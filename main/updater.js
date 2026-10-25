'use strict'

/**
 * 更新器：查询 npm 版本、调用免密助手安装、同步 profile 插件。
 *
 * 安全约定：真正提权安装只通过 root 拥有的 /usr/local/sbin/dsh-update 完成，
 * 客户端进程本身永远以普通用户运行。
 */
const { spawn, execFile } = require('node:child_process')
const fs = require('node:fs')
const https = require('node:https')

const REGISTRY = 'https://registry.npmjs.org/'
const UPDATE_HELPER = '/usr/local/sbin/dsh-update'
const DSH_PACKAGE = '@deepseek-ai/dsh'
const CODEX_PLUGIN = '@deepseek-ai/dsh-subagent-codex'

const packumentCache = new Map()
const CACHE_TTL = 10 * 60 * 1000

/** 解析版本为可比较的结构。 */
function parseVersion(value) {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(String(value).trim())
  if (!m) return null
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    pre: m[4] ? m[4].split('.') : [],
  }
}

/** semver 比较：a>b 返回 1，a<b 返回 -1，相等返回 0。 */
function compareVersions(a, b) {
  const pa = parseVersion(a)
  const pb = parseVersion(b)
  if (!pa || !pb) throw new Error(`无法比较版本: ${a} / ${b}`)
  for (const key of ['major', 'minor', 'patch']) {
    if (pa[key] !== pb[key]) return pa[key] > pb[key] ? 1 : -1
  }
  if (!pa.pre.length && !pb.pre.length) return 0
  if (!pa.pre.length) return 1
  if (!pb.pre.length) return -1
  const len = Math.max(pa.pre.length, pb.pre.length)
  for (let i = 0; i < len; i++) {
    const x = pa.pre[i]
    const y = pb.pre[i]
    if (x === undefined) return -1
    if (y === undefined) return 1
    const xNum = /^\d+$/.test(x)
    const yNum = /^\d+$/.test(y)
    if (xNum && yNum) {
      const diff = Number(x) - Number(y)
      if (diff) return diff > 0 ? 1 : -1
    } else if (xNum) {
      return -1
    } else if (yNum) {
      return 1
    } else if (x !== y) {
      return x > y ? 1 : -1
    }
  }
  return 0
}

/** 获取 npm packument（带缓存）。 */
function fetchPackument(name, timeoutMs = 20000) {
  const cached = packumentCache.get(name)
  if (cached && Date.now() - cached.at < CACHE_TTL) return Promise.resolve(cached.data)
  const url = REGISTRY + name.replace('/', '%2F')
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      { headers: { accept: 'application/json', 'user-agent': 'dsh-desktop/1.0' } },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume()
          reject(new Error(`registry 返回 HTTP ${res.statusCode}`))
          return
        }
        let data = ''
        res.setEncoding('utf8')
        res.on('data', (chunk) => (data += chunk))
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data)
            packumentCache.set(name, { at: Date.now(), data: parsed })
            resolve(parsed)
          } catch (err) {
            reject(err)
          }
        })
      },
    )
    req.on('error', reject)
    req.setTimeout(timeoutMs, () => req.destroy(new Error('registry 请求超时')))
  })
}

/** 运行子进程并收集输出。 */
function run(command, args, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      env: opts.env || process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          timedOut = true
          try {
            child.kill('SIGKILL')
          } catch {
            // ignore
          }
        }, opts.timeoutMs)
      : null
    child.stdout.on('data', (chunk) => (stdout += chunk.toString()))
    child.stderr.on('data', (chunk) => (stderr += chunk.toString()))
    child.on('error', (err) => {
      if (timer) clearTimeout(timer)
      resolve({ code: -1, stdout, stderr: stderr + String(err) })
    })
    child.on('close', (code) => {
      if (timer) clearTimeout(timer)
      resolve({ code: timedOut ? -2 : code, stdout, stderr, timedOut })
    })
    if (opts.onOutput) {
      child.stdout.on('data', opts.onOutput)
      child.stderr.on('data', opts.onOutput)
    }
  })
}

/**
 * 检查更新。
 * @param {object} opts
 * @param {'next'|'latest'} opts.channel
 * @param {string} opts.installedVersion
 * @param {string} [opts.fakeVersion] 测试用：伪造远端版本
 * @returns {Promise<{available:boolean,current:string,latest:string,channel:string}>}
 */
async function checkForUpdate({ channel, installedVersion, fakeVersion }) {
  if (fakeVersion) {
    return {
      available: compareVersions(fakeVersion, installedVersion) > 0,
      current: installedVersion,
      latest: fakeVersion,
      channel: `fake:${channel}`,
    }
  }
  const packument = await fetchPackument(DSH_PACKAGE)
  const tags = packument['dist-tags'] || {}
  const latest = tags[channel] || tags.latest
  if (!latest) throw new Error('npm registry 未提供 dist-tags')
  return {
    available: compareVersions(latest, installedVersion) > 0,
    current: installedVersion,
    latest,
    channel,
  }
}

/** 免密助手是否已安装（仅检查文件存在）。 */
function helperInstalled() {
  return fs.existsSync(UPDATE_HELPER)
}

/**
 * 通过免密助手安装指定版本（需要 setup-privileged.sh 已执行过一次）。
 * @returns {Promise<{ok:boolean, logs:string}>}
 */
async function installVersion(version, onOutput) {
  if (!helperInstalled()) {
    const appRoot =
      process.env.DSH_DESKTOP_PROJECT_DIR ||
      `${process.env.HOME || '~'}/.local/opt/dsh-desktop/resources/app`
    throw new Error(
      `免密升级助手未安装（缺少 ${UPDATE_HELPER}）。请先运行一次：\n` +
        `  sudo bash ${appRoot}/scripts/setup-privileged.sh ${appRoot}/scripts "$USER" ` +
        `"$HOME/.local/opt/dsh-desktop/chrome-sandbox"`,
    )
  }
  const result = await run('sudo', ['-n', UPDATE_HELPER, version], {
    timeoutMs: 10 * 60 * 1000,
    onOutput,
  })
  if (result.code !== 0) {
    const detail = (result.stderr || result.stdout || '').trim().slice(-1500)
    if (/password is required|a terminal is required|not allowed/i.test(detail)) {
      throw new Error(`免密升级助手不可用（sudo 需要密码）。\n${detail}`)
    }
    throw new Error(`安装失败（退出码 ${result.code}）。\n${detail}`)
  }
  return { ok: true, logs: (result.stdout || '').trim() }
}

/**
 * 同步 profile 里的第三方插件版本（peerDependencies 要求与 dsh 精确一致）。
 * 失败只告警，不阻断主流程。
 */
async function syncProfilePlugin({ version, dshBin, dshHome, profile }) {
  const profileName = profile || process.env.DSH_PROFILE || 'web'
  let packument
  try {
    packument = await fetchPackument(CODEX_PLUGIN)
  } catch (err) {
    return { ok: false, skipped: true, reason: `查询插件版本失败: ${err.message}` }
  }
  if (!packument.versions || !packument.versions[version]) {
    return { ok: false, skipped: true, reason: `插件未发布 ${version} 版本，保持现状` }
  }
  const result = await run(
    dshBin,
    ['plugin', '--profile', profileName, 'add', `${CODEX_PLUGIN}@${version}`, '--save-exact'],
    {
      timeoutMs: 5 * 60 * 1000,
      env: { ...process.env, DSH_HOME: dshHome },
    },
  )
  const output = (result.stdout + result.stderr).trim()
  return { ok: result.code === 0, output: output.slice(-2000) }
}

module.exports = {
  checkForUpdate,
  compareVersions,
  parseVersion,
  installVersion,
  helperInstalled,
  syncProfilePlugin,
  run,
  UPDATE_HELPER,
}
