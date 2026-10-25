'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const http = require('node:http')
const { ServerManager, validToken, probe } = require('../main/server')
const { Config } = require('../main/config')
const { readTail, redact } = require('../main/runtime-utils')

async function setup(t, mode = 'serve') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-unit-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const socket = http.createServer()
  await new Promise((r) => socket.listen(0, '127.0.0.1', r))
  const port = socket.address().port
  await new Promise((r) => socket.close(r))
  const bin = path.join(dir, 'dsh')
  const code = mode === 'serve' ? `
const http=require('node:http'), fs=require('node:fs');
const port=Number(process.argv.at(-1));
fs.appendFileSync(${JSON.stringify(path.join(dir, 'starts'))}, 'start\\n');
const server=http.createServer((req,res)=>{
 if(req.url==='/?token=valid'){res.writeHead(303,{'location':'/','set-cookie':'dsh-auth-test=ok; HttpOnly'});}
 else {res.writeHead(401);}
 res.end();
});
server.on('error',err=>{console.error(err.code);process.exit(1)});
server.listen(port,'127.0.0.1',()=>console.log('http://127.0.0.1:'+port+'/?token=valid'));
` : mode === 'signal' ? "process.kill(process.pid,'SIGTERM')" : 'process.exit(7)'
  fs.writeFileSync(bin, '#!/usr/bin/env node\n' + code, { mode: 0o700 })
  const m = new ServerManager({ port, bin, dshHome: dir, logFile: path.join(dir, 'server.log'), startupTimeoutMs: 3000 })
  t.after(async () => { await m.stop({ includeExternal: true }); await new Promise((r) => setTimeout(r, 50)) })
  return { dir, m, bin, port }
}

test('concurrent starts share one child; HEAD liveness works with 401', async (t) => {
  const { m, dir } = await setup(t)
  const [a, b] = await Promise.all([m.start(), m.start()])
  assert.equal(a, b)
  assert.equal(fs.readFileSync(path.join(dir, 'starts'), 'utf8'), 'start\n')
  assert.equal(await probe(m.baseUrl), true)
  assert.equal(await validToken(a), true)
})

for (const mode of ['exit', 'signal']) {
  test(`startup ${mode} fails promptly rather than waiting for timeout`, async (t) => {
    const { m } = await setup(t, mode)
    const begin = performance.now()
    await assert.rejects(m.start(), /启动失败/)
    assert.ok(performance.now() - begin < 2000)
    assert.equal(m.child, null)
  })
}

test('spawn error rejects promptly and does not throw unhandled error', async (t) => {
  const { m, dir } = await setup(t)
  m.bin = path.join(dir, 'missing-executable')
  const begin = performance.now()
  await assert.rejects(m.start(), /ENOENT/)
  assert.ok(performance.now() - begin < 2000)
})

test('reuse verifies token from newest log then older log; stopping client preserves external service', async (t) => {
  const { m, dir, port } = await setup(t)
  const good = await m.start()
  fs.writeFileSync(path.join(dir, 'web.log'), `http://127.0.0.1:${port}/?token=stale\n`)
  const borrower = new ServerManager({ port, dshHome: dir, logFile: path.join(dir, 'web.log') })
  borrower.logFile = path.join(dir, 'server.log')
  const found = await borrower.detectExisting()
  assert.equal(found.url, good)
  assert.equal(await borrower.start(), good)
  assert.equal(borrower.child, null)
  await borrower.stop()
  assert.equal(await validToken(good), true)
  assert.equal(fs.readFileSync(path.join(dir, 'starts'), 'utf8'), 'start\n')
})

test('unrelated HTTP listener is not adopted or terminated', async (t) => {
  const { m, port } = await setup(t)
  const unrelated = http.createServer((req, res) => res.end('other app'))
  await new Promise((r) => unrelated.listen(port, '127.0.0.1', r))
  t.after(() => new Promise((r) => unrelated.close(r)))
  await assert.rejects(m.start(), /无法确认/)
  assert.equal(await probe(m.baseUrl), true)
})

test('configuration batches writes and flushes atomically', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-config-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const c = new Config(dir)
  let writes = 0
  const save = c.save.bind(c)
  c.save = () => { writes++; save() }
  c.set('port', 3100); c.set('useX11', true); c.set('autoCheck', false)
  assert.equal(writes, 0)
  await new Promise((r) => setTimeout(r, 300))
  assert.equal(writes, 1)
  assert.equal(JSON.parse(fs.readFileSync(c.file)).port, 3100)
  c.set('port', 3100)
  await new Promise((r) => setTimeout(r, 250))
  assert.equal(writes, 1)
  c.set('port', 3101); c.save()
  assert.equal(JSON.parse(fs.readFileSync(c.file)).port, 3101)
})

test('diagnostic tail is bounded and tokens are redacted', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-tail-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const log = path.join(dir, 'large.log')
  fs.writeFileSync(log, 'x'.repeat(1024 * 1024) + '\nhttp://127.0.0.1:3080/?token=secret\nlast\n')
  assert.ok(readTail(log, 400).length <= 65536)
  assert.equal(readTail(log, 2), 'last\n')
  assert.ok(!redact(readTail(log)).includes('token=secret'))
})
