'use strict'

/**
 * 管理 dsh web 服务进程：
 * - 优先使用客户端自己拉起的进程（可随更新重启）
 * - 若端口已被 dsh-start 之类的旧服务占用，可选择接管或复用
 */
const { spawn, execFileSync } = require('node:child_process')
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')

const { readTail } = require('./runtime-utils')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** 探测一个 URL 是否有响应（任何 HTTP 状态码都算活着）。 */
function probe(url, timeoutMs = 1500) {
  return new Promise((resolve) => {
    let done = false
    const finish = (value) => {
      if (done) return
      done = true
      resolve(value)
    }
    const req = http.request(url, { method: 'HEAD' }, (res) => {
      res.resume()
      finish(true)
    })
    req.on('error', () => finish(false))
    req.end()
    req.setTimeout(timeoutMs, () => {
      req.destroy()
      finish(false)
    })
  })
}

function readCmdline(pid) {
  try {
    return fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').join(' ').trim()
  } catch {
    return ''
  }
}

/** 通过 ss 找到监听某端口的进程 pid。 */
function findPortPid(port) {
  try {
    const out = execFileSync('ss', ['-ltnp'], { encoding: 'utf8', timeout: 1500 })
    for (const line of out.split('\n')) {
      if (!line.includes(`:${port} `) && !line.includes(`:${port}\t`)) continue
      const m = /pid=(\d+)/.exec(line)
      if (m) return Number(m[1])
    }
  } catch {
    // ignore
  }
  return null
}

class ServerManager {
  /**
   * @param {object} opts
   * @param {string} opts.port
   * @param {string} [opts.dshHome]
   * @param {string} [opts.bin]      dsh 可执行文件路径（默认自动探测）
   * @param {string} opts.logFile    服务日志文件
   */
  constructor(opts) {
    this.port = Number(opts.port)
    this.dshHome = opts.dshHome || path.join(os.homedir(), '.dsh')
    this.logFile = opts.logFile
    this.lockFile = opts.lockFile || path.join(this.dshHome, 'web.lock')
    this.bin = opts.bin || null
    this.child = null
    this.tokenUrl = null
    this.externalPid = null
    this.logs = []
    this.stopping = false
    this.starting = null
    this.startupError = null
    this.startupTimeoutMs = opts.startupTimeoutMs || 30000
    this.onExit = typeof opts.onExit === 'function' ? opts.onExit : null
  }

  get baseUrl() {
    return `http://127.0.0.1:${this.port}/`
  }

  /** 探测 dsh 可执行文件：DSH_BIN > ~/.local/bin/dsh > /usr/bin/dsh > PATH */
  resolveBin() {
    if (this.bin) return this.bin
    const candidates = [
      process.env.DSH_DESKTOP_DSH_BIN,
      path.join(os.homedir(), '.local', 'bin', 'dsh'),
      '/usr/bin/dsh',
    ].filter(Boolean)
    for (const candidate of candidates) {
      try {
        fs.accessSync(candidate, fs.constants.X_OK)
        this.bin = candidate
        return candidate
      } catch {
        // 继续
      }
    }
    throw new Error('找不到 dsh 可执行文件，请确认已安装 @deepseek-ai/dsh')
  }

  /** 读取当前安装的 dsh 版本。 */
  installedVersion() {
    const bin = this.resolveBin()
    const real = fs.realpathSync(bin)
    // /…/node_modules/@deepseek-ai/dsh/lib/bin.js -> 包根目录
    const pkgRoot = path.dirname(path.dirname(real))
    const pkg = JSON.parse(fs.readFileSync(path.join(pkgRoot, 'package.json'), 'utf8'))
    return pkg.version
  }

  /** 端口上是否已有服务（返回 {pid, url, cmdline} 或 null）。 */
  async detectExisting() {
    const alive = await probe(this.baseUrl)
    if (!alive) return null

    const pid = findPortPid(this.port)
    let tokenUrl = null
    // token 可能来自客户端自己的 server.log，也可能来自旧浏览器版的 ~/.dsh/web.log
    const logCandidates = [this.logFile, path.join(this.dshHome, 'web.log')]
      .filter(Boolean)
      .map((file) => {
        let mtime = 0
        try {
          mtime = fs.statSync(file).mtimeMs
        } catch {
          // ignore
        }
        return { file, mtime }
      })
      .sort((a, b) => b.mtime - a.mtime)
    for (const candidate of logCandidates) {
      try {
        const log = readTail(candidate.file, 400)
        const matches = [...log.matchAll(/http:\/\/127\.0\.0\.1:(\d+)\/\?token=([A-Za-z0-9_-]+)/g)]
        for (const match of matches.reverse().slice(0, 8)) {
          if (Number(match[1]) !== this.port) continue
          const url = `${this.baseUrl}?token=${match[2]}`
          if (await validToken(url)) { tokenUrl = url; break }
        }
        if (tokenUrl) break
      } catch {
        // ignore
      }
    }
    let pidFromFile = null
    try {
      pidFromFile = Number(fs.readFileSync(path.join(this.dshHome, 'web.pid'), 'utf8').trim()) || null
    } catch {
      // ignore
    }
    const effectivePid = pid || pidFromFile
    return {
      pid: effectivePid,
      url: tokenUrl,
      cmdline: effectivePid ? readCmdline(effectivePid) : '',
    }
  }

  /** 复用已在运行的服务。 */
  attachExisting(existing) {
    if (!isDshCommand(existing.cmdline) || !existing.url) {
      throw new Error('端口已被占用，但无法确认有效的 dsh 服务及访问凭据')
    }
    this.externalPid = existing.pid || null
    this.tokenUrl = existing.url
    this.pushLog(`复用已运行的服务 pid=${existing.pid || '未知'}`)
    if (!this.tokenUrl) throw new Error('无法从 ~/.dsh/web.log 读取访问 token')
    return this.tokenUrl
  }

  pushLog(line) {
    const text = String(line).trimEnd()
    this.logs.push(text)
    if (this.logs.length > 400) this.logs.shift()
  }

  /** 等待服务就绪，返回带 token 的访问地址。 */
  async waitReady(timeoutMs = this.startupTimeoutMs) {
    const child = this.child
    const startedAt = Date.now()
    while (Date.now() - startedAt < timeoutMs) {
      if (this.startupError) throw this.startupError
      if (!child || child.exitCode !== null || child.signalCode !== null) {
        throw new Error(
          `dsh web 启动失败（退出码 ${child?.exitCode ?? child?.signalCode ?? '未启动'}）。日志：\n${this.logs.slice(-15).join('\n')}`,
        )
      }
      if (this.tokenUrl && (await probe(this.tokenUrl, 1000))) {
        return this.tokenUrl
      }
      await sleep(400)
    }
    throw new Error(`等待服务就绪超时。日志：\n${this.logs.slice(-15).join('\n')}`)
  }

  /** 拉起自己的 dsh web 进程。 */
  start() {
    if (this.starting) return this.starting
    this.starting = this._start().finally(() => { this.starting = null })
    return this.starting
  }

  async _start() {
    if (this.child) return this.tokenUrl || this.waitReady()
    const existing = await this.detectExisting()
    if (existing) return this.attachExisting(existing)
    this.externalPid = null
    this.startupError = null
    this.stopping = false
    this.tokenUrl = null
    const bin = this.resolveBin()
    fs.accessSync(bin, fs.constants.X_OK)
    this.pushLog(`启动（锁 ${this.lockFile}）: ${bin} web --no-open --port ${this.port}`)
    fs.mkdirSync(path.dirname(this.logFile), { recursive: true })
    const logStream = fs.createWriteStream(this.logFile, { flags: 'a', mode: 0o600 })
    logStream.on('error', (err) => { this.pushLog(`写入服务日志失败: ${err.message}`) })
    logStream.write(`\n===== ${new Date().toISOString()} DeepSeek Harness 桌面客户端启动服务 =====\n`)

    const env = { ...process.env, DSH_HOME: this.dshHome }
    for (const key of Object.keys(env)) {
      if (key.startsWith('DSH_DESKTOP_')) delete env[key]
    }
    const child = spawn('/usr/bin/flock', ['-n', this.lockFile, bin, 'web', '--no-open', '--port', String(this.port)], {
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env,
    })
    this.child = child

    let tail = ''
    const onData = (chunk) => {
      const text = chunk.toString()
      for (const line of text.split(/\r?\n/)) {
        if (!line.trim()) continue
        this.pushLog(line)
        logStream.write(line + '\n')
      }
      // token 行可能跨 chunk 到达，保留尾部再匹配
      tail = (tail + text).slice(-4096)
      const m = [...tail.matchAll(/http:\/\/127\.0\.0\.1:(\d+)\/\?token=([A-Za-z0-9_-]+)/g)].at(-1)
      if (m) this.tokenUrl = `http://127.0.0.1:${m[1]}/?token=${m[2]}`
    }
    child.on('error', (err) => { this.startupError = err })
    child.on('close', () => logStream.end())
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.on('exit', (code, signal) => {
      this.pushLog(`服务进程退出 code=${code} signal=${signal}`)
      logStream.write(`[desktop] 服务进程退出 code=${code} signal=${signal}\n`)
      if (this.child === child) {
        this.child = null
        this.tokenUrl = null
      }
      if (!this.stopping && !this.starting && this.onExit) {
        try {
          this.onExit({ code, signal })
        } catch {
          // ignore
        }
      }
    })

    try {
      return await this.waitReady()
    } catch (err) {
      await this.stop()
      // 另一启动器抢先绑定端口时，验证并复用，而非重复拉起进程。
      const replacement = await this.detectExisting()
      if (replacement && replacement.url && isDshCommand(replacement.cmdline)) {
        return this.attachExisting(replacement)
      }
      throw err
    }
  }

  /** 停止自己拉起的进程，或接管时停止外部进程。 */
  async stop({ includeExternal = false } = {}) {
    this.stopping = true
    const child = this.child
    this.child = null
    this.tokenUrl = null
    if (child) {
      this.pushLog(`停止服务 pid=${child.pid}`)
      try {
        process.kill(-child.pid, 'SIGTERM')
      } catch {
        try {
          child.kill('SIGTERM')
        } catch {
          // ignore
        }
      }
      const deadline = Date.now() + 8000
      while (child.pid && Date.now() < deadline && child.exitCode === null && child.signalCode === null) await sleep(150)
      if (child.exitCode === null && child.signalCode === null && child.pid) {
        try {
          process.kill(-child.pid, 'SIGKILL')
        } catch {
          try {
            child.kill('SIGKILL')
          } catch {
            // ignore
          }
        }
        await sleep(300)
      }
    }
    const externalPid = this.externalPid
    this.externalPid = null
    const stopExternal = includeExternal && externalPid && isDshCommand(readCmdline(externalPid))
    if (stopExternal) {
      // 若网页服务由用户级 systemd 托管，先停掉重启策略，再处理进程本身。
      try {
        const runtime = process.env.XDG_RUNTIME_DIR || `/run/user/${process.getuid()}`
        const env = { ...process.env, XDG_RUNTIME_DIR: runtime }
        if (!env.DBUS_SESSION_BUS_ADDRESS) env.DBUS_SESSION_BUS_ADDRESS = `unix:path=${runtime}/bus`
        execFileSync('systemctl', ['--user', 'stop', 'dsh-web-session.service'], {
          env,
          stdio: 'ignore',
          timeout: 4000,
        })
      } catch {
        // 没有 systemd 单元时继续按 PID 停止。
      }
      // 只有明确的用户重启/接管才停止外部服务，且只发信号给该进程。
      this.pushLog(`停止外部服务 pid=${externalPid}`)
      try { process.kill(externalPid, 'SIGTERM') } catch { /* already stopped */ }
      const deadline = Date.now() + 6000
      while (Date.now() < deadline && isDshCommand(readCmdline(externalPid))) await sleep(100)
      if (isDshCommand(readCmdline(externalPid))) {
        try { process.kill(externalPid, 'SIGKILL') } catch { /* already stopped */ }
      }
    }
    if (!child && !stopExternal) return
    // 等端口释放
    for (let i = 0; i < 30; i++) {
      if (!(await probe(this.baseUrl, 500))) return
      await sleep(200)
    }
  }

  async restart() {
    await this.stop({ includeExternal: true })
    return this.start()
  }
}

function isDshCommand(cmdline) {
  return /(?:^|[ /])(?:dsh|dsh\/lib\/bin\.js)\s+(?:web|--profile\s+web)(?:\s|$)/.test(cmdline || '')
}

// 校验登录跳转和认证 Cookie，避免从旧日志取到已经失效的 token。
function validToken(url, timeoutMs = 1200) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume()
      resolve([302, 303].includes(res.statusCode) &&
        (res.headers['set-cookie'] || []).some((c) => /^dsh-auth-/.test(c)))
    })
    req.on('error', () => resolve(false))
    req.setTimeout(timeoutMs, () => { req.destroy(); resolve(false) })
  })
}

module.exports = { ServerManager, probe, findPortPid, readCmdline, isDshCommand, validToken }
