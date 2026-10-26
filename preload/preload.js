'use strict'

/**
 * 预加载脚本（运行在沙箱渲染进程）：
 * 1. 向页面暴露受限的桌面客户端 API；
 * 2. 在页面内注入「发现新版本 / 立即升级」提示条。
 */
const { contextBridge, ipcRenderer } = require('electron')

const BANNER_ID = 'dsh-desktop-update-banner'
let currentInfo = null
let upgradeState = 'idle'

contextBridge.exposeInMainWorld('dshDesktop', {
  getInfo: () => ipcRenderer.invoke('dsh-desktop:info'),
  checkUpdate: () => ipcRenderer.invoke('dsh-desktop:check-update'),
  upgrade: (version) => ipcRenderer.invoke('dsh-desktop:upgrade', version),
  dismissUpdate: (version) => ipcRenderer.invoke('dsh-desktop:dismiss-update', version),
})

function removeBanner() {
  document.getElementById(BANNER_ID)?.remove()
}

function renderBanner(info) {
  if (!info || upgradeState === 'upgrading') return
  removeBanner()
  currentInfo = info
  const host = document.createElement('div')
  host.id = BANNER_ID
  const shadow = host.attachShadow({ mode: 'closed' })
  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      .card {
        position: fixed; right: 18px; bottom: 18px; width: 300px;
        background: #1c1d21; color: #e8e8ea; border: 1px solid #34363d;
        border-radius: 12px; box-shadow: 0 12px 40px rgba(0,0,0,.5);
        font: 13px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif;
        padding: 14px 16px; z-index: 2147483647; user-select: none;
      }
      .title { font-weight: 600; font-size: 14px; }
      .title b { color: #7c9bff; }
      .sub { color: #9a9ca6; font-size: 12px; margin-top: 2px; }
      .actions { display: flex; gap: 8px; margin-top: 12px; }
      button {
        flex: 1; border: 0; border-radius: 8px; padding: 7px 10px;
        font: inherit; font-size: 12px; cursor: pointer;
      }
      #go { background: #4f6ef7; color: #fff; font-weight: 600; }
      #go:hover { background: #5b79ff; }
      #later { background: #2a2c33; color: #c7c9d3; }
      #later:hover { background: #33363f; }
      .err { color: #ff8f8f; font-size: 12px; margin-top: 8px; white-space: pre-wrap; }
      .progress { color: #c7c9d3; font-size: 12px; margin-top: 8px; }
    </style>
    <div class="card">
      <div class="title">发现新版本 <b>v${escapeHtml(info.latest)}</b></div>
      <div class="sub">当前版本 v${escapeHtml(info.current)}</div>
      <div class="actions">
        <button id="go">立即升级</button>
        <button id="later">稍后</button>
      </div>
      <div class="progress" hidden></div>
      <div class="err" hidden></div>
    </div>`
  const card = shadow.querySelector('.card')
  const go = shadow.querySelector('#go')
  const later = shadow.querySelector('#later')
  const progress = shadow.querySelector('.progress')
  const err = shadow.querySelector('.err')

  later.addEventListener('click', () => {
    ipcRenderer.invoke('dsh-desktop:dismiss-update', info.latest).catch(() => {})
    removeBanner()
  })
  go.addEventListener('click', async () => {
    upgradeState = 'upgrading'
    go.disabled = true
    later.disabled = true
    go.textContent = '升级中…'
    progress.hidden = false
    progress.textContent = '正在停止服务…'
    err.hidden = true
    try {
      const result = await ipcRenderer.invoke('dsh-desktop:upgrade', info.latest)
      if (!result || !result.ok) {
        upgradeState = 'idle'
        progress.hidden = true
        err.hidden = false
        err.textContent = (result && result.error) || '升级失败'
        go.disabled = false
        later.disabled = false
        go.textContent = '重试'
      }
      // 成功时主进程会重启服务并刷新页面，提示条随之消失
    } catch (error) {
      upgradeState = 'idle'
      progress.hidden = true
      err.hidden = false
      err.textContent = String(error)
      go.disabled = false
      later.disabled = false
      go.textContent = '重试'
    }
  })

  // 挂到 documentElement，避免被页面的 body 样式裁剪
  document.documentElement.appendChild(host)
  return card
}

function escapeHtml(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

ipcRenderer.on('dsh-desktop:update-available', (_event, info) => {
  renderBanner(info)
})

ipcRenderer.on('dsh-desktop:update-clear', () => {
  removeBanner()
})

// 页面可能因服务重启而整页重载，重载后主进程会再次推送；这里不需额外逻辑。
window.addEventListener('DOMContentLoaded', () => {
  if (currentInfo && upgradeState === 'idle') {
    // 保留当前状态，等待主进程重新推送
  }
})

// ---- 会话空闲时隐藏 dsh 前端残留的「任务运行中」状态条（兼容层）----
const HIDE_RUNNING_STYLE_ID = 'dsh-desktop-hide-running'
let uiConfig = { autoHideStaleRunning: true }
let sessionRunning = true
let hideRunningTimer = null

function applyRunningBarVisibility() {
  const existing = document.getElementById(HIDE_RUNNING_STYLE_ID)
  if (existing) existing.remove()
  if (!uiConfig.autoHideStaleRunning || sessionRunning || !document.documentElement) return
  const style = document.createElement('style')
  style.id = HIDE_RUNNING_STYLE_ID
  style.textContent = '[class*="_running"]{display:none!important}'
  document.documentElement.appendChild(style)
}

function setSessionRunning(running) {
  sessionRunning = Boolean(running)
  if (hideRunningTimer) {
    clearTimeout(hideRunningTimer)
    hideRunningTimer = null
  }
  if (sessionRunning) {
    applyRunningBarVisibility()
  } else {
    // 等 dsh 自己清理；8 秒后仍在才隐藏，避免误伤
    hideRunningTimer = setTimeout(() => applyRunningBarVisibility(), 8000)
  }
}

ipcRenderer.on('dsh-desktop:ui-config', (_event, cfg) => {
  if (cfg && typeof cfg === 'object') {
    uiConfig = { autoHideStaleRunning: cfg.autoHideStaleRunning !== false }
    applyRunningBarVisibility()
  }
})
ipcRenderer.on('dsh-desktop:session-running', (_event, data) => {
  if (data && typeof data.running === 'boolean') setSessionRunning(data.running)
})
ipcRenderer
  .invoke('dsh:get-ui-config')
  .then((cfg) => {
    if (cfg) {
      uiConfig = { autoHideStaleRunning: cfg.autoHideStaleRunning !== false }
      applyRunningBarVisibility()
    }
  })
  .catch(() => {})

// ---- 拖拽诊断（不拦截，交给 dsh 原生拖拽附件）----
// dsh 前端自带「文件或图片拖动到此处」提示层（backdrop blur）。客户端不再
// preventDefault / stopPropagation，避免其拖拽状态无法复位导致模糊层残留。
const DROP_OVERLAY_ID = 'dsh-desktop-drop-overlay'

function isFullscreenBlurMask(el) {
  try {
    const st = getComputedStyle(el)
    const blur = /blur/i.test(st.backdropFilter || '') || /blur/i.test(st.filter || '')
    if (!blur) return false
    const r = el.getBoundingClientRect()
    return r.width >= window.innerWidth * 0.9 && r.height >= window.innerHeight * 0.9
  } catch {
    return false
  }
}

function collectDropDiagnostics() {
  const masks = []
  for (const el of document.querySelectorAll('*')) {
    if (!isFullscreenBlurMask(el)) continue
    const r = el.getBoundingClientRect()
    masks.push({
      tag: el.tagName.toLowerCase(),
      cls: String(el.getAttribute('class') || '').slice(0, 120),
      role: el.getAttribute('role') || '',
      backdropFilter: getComputedStyle(el).backdropFilter,
      rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
      text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80),
    })
    if (masks.length >= 5) break
  }
  return {
    overlay: !!document.getElementById(DROP_OVERLAY_ID),
    masks,
    dialogs: document.querySelectorAll('[role="dialog"], dialog').length,
    activeTag: document.activeElement ? document.activeElement.tagName : '',
  }
}

// 仅观察和记录，不改变事件默认行为
window.addEventListener(
  'drop',
  () => {
    setTimeout(() => {
      try {
        ipcRenderer.send('dsh:drop-diagnostics', collectDropDiagnostics())
      } catch {
        // ignore
      }
    }, 800)
  },
  true,
)

// ---- 拖拽/粘贴文件与长文本转文件（CODEX 风格）----
let pasteConfig = { enabled: true, threshold: 6000 }

function applyPasteConfig(cfg) {
  if (!cfg || typeof cfg !== 'object') return
  pasteConfig = {
    enabled: cfg.enabled !== false,
    threshold: Number(cfg.threshold) || 6000,
  }
}

ipcRenderer.on('dsh-desktop:paste-config', (_event, cfg) => applyPasteConfig(cfg))
// 仅测试环境：主进程下发 test-mode 后暴露模拟粘贴 API（用于自动化验证）
ipcRenderer.on('dsh-desktop:test-mode', () => {
  try {
    contextBridge.exposeInMainWorld('__dshDesktopTest', {
      pasteText: async (text) => {
        if (!text || text.length < pasteConfig.threshold) return 'below-threshold'
        const result = await ipcRenderer.invoke('dsh:save-pasted-text', { text })
        if (result && result.path) {
          insertTextIntoComposer(result.path)
          return result.path
        }
        return 'no-path'
      },
    })
  } catch {
    // 重复暴露时忽略
  }
})
ipcRenderer.invoke('dsh:get-paste-config').then(applyPasteConfig).catch(() => {})

const TOAST_ID = 'dsh-desktop-toast'

function showToast(text) {
  document.getElementById(TOAST_ID)?.remove()
  const host = document.createElement('div')
  host.id = TOAST_ID
  const shadow = host.attachShadow({ mode: 'closed' })
  shadow.innerHTML = `
    <style>
      .toast {
        position: fixed; left: 50%; bottom: 96px; transform: translateX(-50%);
        z-index: 2147483647; max-width: 70vw; padding: 8px 14px;
        background: rgba(24, 25, 30, 0.95); color: #e8e8ea; border-radius: 8px;
        font: 13px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif;
        border: 1px solid #34363f; box-shadow: 0 6px 24px rgba(0,0,0,0.35);
      }
    </style>
    <div class="toast"></div>`
  shadow.querySelector('.toast').textContent = text
  document.documentElement.appendChild(host)
  setTimeout(() => host.remove(), 2600)
}

function isEditable(el) {
  if (!el) return false
  if (el.disabled || el.readOnly) return false
  return (
    el.tagName === 'TEXTAREA' ||
    el.tagName === 'INPUT' ||
    el.isContentEditable ||
    el.getAttribute('role') === 'textbox'
  )
}

function findComposer() {
  const active = document.activeElement
  if (isEditable(active) && active.offsetParent !== null) return active
  const candidates = [...document.querySelectorAll(
    'textarea, [contenteditable="true"], [contenteditable=""], [role="textbox"]',
  )].filter((el) => isEditable(el) && el.offsetParent !== null)
  // 聊天输入框通常在最底部
  candidates.sort((a, b) => b.getBoundingClientRect().top - a.getBoundingClientRect().top)
  return candidates[0] || null
}

/** 把路径/文本插入聊天输入框（兼容 textarea 与 contenteditable）。 */
function insertTextIntoComposer(text) {
  const el = findComposer()
  if (!el) {
    navigator.clipboard?.writeText(text).catch(() => {})
    showToast('未找到输入框，路径已复制到剪贴板')
    return false
  }
  el.focus()
  if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set
    const current = el.value || ''
    setter.call(el, current && !current.endsWith('\n') ? `${current}\n${text}` : `${current}${text}`)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  }
  const selection = window.getSelection()
  selection?.removeAllRanges()
  const range = document.createRange()
  range.selectNodeContents(el)
  range.collapse(false)
  selection?.addRange(range)
  if (document.execCommand('insertText', false, text)) return true
  el.textContent = `${el.textContent || ''}${text}`
  el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }))
  return true
}

// 粘贴：文件/图片保存后插入路径；超长文本保存为 txt 再插入路径
window.addEventListener(
  'paste',
  async (event) => {
    if (!pasteConfig.enabled) return
    const data = event.clipboardData
    if (!data) return
    // 图片/文件粘贴交给 dsh 原生附件处理；这里只处理超长文本
    const fileItems = [...(data.items || [])].filter((item) => item.kind === 'file')
    if (fileItems.length) return
    const text = data.getData('text/plain') || ''
    if (!text || text.length < pasteConfig.threshold) return
    event.preventDefault()
    event.stopImmediatePropagation()
    try {
      const result = await ipcRenderer.invoke('dsh:save-pasted-text', { text })
      if (result && result.path && insertTextIntoComposer(result.path)) {
        showToast(`长文本已保存为文件并插入路径（${text.length} 字符）`)
      }
    } catch (err) {
      showToast(`长文本转文件失败：${err.message}`)
    }
  },
  true,
)
