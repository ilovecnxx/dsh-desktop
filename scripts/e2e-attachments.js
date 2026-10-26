#!/usr/bin/env node
'use strict'

/**
 * 附件体验 e2e：起一个隔离的 dsh web 服务 + Electron 测试实例，
 * 自动执行「三图拖拽 + 剪贴板截图 Ctrl+V 粘贴」，输出结构化结果。
 * 需要在有显示环境（CI 用 xvfb-run）下运行；退出码 0 表示通过。
 */
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const projectDir = process.env.E2E_PROJECT || process.cwd()

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-e2e-'))
  const dshHome = path.join(root, 'home')
  const work = path.join(root, 'work')
  const userData = path.join(root, 'ud')
  for (const dir of [dshHome, work, userData]) fs.mkdirSync(dir, { recursive: true })

  // 本地/有 profile 时复用，避免重新初始化；CI 则让 dsh 自举默认 profile
  const sourceHome = process.env.E2E_SOURCE_DSH_HOME || path.join(os.homedir(), '.dsh')
  for (const name of ['profiles', 'storages']) {
    const src = path.join(sourceHome, name)
    if (!fs.existsSync(src)) continue
    try {
      fs.symlinkSync(src, path.join(dshHome, name))
    } catch {
      // ignore
    }
  }

  const dsh = spawn('/usr/bin/dsh', ['web', '--no-open', '--port', '0'], {
    cwd: work,
    env: { ...process.env, DSH_HOME: dshHome },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let dshOutput = ''
  const url = await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`dsh web 启动超时\n${dshOutput.slice(-2000)}`)),
      60000,
    )
    const onData = (chunk) => {
      dshOutput += chunk.toString()
      const match = dshOutput.match(/http:\/\/127\.0\.0\.1:(\d+)\/\?token=([A-Za-z0-9_-]+)/)
      if (match) {
        clearTimeout(timer)
        resolve(match[0])
      }
    }
    dsh.stdout.on('data', onData)
    dsh.stderr.on('data', onData)
    dsh.once('exit', (code) => reject(new Error(`dsh web 退出 ${code}\n${dshOutput.slice(-2000)}`)))
  })
  const port = new URL(url).port
  fs.writeFileSync(path.join(userData, 'server.log'), `${url}\n`)

  const electron = path.join(projectDir, 'node_modules/electron/dist/electron')
  const args = ['--no-sandbox', '--disable-gpu']
  if (process.env.WAYLAND_DISPLAY) args.push('--ozone-platform=wayland')
  const logFile = path.join(root, 'run.log')
  const runLog = fs.createWriteStream(logFile)
  const child = spawn(electron, [...args, '.'], {
    cwd: projectDir,
    env: {
      ...process.env,
      DSH_HOME: dshHome,
      DSH_DESKTOP_USER_DATA: userData,
      DSH_DESKTOP_PORT: port,
      DSH_DESKTOP_TAKEOVER: 'reuse',
      DSH_DESKTOP_NO_TRAY: '1',
      DSH_DESKTOP_EXIT_AFTER_MS: '18000',
      DSH_DESKTOP_TEST_ATTACHMENTS: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.pipe(runLog)
  child.stderr.pipe(runLog)
  const code = await new Promise((resolve) => child.on('exit', resolve))
  await sleep(500)

  const log = fs.readFileSync(logFile, 'utf8')
  const match = log.match(/\[test\] attachments (\{.*\})/)
  let result = null
  if (match) {
    try {
      result = JSON.parse(match[1])
    } catch {
      result = null
    }
  }
  console.log('E2E_RESULT ' + JSON.stringify({ code, result }))
  if (!result) {
    console.error('--- run.log tail ---')
    console.error(log.slice(-3000))
    console.error('--- keep dir:', root)
  }
  try {
    process.kill(-dsh.pid, 'SIGTERM')
  } catch {
    dsh.kill('SIGTERM')
  }
  if (result) {
    try {
      fs.rmSync(root, { recursive: true, force: true })
    } catch {
      // ignore
    }
  }
  if (!result) {
    console.error('未找到 [test] attachments 结果')
    process.exit(1)
  }
  const ok = result.drop && result.drop.chips >= 1 && result.paste && result.paste.chips >= 1
  process.exit(ok ? 0 : 1)
}

main().catch((err) => {
  console.error(err.message)
  process.exit(2)
})
