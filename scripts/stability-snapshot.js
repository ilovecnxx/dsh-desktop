#!/usr/bin/env node
'use strict'
/** 稳定性观察快照：追加一行 JSON 到 ~/.config/dsh-desktop/observation.jsonl */
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const configDir = path.join(os.homedir(), '.config', 'dsh-desktop')
const outFile = path.join(configDir, 'observation.jsonl')
fs.mkdirSync(configDir, { recursive: true })

function sh(cmd, args = []) {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', timeout: 5000 }).trim()
  } catch {
    return ''
  }
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

const env = { ...process.env, XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR || `/run/user/${process.getuid()}` }
const userService = (() => {
  try {
    return execFileSync('systemctl', ['--user', 'is-active', 'dsh-web-session.service'], {
      encoding: 'utf8',
      timeout: 5000,
      env,
    }).trim()
  } catch {
    return 'inactive'
  }
})()

const clients = sh('pgrep', ['-af', 'opt/dsh-desktop/dsh-desktop --ozone'])
  .split('\n')
  .filter(Boolean)
const ports = sh('ss', ['-ltn'])
  .split('\n')
  .filter((line) => line.includes(':3080 ') || line.includes(':3081 '))
  .map((line) => line.replace(/\s+/g, ' ').trim())

const stability = readJson(path.join(configDir, 'stability.json'))
const record = {
  ts: new Date().toISOString(),
  version: stability && stability.version,
  dshVersion: stability && stability.dshVersion,
  clientRunning: clients.length > 0,
  clientPids: clients.map((line) => Number(line.split(/\s+/)[0])).filter(Boolean),
  devServiceActive: userService === 'active',
  rootServiceActive: sh('systemctl', ['is-active', 'dsh-web-root.service']) === 'active',
  ports,
  stability: stability || null,
  recentErrors: (() => {
    try {
      const { readTail } = require('../main/runtime-utils')
      return readTail(path.join(configDir, 'main.log'), 40)
        .split('\n')
        .filter((line) => /错误|失败|崩溃|GPU 进程退出/.test(line))
        .slice(-5)
    } catch {
      return []
    }
  })(),
}
fs.appendFileSync(outFile, JSON.stringify(record) + '\n')
console.log(JSON.stringify(record))
