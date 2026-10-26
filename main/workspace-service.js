'use strict'

/**
 * 为「拖入文件夹作为工作区」启动一个独立的 dsh web 实例：
 * - cwd = 文件夹（工作区）
 * - 随机空闲端口
 * - 从 stdout 解析带 token 的访问地址
 * 窗口关闭时调用 stop() 释放进程。
 */
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const net = require('node:net')
const os = require('node:os')
const path = require('node:path')

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
  })
}

/**
 * @param {string} folder
 * @param {{dshHome?:string, bin?:string, timeoutMs?:number}} [opts]
 * @returns {Promise<{port:number,url:string,child:import('node:child_process').ChildProcess,stop:()=>void}>}
 */
async function startWorkspaceService(folder, opts = {}) {
  const target = path.resolve(String(folder || ''))
  let stat
  try {
    stat = fs.statSync(target)
  } catch {
    throw new Error(`工作区文件夹不存在：${target}`)
  }
  if (!stat.isDirectory()) throw new Error(`不是文件夹：${target}`)
  const dshHome = opts.dshHome || process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
  const bin = opts.bin || '/usr/bin/dsh'
  const port = await getFreePort()
  const child = spawn(bin, ['web', '--no-open', '--port', String(port)], {
    cwd: target,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, DSH_HOME: dshHome },
  })
  const logs = []
  const timeoutMs = opts.timeoutMs || 45000
  const url = await new Promise((resolve, reject) => {
    let settled = false
    const finish = (fn, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      fn(value)
    }
    const timer = setTimeout(() => {
      finish(reject, new Error(`工作区服务启动超时。日志：\n${logs.slice(-10).join('\n')}`))
    }, timeoutMs)
    const onData = (chunk) => {
      const text = chunk.toString('utf8')
      logs.push(text)
      if (logs.length > 200) logs.shift()
      const match = text.match(
        new RegExp(`http://127\\.0\\.0\\.1:${port}/\\?token=([A-Za-z0-9_-]+)`),
      )
      if (match) finish(resolve, `http://127.0.0.1:${port}/?token=${match[1]}`)
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.once('error', (err) => finish(reject, err))
    child.once('exit', (code, signal) => {
      if (!settled) {
        finish(
          reject,
          new Error(`工作区服务退出（code=${code} signal=${signal}）。日志：\n${logs.slice(-10).join('\n')}`),
        )
      }
    })
  })
  const stop = () => {
    try {
      process.kill(-child.pid, 'SIGTERM')
    } catch {
      try {
        child.kill('SIGTERM')
      } catch {
        // ignore
      }
    }
  }
  return { port, url, child, stop, folder: target }
}

module.exports = { startWorkspaceService, getFreePort }
