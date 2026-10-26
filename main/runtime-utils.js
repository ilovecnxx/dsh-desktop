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

/**
 * 日志超过上限时轮转为 <file>.1（只保留一份旧日志），返回是否发生轮转。
 * 读取/写入失败时静默返回 false，不影响主流程。
 */
function rotateIfNeeded(file, maxBytes = 2 * 1024 * 1024) {
  try {
    const stat = fs.statSync(file)
    if (stat.size < maxBytes) return false
    const backup = `${file}.1`
    try {
      fs.rmSync(backup, { force: true })
    } catch {
      // ignore
    }
    fs.renameSync(file, backup)
    return true
  } catch {
    return false
  }
}

/**
 * GPU 进程在时间窗口内反复崩溃时，建议切换到软件渲染。
 * @param {number[]} crashTimes 崩溃时间戳（毫秒）
 * @param {number} now 当前时间戳
 * @param {number} windowMs 统计窗口
 * @param {number} threshold 触发阈值
 */
function shouldFallbackToSoftwareRendering(
  crashTimes,
  now = Date.now(),
  windowMs = 10 * 60 * 1000,
  threshold = 2,
) {
  if (!Array.isArray(crashTimes) || crashTimes.length === 0) return false
  const recent = crashTimes.filter((time) => Number.isFinite(time) && now - time <= windowMs)
  return recent.length >= threshold
}

module.exports = {
  readTail,
  redact,
  updateDelay,
  rotateIfNeeded,
  shouldFallbackToSoftwareRendering,
}
