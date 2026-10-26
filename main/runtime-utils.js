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

/**
 * 解析关闭窗口时的行为，兼容旧配置 closeToTray。
 * @returns {'tray'|'quit'|'quit-all'}
 */
function resolveCloseAction(closeAction, legacyCloseToTray) {
  if (closeAction === 'tray' || closeAction === 'quit' || closeAction === 'quit-all') {
    return closeAction
  }
  return legacyCloseToTray === false ? 'quit' : 'tray'
}

/**
 * 服务反复退出时的重启退避：窗口内退出次数达到阈值后指数退避，避免崩溃风暴。
 * @param {number[]} exitTimes 退出时间戳
 * @param {number} now 当前时间
 * @param {object} [opts]
 * @returns {number} 建议延迟（毫秒）
 */
function serviceRestartDelay(exitTimes, now = Date.now(), opts = {}) {
  const { windowMs = 2 * 60 * 1000, baseMs = 1500, maxMs = 60000, threshold = 3 } = opts
  const recent = (exitTimes || []).filter(
    (time) => Number.isFinite(time) && now - time <= windowMs,
  )
  if (recent.length < threshold) return baseMs
  const step = Math.min(recent.length - threshold, 6)
  return Math.min(maxMs, baseMs * 2 ** step)
}

/**
 * 规范化界面动效模式：normal（正常）/ blur（失焦暂停）/ always（始终暂停）。
 */
function resolveMotionMode(mode) {
  return mode === 'normal' || mode === 'blur' || mode === 'auto' || mode === 'always'
    ? mode
    : 'auto'
}

/**
 * 当前是否应暂停页面动画/过渡。
 * @param {string} mode 动效模式
 * @param {boolean} focused 窗口是否聚焦
 */
function shouldPauseMotion(mode, focused, idleMs = 0, idleThresholdMs = 90 * 1000) {
  const normalized = resolveMotionMode(mode)
  if (normalized === 'always') return true
  if (normalized === 'blur') return !focused
  if (normalized === 'auto') return !focused || idleMs >= idleThresholdMs
  return false
}

/**
 * 根据会话运行状态变化决定是否发系统通知。
 * @param {{running:boolean,dialogs:number}} prev 上一次轮询状态
 * @param {{running:boolean,dialogs:number}} next 本次轮询状态
 * @param {boolean} focused 窗口是否聚焦
 * @param {{finishEnabled?:boolean,approvalEnabled?:boolean}} opts
 * @returns {'finish'|'approval'|null}
 */
function sessionNotifyDecision(prev, next, focused, opts = {}) {
  const { finishEnabled = true, approvalEnabled = true } = opts
  if (focused) return null
  if (approvalEnabled && Number(next.dialogs) > 0 && Number(prev.dialogs) === 0) return 'approval'
  if (finishEnabled && prev.running === true && next.running === false) return 'finish'
  return null
}

/**
 * 规范化 npm registry 地址；非法值回退到官方源。
 */
function normalizeRegistry(value) {
  const fallback = 'https://registry.npmjs.org/'
  if (typeof value !== 'string') return fallback
  const trimmed = value.trim()
  if (!trimmed) return fallback
  try {
    const url = new URL(trimmed)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return fallback
    return url.href.endsWith('/') ? url.href : `${url.href}/`
  } catch {
    return fallback
  }
}

/**
 * 判断保存的窗口区域是否与任一显示器工作区相交。
 * @param {{x?:number,y?:number,width?:number,height?:number}} saved
 * @param {Array<{x:number,y:number,width:number,height:number}>} workAreas
 */
function boundsIntersectAny(saved, workAreas) {
  if (!saved || typeof saved.width !== 'number' || typeof saved.height !== 'number') return false
  if (!Array.isArray(workAreas) || workAreas.length === 0) return false
  return workAreas.some((area) => {
    const x = Number.isFinite(saved.x) ? saved.x : area.x
    const y = Number.isFinite(saved.y) ? saved.y : area.y
    return (
      x < area.x + area.width &&
      x + saved.width > area.x &&
      y < area.y + area.height &&
      y + saved.height > area.y
    )
  })
}

module.exports = {
  readTail,
  redact,
  updateDelay,
  rotateIfNeeded,
  shouldFallbackToSoftwareRendering,
  resolveCloseAction,
  serviceRestartDelay,
  resolveMotionMode,
  shouldPauseMotion,
  sessionNotifyDecision,
  normalizeRegistry,
  boundsIntersectAny,
}
