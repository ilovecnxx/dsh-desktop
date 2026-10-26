'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const {
  rotateIfNeeded,
  shouldFallbackToSoftwareRendering,
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
