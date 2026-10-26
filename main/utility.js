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
  <div class="row"><div><div class="label">自动检查间隔</div></div>
    <select id="checkIntervalMs"><option value="21600000">6 小时</option><option value="43200000">12 小时</option><option value="86400000">24 小时</option></select></div>
  <div class="row"><div><div class="label">npm 镜像源</div><div class="hint">国内可填 https://registry.npmmirror.com/</div></div>
    <input type="text" id="registry" style="min-width:270px"></div>
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
  <div class="row"><div><div class="label">任务完成通知</div><div class="hint">窗口未聚焦时，会话运行结束弹系统通知</div></div><input type="checkbox" id="notifyOnFinish"></div>
  <div class="row"><div><div class="label">等待确认通知</div><div class="hint">窗口未聚焦且出现确认弹窗时提醒</div></div><input type="checkbox" id="notifyOnApproval"></div>
  <div class="row"><div><div class="label">长文本粘贴转文件</div><div class="hint">超过阈值的内容保存为 txt 文件并插入路径</div></div><input type="checkbox" id="pasteToFileEnabled"></div>
  <div class="row"><div><div class="label">转换阈值（字符）</div></div><input type="number" id="pasteToFileThreshold" min="500" max="200000" step="500"></div>
  <div class="row"><div><div class="label">工作区实例上限</div><div class="hint">同时打开的工作区窗口数，超出按最旧自动关闭</div></div><input type="number" id="workspaceLimit" min="1" max="10" step="1"></div>
  <div class="row"><div><div class="label">以 root 运行服务（实验性）</div><div class="hint">需先运行 sudo bash scripts/setup-root.sh；会以 root 运行 dsh web</div></div><input type="checkbox" id="runServiceAsRoot"></div>
  <div class="row"><div><div class="label">界面动效</div><div class="hint">会话运行时的动画在部分 Wayland/GPU 上很耗 CPU；失焦暂停可显著省电</div></div>
    <select id="motionMode"><option value="auto">自动（失焦或空闲时暂停）</option><option value="normal">正常</option><option value="blur">仅失焦时暂停</option><option value="always">始终暂停</option></select></div>
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
async function fmtDuration(ms) {
  const total = Math.max(0, Math.floor(Number(ms) || 0) / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  return h > 0 ? h + 'h ' + m + 'm' : m + 'm'
}

function refresh() {
  const state = await window.dshUtility.invoke('settings:get')
  $('channel').value = state.config.channel
  $('autoCheck').checked = !!state.config.autoCheck
  $('checkIntervalMs').value = String(state.config.checkIntervalMs || 21600000)
  $('registry').value = state.config.registry || 'https://registry.npmjs.org/'
  $('shellAutoCheck').checked = !!state.config.shellAutoCheck
  $('autoRestartService').checked = !!state.config.autoRestartService
  $('closeAction').value = state.config.closeAction || 'tray'
  $('useX11').checked = !!state.config.useX11
  $('softwareRendering').checked = !!state.config.softwareRendering
  $('motionMode').value = state.config.motionMode || 'auto'
  $('notifyOnFinish').checked = state.config.notifyOnFinish !== false
  $('notifyOnApproval').checked = state.config.notifyOnApproval !== false
  $('pasteToFileEnabled').checked = state.config.pasteToFileEnabled !== false
  $('pasteToFileThreshold').value = String(state.config.pasteToFileThreshold || 6000)
  $('runServiceAsRoot').checked = Boolean(state.config.runServiceAsRoot)
  $('workspaceLimit').value = String(state.config.workspaceLimit || 3)
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
      checkIntervalMs: Number($('checkIntervalMs').value),
      registry: $('registry').value.trim(),
      shellAutoCheck: $('shellAutoCheck').checked,
      autoRestartService: $('autoRestartService').checked,
      closeAction: $('closeAction').value,
      useX11: $('useX11').checked,
      softwareRendering: $('softwareRendering').checked,
      motionMode: $('motionMode').value,
      notifyOnFinish: $('notifyOnFinish').checked,
      notifyOnApproval: $('notifyOnApproval').checked,
      pasteToFileEnabled: $('pasteToFileEnabled').checked,
      pasteToFileThreshold: Number($('pasteToFileThreshold').value),
      runServiceAsRoot: $('runServiceAsRoot').checked,
      workspaceLimit: Number($('workspaceLimit').value),
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
    <button id="export-diag">导出诊断包</button>
    <button id="export-sessions">备份会话</button>
    <button id="export-markdown">导出最近会话 Markdown</button>
    <button id="rollback-shell">回滚客户端版本</button>
    <button id="rollback-dsh">回滚 dsh 运行时</button>
    <button id="systemd-enable">启用 systemd 托管</button>
    <button id="systemd-disable">返回客户端托管</button>
    <button id="fix-owner">修复 dsh 文件属主</button>
    <button id="switch-dev-service">连接开发服务(3080)</button>
    <button id="switch-test-service">连接 root 测试(3081)</button>
    <button id="root-service-start">启动 root 服务</button>
    <button id="root-service-stop">停止 root 服务</button>
    <button id="close-workspaces">关闭全部工作区</button>
    <button id="stability-report">导出稳定性报告</button>
    <button id="clear-cache">清理缓存</button>
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
    ['工作区窗口', String(info.workspaceCount ?? 0)],
    ['运行时长', fmtDuration(info.stability && info.stability.uptimeMs)],
    ['自动重连', String((info.stability && info.stability.reconnects) || 0)],
    ['GPU 降级', String((info.stability && info.stability.gpuFallbacks) || 0)],
    ['当前 HOME', info.home || process.env.HOME || ''],
    ['服务托管', info.useSystemdService ? 'systemd 用户服务' : info.externalService ? '外部服务 ' + info.port : '客户端子进程'],
    ['界面动效', info.motionMode === 'always' ? '始终暂停' : info.motionMode === 'blur' ? '仅失焦暂停' : info.motionMode === 'auto' ? '自动（失焦/空闲暂停）' : '正常'],
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
for (const [id, action] of [['check-dsh','check-dsh-update'],['check-shell','check-shell-update'],['restart','restart-service'],['open-logs','open-logs'],['export-diag','export-diagnostics'],['export-sessions','export-sessions'],['export-markdown','export-markdown'],['rollback-shell','rollback-shell'],['rollback-dsh','rollback-dsh'],['systemd-enable','systemd-enable'],['systemd-disable','systemd-disable'],['fix-owner','fix-owner'],['close-workspaces','close-workspaces'],['stability-report','stability-report'],['switch-dev-service','switch-dev-service'],['switch-test-service','switch-test-service'],['root-service-start','root-service-start'],['root-service-stop','root-service-stop'],['clear-cache','clear-cache']]) {
  $(id).addEventListener('click', async () => {
    try { const res = await window.dshUtility.invoke('diagnostics:action', { action }); toast(res.message || '完成') }
    catch (err) { toast('操作失败：' + err.message) }
  })
}
refresh().catch((err) => toast('加载失败：' + err.message))
</script></body></html>`
}

module.exports = { createUtilityWindow, settingsHtml, diagnosticsHtml, clipboard }
