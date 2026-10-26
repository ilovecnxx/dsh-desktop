'use strict'

/**
 * 应用菜单 + 托盘菜单。
 * ctx 由主进程提供，包含各菜单动作回调。
 */
const { Menu, app } = require('electron')

function channelSubmenu(ctx) {
  return ['next', 'latest'].map((channel) => ({
    label: channel === 'next' ? '预发布通道（next）' : '稳定通道（latest）',
    type: 'radio',
    checked: ctx.getChannel() === channel,
    click: () => ctx.setChannel(channel),
  }))
}

function updateLabel(ctx) {
  const pending = ctx.getPending()
  return pending ? `检查更新…（发现 v${pending.latest}）` : '检查更新…'
}

function recentSessionSubmenu(ctx) {
  const list = (ctx.getRecentSessions && ctx.getRecentSessions()) || []
  if (!list.length) return [{ label: '（暂无会话）', enabled: false }]
  return list.map((item) => ({
    label: item.title,
    click: () => ctx.openSession(item),
  }))
}

function serviceModeSubmenu(ctx) {
  const mode = (ctx.getServiceMode && ctx.getServiceMode()) || { port: 0 }
  const item = (port, label) => ({
    label,
    type: 'radio',
    checked: mode.port === port,
    click: () => ctx.switchService(port),
  })
  return [
    item(3080, '开发服务(3080, user)'),
    item(3081, 'root 测试(3081)'),
  ]
}

function recentWorkspacesSubmenu(ctx) {
  const list = (ctx.getRecentWorkspaces && ctx.getRecentWorkspaces()) || []
  if (!list.length) return [{ label: '（暂无）', enabled: false }]
  return list.map((folder) => ({
    label: String(folder).replace(/^\/home\/[^/]+/, '~'),
    click: () => ctx.openRecentWorkspace(folder),
  }))
}

function buildApplicationMenu(ctx) {
  const template = [
    {
      label: 'DeepSeek Harness',
      submenu: [
        { label: '关于 DeepSeek Harness', click: () => ctx.showAbout() },
        { label: '管理 dsh 命令…', click: () => ctx.dshCommand() },
        { label: '新建窗口', accelerator: 'CmdOrCtrl+Shift+N', click: () => ctx.newWindow() },
        { label: '最近会话', submenu: recentSessionSubmenu(ctx) },
    { label: '打开文件夹作为工作区…', click: () => ctx.openFolderWorkspace() },
    { label: '最近工作区', submenu: recentWorkspacesSubmenu(ctx) },
        { label: '打开文件夹作为工作区…', click: () => ctx.openFolderWorkspace() },
        { label: '最近工作区', submenu: recentWorkspacesSubmenu(ctx) },
        { label: '服务模式', submenu: serviceModeSubmenu(ctx) },
        { type: 'separator' },
        { label: updateLabel(ctx), accelerator: 'CmdOrCtrl+U', click: () => ctx.checkUpdate() },
        { label: '检查客户端更新…', click: () => ctx.checkShellUpdate() },
        { label: '更新通道', submenu: channelSubmenu(ctx) },
        { label: '从 GitHub 检查客户端更新…', click: () => ctx.checkGithubRelease() },
        { type: 'separator' },
        { label: '设置…', accelerator: 'CmdOrCtrl+,', click: () => ctx.openSettings() },
        { label: '重启客户端', click: () => ctx.restartApp() },
        { type: 'separator' },
        { label: '打开配置目录', click: () => ctx.openConfigDir() },
        { label: '打开客户端日志', click: () => ctx.openLogs() },
        { type: 'separator' },
        { label: '退出客户端（保留服务）', accelerator: 'CmdOrCtrl+Q', click: () => ctx.quit() },
        { label: '彻底退出（含网页服务）', click: () => ctx.quitAll() },
      ],
    },
    {
      label: '服务',
      submenu: [
        { label: '重启服务', click: () => ctx.restartServer() },
        {
          label: '服务异常时自动重启',
          type: 'checkbox',
          checked: ctx.isAutoRestart(),
          click: () => ctx.toggleAutoRestart(),
        },
        {
          label: '全局快捷键（显示/隐藏窗口）',
          type: 'checkbox',
          checked: ctx.isGlobalShortcut(),
          click: () => ctx.toggleGlobalShortcut(),
        },
        { label: '在浏览器中打开', click: () => ctx.openInBrowser() },
        { type: 'separator' },
        { label: '服务日志', click: () => ctx.openServerLog() },
        { label: '打开下载目录', click: () => ctx.openDownloads() },
      ],
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '重新加载' },
        { role: 'forceReload', label: '强制重新加载' },
        { role: 'toggleDevTools', label: '切换开发者工具' },
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' },
      ],
    },
    {
      label: '帮助',
      submenu: [
        {
          label: '官方文档',
          click: () => ctx.openExternal('https://deepseek-harness.github.io/deepseek-harness/'),
        },
        {
          label: '报告问题',
          click: () => ctx.openExternal('https://github.com/deepseek-ai/deepseek-harness/issues'),
        },
        { type: 'separator' },
        { label: '查看 dsh 更新说明', click: () => ctx.openExternal('https://github.com/deepseek-ai/deepseek-harness/releases') },
        { label: 'GitHub 状态…', click: () => ctx.githubStatus() },
        {
      label: '帮助',
      submenu: [
        { label: 'GitHub 状态…', click: () => ctx.githubStatus() },
        { label: '管理 dsh 命令…', click: () => ctx.dshCommand() },
        { label: '开发者工具 (F12)', click: () => ctx.toggleDevTools() },
        { type: 'separator' },
        { label: '诊断信息…', click: () => ctx.openDiagnostics() },
      ],
    },
        { label: '开发者工具 (F12)', click: () => ctx.toggleDevTools() },
      ],
    },
  ]
  return Menu.buildFromTemplate(template)
}

function buildTrayMenu(ctx) {
  const template = [
    { label: '打开主窗口', click: () => ctx.showWindow() },
    { label: '服务模式', submenu: serviceModeSubmenu(ctx) },
    { label: '新建窗口', click: () => ctx.newWindow() },
    { label: '最近会话', submenu: recentSessionSubmenu(ctx) },
    { label: `状态：${ctx.getServiceStatus()}`, enabled: false },
    { type: 'separator' },
    { label: updateLabel(ctx), click: () => ctx.checkUpdate() },
    { label: '检查客户端更新…', click: () => ctx.checkShellUpdate() },
    { label: '更新通道', submenu: channelSubmenu(ctx) },
    { label: '重启服务', click: () => ctx.restartServer() },
    {
      label: '服务异常时自动重启',
      type: 'checkbox',
      checked: ctx.isAutoRestart(),
      click: () => ctx.toggleAutoRestart(),
    },
    {
      label: '全局快捷键（显示/隐藏窗口）',
      type: 'checkbox',
      checked: ctx.isGlobalShortcut(),
      click: () => ctx.toggleGlobalShortcut(),
    },
    {
      label: '开机自启',
      type: 'checkbox',
      checked: ctx.isAutostart(),
      click: () => ctx.toggleAutostart(),
    },
    { type: 'separator' },
    { label: '设置…', click: () => ctx.openSettings() },
    { label: '诊断信息…', click: () => ctx.openDiagnostics() },
    { label: '打开客户端日志', click: () => ctx.openLogs() },
    { label: '退出客户端（保留服务）', click: () => ctx.quit() },
    { label: '彻底退出（含网页服务）', click: () => ctx.quitAll() },
  ]
  return Menu.buildFromTemplate(template)
}

module.exports = { buildApplicationMenu, buildTrayMenu }
