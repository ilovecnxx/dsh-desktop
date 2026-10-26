'use strict'

/**
 * systemd 用户服务托管：把 dsh web 作为独立服务运行，客户端重启/崩溃不再中断会话。
 * 仅负责生成/安装 unit、启停与读取 token；调用方需要自行处理端口与探测。
 */
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const UNIT_NAME = 'dsh-web-session.service'

function unitDir() {
  return path.join(os.homedir(), '.config', 'systemd', 'user')
}

function unitPath() {
  return path.join(unitDir(), UNIT_NAME)
}

/**
 * @param {{dshHome:string,port:number,workspace:string,logFile:string,dsh?:string,flock?:string}} opts
 */
function buildUnit(opts) {
  const dsh = opts.dsh || '/usr/bin/dsh'
  const flock = opts.flock || '/usr/bin/flock'
  const lock = path.join(opts.dshHome, 'web.lock')
  return `[Unit]
Description=DeepSeek Harness web service (DSH Desktop)
After=network.target

[Service]
Type=simple
WorkingDirectory=${opts.workspace}
Environment=DSH_HOME=${opts.dshHome}
ExecStart=${flock} -n ${lock} ${dsh} web --no-open --port ${opts.port}
Restart=on-failure
RestartSec=2
StandardOutput=append:${opts.logFile}
StandardError=append:${opts.logFile}

[Install]
WantedBy=default.target
`
}

function control(args, timeout = 15000) {
  execFileSync('systemctl', ['--user', ...args], { timeout, stdio: 'ignore' })
}

function available() {
  try {
    execFileSync('systemctl', ['--user', 'is-system-running'], { timeout: 3000, stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

function installUnit(opts) {
  fs.mkdirSync(unitDir(), { recursive: true })
  fs.mkdirSync(path.dirname(opts.logFile), { recursive: true })
  fs.writeFileSync(unitPath(), buildUnit(opts), { mode: 0o644 })
  control(['daemon-reload'])
}

function start() {
  control(['start', UNIT_NAME])
}

function stop() {
  control(['stop', UNIT_NAME])
}

function isActive() {
  try {
    return (
      execFileSync('systemctl', ['--user', 'is-active', UNIT_NAME], {
        encoding: 'utf8',
        timeout: 5000,
      }).trim() === 'active'
    )
  } catch {
    return false
  }
}

function mainPid() {
  try {
    const out = execFileSync(
      'systemctl',
      ['--user', 'show', '-p', 'MainPID', '--value', UNIT_NAME],
      { encoding: 'utf8', timeout: 5000 },
    ).trim()
    return Number(out) || null
  } catch {
    return null
  }
}

/** 从 systemd 服务日志里解析出本端口的带 token 访问地址。 */
function parseTokenFromLog(text, port) {
  const matches = [...String(text || '').matchAll(/http:\/\/127\.0\.0\.1:(\d+)\/\?token=([A-Za-z0-9_-]+)/g)]
  for (const match of matches.reverse()) {
    if (Number(match[1]) !== Number(port)) continue
    return `http://127.0.0.1:${port}/?token=${match[2]}`
  }
  return null
}

module.exports = {
  UNIT_NAME,
  unitPath,
  buildUnit,
  installUnit,
  available,
  start,
  stop,
  isActive,
  mainPid,
  parseTokenFromLog,
}
