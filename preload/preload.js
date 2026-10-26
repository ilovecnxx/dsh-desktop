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

// ---- 文件拖拽上传增强（显示提示层，避免拖入文件时页面跳转）----
const DROP_OVERLAY_ID = 'dsh-desktop-drop-overlay'
let dragDepth = 0

function hasFiles(event) {
  const types = event.dataTransfer && event.dataTransfer.types
  return !!types && Array.prototype.includes.call(types, 'Files')
}

function showDropOverlay() {
  if (document.getElementById(DROP_OVERLAY_ID) || !document.documentElement) return
  const host = document.createElement('div')
  host.id = DROP_OVERLAY_ID
  const shadow = host.attachShadow({ mode: 'closed' })
  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      .overlay {
        position: fixed; inset: 0; z-index: 2147483646;
        background: rgba(10, 11, 14, 0.72); display: grid; place-items: center;
        font: 15px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif; color: #e8e8ea;
        border: 2px dashed #4f6ef7; pointer-events: none;
      }
      .box { text-align: center; }
      .title { font-weight: 600; font-size: 17px; }
      .hint { color: #9a9ca6; font-size: 12px; margin-top: 4px; }
    </style>
    <div class="overlay"><div class="box">
      <div class="title">松开鼠标上传文件</div>
      <div class="hint">文件会作为附件发送到当前会话</div>
    </div></div>`
  document.documentElement.appendChild(host)
}

function hideDropOverlay() {
  document.getElementById(DROP_OVERLAY_ID)?.remove()
}

window.addEventListener(
  'dragenter',
  (event) => {
    if (!hasFiles(event)) return
    dragDepth += 1
    showDropOverlay()
  },
  true,
)
window.addEventListener(
  'dragleave',
  (event) => {
    if (!hasFiles(event)) return
    dragDepth = Math.max(0, dragDepth - 1)
    if (dragDepth === 0) hideDropOverlay()
  },
  true,
)
window.addEventListener(
  'dragover',
  (event) => {
    if (!hasFiles(event)) return
    // 阻止 Electron 默认打开拖入的文件；页面自己的 drop 处理器仍会收到事件
    event.preventDefault()
  },
  true,
)
window.addEventListener(
  'drop',
  (event) => {
    if (!hasFiles(event)) return
    event.preventDefault()
    dragDepth = 0
    hideDropOverlay()
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

async function handleDroppedFiles(files) {
  const paths = []
  const blobs = []
  for (const file of files) {
    let filePath = ''
    try {
      filePath = webUtils.getPathForFile(file) || ''
    } catch {
      filePath = ''
    }
    if (filePath) paths.push(filePath)
    else if (file.size <= 20 * 1024 * 1024) blobs.push(file)
  }
  if (paths.length) {
    try {
      const result = await ipcRenderer.invoke('dsh:open-dropped', { paths })
      if (result && result.folder) {
        showToast(`已在新窗口打开工作区：${result.folder}`)
        return true
      }
      if (result && Array.isArray(result.files) && result.files.length) {
        return insertTextIntoComposer(result.files.join('\n'))
      }
    } catch (err) {
      showToast(`处理拖入内容失败：${err.message}`)
    }
  }
  const saved = []
  for (const file of blobs) {
    try {
      const data = new Uint8Array(await file.arrayBuffer())
      const result = await ipcRenderer.invoke('dsh:save-pasted-file', {
        name: file.name,
        type: file.type,
        data,
      })
      if (result && result.path) saved.push(result.path)
    } catch {
      // ignore
    }
  }
  if (!saved.length) return false
  return insertTextIntoComposer(saved.join('\n'))
}

// 拖入文件/图片：插入真实路径（页面没有附件上传接口，路径可直接被 dsh 工具读取）
window.addEventListener(
  'drop',
  (event) => {
    if (!hasFiles(event)) return
    event.preventDefault()
    event.stopImmediatePropagation()
    dragDepth = 0
    hideDropOverlay()
    const files = [...(event.dataTransfer?.files || [])]
    if (!files.length) return
    handleDroppedFiles(files).then((ok) => {
      if (ok) showToast(`已处理 ${files.length} 个文件/文件夹`)
    })
  },
  true,
)

// 粘贴：文件/图片保存后插入路径；超长文本保存为 txt 再插入路径
window.addEventListener(
  'paste',
  async (event) => {
    if (!pasteConfig.enabled) return
    const data = event.clipboardData
    if (!data) return
    const fileItems = [...(data.items || [])].filter((item) => item.kind === 'file')
    if (fileItems.length) {
      const files = fileItems.map((item) => item.getAsFile()).filter(Boolean)
      if (!files.length) return
      event.preventDefault()
      event.stopImmediatePropagation()
      const ok = await handleDroppedFiles(files)
      if (ok) showToast(`已处理 ${files.length} 个图片/文件`)
      return
    }
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
