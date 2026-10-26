'use strict'

/**
 * 持久化配置：更新通道、自动检查、窗口位置等。
 * 默认配置目录可通过 DSH_DESKTOP_USER_DATA 覆盖（测试用）。
 */
const fs = require('node:fs')
const path = require('node:path')

const DEFAULT_CONFIG = {
  channel: 'next', // 'next' | 'latest'
  autoCheck: true,
  // npm registry 镜像（国内可改为 https://registry.npmmirror.com/）
  registry: 'https://registry.npmjs.org/',
  checkIntervalMs: 6 * 60 * 60 * 1000,
  closeToTray: true,
  // 关闭窗口行为：tray 收进托盘 / quit 退出客户端保留服务 / quit-all 彻底退出
  closeAction: 'tray',
  windowBounds: null,
  dismissedVersion: null,
  lastCheckAt: null,
  // 服务健康监控
  autoRestartService: true,
  // 进程退出立即恢复；无响应连续两次检查失败后再恢复，避免瞬时拥塞误判。
  healthIntervalMs: 60000,
  // 客户端壳自更新
  shellAutoCheck: true,
  lastShellCheckAt: null,
  // 全局快捷键
  // Wayland 下全局快捷键依赖 XWayland，容易产生认证错误和额外开销。
  globalShortcutEnabled: false,
  globalShortcut: 'CommandOrControl+Alt+Space',
  // 服务端口（被其他程序占用时会自动尝试后续端口）
  port: 3080,
  // 默认使用原生 Wayland；需要全局快捷键时再手动开启 XWayland。
  useX11: false,
  // GPU 进程反复崩溃后自动切换软件渲染（启动器会追加 --disable-gpu）
  softwareRendering: false,
  // 界面动效：normal 正常 / blur 窗口失焦时暂停 / always 始终暂停
  // dsh Web UI 的运行态动画在部分 Wayland/GPU 环境下 CPU 开销很大，失焦时暂停可显著省电
  motionMode: 'auto',
  // 系统通知：会话跑完 / 需要确认（窗口未聚焦时）
  notifyOnFinish: true,
  notifyOnApproval: true,
  // 自动模式下，窗口聚焦但空闲超过该时长也暂停循环动画
  motionIdleMs: 90 * 1000,
}

class Config {
  constructor(dir) {
    this.dir = dir
    this.file = path.join(dir, 'config.json')
    this.data = { ...DEFAULT_CONFIG }
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'))
      this.data = { ...this.data, ...raw }
    } catch {
      // 首次运行，使用默认值
    }
  }

  get(key) {
    return this.data[key]
  }

  set(key, value) {
    if (JSON.stringify(this.data[key]) === JSON.stringify(value)) return
    this.data[key] = value
    clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => this.save(), 200)
  }

  save() {
    clearTimeout(this.saveTimer)
    this.saveTimer = null
    try {
      fs.mkdirSync(this.dir, { recursive: true })
      const temp = `${this.file}.${process.pid}.tmp`
      fs.writeFileSync(temp, JSON.stringify(this.data, null, 2) + '\n', { mode: 0o600 })
      fs.renameSync(temp, this.file)
    } catch (err) {
      console.error('[config] 保存失败:', err)
    }
  }
}

module.exports = { Config, DEFAULT_CONFIG }
