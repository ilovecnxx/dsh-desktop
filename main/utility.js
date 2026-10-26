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
  *{box-sizing:border-box}
  html,body{margin:0;min-height:100%;background:
    radial-gradient(1100px 520px at 15% -10%, #1c2333 0%, rgba(18,20,26,0) 60%),
    radial-gradient(900px 480px at 110% 0%, #1a2436 0%, rgba(14,16,21,0) 55%),
    #0f1117;color:#e9ecf3;
    font:13px/1.65 system-ui,-apple-system,"Segoe UI","Noto Sans CJK SC",sans-serif;
    -webkit-font-smoothing:antialiased}
  .wrap{padding:26px 26px 92px;max-width:820px;margin:0 auto}
  h1{font-size:19px;margin:0 0 6px;font-weight:650;letter-spacing:.2px;
    background:linear-gradient(90deg,#f3f6ff,#9db4ff 70%,#b39dff);
    -webkit-background-clip:text;background-clip:text;color:transparent}
  .sub{color:#9aa1b4;font-size:12px;margin-bottom:18px}
  .row{display:flex;align-items:center;justify-content:space-between;gap:16px;
    padding:12px 14px;margin:8px 0;border:1px solid rgba(255,255,255,.065);
    border-radius:12px;background:rgba(255,255,255,.028);transition:background .15s,border-color .15s}
  .row:hover{background:rgba(255,255,255,.05);border-color:rgba(255,255,255,.11)}
  .label{color:#eef1f8;font-weight:520}
  .hint{color:#8f96a9;font-size:11px;margin-top:3px;line-height:1.5}
  .value{color:#c9cfdd;font-size:12px}
  select,input[type="text"]{background:#171b24;color:#eef1f8;border:1px solid #2f3749;
    border-radius:9px;padding:7px 10px;font:inherit;min-width:132px;outline:none;transition:border-color .15s,box-shadow .15s}
  select:focus,input[type="text"]:focus{border-color:#5b7cfa;box-shadow:0 0 0 3px rgba(91,124,250,.16)}
  input[type="checkbox"]{width:17px;height:17px;accent-color:#5b7cfa;cursor:pointer}
  .actions{position:sticky;bottom:0;display:flex;flex-wrap:wrap;gap:9px;margin-top:20px;
    padding:14px 0 12px;background:linear-gradient(180deg,rgba(15,17,23,0),rgba(15,17,23,.94) 40%);
    backdrop-filter:blur(8px);z-index:5}
  button{background:#232a38;color:#dce3f2;border:1px solid #313b4f;border-radius:9px;
    padding:8px 14px;font:inherit;font-size:12px;font-weight:520;cursor:pointer;
    transition:background .15s,border-color .15s,transform .05s}
  button:hover{background:#2b3446;border-color:#40506e}
  button:active{transform:translateY(1px)}
  button.primary{background:linear-gradient(135deg,#5b7cfa,#8065ff);border-color:transparent;
    color:#fff;box-shadow:0 8px 22px rgba(91,124,250,.28)}
  button.primary:hover{filter:brightness(1.08)}
  .toast{margin-top:12px;color:#9db4ff;font-size:12px;min-height:18px}
  pre{background:#0a0d13;border:1px solid #252d3d;border-left:3px solid #5b7cfa;
    border-radius:10px;padding:12px 14px;margin:10px 0;
    font:11.5px/1.55 ui-monospace,"JetBrains Mono","Cascadia Code",monospace;color:#c9d3e6;
    white-space:pre-wrap;word-break:break-word;box-shadow:0 6px 20px rgba(0,0,0,.25)}
  a{color:#85a8ff;text-decoration:none}
  a:hover{text-decoration:underline}
  ::selection{background:rgba(91,124,250,.38);color:#fff}
  *{scrollbar-width:thin;scrollbar-color:#3b4356 transparent}
  *::-webkit-scrollbar{width:9px;height:9px}
  *::-webkit-scrollbar-thumb{background:#3b4356;border-radius:999px;border:2px solid transparent;background-clip:padding-box}
  *::-webkit-scrollbar-track{background:transparent}
  ::-webkit-scrollbar-thumb:hover{background:#4a5570}
`;

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
  <div class="row"><div><div class="label">工作区闲置回收（分钟）</div><div class="hint">窗口失焦超过该时长自动关闭并释放内存</div></div><input type="number" id="workspaceIdleMinutes" min="1" max="240" step="1"></div>
  <div class="row"><div><div class="label">显示状态胶囊</div><div class="hint">右下角显示模式/端口与快捷操作</div></div><input type="checkbox" id="showStatusPill"></div>
  <div class="row"><div><div class="label">界面风格</div><div class="hint">增强聊天文字、代码/命令行块的对比度与配色</div></div><select id="uiTheme"><option value="modern">现代</option><option value="contrast">高对比</option><option value="soft">柔和</option><option value="off">关闭</option></select></div>
  <div class="row"><div><div class="label">界面缩放</div></div><select id="uiZoom"><option value="0.9">90%</option><option value="1">100%</option><option value="1.1">110%</option><option value="1.25">125%</option></select></div>
  <div class="row"><div><div class="label">全部完成后收起任务面板</div><div class="hint">启发式：仅隐藏明确显示“全部完成”的任务/待办面板</div></div><input type="checkbox" id="autoCollapseCompletedTasks"></div>
  <div class="row"><div><div class="label">自动隐藏运行中状态条</div><div class="hint">空闲时隐藏 dsh 前端残留的「任务运行中」条</div></div><input type="checkbox" id="autoHideStaleRunning"></div>
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
  $('workspaceIdleMinutes').value = String(state.config.workspaceIdleMinutes || 10)
  $('autoHideStaleRunning').checked = state.config.autoHideStaleRunning !== false
  $('autoCollapseCompletedTasks').checked = state.config.autoCollapseCompletedTasks !== false
  $('showStatusPill').checked = state.config.showStatusPill !== false
  $('uiZoom').value = String(state.config.uiZoom || 1)
  $('uiTheme').value = state.config.uiTheme || 'modern'
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
      workspaceIdleMinutes: Number($('workspaceIdleMinutes').value),
      autoHideStaleRunning: $('autoHideStaleRunning').checked,
      autoCollapseCompletedTasks: $('autoCollapseCompletedTasks').checked,
      showStatusPill: $('showStatusPill').checked,
      uiZoom: Number($('uiZoom').value),
      uiTheme: $('uiTheme').value,
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
    <button id="reload-ui">重新加载界面</button>
    <button id="stability-summary">稳定性汇总</button>
    <button id="migration-wizard">迁移向导</button>
    <button id="check-github-release">从 GitHub 检查更新</button>
    <button id="github-status">GitHub 状态</button>
    <button id="dsh-command">管理 dsh 命令</button>
    <button id="ui-report">导出界面状态</button>
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
for (const [id, action] of [['check-dsh','check-dsh-update'],['check-shell','check-shell-update'],['restart','restart-service'],['open-logs','open-logs'],['export-diag','export-diagnostics'],['export-sessions','export-sessions'],['export-markdown','export-markdown'],['rollback-shell','rollback-shell'],['rollback-dsh','rollback-dsh'],['systemd-enable','systemd-enable'],['systemd-disable','systemd-disable'],['fix-owner','fix-owner'],['close-workspaces','close-workspaces'],['stability-report','stability-report'],['reload-ui','reload-ui'],['stability-summary','stability-summary'],['migration-wizard','migration-wizard'],['check-github-release','check-github-release'],['github-status','github-status'],['dsh-command','dsh-command'],['ui-report','ui-report'],['switch-dev-service','switch-dev-service'],['switch-test-service','switch-test-service'],['root-service-start','root-service-start'],['root-service-stop','root-service-stop'],['clear-cache','clear-cache']]) {
  $(id).addEventListener('click', async () => {
    try { const res = await window.dshUtility.invoke('diagnostics:action', { action }); toast(res.message || '完成') }
    catch (err) { toast('操作失败：' + err.message) }
  })
}
refresh().catch((err) => toast('加载失败：' + err.message))
</script></body></html>`
}

module.exports = { createUtilityWindow, settingsHtml, diagnosticsHtml, clipboard }
