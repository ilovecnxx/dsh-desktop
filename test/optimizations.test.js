'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const {
  rotateIfNeeded,
  shouldFallbackToSoftwareRendering,
  resolveCloseAction,
  serviceRestartDelay,
  resolveMotionMode,
  shouldPauseMotion,
  sessionNotifyDecision,
} = require('../main/runtime-utils')
const shellUpdater = require('../main/shell-updater')

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-opt-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}

test('rotateIfNeeded keeps small logs and rotates oversized ones once', (t) => {
  const dir = tempDir(t)
  const file = path.join(dir, 'main.log')
  fs.writeFileSync(file, 'small\n')
  assert.equal(rotateIfNeeded(file, 1024), false)
  assert.equal(fs.readFileSync(file, 'utf8'), 'small\n')

  fs.writeFileSync(file, 'x'.repeat(2048))
  assert.equal(rotateIfNeeded(file, 1024), true)
  assert.equal(fs.existsSync(file), false)
  assert.equal(fs.readFileSync(`${file}.1`, 'utf8').length, 2048)

  // 第一次轮转产生的 .1 会被新的轮转覆盖，不会无限堆积
  fs.writeFileSync(file, 'y'.repeat(2048))
  assert.equal(rotateIfNeeded(file, 1024), true)
  assert.equal(fs.readFileSync(`${file}.1`, 'utf8').startsWith('y'), true)
})

test('shouldFallbackToSoftwareRendering only counts crashes inside the window', () => {
  const now = 10 * 60 * 1000 + 5
  assert.equal(shouldFallbackToSoftwareRendering([], now), false)
  assert.equal(shouldFallbackToSoftwareRendering([now - 100], now), false)
  assert.equal(shouldFallbackToSoftwareRendering([now - 100, now - 50], now), true)
  // 窗口外的不计入
  assert.equal(shouldFallbackToSoftwareRendering([now - 20 * 60 * 1000, now - 100], now), false)
  // 非数字忽略
  assert.equal(shouldFallbackToSoftwareRendering([null, NaN, now], now), false)
})

test('shell updater checks versions and applies atomically with rollback', (t) => {
  const dir = tempDir(t)
  const appRoot = path.join(dir, 'install')
  const source = path.join(dir, 'source')
  const installedApp = path.join(appRoot, 'resources', 'app')
  fs.mkdirSync(path.join(installedApp, 'main'), { recursive: true })
  fs.writeFileSync(
    path.join(installedApp, 'package.json'),
    JSON.stringify({ name: 'dsh-desktop', version: '1.0.0' }),
  )
  fs.writeFileSync(path.join(installedApp, 'main', 'main.js'), '// old\n')

  fs.mkdirSync(path.join(source, 'main'), { recursive: true })
  fs.writeFileSync(
    path.join(source, 'package.json'),
    JSON.stringify({ name: 'dsh-desktop', version: '1.1.0' }),
  )
  fs.writeFileSync(path.join(source, 'main', 'main.js'), '// new\n')

  const oldEnv = {
    DSH_DESKTOP_APP_ROOT: process.env.DSH_DESKTOP_APP_ROOT,
    DSH_DESKTOP_SHELL_SOURCE: process.env.DSH_DESKTOP_SHELL_SOURCE,
  }
  process.env.DSH_DESKTOP_APP_ROOT = appRoot
  process.env.DSH_DESKTOP_SHELL_SOURCE = source
  t.after(() => {
    if (oldEnv.DSH_DESKTOP_APP_ROOT === undefined) delete process.env.DSH_DESKTOP_APP_ROOT
    else process.env.DSH_DESKTOP_APP_ROOT = oldEnv.DSH_DESKTOP_APP_ROOT
    if (oldEnv.DSH_DESKTOP_SHELL_SOURCE === undefined) delete process.env.DSH_DESKTOP_SHELL_SOURCE
    else process.env.DSH_DESKTOP_SHELL_SOURCE = oldEnv.DSH_DESKTOP_SHELL_SOURCE
  })

  assert.equal(shellUpdater.installedVersion(), '1.0.0')
  const check = shellUpdater.checkForShellUpdate()
  assert.equal(check.available, true)
  assert.equal(check.latest, '1.1.0')

  const applied = shellUpdater.applyShellUpdate()
  assert.equal(applied.version, '1.1.0')
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(installedApp, 'package.json'), 'utf8')).version,
    '1.1.0',
  )
  assert.equal(fs.readFileSync(path.join(installedApp, 'main', 'main.js'), 'utf8'), '// new\n')
  assert.equal(
    JSON.parse(
      fs.readFileSync(path.join(appRoot, 'resources', 'app.backup', 'package.json'), 'utf8'),
    ).version,
    '1.0.0',
  )
  assert.equal(shellUpdater.checkForShellUpdate().available, false)

  // 回滚恢复旧版本
  assert.equal(shellUpdater.rollbackShellUpdate(), true)
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(installedApp, 'package.json'), 'utf8')).version,
    '1.0.0',
  )
  assert.equal(fs.readFileSync(path.join(installedApp, 'main', 'main.js'), 'utf8'), '// old\n')
})

test('resolveCloseAction validates values and migrates legacy closeToTray', () => {
  assert.equal(resolveCloseAction('tray', true), 'tray')
  assert.equal(resolveCloseAction('quit', true), 'quit')
  assert.equal(resolveCloseAction('quit-all', true), 'quit-all')
  // 非法值回退到旧配置
  assert.equal(resolveCloseAction('bogus', true), 'tray')
  assert.equal(resolveCloseAction(undefined, false), 'quit')
  assert.equal(resolveCloseAction(null, undefined), 'tray')
})

test('serviceRestartDelay backoff grows after repeated exits and caps', () => {
  const now = 1_000_000
  assert.equal(serviceRestartDelay([], now), 1500)
  assert.equal(serviceRestartDelay([now - 1000, now - 500], now), 1500)
  // 窗口内达到 3 次开始退避
  assert.equal(serviceRestartDelay([now - 3000, now - 2000, now - 1000], now), 1500)
  assert.equal(serviceRestartDelay([now - 3000, now - 2000, now - 1000, now - 500], now), 3000)
  assert.equal(
    serviceRestartDelay([now - 3000, now - 2000, now - 1000, now - 500, now - 400, now - 300], now),
    12000,
  )
  // 窗口外的旧退出不计入
  assert.equal(serviceRestartDelay([now - 10 * 60 * 1000, now - 1000], now), 1500)
  // 封顶
  const many = Array.from({ length: 20 }, (_, i) => now - i * 100)
  assert.equal(serviceRestartDelay(many, now), 60000)
})

test('motion mode validates and pauses based on focus', () => {
  assert.equal(resolveMotionMode('blur'), 'blur')
  assert.equal(resolveMotionMode('always'), 'always')
  assert.equal(resolveMotionMode('normal'), 'normal')
  assert.equal(resolveMotionMode('bogus'), 'auto')
  assert.equal(shouldPauseMotion('normal', true), false)
  assert.equal(shouldPauseMotion('normal', false), false)
  assert.equal(shouldPauseMotion('blur', true), false)
  assert.equal(shouldPauseMotion('blur', false), true)
  assert.equal(shouldPauseMotion('always', true), true)
  assert.equal(shouldPauseMotion(undefined, false), true)
  // auto：失焦或空闲超时暂停
  assert.equal(shouldPauseMotion('auto', true, 0), false)
  assert.equal(shouldPauseMotion('auto', true, 120 * 1000), true)
  assert.equal(shouldPauseMotion('auto', false, 0), true)
  assert.equal(resolveMotionMode(undefined), 'auto')
})

test('sessionNotifyDecision notifies finish/approval only when unfocused', () => {
  const base = { running: false, dialogs: 0 }
  // 运行 -> 空闲，未聚焦：完成通知
  assert.equal(sessionNotifyDecision({ running: true, dialogs: 0 }, base, false), 'finish')
  // 聚焦时不打扰
  assert.equal(sessionNotifyDecision({ running: true, dialogs: 0 }, base, true), null)
  // 空闲期间不重复通知
  assert.equal(sessionNotifyDecision(base, base, false), null)
  // 新弹窗且未聚焦：确认通知
  assert.equal(sessionNotifyDecision(base, { running: true, dialogs: 1 }, false), 'approval')
  // 弹窗未变化不重复
  assert.equal(sessionNotifyDecision({ running: true, dialogs: 1 }, { running: true, dialogs: 1 }, false), null)
  // 可关闭
  assert.equal(sessionNotifyDecision({ running: true, dialogs: 0 }, base, false, { finishEnabled: false }), null)
  assert.equal(sessionNotifyDecision(base, { running: true, dialogs: 1 }, false, { approvalEnabled: false }), null)
})
