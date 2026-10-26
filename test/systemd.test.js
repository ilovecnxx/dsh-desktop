'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const {
  buildUnit,
  parseTokenFromLog,
  unitPath,
  UNIT_NAME,
} = require('../main/systemd-service')

test('buildUnit renders a usable user unit', () => {
  const unit = buildUnit({
    dshHome: '/home/user/.dsh',
    port: 3080,
    workspace: '/home/user',
    logFile: '/home/user/.config/dsh-desktop/systemd-server.log',
  })
  assert.ok(unit.includes('WorkingDirectory=/home/user'))
  assert.ok(unit.includes('Environment=DSH_HOME=/home/user/.dsh'))
  assert.ok(unit.includes('dsh web --no-open --port 3080'))
  assert.ok(unit.includes('StandardOutput=append:/home/user/.config/dsh-desktop/systemd-server.log'))
  assert.ok(unit.includes('Restart=on-failure'))
  assert.ok(unit.includes('WantedBy=default.target'))
})

test('unitPath points at the user unit directory', () => {
  assert.equal(path.basename(unitPath()), UNIT_NAME)
  assert.ok(unitPath().includes(path.join('.config', 'systemd', 'user')))
})

test('parseTokenFromLog picks the latest token for the requested port', () => {
  const log = [
    'noise http://127.0.0.1:3080/?token=OLD',
    'noise http://127.0.0.1:3099/?token=OTHER',
    'noise http://127.0.0.1:3080/?token=NEWTOKEN_123',
  ].join('\n')
  assert.equal(parseTokenFromLog(log, 3080), 'http://127.0.0.1:3080/?token=NEWTOKEN_123')
  assert.equal(parseTokenFromLog(log, 3099), 'http://127.0.0.1:3099/?token=OTHER')
  assert.equal(parseTokenFromLog(log, 3100), null)
  assert.equal(parseTokenFromLog('', 3080), null)
})
