'use strict'

/**
 * DeepSeek Harness 桌面客户端（Linux）。
 *
 * 职责：
 * - 管理 dsh web 服务进程（启动、停止、重启、接管旧服务）
 * - 原生窗口 / 系统托盘 / 应用菜单
 * - 检查 npm 上的新版本，通过免密助手一键升级并自动重启
 */
const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, dialog, shell, Notification, globalShortcut, clipboard, screen } = require('electron')
const fs = require('node:fs')
const { execFileSync } = require('node:child_process')
const os = require('node:os')
const path = require('node:path')

const { Config } = require('./config')
const { ServerManager, probe, findPortPid, readCmdline, isDshCommand, validToken } = require('./server')
const {
  readTail: boundedReadTail,
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
} = require('./runtime-utils')
const updater = require('./updater')
const shellUpdater = require('./shell-updater')
const utility = require('./utility')
const sessionsStore = require('./sessions')
const { buildApplicationMenu, buildTrayMenu } = require('./menu')

const APP_NAME = 'DeepSeek Harness'
app.setName(APP_NAME)
// Wayland 下 app_id / X11 WM_CLASS：名称不带 .desktop 后缀，需与桌面文件同名
try {
  if (typeof app.setDesktopName === 'function') app.setDesktopName('dsh-desktop')
} catch {
  // ignore
}

// GPU 进程反复崩溃时 Chromium 默认会直接退出应用；禁用该上限，交给软件渲染回退处理
app.commandLine.appendSwitch('disable-gpu-process-crash-limit')

const PROJECT_DIR = path.resolve(__dirname, '..')
const USER_DATA = process.env.DSH_DESKTOP_USER_DATA || path.join(os.homedir(), '.config', 'dsh-desktop')
app.setPath('userData', USER_DATA)

const PORT_ENV = process.env.DSH_DESKTOP_PORT
let port = Number(PORT_ENV || 3080)
const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
const SERVER_LOG = path.join(USER_DATA, 'server.log')
const MAIN_LOG = path.join(USER_DATA, 'main.log')
const LAUNCHER = process.env.DSH_DESKTOP_LAUNCHER || path.join(os.homedir(), '.local', 'bin', 'dsh-desktop')
const AUTOSTART = process.argv.includes('--autostart')

const CAPTURE_PATH = process.env.DSH_DESKTOP_CAPTURE || null
const CAPTURE_DELAY = Number(process.env.DSH_DESKTOP_CAPTURE_DELAY_MS || 3000)
const CAPTURE_EVERY = process.env.DSH_DESKTOP_CAPTURE_EVERY_LOAD === '1'
const FAKE_UPDATE = process.env.DSH_DESKTOP_FAKE_UPDATE || null
const CHECK_DELAY = Number(process.env.DSH_DESKTOP_CHECK_DELAY_MS || 30000)
// 测试钩子：启动后自动触发一次升级（用于端到端验证）
const TEST_UPGRADE = process.env.DSH_DESKTOP_TEST_UPGRADE || null
const TEST_UPGRADE_DELAY = Number(process.env.DSH_DESKTOP_TEST_UPGRADE_DELAY_MS || 2500)
const EXIT_AFTER_UPGRADE = process.env.DSH_DESKTOP_EXIT_AFTER_UPGRADE === '1'
// 测试钩子：杀死服务进程模拟崩溃 / 触发客户端壳自更新 / 定时退出
const TEST_KILL_SERVER_MS = Number(process.env.DSH_DESKTOP_TEST_KILL_SERVER_MS || 0)
const TEST_STOP_SERVER_MS = Number(process.env.DSH_DESKTOP_TEST_STOP_SERVER_MS || 0)
const TEST_SHELL_UPDATE = process.env.DSH_DESKTOP_TEST_SHELL_UPDATE === '1'
// 测试钩子：模拟 GPU 进程崩溃
const TEST_GPU_CRASH_MS = Number(process.env.DSH_DESKTOP_TEST_GPU_CRASH_MS || 0)
const TEST_GPU_FALLBACK = process.env.DSH_DESKTOP_TEST_GPU_FALLBACK === '1'
const TEST_HIDE_MS = Number(process.env.DSH_DESKTOP_TEST_HIDE_MS || 0)
const TEST_GPU_LAUNCH_FAILED = process.env.DSH_DESKTOP_TEST_GPU_LAUNCH_FAILED === '1'
const TEST_NO_RELAUNCH = process.env.DSH_DESKTOP_TEST_NO_RELAUNCH === '1'
// 页面诊断：加载后输出动画/内存信息（用于排查高 CPU）
const PAGE_DIAG_MS = Number(process.env.DSH_DESKTOP_PAGE_DIAG_MS || 0)
const SHELL_NO_RELAUNCH = process.env.DSH_DESKTOP_SHELL_UPDATE_NO_RELAUNCH === '1'
const EXIT_AFTER_MS = Number(process.env.DSH_DESKTOP_EXIT_AFTER_MS || 0)
const NO_TRAY = process.env.DSH_DESKTOP_NO_TRAY === '1'
const TAKEOVER = process.env.DSH_DESKTOP_TAKEOVER || 'reuse'

let config = null
let server = null
let win = null
let tray = null
let progressWin = null
let pendingUpdate = null
let upgrading = false
let quitting = false
let managed = false
let trayHintShown = false
let autoCheckTimer = null
let captureDone = false
let healthTimer = null
let healthFailures = 0
let recovering = false
let reconnectVisible = false
let serviceHealthy = true
let shortcutRegistered = false
let boundsTimer = null
let healthChecking = false
let lastRendererRecovery = 0
let quitPromise = null
let logWrites = 0
let lastMotionPaused = null
let lastActivityAt = Date.now()
let motionTimer = null
let sessionWatchTimer = null
const auxWindows = new Set()
const auxMotionState = new WeakMap()
let sessionPrev = { running: false, dialogs: 0 }
let recentSessions = []
let recentSessionsTimer = null
let recentSessionsLoading = false
const gpuCrashTimes = []
const serviceExitTimes = []
let gpuFallbackInProgress = false
const MAIN_LOG_MAX_BYTES = 2 * 1024 * 1024
const bootStartedAt = performance.now()

function log(...args) {
  const line =
    `[${new Date().toISOString()}] ` +
    args.map((a) => redact(typeof a === 'string' ? a : JSON.stringify(a))).join(' ')
  console.log(line)
  try {
    fs.mkdirSync(USER_DATA, { recursive: true })
    // 每 200 行检查一次大小，避免每次写日志都 stat
    if (++logWrites % 200 === 0) rotateIfNeeded(MAIN_LOG, MAIN_LOG_MAX_BYTES)
    fs.appendFileSync(MAIN_LOG, line + '\n')
  } catch {
    // ignore
  }
}

function iconPath(name) {
  return path.join(PROJECT_DIR, 'assets', name)
}

function escapeHtml(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function notify(title, body) {
  try {
    if (!Notification.isSupported()) return
    const notification = new Notification({ title, body, icon: iconPath('icon-256.png') })
    // 点击通知聚焦客户端
    notification.on('click', () => showWindow())
    notification.show()
  } catch {
    // ignore
  }
}

const GPU_CRASH_WINDOW_MS = 10 * 60 * 1000
const GPU_CRASH_THRESHOLD = 2

/** 处理 GPU 进程崩溃：10 分钟内反复崩溃则引导切换到软件渲染。 */
async function handleGpuProcessGone(details = {}) {
  const now = Date.now()
  gpuCrashTimes.push(now)
  // 只保留窗口内的时间戳，避免数组无限增长
  while (gpuCrashTimes.length && now - gpuCrashTimes[0] > GPU_CRASH_WINDOW_MS) gpuCrashTimes.shift()
  log(
    `GPU 进程退出 reason=${details.reason || 'unknown'} exitCode=${details.exitCode ?? 'unknown'}`,
  )
  if (!config || config.get('softwareRendering') || gpuFallbackInProgress) return
  if (!shouldFallbackToSoftwareRendering(gpuCrashTimes, now, GPU_CRASH_WINDOW_MS, GPU_CRASH_THRESHOLD)) {
    return
  }
  gpuFallbackInProgress = true
  const launchFailed = String(details.reason || '').includes('launch-failed')
  log(`GPU 进程 10 分钟内反复崩溃，准备切换到软件渲染${launchFailed ? '（启动失败，自动切换）' : ''}`)
  if (TEST_GPU_FALLBACK) {
    config.set('softwareRendering', true)
    log('[test] 已写入 softwareRendering=true（测试模式不重启）')
    return
  }
  if (launchFailed) {
    // GPU 进程连启动都失败时对话框可能也无法正常显示，直接自动降级重启
    config.set('softwareRendering', true)
    notify('图形加速不可用', 'GPU 进程启动失败，正在以软件渲染重启客户端…')
    log('GPU 启动失败，自动切换软件渲染并重启客户端')
    if (TEST_NO_RELAUNCH) {
      log('[test] 跳过自动重启（DSH_DESKTOP_TEST_NO_RELAUNCH=1）')
      return
    }
    try {
      await server.stop()
    } catch (err) {
      log(`切换软件渲染前停止服务失败: ${err.message}`)
    }
    app.relaunch()
    app.exit(0)
    return
  }
  notify('图形加速异常', 'GPU 进程反复崩溃，可在设置中启用软件渲染后重启客户端。')
  if (!win || win.isDestroyed()) return
  try {
    const answer = await dialog.showMessageBox(win, {
      type: 'warning',
      title: '图形加速异常',
      message: 'GPU 进程反复崩溃',
      detail:
        '可以让客户端改用软件渲染后重启（会一并重启后台服务，会话记录保留）。\n' +
        '如果选择稍后，也可以随时在「设置 → 软件渲染」里手动开启。',
      buttons: ['立即重启并启用软件渲染', '稍后'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    })
    if (answer.response === 0) {
      config.set('softwareRendering', true)
      try {
        await server.stop()
      } catch (err) {
        log(`切换软件渲染前停止服务失败: ${err.message}`)
      }
      app.relaunch()
      app.exit(0)
    } else {
      gpuFallbackInProgress = false
    }
  } catch {
    gpuFallbackInProgress = false
  }
}

function installedVersionSafe() {
  try {
    return server.installedVersion()
  } catch {
    return 'unknown'
  }
}

/** 选择一个可用端口：优先配置端口；被 dsh 占用则复用，被其他程序占用则顺延。 */
async function choosePort(preferred) {
  const start = Number(preferred) || 3080
  for (let candidate = start; candidate < start + 20; candidate++) {
    if (!(await probe(`http://127.0.0.1:${candidate}/`, 800))) return candidate
    const pid = findPortPid(candidate)
    const cmdline = pid ? readCmdline(pid) : ''
    if (isDshCommand(cmdline)) {
      log(`端口 ${candidate} 已被 dsh 服务占用，使用该端口`)
      return candidate
    }
    log(`端口 ${candidate} 被其他程序占用（pid=${pid || '未知'}），尝试下一个端口`)
  }
  throw new Error(`端口 ${start}-${start + 19} 均不可用`)
}

/* ---------------------------------------------------------------- 窗口 */

function sanitizeWindowBounds(saved) {
  if (!saved || typeof saved.width !== 'number' || typeof saved.height !== 'number') return {}
  try {
    const displays = screen.getAllDisplays()
    const visible = displays.some(({ workArea }) => {
      const x = Number.isFinite(saved.x) ? saved.x : workArea.x
      const y = Number.isFinite(saved.y) ? saved.y : workArea.y
      return (
        x < workArea.x + workArea.width &&
        x + saved.width > workArea.x &&
        y < workArea.y + workArea.height &&
        y + saved.height > workArea.y
      )
    })
    return visible ? saved : {}
  } catch {
    return saved
  }
}

function createWindow() {
  const saved = sanitizeWindowBounds(config.get('windowBounds'))
  win = new BrowserWindow({
    width: saved.width || 1280,
    height: saved.height || 880,
    x: saved.x,
    y: saved.y,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: '#151517',
    title: APP_NAME,
    icon: iconPath('icon-256.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(PROJECT_DIR, 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      backgroundThrottling: true,
    },
  })
  win.setMenuBarVisibility(false)

  win.on('close', (event) => {
    saveWindowBounds()
    if (quitting) return
    const action = resolveCloseAction(config.get('closeAction'), config.get('closeToTray'))
    if (action === 'tray') {
      event.preventDefault()
      if (tray && !tray.isDestroyed()) {
        win.hide()
        if (!trayHintShown) {
          trayHintShown = true
          notify(APP_NAME, '窗口已隐藏到系统托盘，可从托盘图标重新打开。')
        }
      } else {
        // 托盘不可用时最小化而不是隐藏，避免窗口"消失且无法找回"
        win.minimize()
        notify(APP_NAME, '系统托盘不可用，窗口已最小化。')
      }
      return
    }
    if (action === 'quit-all') {
      event.preventDefault()
      quitApp({ stopExternal: true })
    }
  })
  win.on('focus', () => {
    markActivity()
    syncMotionState()
  })
  win.on('blur', () => {
    markActivity()
    syncMotionState()
  })
  win.webContents.on('before-input-event', () => {
    markActivity()
    syncMotionState()
  })
  win.on('hide', () => saveWindowBounds())
  win.on('minimize', () => saveWindowBounds())
  win.on('moved', () => scheduleSaveWindowBounds())
  win.on('resized', () => scheduleSaveWindowBounds())

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isLocalAppUrl(url)) {
      createAuxWindow(url)
      return { action: 'deny' }
    }
    if (/^https?:/i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    try {
      const target = new URL(url)
      const local = ['127.0.0.1', 'localhost'].includes(target.hostname)
      if (!local) {
        event.preventDefault()
        shell.openExternal(url)
      }
    } catch {
      // ignore
    }
  })
  win.webContents.on('did-finish-load', () => {
    if (pendingUpdate && !upgrading) sendUpdate(pendingUpdate)
    if (/^https?:/.test(win.webContents.getURL())) {
      lastMotionPaused = null
      scheduleCapture()
      maybeRunPerfHooks()
      schedulePageDiagnostics()
      syncMotionState()
    }
  })
  win.webContents.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
    // -3 是被主动取消的导航，忽略
    if (!isMainFrame || code === -3 || String(url).startsWith('data:')) return
    log(`页面加载失败 code=${code} ${desc} ${url}`)
    serviceHealthy = false
    if (quitting || upgrading || recovering) return
    if (config.get('autoRestartService')) {
      setTimeout(() => {
        recoverService(`页面加载失败 ${code} ${desc}`).catch(() => {})
      }, 500)
    } else {
      showReconnectPage(`页面加载失败：${desc}`).catch(() => {})
    }
  })
  win.webContents.on('render-process-gone', (_e, details) => {
    log(`渲染进程退出: ${JSON.stringify(details)}`)
    if (quitting || details.reason === 'clean-exit' || !server?.tokenUrl) return
    if (Date.now() - lastRendererRecovery < 60000) return
    lastRendererRecovery = Date.now()
    setTimeout(() => reloadApp().catch((err) => log(err.message)), 500)
  })
}

function saveWindowBounds() {
  if (!win || win.isDestroyed()) return
  try {
    config.set('windowBounds', win.getBounds())
  } catch {
    // ignore
  }
}

function scheduleSaveWindowBounds() {
  if (boundsTimer) return
  boundsTimer = setTimeout(() => {
    boundsTimer = null
    saveWindowBounds()
  }, 800)
}

/**
 * 根据「动效模式 + 当前焦点」通知渲染进程暂停/恢复界面动效。
 * dsh Web UI 的运行态动画在部分 Wayland/GPU 环境下 CPU 开销很大。
 */
const PAUSE_MOTION_JS = `(() => {
  window.__dshMotion = window.__dshMotion || { timer: null, paused: new Set() };
  const state = window.__dshMotion;
  const pause = () => {
    for (const anim of document.getAnimations()) {
      try {
        const timing = anim.effect && anim.effect.getTiming ? anim.effect.getTiming() : null;
        const iterations = timing ? timing.iterations : 1;
        const infinite = iterations === Infinity || (typeof iterations === 'number' && !Number.isFinite(iterations));
        if (infinite && anim.playState === 'running') { anim.pause(); state.paused.add(anim); }
      } catch (err) {}
    }
  };
  pause();
  if (!state.timer) state.timer = setInterval(pause, 2000);
  return state.paused.size;
})()`

const RESUME_MOTION_JS = `(() => {
  const state = window.__dshMotion;
  if (!state) return 0;
  if (state.timer) { clearInterval(state.timer); state.timer = null; }
  let resumed = 0;
  for (const anim of state.paused) { try { anim.play(); resumed++; } catch (err) {} }
  state.paused.clear();
  return resumed;
})()`

function isLocalAppUrl(url) {
  try {
    const target = new URL(url)
    return (
      (target.hostname === '127.0.0.1' || target.hostname === 'localhost') &&
      String(target.port || '') === String(port)
    )
  } catch {
    return false
  }
}

function applyAuxMotionState(target) {
  if (!target || target.isDestroyed()) return
  const mode = resolveMotionMode(config.get('motionMode'))
  const paused = shouldPauseMotion(
    mode,
    target.isFocused(),
    Date.now() - lastActivityAt,
    Number(config.get('motionIdleMs') || 90 * 1000),
  )
  if (auxMotionState.get(target) === paused) return
  auxMotionState.set(target, paused)
  target.webContents
    .executeJavaScript(paused ? PAUSE_MOTION_JS : RESUME_MOTION_JS, true)
    .catch(() => {})
}

/** 新建一个独立窗口，加载同一 dsh web 服务（多会话并行查看）。 */
function createAuxWindow(targetUrl) {
  const url = targetUrl || (server && server.tokenUrl)
  if (!url) return null
  const aux = new BrowserWindow({
    width: 1280,
    height: 880,
    show: false,
    backgroundColor: '#151517',
    title: APP_NAME,
    icon: iconPath('icon-256.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(PROJECT_DIR, 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  })
  auxWindows.add(aux)
  aux.on('closed', () => {
    auxWindows.delete(aux)
    auxMotionState.delete(aux)
  })
  aux.webContents.setWindowOpenHandler(({ url: next }) => {
    if (isLocalAppUrl(next)) {
      createAuxWindow(next)
      return { action: 'deny' }
    }
    if (/^https?:/i.test(next)) shell.openExternal(next)
    return { action: 'deny' }
  })
  aux.webContents.on('will-navigate', (event, next) => {
    if (isLocalAppUrl(next)) return
    event.preventDefault()
    if (/^https?:/i.test(next)) shell.openExternal(next)
  })
  aux.on('focus', () => {
    markActivity()
    applyAuxMotionState(aux)
  })
  aux.on('blur', () => {
    markActivity()
    applyAuxMotionState(aux)
  })
  aux.webContents.on('before-input-event', () => {
    markActivity()
    applyAuxMotionState(aux)
  })
  aux.webContents.on('did-finish-load', () => {
    auxMotionState.delete(aux)
    applyAuxMotionState(aux)
  })
  aux.once('ready-to-show', () => aux.show())
  aux.loadURL(url).catch((err) => log(`新窗口加载失败: ${err.message}`))
  log(`新建窗口（当前共 ${auxWindows.size + 1} 个窗口）`)
  return aux
}

function markActivity() {
  lastActivityAt = Date.now()
}

function syncMotionState() {
  if (!win || win.isDestroyed()) return
  const mode = resolveMotionMode(config.get('motionMode'))
  const idleMs = Date.now() - lastActivityAt
  const paused = shouldPauseMotion(
    mode,
    win.isFocused(),
    idleMs,
    Number(config.get('motionIdleMs') || 90 * 1000),
  )
  if (paused === lastMotionPaused) return
  lastMotionPaused = paused
  win.webContents
    .executeJavaScript(paused ? PAUSE_MOTION_JS : RESUME_MOTION_JS, true)
    .then((count) => {
      log(`界面动效: ${paused ? `已暂停 ${count} 个循环动画` : `已恢复 ${count} 个动画`}（模式 ${mode}）`)
    })
    .catch((err) => {
      lastMotionPaused = null
      log(`界面动效切换失败: ${err.message}`)
    })
}

function toggleWindowVisibility() {
  if (!win || win.isDestroyed()) return
  if (win.isVisible() && !win.isMinimized()) win.hide()
  else showWindow()
}

function registerGlobalShortcut() {
  unregisterGlobalShortcut()
  if (!config.get('globalShortcutEnabled')) {
    log('全局快捷键已禁用')
    return false
  }
  const accelerator = config.get('globalShortcut')
  try {
    shortcutRegistered = globalShortcut.register(accelerator, toggleWindowVisibility)
  } catch (err) {
    shortcutRegistered = false
    log(`全局快捷键注册异常: ${err.message}`)
  }
  log(`全局快捷键 ${accelerator} 注册${shortcutRegistered ? '成功' : '失败'}`)
  return shortcutRegistered
}

function unregisterGlobalShortcut() {
  if (!shortcutRegistered) return
  try {
    globalShortcut.unregisterAll()
  } catch {
    // ignore
  }
  shortcutRegistered = false
}

function serviceStatusText() {
  if (upgrading) return '正在升级…'
  if (recovering) return '服务恢复中…'
  if (!serviceHealthy) return '服务异常'
  return `服务运行中 · dsh v${installedVersionSafe()}`
}

function showWindow() {
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

function schedulePageDiagnostics() {
  if (!PAGE_DIAG_MS) return
  setTimeout(async () => {
    try {
      const info = await win.webContents.executeJavaScript(`(() => {
        const list = document.getAnimations ? document.getAnimations() : []
        const running = []
        for (const el of document.querySelectorAll('*')) {
          const st = getComputedStyle(el)
          if (st.animationName && st.animationName !== 'none' && st.animationPlayState === 'running') {
            running.push(st.animationName + ':' + el.tagName.toLowerCase())
            if (running.length >= 25) break
          }
        }
        const perf = performance.memory
          ? { used: performance.memory.usedJSHeapSize, total: performance.memory.totalJSHeapSize }
          : null
        // 找出持续运行的动画元素，用于识别"会话运行中"
        const runningEls = []
        for (const el of document.querySelectorAll('*')) {
          const st = getComputedStyle(el)
          if (!st.animationName || st.animationName === 'none') continue
          if (st.animationIterationCount !== 'infinite') continue
          runningEls.push({
            tag: el.tagName.toLowerCase(),
            cls: String(el.getAttribute('class') || '').slice(0, 80),
            label: el.getAttribute('aria-label') || '',
            role: el.getAttribute('role') || '',
            text: (el.textContent || '').trim().slice(0, 40),
          })
          if (runningEls.length >= 12) break
        }
        const dialogs = [...document.querySelectorAll('[role="dialog"], dialog')]
          .slice(0, 5)
          .map((d) => ({ text: (d.textContent || '').trim().slice(0, 120) }))
        return {
          title: document.title,
          runningEls,
          dialogs,
          url: location.href.replace(/token=[^&]+/, 'token=[redacted]'),
          visibility: document.visibilityState,
          anims: list.length,
          runningCount: running.length,
          running,
          perf,
        }
      })()`)
      log(`[page-diag] ${JSON.stringify(info)}`)
    } catch (err) {
      log(`[page-diag] 失败: ${err.message}`)
    }
  }, PAGE_DIAG_MS)
}

function maybeRunPerfHooks() {
  const dump = process.env.DSH_DESKTOP_TEST_DUMP_ANIMATIONS === '1'
  const pause = process.env.DSH_DESKTOP_TEST_PAUSE_ANIMATIONS === '1'
  if (!dump && !pause) return
  setTimeout(async () => {
    try {
      if (dump) {
        const info = await win.webContents.executeJavaScript(`(() => {
          const anims = document.getAnimations ? document.getAnimations() : []
          let cssAnim = 0
          const names = {}
          for (const el of document.querySelectorAll('*')) {
            const st = getComputedStyle(el)
            if (st.animationName && st.animationName !== 'none') {
              cssAnim++
              names[st.animationName] = (names[st.animationName] || 0) + 1
            }
          }
          return {
            title: document.title,
            visibility: document.visibilityState,
            anims: anims.length,
            cssAnim,
            names,
            sample: anims.slice(0, 15).map(a => (a.animationName || 'unknown') + ':' + a.playState),
          }
        })()`)
        log(`[test] 页面动画信息: ${JSON.stringify(info)}`)
      }
      if (pause) {
        await win.webContents.executeJavaScript(`(() => {
          if (document.getElementById('dsh-desktop-pause-anim')) return 'exists'
          const st = document.createElement('style')
          st.id = 'dsh-desktop-pause-anim'
          st.textContent = '*,*::before,*::after{animation-play-state:paused!important;transition:none!important}'
          document.documentElement.appendChild(st)
          return 'injected'
        })()`)
        log('[test] 已暂停页面动画/过渡')
      }
    } catch (err) {
      log(`[test] 性能钩子失败: ${err.message}`)
    }
  }, Number(process.env.DSH_DESKTOP_TEST_PERF_HOOK_DELAY_MS || 3000))
}

function scheduleCapture() {
  if (!CAPTURE_PATH) return
  if (captureDone && !CAPTURE_EVERY) return
  captureDone = true
  setTimeout(async () => {
    try {
      const image = await win.webContents.capturePage()
      fs.writeFileSync(CAPTURE_PATH, image.toPNG())
      log(`CAPTURE_SAVED ${CAPTURE_PATH}`)
      if (process.env.DSH_DESKTOP_METRICS_FILE) {
        fs.writeFileSync(process.env.DSH_DESKTOP_METRICS_FILE, JSON.stringify({ gpu: app.getGPUFeatureStatus(), processes: app.getAppMetrics(), sandbox: win.webContents.getLastWebPreferences().sandbox }, null, 2))
      }
    } catch (err) {
      log(`CAPTURE_FAILED ${err.message}`)
    }
    if (process.env.DSH_DESKTOP_EXIT_AFTER_CAPTURE === '1') {
      setTimeout(() => quitApp(), 300)
    }
  }, CAPTURE_DELAY)
}

/* ---------------------------------------------------------------- 更新 */

function sendUpdate(info) {
  if (!win || win.isDestroyed()) return
  win.webContents.send('dsh-desktop:update-available', {
    current: info.current,
    latest: info.latest,
    channel: info.channel,
  })
  if (tray) tray.setToolTip(`${APP_NAME} — 新版本 v${info.latest} 可用`)
}

async function checkNow({ interactive = false } = {}) {
  if (!server) return { available: false, error: '服务未初始化' }
  try {
    const installed = server.installedVersion()
    const result = await updater.checkForUpdate({
      channel: config.get('channel'),
      installedVersion: installed,
      fakeVersion: FAKE_UPDATE || undefined,
    })
    config.set('lastCheckAt', new Date().toISOString())
    log(
      `检查更新: 当前 v${installed}，${result.channel} 通道最新 v${result.latest}，可升级=${result.available}`,
    )
    if (result.available) {
      pendingUpdate = result
      if (interactive) {
        const answer = await dialog.showMessageBox(win, {
          type: 'info',
          title: '发现新版本',
          message: `发现新版本 v${result.latest}`,
          detail: `当前版本 v${result.current}\n更新通道：${result.channel}\n\n升级过程会自动停止服务、安装新版本、同步插件并重启，通常需要 1–3 分钟。`,
          buttons: ['立即升级', '稍后'],
          defaultId: 0,
          cancelId: 1,
          noLink: true,
        })
        if (answer.response === 0) return await upgrade(result.latest)
      } else {
        sendUpdate(result)
        notify(`发现新版本 v${result.latest}`, '点击客户端右下角提示即可升级。')
      }
    } else {
      pendingUpdate = null
      if (tray) tray.setToolTip(`${APP_NAME} — v${installed}`)
      if (interactive) {
        await dialog.showMessageBox(win, {
          type: 'info',
          title: '检查更新',
          message: '已是最新版本',
          detail: `当前版本 v${installed}\n更新通道：${config.get('channel')}`,
          noLink: true,
        })
      }
    }
    refreshMenus()
    return result
  } catch (err) {
    log(`检查更新失败: ${err.message}`)
    if (interactive) dialog.showErrorBox('检查更新失败', err.message)
    return { available: false, error: err.message }
  }
}

function showProgressWindow(version) {
  if (progressWin) return
  progressWin = new BrowserWindow({
    width: 420,
    height: 150,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    backgroundColor: '#151517',
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  })
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;height:100%;background:#151517;color:#e8e8ea;
      font:13px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif;}
    .box{padding:22px 24px}
    .title{font-size:15px;font-weight:600}
    .sub{color:#9a9ca6;font-size:12px;margin-top:2px}
    .step{margin-top:14px;color:#7c9bff;font-size:13px}
    .bar{margin-top:12px;height:4px;border-radius:2px;background:#2a2c33;overflow:hidden}
    .bar i{display:block;height:100%;width:40%;background:#4f6ef7;border-radius:2px;
      animation:slide 1.2s ease-in-out infinite}
    @keyframes slide{0%{transform:translateX(-100%)}100%{transform:translateX(350%)}}
  </style></head><body><div class="box">
    <div class="title">正在升级 DeepSeek Harness</div>
    <div class="sub">目标版本 v${escapeHtml(version)}</div>
    <div class="step" id="step">准备中…</div>
    <div class="bar"><i></i></div>
  </div></body></html>`
  progressWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
  progressWin.once('ready-to-show', () => progressWin.show())
}

function setProgress(text) {
  if (!progressWin) return
  progressWin.webContents
    .executeJavaScript(`document.getElementById('step').textContent = ${JSON.stringify(text)}`)
    .catch(() => {})
}

function closeProgressWindow() {
  if (!progressWin) return
  try {
    progressWin.destroy()
  } catch {
    // ignore
  }
  progressWin = null
}

async function upgrade(version) {
  if (upgrading || recovering) return { ok: false, error: '服务正在更新或恢复，请稍候' }
  if (!server) return { ok: false, error: '服务未初始化' }
  upgrading = true
  log(`开始升级到 ${version}`)
  try {
    if (win && !win.isDestroyed()) win.hide()
    showProgressWindow(version)
    setProgress('停止服务…')
    await server.stop({ includeExternal: true })

    setProgress(`安装 @deepseek-ai/dsh@${version}…`)
    await updater.installVersion(version, (chunk) => {
      const text = chunk.toString().trim()
      if (text) log(`[helper] ${text}`)
    })
    const newVersion = server.installedVersion()
    if (newVersion !== version) {
      throw new Error(`安装后版本为 ${newVersion}，与目标 ${version} 不一致`)
    }

    setProgress('同步 profile 插件…')
    const sync = await updater.syncProfilePlugin({
      version,
      dshBin: server.resolveBin(),
      dshHome: DSH_HOME,
    })
    if (!sync.ok) log(`插件同步跳过/失败: ${sync.reason || sync.output || ''}`)

    setProgress('启动新版本服务…')
    await server.start()
    managed = Boolean(server.child)
    pendingUpdate = null
    config.set('dismissedVersion', null)
    config.set('lastUpgradeAt', new Date().toISOString())

    closeProgressWindow()
    await win.loadURL(server.tokenUrl)
    win.show()
    notify('升级完成', `DeepSeek Harness 已升级到 v${version}`)
    log(`升级完成: ${version}`)
    return { ok: true, version }
  } catch (err) {
    log(`升级失败: ${err.message}`)
    closeProgressWindow()
    try {
      await server.start()
      managed = Boolean(server.child)
      await win.loadURL(server.tokenUrl)
    } catch (restoreErr) {
      log(`恢复服务失败: ${restoreErr.message}`)
    }
    win.show()
    await dialog.showMessageBox(win, {
      type: 'error',
      title: '升级失败',
      message: '升级未完成，已尽量恢复原有服务',
      detail: String(err.message || err),
      noLink: true,
    })
    return { ok: false, error: String(err.message || err) }
  } finally {
    upgrading = false
    closeProgressWindow()
    refreshMenus()
  }
}

/* ---------------------------------------------------------------- 服务 */

async function loadApp(url) {
  log(`加载界面: ${url}`)
  await win.loadURL(url)
  if (!AUTOSTART) win.show()
  else if (!tray) win.show()
}

async function ensureServer() {
  const existing = await server.detectExisting()
  if (!existing) {
    const url = await server.start()
    managed = Boolean(server.child)
    await loadApp(url)
    return
  }

  let decision = TAKEOVER
  if (decision === 'ask') {
    const answer = await dialog.showMessageBox({
      type: 'question',
      title: APP_NAME,
      message: '检测到已有 DeepSeek Harness 服务在运行',
      detail:
        `端口 ${port} 上已有一个 dsh web 进程` +
        (existing.pid ? `（PID ${existing.pid}）` : '') +
        `。\n\n“接管”会停止它，改由桌面客户端管理服务；当前浏览器窗口会断开，会话记录仍可在客户端里打开。` +
        `\n“仅打开”则直接复用现有服务。`,
      buttons: ['接管并重启服务', '仅打开现有服务', '取消'],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
    })
    decision = answer.response === 0 ? 'takeover' : answer.response === 1 ? 'reuse' : 'quit'
  }

  if (decision === 'quit') {
    quitApp()
    return
  }
  if (decision === 'reuse') {
    const url = server.attachExisting(existing)
    managed = false
    await loadApp(url)
    return
  }
  if (!existing.pid) {
    dialog.showErrorBox('无法接管服务', `端口 ${port} 已被占用，但无法识别占用进程。请手动关闭后重试。`)
    quitApp()
    return
  }
  server.externalPid = existing.pid
  await server.stop({ includeExternal: true })
  const url = await server.start()
  managed = Boolean(server.child)
  await loadApp(url)
}

async function restartServer() {
  if (upgrading || recovering) return
  recovering = true
  try {
    await server.stop({ includeExternal: true })
    const url = await server.start()
    managed = Boolean(server.child)
    await win.loadURL(url)
    win.show()
    notify('服务已重启', `当前版本 v${server.installedVersion()}`)
  } catch (err) {
    log(`重启服务失败: ${err.message}`)
    dialog.showErrorBox('重启服务失败', String(err.message || err))
  } finally { recovering = false }
}

/* ---------------------------------------------------------------- 健康监控 */

function reconnectPageHtml(detail) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;height:100%;background:#151517;color:#e8e8ea;
      font:14px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif;
      display:flex;align-items:center;justify-content:center}
    .box{text-align:center;max-width:420px;padding:24px}
    .spinner{width:36px;height:36px;margin:0 auto 18px;border-radius:50%;
      border:3px solid #2a2c33;border-top-color:#4f6ef7;animation:spin .9s linear infinite}
    @keyframes spin{to{transform:rotate(360deg)}}
    .title{font-size:15px;font-weight:600}
    .detail{margin-top:8px;color:#9a9ca6;font-size:12px;white-space:pre-wrap}
  </style></head><body><div class="box">
    <div class="spinner"></div>
    <div class="title">正在恢复 DeepSeek Harness 服务…</div>
    <div class="detail">${escapeHtml(detail || '服务暂时无响应，客户端会自动重启它。')}</div>
  </div></body></html>`
}

async function showReconnectPage(detail) {
  if (!win || win.isDestroyed()) return
  reconnectVisible = true
  try {
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(reconnectPageHtml(detail)))
  } catch {
    // ignore
  }
}

async function reloadApp() {
  if (!server || !server.tokenUrl) return
  reconnectVisible = false
  try {
    await win.loadURL(server.tokenUrl)
    serviceHealthy = true
  } catch (err) {
    log(`重新加载界面失败: ${err.message}`)
    serviceHealthy = false
    reconnectVisible = true
    throw err
  }
}

function startHealthMonitor() {
  if (healthTimer) clearInterval(healthTimer)
  const interval = Math.max(5000, Number(config.get('healthIntervalMs') || 60000))
  healthTimer = setInterval(() => {
    checkHealth().catch((err) => log(`健康检查异常: ${err.message}`))
  }, interval)
  log(
    `服务健康监控已启动（间隔 ${interval}ms，自动重启=${config.get('autoRestartService')}）`,
  )
}

async function checkHealth() {
  if (healthChecking || server?.starting) return
  healthChecking = true
  try { await checkHealthOnce() } finally { healthChecking = false }
}

async function checkHealthOnce() {
  if (!server || quitting || upgrading || recovering) return
  const ok = await probe(server.baseUrl, 2500)
  if (ok) {
    healthFailures = 0
    serviceHealthy = true
    if (!server.tokenUrl || !(await validToken(server.tokenUrl))) {
      const replacement = await server.detectExisting()
      if (replacement?.url) {
        server.attachExisting(replacement)
        await reloadApp()
      }
    } else if (reconnectVisible) await reloadApp()
    return
  }
  healthFailures += 1
  serviceHealthy = false
  log(`健康检查失败（第 ${healthFailures} 次）`)
  if (healthFailures < 2) return
  if (!config.get('autoRestartService')) {
    log('服务异常，但「自动重启服务」已关闭')
    return
  }
  await recoverService('健康检查连续失败')
}

async function recoverService(reason) {
  if (recovering || upgrading || quitting) return
  recovering = true
  healthFailures = 0
  log(`服务异常（${reason}），开始自动恢复`)
  try {
    if (win && !win.isDestroyed()) {
      await showReconnectPage(`原因：${reason}`)
      win.show()
    }
    const existing = await server.detectExisting()
    if (existing) {
      // HMR 或其他启动器已经恢复服务时，只刷新凭据和页面。
      server.attachExisting(existing)
      managed = Boolean(server.child)
    } else {
      await server.stop()
      await server.start()
      managed = Boolean(server.child)
    }
    await reloadApp()
    serviceHealthy = true
    notify('服务已自动恢复', `DeepSeek Harness 服务已重新启动（v${installedVersionSafe()}）`)
    log('服务自动恢复成功')
  } catch (err) {
    serviceHealthy = false
    log(`服务自动恢复失败: ${err.message}`)
    await showReconnectPage(`自动恢复失败：${err.message}`)
    notify('服务恢复失败', String(err.message || err))
  } finally {
    recovering = false
    refreshMenus()
  }
}

/* ------------------------------------------------------- 客户端壳自更新 */

async function checkShellUpdate({ interactive = false } = {}) {
  try {
    const result = shellUpdater.checkForShellUpdate()
    config.set('lastShellCheckAt', new Date().toISOString())
    log(
      `检查客户端更新: 已安装 v${result.current || '未知'}，更新源 v${result.latest || '未知'}，可更新=${result.available}`,
    )
    if (result.error) {
      if (interactive) dialog.showErrorBox('检查客户端更新失败', result.error)
      return result
    }
    if (!result.available) {
      if (interactive) {
        await dialog.showMessageBox(win, {
          type: 'info',
          title: '客户端更新',
          message: '客户端已是最新版本',
          detail: `已安装：v${result.current}\n更新源：v${result.latest}\n来源：${result.source}`,
          noLink: true,
        })
      }
      return result
    }
    if (interactive) {
      const answer = await dialog.showMessageBox(win, {
        type: 'info',
        title: '客户端更新',
        message: `发现客户端新版本 v${result.latest}`,
        detail:
          `已安装：v${result.current}\n更新源：v${result.latest}\n\n` +
          `更新会替换客户端程序文件并重启应用，会话记录保留（重新打开即可继续）。`,
        buttons: ['立即更新并重启', '稍后'],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      })
      if (answer.response === 0) return await applyShellUpdateFlow(result)
    } else {
      notify(`客户端新版本 v${result.latest}`, '可从菜单「检查客户端更新」升级。')
    }
    return result
  } catch (err) {
    log(`检查客户端更新失败: ${err.message}`)
    if (interactive) dialog.showErrorBox('检查客户端更新失败', String(err.message || err))
    return { available: false, error: String(err.message || err) }
  }
}

async function applyShellUpdateFlow(result) {
  if (upgrading || recovering) return { ok: false, error: '服务正在更新或恢复，请稍候' }
  upgrading = true
  log(`开始更新客户端到 v${result.latest}`)
  try {
    if (win && !win.isDestroyed()) win.hide()
    showProgressWindow(`客户端 v${result.latest}`)
    setProgress('停止服务…')
    await server.stop()
    setProgress('替换客户端文件…')
    const applied = shellUpdater.applyShellUpdate()
    if (applied.version !== result.latest) {
      throw new Error(`更新后版本为 v${applied.version}，与目标 v${result.latest} 不一致`)
    }
    config.set('lastShellUpdateAt', new Date().toISOString())
    log(`客户端文件已更新到 v${applied.version}`)
    setProgress('重启客户端…')
    closeProgressWindow()
    if (SHELL_NO_RELAUNCH) {
      upgrading = false
      return { ok: true, version: applied.version, relaunch: false }
    }
    setTimeout(() => {
      config.save()
      app.relaunch()
      app.exit(0)
    }, 400)
    return { ok: true, version: applied.version, relaunch: true }
  } catch (err) {
    log(`客户端更新失败: ${err.message}`)
    closeProgressWindow()
    upgrading = false
    try {
      await server.start()
      managed = Boolean(server.child)
      await win.loadURL(server.tokenUrl)
    } catch (restoreErr) {
      log(`更新失败后恢复服务失败: ${restoreErr.message}`)
      await showReconnectPage(`客户端更新失败：${restoreErr.message}`)
    }
    win.show()
    dialog.showErrorBox('客户端更新失败', String(err.message || err))
    refreshMenus()
    return { ok: false, error: String(err.message || err) }
  }
}

/* ---------------------------------------------------------- 工具窗口 */

let settingsWin = null
let diagnosticsWin = null

function readTail(file, maxLines) {
  return redact(boundedReadTail(file, maxLines))
}

function settingsSnapshot() {
  return {
    config: {
      channel: config.get('channel'),
      autoCheck: Boolean(config.get('autoCheck')),
      checkIntervalMs: Number(config.get('checkIntervalMs') || 6 * 60 * 60 * 1000),
      registry: config.get('registry') || 'https://registry.npmjs.org/',
      shellAutoCheck: Boolean(config.get('shellAutoCheck')),
      autoRestartService: Boolean(config.get('autoRestartService')),
      closeToTray: Boolean(config.get('closeToTray')),
      closeAction: resolveCloseAction(config.get('closeAction'), config.get('closeToTray')),
      motionMode: resolveMotionMode(config.get('motionMode')),
      notifyOnFinish: config.get('notifyOnFinish') !== false,
      notifyOnApproval: config.get('notifyOnApproval') !== false,
      globalShortcutEnabled: Boolean(config.get('globalShortcutEnabled')),
      healthIntervalMs: Number(config.get('healthIntervalMs') || 60000),
      useX11: config.get('useX11') !== false,
      softwareRendering: Boolean(config.get('softwareRendering')),
    },
    autostart: autostartEnabled(),
    globalShortcut: config.get('globalShortcut'),
    shortcutRegistered,
    shellSource: shellUpdater.sourceDir(),
    clientVersion: app.getVersion(),
    dshVersion: installedVersionSafe(),
  }
}

function applySettingsPatch(patch) {
  const previous = settingsSnapshot()
  const merged = { ...previous.config, ...patch }
  config.set('channel', merged.channel === 'latest' ? 'latest' : 'next')
  config.set('autoCheck', Boolean(merged.autoCheck))
  config.set(
    'checkIntervalMs',
    Math.max(60 * 60 * 1000, Number(merged.checkIntervalMs) || 6 * 60 * 60 * 1000),
  )
  const registry = normalizeRegistry(merged.registry)
  config.set('registry', registry)
  updater.setRegistry(registry)
  restartAutoCheck()
  config.set('shellAutoCheck', Boolean(merged.shellAutoCheck))
  config.set('autoRestartService', Boolean(merged.autoRestartService))
  const closeAction = resolveCloseAction(merged.closeAction, merged.closeToTray)
  config.set('closeAction', closeAction)
  config.set('closeToTray', closeAction === 'tray')
  if (merged.notifyOnFinish !== undefined) config.set('notifyOnFinish', Boolean(merged.notifyOnFinish))
  if (merged.notifyOnApproval !== undefined) {
    config.set('notifyOnApproval', Boolean(merged.notifyOnApproval))
  }
  if (merged.motionMode !== undefined) {
    config.set('motionMode', resolveMotionMode(merged.motionMode))
    lastMotionPaused = null
    syncMotionState()
  }
  config.set('globalShortcutEnabled', Boolean(merged.globalShortcutEnabled))
  const interval = Math.max(5000, Number(merged.healthIntervalMs) || 60000)
  config.set('healthIntervalMs', interval)
  config.set('useX11', Boolean(merged.useX11))
  config.set('softwareRendering', Boolean(merged.softwareRendering))
  if (interval !== Number(previous.config.healthIntervalMs)) startHealthMonitor()
  if (Boolean(merged.globalShortcutEnabled) !== Boolean(previous.config.globalShortcutEnabled)) {
    if (merged.globalShortcutEnabled) registerGlobalShortcut()
    else unregisterGlobalShortcut()
  }
  if ('autostart' in patch && Boolean(patch.autostart) !== Boolean(previous.autostart)) {
    setAutostart(Boolean(patch.autostart))
  }
  log('设置已更新')
  refreshMenus()
  return settingsSnapshot()
}

async function exportDiagnosticsBundle() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const defaultPath = path.join(app.getPath('downloads'), `dsh-desktop-diagnostics-${stamp}.tar.gz`)
  const picked = await dialog.showSaveDialog(win, {
    title: '导出诊断包',
    defaultPath,
    filters: [{ name: 'tar.gz 压缩包', extensions: ['tar.gz'] }],
  })
  if (picked.canceled || !picked.filePath) return { message: '已取消' }
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-diag-'))
  try {
    fs.writeFileSync(path.join(stage, 'diagnostics.json'), JSON.stringify(buildDiagnostics(), null, 2))
    for (const file of ['config.json', 'main.log', 'server.log', 'rollout.log']) {
      const src = path.join(USER_DATA, file)
      if (fs.existsSync(src)) fs.copyFileSync(src, path.join(stage, file))
    }
    execFileSync('tar', ['-czf', picked.filePath, '-C', stage, '.'], { timeout: 20000 })
    log(`已导出诊断包 ${picked.filePath}`)
    return { message: `已导出诊断包：${picked.filePath}` }
  } catch (err) {
    log(`导出诊断包失败: ${err.message}`)
    throw err
  } finally {
    fs.rmSync(stage, { recursive: true, force: true })
  }
}

function clearClientCache() {
  const dirs = [
    'Cache',
    'Code Cache',
    'GPUCache',
    'DawnGraphiteCache',
    'DawnWebGPUCache',
    'GrShaderCache',
    'ShaderCache',
  ]
  let removed = 0
  for (const name of dirs) {
    try {
      fs.rmSync(path.join(USER_DATA, name), { recursive: true, force: true })
      removed++
    } catch {
      // ignore
    }
  }
  log(`已清理客户端缓存目录 ${removed} 个`)
  return { message: `已清理 ${removed} 个缓存目录，重启客户端后完全生效` }
}

async function handleUtilityAction(payload) {
  const action = payload && payload.action
  switch (action) {
    case 'check-dsh-update': {
      const result = await checkNow({ interactive: true })
      return { message: result && result.available ? `发现 dsh 新版本 v${result.latest}` : 'dsh 已是最新版本' }
    }
    case 'check-shell-update': {
      const result = await checkShellUpdate({ interactive: true })
      if (result && result.available) return { message: `客户端更新 v${result.latest} 已处理` }
      return { message: '客户端已是最新版本' }
    }
    case 'restart-service':
      await restartServer()
      return { message: '服务已重启' }
    case 'restart-app': {
      const answer = await dialog.showMessageBox(win, {
        type: 'question',
        title: '重启客户端',
        message: '重启客户端以应用设置？',
        detail: '后台服务会一起重启，会话记录保留，重新打开即可继续。',
        buttons: ['重启', '取消'],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      })
      if (answer.response !== 0) return { message: '已取消' }
      await server.stop()
      setTimeout(() => {
        config.save()
      app.relaunch()
        app.exit(0)
      }, 200)
      return { message: '正在重启客户端…' }
    }
    case 'quit-all':
      quitApp({ stopExternal: true })
      return { message: '正在彻底退出客户端和网页服务…' }
    case 'open-logs':
      await shell.openPath(USER_DATA)
      return { message: '已打开日志目录' }
    case 'export-diagnostics':
      return exportDiagnosticsBundle()
    case 'clear-cache':
      return clearClientCache()
    default:
      throw new Error(`未知操作: ${action}`)
  }
}

function buildDiagnostics() {
  return {
    clientVersion: app.getVersion(),
    dshVersion: installedVersionSafe(),
    status: serviceStatusText(),
    managed,
    servicePid: (server && (server.child?.pid || server.externalPid)) || null,
    port,
    shortcut: `${config.get('globalShortcut')}（${shortcutRegistered ? '已生效' : '未生效'}）`,
    softwareRendering: Boolean(config.get('softwareRendering')),
    electron: process.versions.electron,
    node: process.versions.node,
    os: `${os.type()} ${os.release()} ${os.arch()}`,
    gpu: app.getGPUFeatureStatus(),
    processes: app.getAppMetrics().map(({ pid, type, cpu, memory }) => ({ pid, type, cpu, memory })),
    lastCheckAt: config.get('lastCheckAt'),
    lastShellCheckAt: config.get('lastShellCheckAt'),
    shellSource: shellUpdater.sourceDir(),
    mainLog: readTail(MAIN_LOG, 100),
    serverLog: readTail(SERVER_LOG, 100),
  }
}

function handleDiagnosticsAction(payload) {
  const action = payload && payload.action
  if (action === 'copy') {
    clipboard.writeText(JSON.stringify(buildDiagnostics(), null, 2))
    return { message: '诊断信息已复制到剪贴板' }
  }
  return handleUtilityAction({ action })
}

function maybeCaptureUtility(win, name) {
  const target = process.env.DSH_DESKTOP_UTIL_CAPTURE
  if (!target) return
  win.webContents.on('did-finish-load', () => {
    setTimeout(async () => {
      try {
        const image = await win.webContents.capturePage()
        const file = target.includes('%s') ? target.replace('%s', name) : target
        fs.writeFileSync(file, image.toPNG())
        log(`CAPTURE_SAVED_UTILITY ${file}`)
      } catch (err) {
        log(`CAPTURE_FAILED_UTILITY ${err.message}`)
      }
    }, 2200)
  })
}

function openSettingsWindow() {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.show()
    settingsWin.focus()
    return
  }
  settingsWin = utility.createUtilityWindow({
    title: 'DeepSeek Harness 设置',
    width: 780,
    height: 700,
    html: utility.settingsHtml(),
  })
  settingsWin.on('closed', () => {
    settingsWin = null
  })
  maybeCaptureUtility(settingsWin, 'settings')
}

function openDiagnosticsWindow() {
  if (diagnosticsWin && !diagnosticsWin.isDestroyed()) {
    diagnosticsWin.show()
    diagnosticsWin.focus()
    return
  }
  diagnosticsWin = utility.createUtilityWindow({
    title: 'DeepSeek Harness 诊断信息',
    width: 880,
    height: 820,
    html: utility.diagnosticsHtml(),
  })
  diagnosticsWin.on('closed', () => {
    diagnosticsWin = null
  })
  maybeCaptureUtility(diagnosticsWin, 'diagnostics')
}

/* ---------------------------------------------------------------- 自动启动 */

function autostartFile() {
  return path.join(os.homedir(), '.config', 'autostart', 'dsh-desktop.desktop')
}

function autostartEnabled() {
  return fs.existsSync(autostartFile())
}

function setAutostart(enabled) {
  const file = autostartFile()
  try {
    if (enabled) {
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(
        file,
        `[Desktop Entry]\nType=Application\nName=${APP_NAME}\nExec=${LAUNCHER} --autostart\nIcon=dsh-desktop\nTerminal=false\nX-GNOME-Autostart-enabled=true\n`,
      )
      log('已开启开机自启')
    } else {
      fs.rmSync(file, { force: true })
      log('已关闭开机自启')
    }
  } catch (err) {
    dialog.showErrorBox('设置开机自启失败', String(err.message || err))
  }
}

function toggleAutostart() {
  setAutostart(!autostartEnabled())
  refreshMenus()
}

/* ---------------------------------------------------------------- 菜单 / 托盘 */

function menuContext() {
  return {
    getChannel: () => config.get('channel'),
    setChannel: (channel) => {
      config.set('channel', channel)
      pendingUpdate = null
      refreshMenus()
      checkNow({ interactive: false })
    },
    getPending: () => pendingUpdate,
    checkUpdate: () => checkNow({ interactive: true }),
    checkShellUpdate: () => checkShellUpdate({ interactive: true }),
    isAutoRestart: () => Boolean(config.get('autoRestartService')),
    toggleAutoRestart: () => {
      config.set('autoRestartService', !config.get('autoRestartService'))
      log(`服务自动重启已${config.get('autoRestartService') ? '开启' : '关闭'}`)
      refreshMenus()
    },
    restartServer: () => restartServer(),
    openInBrowser: () => shell.openExternal(server?.tokenUrl || server?.baseUrl || `http://127.0.0.1:${port}/`),
    openLogs: () => shell.openPath(MAIN_LOG),
    openConfigDir: () => shell.openPath(USER_DATA),
    openServerLog: () => shell.showItemInFolder(SERVER_LOG),
    openExternal: (url) => shell.openExternal(url),
    showWindow: () => showWindow(),
    showAbout: () => showAbout(),
    isAutostart: () => autostartEnabled(),
    toggleAutostart: () => toggleAutostart(),
    getServiceStatus: () => serviceStatusText(),
    openSettings: () => openSettingsWindow(),
    newWindow: () => createAuxWindow(),
    getRecentSessions: () => recentSessions,
    openSession: (item) => openRecentSession(item),
    restartApp: () => {
      server.stop().then(() => {
        config.save()
      app.relaunch()
        app.exit(0)
      })
    },
    openDiagnostics: () => openDiagnosticsWindow(),
    isGlobalShortcut: () => Boolean(config.get('globalShortcutEnabled')),
    toggleGlobalShortcut: () => {
      const next = !config.get('globalShortcutEnabled')
      config.set('globalShortcutEnabled', next)
      log(`全局快捷键已${next ? '开启' : '关闭'}`)
      if (next) {
        if (!registerGlobalShortcut()) {
          notify('快捷键注册失败', `无法注册 ${config.get('globalShortcut')}，可能与系统或其他应用冲突。`)
        }
      } else {
        unregisterGlobalShortcut()
      }
      refreshMenus()
    },
    quit: () => quitApp(),
    quitAll: () => quitApp({ stopExternal: true }),
  }
}

function refreshMenus() {
  const ctx = menuContext()
  Menu.setApplicationMenu(buildApplicationMenu(ctx))
  if (tray) {
    tray.setToolTip(`${APP_NAME} — ${serviceStatusText()} · 客户端 v${app.getVersion()}`)
    tray.setContextMenu(buildTrayMenu(ctx))
  }
}

function createTray() {
  if (NO_TRAY) return
  try {
    const image = nativeImage.createFromPath(iconPath('icon-32.png'))
    tray = new Tray(image)
    tray.setToolTip(`${APP_NAME} — ${serviceStatusText()} · 客户端 v${app.getVersion()}`)
    // 创建后立即绑定菜单：AppIndicator 下左键/右键都依赖 context menu，
    // 不能等后续 refreshMenus() 才绑定，否则点击顶栏会没有反应。
    tray.setContextMenu(buildTrayMenu(menuContext()))
    tray.on('click', () => showWindow())
    tray.on('double-click', () => showWindow())
    log('系统托盘已创建并绑定菜单')
  } catch (err) {
    log(`创建托盘失败（不影响使用）: ${err.message}`)
  }
}

async function showAbout() {
  const answer = await dialog.showMessageBox(win, {
    type: 'info',
    title: `关于 ${APP_NAME}`,
    message: APP_NAME,
    detail:
      `客户端版本：v${app.getVersion()}\n` +
      `客户端更新源：v${shellUpdater.sourceVersion() || '未知'}\n` +
      `dsh 运行时：v${installedVersionSafe()}\n` +
      `更新通道：${config.get('channel')}\n` +
      `服务模式：${managed ? '客户端托管' : '复用外部服务'}\n` +
      `服务自动重启：${config.get('autoRestartService') ? '开' : '关'}\n` +
      `软件渲染：${config.get('softwareRendering') ? '开' : '关（GPU 加速）'}\n` +
      `端口：${port}\n` +
      `Electron：v${process.versions.electron}\n` +
      `Node：v${process.versions.node}`,
    buttons: ['好'],
    noLink: true,
  })
  return answer
}

function quitApp({ stopExternal = false } = {}) {
  if (quitPromise) return quitPromise
  quitting = true
  quitPromise = (async () => {
    try {
      if (server) await server.stop({ includeExternal: stopExternal })
    } catch (err) {
      log(`退出时停止服务失败: ${err.message}`)
    } finally {
      app.quit()
    }
  })()
  return quitPromise
}

/* ---------------------------------------------------------------- 启动 */

function registerIpc() {
  ipcMain.handle('dsh-desktop:info', () => ({
    appVersion: app.getVersion(),
    dshVersion: installedVersionSafe(),
    shellVersion: shellUpdater.installedVersion(),
    channel: config.get('channel'),
    port,
    managed,
    autoRestart: Boolean(config.get('autoRestartService')),
    pendingUpdate: pendingUpdate ? { latest: pendingUpdate.latest, current: pendingUpdate.current } : null,
  }))
  ipcMain.handle('dsh-desktop:check-update', async () => checkNow({ interactive: false }))
  ipcMain.handle('dsh-desktop:upgrade', async (_event, version) => upgrade(String(version)))
  ipcMain.handle('dsh-desktop:check-shell-update', async () => checkShellUpdate({ interactive: false }))
  ipcMain.handle('dsh-desktop:apply-shell-update', async (_event, version) => {
    const result = shellUpdater.checkForShellUpdate()
    if (!result.available) return { ok: false, error: '客户端已是最新版本' }
    if (version && String(version) !== result.latest) {
      return { ok: false, error: '目标版本与更新源不一致' }
    }
    return applyShellUpdateFlow(result)
  })
  ipcMain.handle('dsh-desktop:dismiss-update', async (_event, version) => {
    config.set('dismissedVersion', String(version))
    pendingUpdate = null
    refreshMenus()
    return true
  })
  ipcMain.handle('settings:get', () => settingsSnapshot())
  ipcMain.handle('settings:set', async (_event, patch) => applySettingsPatch(patch || {}))
  ipcMain.handle('settings:action', async (_event, payload) => handleUtilityAction(payload || {}))
  ipcMain.handle('diagnostics:get', () => buildDiagnostics())
  ipcMain.handle('diagnostics:action', async (_event, payload) =>
    handleDiagnosticsAction(payload || {}),
  )
}

function restartAutoCheck() {
  if (autoCheckTimer) clearTimeout(autoCheckTimer)
  autoCheckTimer = null
  startAutoCheck()
}

function startAutoCheck() {
  if (autoCheckTimer) clearTimeout(autoCheckTimer)
  if (quitting) return
  const interval = config.get('checkIntervalMs') || 6 * 60 * 60 * 1000
  const delay = updateDelay(config.get('lastCheckAt'), interval, CHECK_DELAY)
  autoCheckTimer = setTimeout(async () => {
    if (quitting) return
    if (config.get('autoCheck') && !upgrading) {
      try { await checkNow({ interactive: false }) }
      catch (err) { log(`自动检查失败: ${err.message}`) }
    }
    // 失败或关闭时也不高频重试；手动检查始终可用。
    autoCheckTimer = setTimeout(startAutoCheck, interval)
  }, delay)
}

async function refreshRecentSessions() {
  if (recentSessionsLoading) return
  recentSessionsLoading = true
  try {
    recentSessions = await sessionsStore.listRecentSessions(path.join(DSH_HOME, 'sessions'), 8)
  } catch (err) {
    log(`读取最近会话失败: ${err.message}`)
    recentSessions = []
  } finally {
    recentSessionsLoading = false
    refreshMenus()
  }
}

/** 托盘/菜单点击最近会话：先聚焦窗口，再在页面里点击对应会话项（dsh UI 无 URL 路由，best effort）。 */
function openRecentSession(item) {
  showWindow()
  if (!item || !win || win.isDestroyed()) return
  const raw = String(item.rawTitle || item.title || '')
  setTimeout(() => {
    win.webContents
      .executeJavaScript(
        `(() => {
          const want = ${JSON.stringify(raw)};
          if (!want) return 'no-title';
          const nodes = [...document.querySelectorAll('button,a,[role="button"],li,div,span')];
          const exact = nodes.find((el) => (el.textContent || '').trim() === want && el.offsetParent !== null);
          if (exact) { exact.click(); return 'clicked'; }
          const prefix = want.slice(0, 10);
          if (prefix.length > 2) {
            const loose = nodes.find((el) => {
              const text = (el.textContent || '').trim();
              return text.startsWith(prefix) && text.length < 200 && el.offsetParent !== null;
            });
            if (loose) { loose.click(); return 'clicked-prefix'; }
          }
          return 'not-found';
        })()`,
        true,
      )
      .then((result) => log(`打开最近会话 ${item.id}: ${result}`))
      .catch((err) => log(`打开最近会话失败: ${err.message}`))
  }, 600)
}

const SESSION_STATE_JS = `(() => {
  let running = false
  const selector = '[class*="spinner"],[class*="sweep"],[class*="highlight"],[class*="shimmer"],[class*="state-dot"]'
  for (const el of document.querySelectorAll(selector)) {
    const st = getComputedStyle(el)
    if (st.animationName && st.animationName !== 'none' && st.animationIterationCount === 'infinite') {
      running = true
      break
    }
  }
  return {
    running,
    dialogs: document.querySelectorAll('[role="dialog"],dialog').length,
    title: document.title,
  }
})()`

async function pollSessionState() {
  if (!win || win.isDestroyed() || quitting || upgrading) return
  if (!/^http:\/\/127\.0\.0\.1/.test(win.webContents.getURL())) return
  let state
  try {
    state = await win.webContents.executeJavaScript(SESSION_STATE_JS, true)
  } catch {
    return
  }
  if (!state || typeof state.running !== 'boolean') return
  const decision = sessionNotifyDecision(sessionPrev, state, win.isFocused(), {
    finishEnabled: config.get('notifyOnFinish') !== false,
    approvalEnabled: config.get('notifyOnApproval') !== false,
  })
  sessionPrev = { running: state.running, dialogs: Number(state.dialogs) || 0 }
  if (!decision) return
  const title =
    typeof state.title === 'string' && state.title ? state.title : 'DeepSeek Harness'
  if (decision === 'finish') notify('会话已完成', title)
  else notify('可能需要你的确认', title)
  log(`系统通知: ${decision === 'finish' ? '会话完成' : '等待确认'}（${title}）`)
}

function startSessionWatcher() {
  if (sessionWatchTimer) clearInterval(sessionWatchTimer)
  sessionPrev = { running: false, dialogs: 0 }
  sessionWatchTimer = setInterval(() => {
    pollSessionState().catch((err) => log(`会话状态轮询失败: ${err.message}`))
  }, 5000)
}

async function bootstrap() {
  config = new Config(USER_DATA)
  updater.setRegistry(normalizeRegistry(config.get('registry')))
  rotateIfNeeded(MAIN_LOG, MAIN_LOG_MAX_BYTES)
  app.on('child-process-gone', (_event, details) => {
    if (details && details.type === 'GPU') {
      handleGpuProcessGone(details).catch((err) => log(`处理 GPU 崩溃失败: ${err.message}`))
    }
  })
  if (!PORT_ENV) {
    try {
      port = await choosePort(Number(config.get('port') || 3080))
    } catch (err) {
      log(`选择端口失败: ${err.message}`)
    }
  }
  config.set('port', port)
  server = new ServerManager({
    port,
    dshHome: DSH_HOME,
    logFile: SERVER_LOG,
    lockFile: path.join(DSH_HOME, 'web.lock'),
    onExit: () => {
      const now = Date.now()
      serviceExitTimes.push(now)
      while (serviceExitTimes.length && now - serviceExitTimes[0] > 2 * 60 * 1000) {
        serviceExitTimes.shift()
      }
      const delay = serviceRestartDelay(serviceExitTimes, now)
      log(`服务进程意外退出（2 分钟内第 ${serviceExitTimes.length} 次），${delay}ms 后恢复`)
      if (quitting || upgrading || recovering || !config.get('autoRestartService')) return
      if (delay > 5000) {
        notify('服务反复退出', `将在约 ${Math.round(delay / 1000)} 秒后重试启动服务。`)
      }
      setTimeout(() => {
        recoverService('服务进程退出').catch((err) => log(`恢复失败: ${err.message}`))
      }, delay)
    },
  })
  registerIpc()
  createWindow()
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(
    '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>DeepSeek Harness</title>' +
    '<body style="margin:0;background:#151517;color:#e8e8ea;font:16px system-ui;display:grid;place-items:center;height:100vh">' +
    '<div>正在连接 DeepSeek Harness…<p style="font-size:12px;color:#9a9ca6">首次启动需要加载服务和插件</p></div></body></html>'))
  if (!AUTOSTART) win.show()
  log(`启动窗口就绪 ${Math.round(performance.now() - bootStartedAt)}ms`)
  createTray()
  refreshMenus()
  registerGlobalShortcut()
  if (motionTimer) clearInterval(motionTimer)
  motionTimer = setInterval(() => {
    if (!quitting && !upgrading) syncMotionState()
  }, 15000)
  try {
    await ensureServer()
  } catch (err) {
    log(`启动服务失败: ${err.message}`)
    dialog.showErrorBox('启动失败', String(err.message || err))
    quitApp()
    return
  }
  startAutoCheck()
  startHealthMonitor()
  try {
    log(`GPU 状态: ${JSON.stringify(app.getGPUFeatureStatus())}`)
  } catch {
    // ignore
  }
  log(`客户端启动完成 dsh=${installedVersionSafe()} electron=${process.versions.electron} elapsedMs=${Math.round(performance.now() - bootStartedAt)}`)
  startSessionWatcher()
  refreshRecentSessions()
  if (recentSessionsTimer) clearInterval(recentSessionsTimer)
  recentSessionsTimer = setInterval(() => refreshRecentSessions(), 5 * 60 * 1000)

  if (config.get('shellAutoCheck')) {
    setTimeout(() => {
      checkShellUpdate({ interactive: false }).catch((err) =>
        log(`自动检查客户端更新失败: ${err.message}`),
      )
    }, updateDelay(config.get('lastShellCheckAt'), config.get('checkIntervalMs'), CHECK_DELAY + 10000))
  }

  if (TEST_UPGRADE) {
    setTimeout(async () => {
      log(`[test] 触发升级 ${TEST_UPGRADE}`)
      const result = await upgrade(TEST_UPGRADE)
      log(`[test] 升级结果 ${JSON.stringify(result)}`)
      if (EXIT_AFTER_UPGRADE) {
        setTimeout(
          () => quitApp(),
          Number(process.env.DSH_DESKTOP_EXIT_AFTER_UPGRADE_MS || 6000),
        )
      }
    }, TEST_UPGRADE_DELAY)
  }

  if (TEST_SHELL_UPDATE) {
    setTimeout(async () => {
      log('[test] 触发客户端壳自更新')
      const check = await checkShellUpdate({ interactive: false })
      log(`[test] 壳更新检查结果 ${JSON.stringify(check)}`)
      if (check.available) {
        const result = await applyShellUpdateFlow(check)
        log(`[test] 壳更新结果 ${JSON.stringify(result)}`)
      }
    }, TEST_UPGRADE_DELAY)
  }

  if (TEST_HIDE_MS > 0) {
    setTimeout(() => {
      log('[test] 隐藏窗口（用于空闲资源采样）')
      if (win && !win.isDestroyed()) win.hide()
    }, TEST_HIDE_MS)
  }

  if (process.env.DSH_DESKTOP_TEST_OPEN_AUX === '1') {
    setTimeout(() => {
      log('[test] 打开辅助窗口')
      createAuxWindow()
    }, Number(process.env.DSH_DESKTOP_TEST_OPEN_AUX_MS || 3000))
  }

  if (TEST_GPU_CRASH_MS > 0) {
    for (const delay of [TEST_GPU_CRASH_MS, TEST_GPU_CRASH_MS + 800]) {
      setTimeout(() => {
        log('[test] 模拟 GPU 进程崩溃')
        handleGpuProcessGone({
          reason: TEST_GPU_LAUNCH_FAILED ? 'launch-failed' : 'crashed',
          exitCode: 1,
        })
      }, delay)
    }
  }

  if (TEST_KILL_SERVER_MS > 0) {
    setTimeout(() => {
      log('[test] 模拟服务崩溃（SIGKILL）')
      try {
        if (server && server.child) process.kill(-server.child.pid, 'SIGKILL')
      } catch (err) {
        log(`[test] 杀死服务失败: ${err.message}`)
      }
    }, TEST_KILL_SERVER_MS)
  }

  if (TEST_STOP_SERVER_MS > 0) {
    setTimeout(() => {
      log('[test] 模拟服务无响应（SIGSTOP）')
      try {
        if (server && server.child) process.kill(-server.child.pid, 'SIGSTOP')
      } catch (err) {
        log(`[test] 暂停服务失败: ${err.message}`)
      }
    }, TEST_STOP_SERVER_MS)
  }

  const testOpen = process.env.DSH_DESKTOP_TEST_OPEN
  if (testOpen === 'settings' || testOpen === 'diagnostics') {
    setTimeout(() => {
      log(`[test] 打开工具窗口 ${testOpen}`)
      if (testOpen === 'settings') openSettingsWindow()
      else openDiagnosticsWindow()
    }, Number(process.env.DSH_DESKTOP_TEST_OPEN_DELAY_MS || 1500))
  }

  if (EXIT_AFTER_MS > 0) setTimeout(() => quitApp(), EXIT_AFTER_MS)
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => showWindow())
  app.on('before-quit', () => {
    quitting = true
    if (autoCheckTimer) clearInterval(autoCheckTimer)
    if (motionTimer) clearInterval(motionTimer)
    if (sessionWatchTimer) clearInterval(sessionWatchTimer)
    if (recentSessionsTimer) clearInterval(recentSessionsTimer)
    if (healthTimer) clearInterval(healthTimer)
    if (boundsTimer) clearTimeout(boundsTimer)
    if (config) config.save()
    unregisterGlobalShortcut()
    try {
      if (server && server.child) process.kill(-server.child.pid, 'SIGTERM')
    } catch {
      // ignore
    }
  })
  app.on('window-all-closed', () => {
    if (!config) return
    const action = resolveCloseAction(config.get('closeAction'), config.get('closeToTray'))
    if (action === 'quit' || action === 'quit-all') {
      quitApp({ stopExternal: action === 'quit-all' })
    }
  })
  app.on('activate', () => showWindow())
  process.on('uncaughtException', (err) => {
    log(`uncaughtException: ${err.stack || err.message}`)
  })
  process.on('unhandledRejection', (err) => {
    log(`unhandledRejection: ${err && err.stack ? err.stack : err}`)
  })
  app.whenReady().then(bootstrap).catch((err) => {
    log(`客户端初始化失败: ${err.message}`)
    dialog.showErrorBox('启动失败', String(err.message || err))
    quitApp()
  })
}
