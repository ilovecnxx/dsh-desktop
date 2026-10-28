'use strict'

/**
 * 工具窗口（设置/诊断）的预加载脚本：
 * 只暴露白名单 IPC，渲染进程不能直接访问 Node。
 */
const { contextBridge, ipcRenderer } = require('electron')

const ALLOWED = new Set([
  'settings:get',
  'settings:set',
  'settings:action',
  'diagnostics:get',
  'diagnostics:action',
  'providers:get',
  'providers:save',
  'providers:delete',
  'providers:test',
  'providers:restart-service',
  'providers:open-credentials',
])

contextBridge.exposeInMainWorld('dshUtility', {
  invoke: (channel, payload) => {
    if (!ALLOWED.has(channel)) {
      return Promise.reject(new Error(`禁止的 IPC 通道: ${channel}`))
    }
    return ipcRenderer.invoke(channel, payload)
  },
})
