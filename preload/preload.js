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
