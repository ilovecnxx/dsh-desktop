'use strict'
const fs = require('node:fs')

// 日志增长后仍只读取最后 64 KiB，避免诊断和重连阻塞主进程。
function readTail(file, maxLines = 200, maxBytes = 64 * 1024) {
  let fd
  try {
    fd = fs.openSync(file, 'r')
    const size = fs.fstatSync(fd).size
    const length = Math.min(size, maxBytes)
    const buffer = Buffer.alloc(length)
    const count = fs.readSync(fd, buffer, 0, length, size - length)
    const text = buffer.subarray(0, count).toString('utf8')
    return text.split('\n').slice(-maxLines).join('\n')
  } catch { return '' } finally { if (fd !== undefined) fs.closeSync(fd) }
}

function redact(text) {
  return String(text).replace(/([?&]token=)[A-Za-z0-9_-]+/g, '$1[redacted]')
}

function updateDelay(lastCheckAt, interval, minimumDelay) {
  const last = Date.parse(lastCheckAt || '')
  if (!Number.isFinite(last) || last > Date.now()) return minimumDelay
  return Math.max(minimumDelay, interval - (Date.now() - last))
}

module.exports = { readTail, redact, updateDelay }
