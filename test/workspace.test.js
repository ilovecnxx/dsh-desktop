'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { getFreePort, startWorkspaceService } = require('../main/workspace-service')

test('getFreePort returns a usable port number', async () => {
  const port = await getFreePort()
  assert.equal(typeof port, 'number')
  assert.ok(port > 0 && port < 65536)
})

test('startWorkspaceService rejects non-directory path', async () => {
  await assert.rejects(() => startWorkspaceService('/definitely/not/here', {}), /不存在|不是文件夹/)
})
