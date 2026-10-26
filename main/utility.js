'use strict'

/**
 * 工具窗口：设置中心 + 诊断面板。
 * 使用独立 preload（preload/utility.js）通过白名单 IPC 与主进程通信。
 */
const { BrowserWindow, clipboard } = require('electron')
const path = require('node:path')
const fs = require('node:fs')

const ICON = path.join(__dirname, '..', 'assets', 'icon-256.png')

function createUtilityWindow({ title, width, height, html }) {
  const win = new BrowserWindow({
    width,
    height,
    title,
    show: false,
    backgroundColor: '#151517',
    autoHideMenuBar: true,
    resizable: true,
    icon: ICON,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'utility.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  })
  win.setMenuBarVisibility(false)
  win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
  win.once('ready-to-show', () => win.show())
  return win
}

const BASE_CSS = `
  html,body{margin:0;height:100%;background:#151517;color:#e8e8ea;
    font:13px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif}
  .wrap{padding:20px 22px 18px;max-width:760px;margin:0 auto}
  h1{font-size:16px;margin:0 0 4px;font-weight:600}
  .sub{color:#9a9ca6;font-size:12px;margin-bottom:16px}
  .row{display:flex;align-items:center;justify-content:space-between;gap:16px;
    padding:9px 0;border-bottom:1px solid #23252b}
  .row:last-of-type{border-bottom:0}
  .label{color:#e8e8ea}
  .hint{color:#8a8d97;font-size:11px;margin-top:2px}
  .value{color:#c7c9d3;font-size:12px}
  select,input[type="text"]{background:#1c1d21;color:#e8e8ea;border:1px solid #34363d;
    border-radius:7px;padding:5px 8px;font:inherit;min-width:120px}
  input[type="checkbox"]{width:16px;height:16px;accent-color:#4f6ef7}
  .actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:18px}
  button{background:#2a2c33;color:#d8dae2;border:0;border-radius:8px;
    padding:8px 13px;font:inherit;font-size:12px;cursor:pointer}
  button:hover{background:#33363f}
  button.primary{background:#4f6ef7;color:#fff;font-weight:600}
  button.primary:hover{background:#5b79ff}
  .toast{margin-top:12px;color:#7c9bff;font-size:12px;min-height:18px}
  pre{background:#101114;border:1px solid #23252b;border-radius:8px;padding:10px;
    font:11px/1.45 ui-monospace,monospace;color:#c7c9d3;white-space:pre-wrap;
    word-break:break-all;max-height:220px;overflow:auto;margin:6px 0 0}
  .grid{display:grid;grid-template-columns:120px 1fr;gap:4px 12px;font-size:12px}
  .grid b{color:#9a9ca6;font-weight:500}
  h2{font-size:13px;margin:18px 0 4px;color:#c7c9d3}
`

function settingsHtml() {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>${BASE_CSS}</style></head>
<body><div class="wrap">
  <h1>设置</h1>
  <div class="sub">DeepSeek Harness 桌面客户端</div>

  <div class="row"><div><div class="label">更新通道</div><div class="hint">next 跟随预发布，latest 只跟稳定版</div></div>
    <select id="channel"><option value="next">next（预发布）</option><option value="latest">latest（稳定）</option></select></div>
  <div class="row"><div><div class="label">自动检查 dsh 更新</div></div><input type="checkbox" id="autoCheck"></div>
  <div class="row"><div><div class="label">自动检查客户端更新</div></div><input type="checkbox" id="shellAutoCheck"></div>
  <div class="row"><div><div class="label">服务异常时自动重启</div></div><input type="checkbox" id="autoRestartService"></div>
  <div class="row"><div><div class="label">健康检查间隔</div></div>
    <select id="healthIntervalMs">
      <option value="10000">10 秒</option><option value="15000">15 秒</option>
      <option value="30000">30 秒</option><option value="60000">60 秒</option>
    </select></div>
  <div class="row"><div><div class="label">关闭窗口时</div><div class="hint">收进托盘 / 退出客户端（保留后台服务）/ 彻底退出（停止后台服务）</div></div>
    <select id="closeAction"><option value="tray">收进托盘</option><option value="quit">退出客户端（保留服务）</option><option value="quit-all">彻底退出（含后台）</option></select></div>
  <div class="row"><div><div class="label">Wayland 兼容模式（X11）</div><div class="hint">优先使用可用的 X11；认证不可用时回退到 Wayland，重启生效</div></div><input type="checkbox" id="useX11"></div>
  <div class="row"><div><div class="label">软件渲染</div><div class="hint">GPU 进程反复崩溃时启用，重启生效</div></div><input type="checkbox" id="softwareRendering"></div>
  <div class="row"><div><div class="label">开机自启</div><div class="hint">登录后自动启动客户端</div></div><input type="checkbox" id="autostart"></div>
  <div class="row"><div><div class="label">全局快捷键</div><div class="hint" id="shortcutHint"></div></div><input type="checkbox" id="globalShortcutEnabled"></div>
  <div class="row"><div><div class="label">客户端更新源</div></div><div class="value" id="shellSource">—</div></div>
  <div class="row"><div><div class="label">当前版本</div></div><div class="value" id="versions">—</div></div>

  <div class="actions">
    <button class="primary" id="save">保存</button>
    <button id="check-dsh">检查 dsh 更新</button>
    <button id="check-shell">检查客户端更新</button>
    <button id="restart">重启服务</button>
    <button id="open-logs">打开日志</button>
    <button id="restart-app">重启客户端</button>
    <button id="quit-all">彻底退出（含网页服务）</button>
  </div>
  <div class="toast" id="toast"></div>
</div>
<script>
const $ = (id) => document.getElementById(id)
async function refresh() {
  const state = await window.dshUtility.invoke('settings:get')
  $('channel').value = state.config.channel
  $('autoCheck').checked = !!state.config.autoCheck
  $('shellAutoCheck').checked = !!state.config.shellAutoCheck
  $('autoRestartService').checked = !!state.config.autoRestartService
  $('closeAction').value = state.config.closeAction || 'tray'
  $('useX11').checked = !!state.config.useX11
  $('softwareRendering').checked = !!state.config.softwareRendering
  $('globalShortcutEnabled').checked = !!state.config.globalShortcutEnabled
  $('autostart').checked = !!state.autostart
  $('healthIntervalMs').value = String(state.config.healthIntervalMs || 60000)
  $('shortcutHint').textContent = state.globalShortcut + (state.shortcutRegistered ? '（已生效）' : '（未生效）')
  $('shellSource').textContent = state.shellSource
  $('versions').textContent = '客户端 v' + state.clientVersion + ' · dsh v' + state.dshVersion
}
function toast(text) { $('toast').textContent = text || '' }
$('save').addEventListener('click', async () => {
  try {
    await window.dshUtility.invoke('settings:set', {
      channel: $('channel').value,
      autoCheck: $('autoCheck').checked,
      shellAutoCheck: $('shellAutoCheck').checked,
      autoRestartService: $('autoRestartService').checked,
      closeAction: $('closeAction').value,
      useX11: $('useX11').checked,
      softwareRendering: $('softwareRendering').checked,
      globalShortcutEnabled: $('globalShortcutEnabled').checked,
      healthIntervalMs: Number($('healthIntervalMs').value),
      autostart: $('autostart').checked,
    })
    await refresh()
    toast('已保存')
  } catch (err) { toast('保存失败：' + err.message) }
})
for (const [id, action] of [['check-dsh','check-dsh-update'],['check-shell','check-shell-update'],['restart','restart-service'],['open-logs','open-logs'],['restart-app','restart-app'],['quit-all','quit-all']]) {
  $(id).addEventListener('click', async () => {
    try {
      const res = await window.dshUtility.invoke('settings:action', { action })
      toast(res && res.message ? res.message : '完成')
    } catch (err) { toast('操作失败：' + err.message) }
  })
}
refresh().catch((err) => toast('加载失败：' + err.message))
</script></body></html>`
}

function diagnosticsHtml() {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>${BASE_CSS}</style></head>
<body><div class="wrap">
  <h1>诊断信息</h1>
  <div class="sub">用于排查客户端与服务状态，可一键复制</div>
  <div class="grid" id="info"></div>
  <h2>最近客户端日志</h2>
  <pre id="mainLog"></pre>
  <h2>最近服务日志</h2>
  <pre id="serverLog"></pre>
  <div class="actions">
    <button class="primary" id="copy">复制诊断信息</button>
    <button id="refresh">刷新</button>
    <button id="check-dsh">检查 dsh 更新</button>
    <button id="check-shell">检查客户端更新</button>
    <button id="restart">重启服务</button>
    <button id="open-logs">打开日志目录</button>
  </div>
  <div class="toast" id="toast"></div>
</div>
<script>
const $ = (id) => document.getElementById(id)
async function refresh() {
  const info = await window.dshUtility.invoke('diagnostics:get')
  const rows = [
    ['客户端版本', info.clientVersion],
    ['dsh 运行时', info.dshVersion],
    ['服务状态', info.status],
    ['服务模式', info.managed ? '客户端托管' : '复用外部服务'],
    ['服务 PID', info.servicePid || '—'],
    ['端口', info.port],
    ['全局快捷键', info.shortcut],
    ['软件渲染', info.softwareRendering ? '开' : '关（GPU 加速）'],
    ['Electron', info.electron],
    ['Node', info.node],
    ['系统', info.os],
    ['最近检查更新', info.lastCheckAt || '—'],
    ['最近检查客户端', info.lastShellCheckAt || '—'],
  ]
  $('info').innerHTML = rows.map(([k, v]) => '<b>' + k + '</b><span>' + String(v ?? '—') + '</span>').join('')
  $('mainLog').textContent = info.mainLog || '（无）'
  $('serverLog').textContent = info.serverLog || '（无）'
}
function toast(text) { $('toast').textContent = text || '' }
$('copy').addEventListener('click', async () => {
  try { const res = await window.dshUtility.invoke('diagnostics:action', { action: 'copy' }); toast(res.message || '已复制') }
  catch (err) { toast('复制失败：' + err.message) }
})
$('refresh').addEventListener('click', () => refresh().then(() => toast('已刷新')))
for (const [id, action] of [['check-dsh','check-dsh-update'],['check-shell','check-shell-update'],['restart','restart-service'],['open-logs','open-logs']]) {
  $(id).addEventListener('click', async () => {
    try { const res = await window.dshUtility.invoke('diagnostics:action', { action }); toast(res.message || '完成') }
    catch (err) { toast('操作失败：' + err.message) }
  })
}
refresh().catch((err) => toast('加载失败：' + err.message))
</script></body></html>`
}

module.exports = { createUtilityWindow, settingsHtml, diagnosticsHtml, clipboard }
