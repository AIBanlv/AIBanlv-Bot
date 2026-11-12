import test from 'node:test'
import assert from 'node:assert/strict'
import { ToolBroker, AssistantService } from '../electron/device-assistant-service.mjs'
import { mkdir, mkdtemp, readdir, rm, writeFile, readFile } from 'node:fs/promises'
import path from 'node:path'
test('Harness broker send-file preserves the originating phone and original task rather than a model-supplied path', async () => {
  const service = new AssistantService({ settings: {}, root: 'fixture' })
  const calls = []
  service.active = { task: 'model paraphrase', originalTask: '把报价.pdf发到手机', targetSession: 'origin-phone' }
  service.files = { send: async (target, options) => { calls.push({ target, options }); return { status: 'received' } } }
  const signal = new AbortController().signal
  await service.execute({ name: 'send_file', target: 'request' }, signal)
  assert.equal(calls[0].options.request, '把报价.pdf发到手机')
  assert.equal(calls[0].options.targetSession, 'origin-phone')
})

test('desktop startup enables automatic Harness authorization without removing target validation', async t => {
  await mkdir('artifacts', { recursive: true })
  const folder = await mkdtemp(path.resolve('artifacts/assistant-automatic-'))
  t.after(() => rm(folder, { recursive: true, force: true }))
  const file = path.join(folder, 'requested.txt')
  await writeFile(file, 'requested fixture text')
  const opened = [], launched = [], statuses = []
  let prompts = 0
  const service = new AssistantService({ settings: {}, root: path.join(folder, 'private'), approvalMode: 'automatic',
    approve: async () => { prompts++; return false }, onStatus: value => statuses.push(value),
    openExternal: async value => opened.push(value), resolveHost: async () => [{ address: '93.184.215.14' }],
    listApps: async () => [{ name: '夹具浏览器', id: 'C:\\Fixture\\browser.exe' }],
    launchApp: async app => launched.push(app) })
  const signal = new AbortController().signal
  for (let i = 0; i < 2; i++) {
    assert.equal((await service.execute({ name: 'open_app', target: '夹具浏览器' }, signal)).status, 'launch_requested')
    assert.equal((await service.execute({ name: 'open_url', target: 'https://example.com' }, signal)).opened, true)
  }
  assert.equal((await service.execute({ name: 'read_text', target: file }, signal)).text, 'requested fixture text')
  assert.equal(prompts, 0)
  assert.equal(launched.length, 2); assert.equal(opened.length, 2)
  assert.equal(statuses.some(value => value.state === 'approval'), false)
  await assert.rejects(service.execute({ name: 'open_url', target: 'http://localhost' }, signal), /TARGET_DENIED/)
  await assert.rejects(service.execute({ name: 'open_app', target: 'C:\\Fixture\\browser.exe' }, signal), /INVALID_ACTION/)
  await assert.rejects(service.execute({ name: 'shell', target: 'echo unsafe' }, signal), /INVALID_ACTION/)
  const abort = new AbortController(); abort.abort()
  await assert.rejects(service.execute({ name: 'open_app', target: '夹具浏览器' }, abort.signal), /abort/i)
  await assert.rejects(service.confirm({ name: 'open_app' }, abort.signal), /abort/i)
  const main = await readFile(new URL('../electron/device-main.mjs', import.meta.url), 'utf8')
  assert.match(main, /approvalMode: 'automatic'/)
  assert.doesNotMatch(main, /允许电脑助手操作|showMoveApproval/)
})

test('explicit prompt mode remains denyable for other service consumers', async () => {
  let count = 0
  const service = new AssistantService({ settings: {}, root: 'fixture', approvalMode: 'prompt',
    approve: async () => { count++; return false } })
  assert.equal(await service.confirm({ name: 'open_app' }, new AbortController().signal), false)
  assert.equal(count, 1)
})

test('broker authenticates, binds an active session, deduplicates and blocks late operations', async t => {
  const executed = []
  const broker = new ToolBroker({ execute: async (action, signal) => {
    signal.throwIfAborted(); executed.push(action); return { opened: true }
  } })
  await broker.start()
  t.after(() => broker.close())
  const body = { sessionId: 'session-1', callId: 'call-1', action: { name: 'open_url', target: 'https://example.com' } }
  const send = (value = body, token = broker.token, headers = {}) => fetch(broker.endpoint, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(value),
  })
  assert.equal((await send(body, 'wrong')).status, 403)
  assert.equal((await send()).status, 409)
  const abort = new AbortController()
  broker.begin('session-1', abort.signal)
  assert.equal((await send({ ...body, sessionId: 'other' })).status, 409)
  assert.equal((await send(body, broker.token, { Origin: 'https://example.com' })).status, 403)
  // Stdio notification and loopback HTTP can arrive in either order.
  setTimeout(() => broker.permit('session-1', 'call-1', body.action), 20)
  const results = await Promise.all([send(), send()])
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409])
  assert.equal(executed.length, 1)
  assert.equal((await send({ ...body, callId: 'huge', extra: true })).status, 400)
  abort.abort()
  assert.equal((await send({ ...body, callId: 'late' })).status, 409)
  assert.equal(executed.length, 1)
})

test('cancel while approval is pending suppresses execution and returns a safe error', async t => {
  let resolveApproval, entered
  const waiting = new Promise(resolve => { entered = resolve })
  let executed = false
  const broker = new ToolBroker({ execute: async (_action, signal) => {
    entered(); await new Promise(resolve => { resolveApproval = resolve })
    signal.throwIfAborted(); executed = true; return { opened: true }
  } })
  await broker.start(); t.after(() => broker.close())
  const abort = new AbortController(); broker.begin('session', abort.signal)
  broker.permit('session', 'one', { name: 'open_url', target: 'https://example.com' })
  const pending = fetch(broker.endpoint, { method: 'POST', headers: {
    Authorization: `Bearer ${broker.token}`, 'Content-Type': 'application/json',
  }, body: JSON.stringify({ sessionId: 'session', callId: 'one', action: { name: 'open_url', target: 'https://example.com' } }) })
  await waiting; abort.abort(); resolveApproval()
  assert.equal((await pending).status, 409)
  assert.equal(executed, false)
})

test('a disconnected caller cannot execute when its ACP permit arrives later', async t => {
  let executed = false
  const broker = new ToolBroker({ execute: async () => { executed = true; return {} } })
  await broker.start(); t.after(() => broker.close())
  broker.begin('s', new AbortController().signal)
  const controller = new AbortController()
  const action = { name: 'open_url', target: 'https://example.com' }
  const pending = fetch(broker.endpoint, { method: 'POST', signal: controller.signal,
    headers: { Authorization: `Bearer ${broker.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: 's', callId: 'c', action }) })
  const rejected = assert.rejects(pending, /abort/i)
  while (!broker.active.waiting.has('c')) await new Promise(resolve => setTimeout(resolve, 5))
  controller.abort(); await rejected
  await new Promise(resolve => setTimeout(resolve, 20))
  broker.permit('s', 'c', action)
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(executed, false)
})

test('reset during launch preparation prevents spawn and cleans all private resources', async t => {
  await mkdir('artifacts', { recursive: true })
  const root = await mkdtemp(path.resolve('artifacts/assistant-launch-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  let finish, entered
  const ready = new Promise(resolve => { entered = resolve })
  const service = new AssistantService({ root, settings: { snapshot: () => ({ enabled: true }), key: () => 'fixture' },
    launchFactory: async () => { entered(); return new Promise(resolve => { finish = resolve }) } })
  const running = service.run('test')
  const rejected = assert.rejects(running, /ASSISTANT_CANCELLED/)
  await ready
  const resetting = service.reset()
  finish({ command: 'must-never-spawn', args: [] })
  await rejected; await resetting
  assert.equal(service.process, null)
  assert.equal(service.broker, null)
  assert.deepEqual(await readdir(root), [])
})

test('broker close waits for a cancelled OS action to settle before releasing the session', async () => {
  let entered, finish
  const ready = new Promise(resolve => { entered = resolve })
  const broker = new ToolBroker({ execute: async (_action, signal) => {
    entered()
    await new Promise(resolve => { finish = resolve })
    signal.throwIfAborted()
    return { moved: 1 }
  } })
  await broker.start()
  const action = { name: 'organize_desktop', target: 'a'.repeat(32) }
  broker.begin('session', new AbortController().signal)
  broker.permit('session', 'one', action)
  const request = fetch(broker.endpoint, { method: 'POST', headers: {
    Authorization: `Bearer ${broker.token}`, 'Content-Type': 'application/json',
  }, body: JSON.stringify({ sessionId: 'session', callId: 'one', action }) }).catch(() => {})
  try {
    await ready
    let closed = false
    const closing = broker.close().then(() => { closed = true })
    await new Promise(resolve => setTimeout(resolve, 20))
    assert.equal(closed, false, 'in-flight operations must settle before a new service session')
    finish()
    await closing
  } finally { finish?.(); await request; await broker.close() }
})

test('cancelled desktop tasks report reconciled effects after native work settles', async () => {
  const statuses = []
  const abort = new AbortController()
  const service = new AssistantService({ settings: {}, root: 'unused-fixture',
    desktop: 'unused-fixture-desktop', onStatus: value => statuses.push(value) })
  service.process = { closed: false, sessionId: 'fixture', start: async () => {},
    run: async () => { abort.abort(); throw new Error('cancel') }, close: async () => {} }
  service.broker = { begin() {}, end() {}, close: async () => {}, inFlight: new Set([
    new Promise(resolve => setTimeout(() => {
      service.organizer.lastOutcome = { batchId: 'a'.repeat(32), moved: 1, operation: 'organize', status: 'partial' }
      resolve()
    }, 20)),
  ]) }
  await assert.rejects(service.perform('fixture', {}, abort.signal, Promise.resolve()), /ASSISTANT_CANCELLED/)
  assert.match(statuses.at(-1).message, /1.*恢复上次桌面整理/)
  assert.equal(statuses.at(-1).outcome.moved, 1)
})

test('mail tools dispatch through the authenticated service and unavailable accounts fail visibly', async t => {
  const calls = []
  const service = new AssistantService({ root: 'fixture-only', settings: {}, mail: {
    list: async target => { calls.push(['list', target]); return { status: 'listed' } },
    read: async target => { calls.push(['read', target]); return { status: 'read' } },
  } })
  const signal = new AbortController().signal
  assert.equal((await service.execute({ name: 'mail_list', target: 'today' }, signal)).status, 'listed')
  assert.equal((await service.execute({ name: 'mail_read', target: 'mail:fixture-token' }, signal)).status, 'read')
  assert.deepEqual(calls, [['list', 'today'], ['read', 'mail:fixture-token']])
  service.mail = null
  await assert.rejects(service.execute({ name: 'mail_list', target: 'today' }, signal), /MAIL_DISABLED/)
})

test('the connection test names the real reason instead of one blanket sentence', async () => {
  const build = (settings, run) => {
    const service = new AssistantService({ settings, root: 'fixture-only' })
    service.run = run
    return service
  }
  const disabled = build({ snapshot: () => ({ enabled: false }), key: () => 'k' }, async () => 'x')
  assert.match((await disabled.verify()).message, /尚未开启/)

  const missing = build({ snapshot: () => ({ enabled: true }), key: () => '' }, async () => 'x')
  assert.match((await missing.verify()).message, /请先填写 DeepSeek API Key/)

  const ok = build({ snapshot: () => ({ enabled: true }), key: () => 'k' }, async () => '连通')
  assert.deepEqual(await ok.verify(), { ok: true, message: '连接正常，Harness 已应答：连通' })

  for (const [code, pattern] of [['KEY_REJECTED', /Key/], ['PROVIDER_UNREACHABLE', /网络|代理/],
    ['PROVIDER_QUOTA', /余额/], ['PROVIDER_MODEL', /模型/], ['HARNESS_UNAVAILABLE', /重启程序/]]) {
    const failing = build({ snapshot: () => ({ enabled: true }), key: () => 'k' },
      async () => { throw Object.assign(new Error(code), { code }) })
    const result = await failing.verify()
    assert.equal(result.ok, false)
    assert.match(result.message, pattern, code)
    assert.doesNotMatch(result.message, /未能完成任务/)
  }
})
