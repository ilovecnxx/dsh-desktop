'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { pickTitleFromLines, cleanTitle } = require('../main/sessions')

test('pickTitleFromLines prefers latest session/title, falls back to first user text', () => {
  const lines = [
    JSON.stringify({ type: 'session', id: 's1' }),
    JSON.stringify({ type: 'agent/inbox/spliced', data: { inserted: [{ role: 'user', content: [{ type: 'text', text: '帮我做一个桌面客户端' }] }] } }),
    JSON.stringify({ type: 'session/title', data: { title: '桌面客户端开发' } }),
  ].join('\n')
  assert.equal(pickTitleFromLines(lines), '桌面客户端开发')
  const noTitle = JSON.stringify({ type: 'agent/inbox/spliced', data: { inserted: [{ role: 'user', content: [{ type: 'text', text: '你好' }] }] } })
  assert.equal(pickTitleFromLines(noTitle), '你好')
  assert.equal(pickTitleFromLines(''), '')
  assert.equal(pickTitleFromLines('not-json\n'), '')
})

test('cleanTitle collapses whitespace and truncates', () => {
  assert.equal(cleanTitle('  a\n b  '), 'a b')
  const long = 'x'.repeat(60)
  assert.equal(cleanTitle(long), 'x'.repeat(33) + '…')
  assert.equal(cleanTitle(''), '')
})
