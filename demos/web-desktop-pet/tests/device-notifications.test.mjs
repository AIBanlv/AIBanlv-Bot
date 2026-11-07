import test from 'node:test'
import assert from 'node:assert/strict'
import { DeviceNotifications } from '../electron/device-notifications.mjs'
import { DeviceChannel } from '../electron/device-channel.mjs'

test('local task results cannot cross into online speech after queuing or late completion', async t => {
  let roleSource = 'local', busy = true
  const spoken = []
  const notices = new DeviceNotifications({ context: () => ({ bound: true, ready: true, owner: 'u', tenantId: 't', roleSource }),
    busy: () => busy, speak: async text => spoken.push(text) })
  t.after(() => notices.clear())
  notices.receive({ eventId: 'queued-local', roleSource: 'local', sentAt: Date.now(), content: '本地私人任务结果' })
  assert.equal(notices.queue.length, 1)
  roleSource = 'online'; busy = false; notices.drain()
  notices.receive({ eventId: 'late-local', roleSource: 'local', sentAt: Date.now(), content: '迟到的本地结果' })
  await Promise.resolve()
  assert.equal(notices.queue.length, 0)
  assert.deepEqual(spoken, [])
  roleSource = 'local'
  notices.receive({ eventId: 'server', source: 'server', sentAt: Date.now(), content: '线上通知不能消耗本地额度' })
  assert.deepEqual(spoken, [])
  notices.receive({ eventId: 'current-local', roleSource: 'local', sentAt: Date.now(), content: '当前本地结果' })
  assert.equal(spoken.length, 1)
})

test('a definite pre-start rejection retains the notice until speech becomes ready and reports arrival separately', async t => {
  let ready = false, calls = 0
  const arrived = [], states = []
  const n = new DeviceNotifications({ context: () => ({ bound: true, ready: true, owner: 'u', tenantId: 't' }), busy: () => false,
    speak: () => { calls++; return ready ? { ok: true } : { ok: false, code: 'SCORE_PENDING' } },
    onNotice: value => arrived.push(value), onStatus: value => states.push(value), retryMs: 100000 })
  t.after(() => n.clear())
  n.receive({ eventId: 'waiting', sentAt: Date.now(), content: '该喝水了' })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(n.queue.length, 1); assert.equal(arrived.length, 1)
  ready = true; n.drain(); await new Promise(resolve => setImmediate(resolve))
  assert.equal(calls, 2); assert.equal(n.queue.length, 0)
  assert.ok(states.some(value => value.code === 'SCORE_PENDING'))
})

test('clear during a pending speech start cannot requeue a notice into a later account', async () => {
  let resolve
  const n = new DeviceNotifications({ context: () => ({ bound: true, ready: true, owner: 'u', tenantId: 't' }), busy: () => false,
    speak: () => new Promise(done => { resolve = done }) })
  n.receive({ eventId: 'pending-start', sentAt: Date.now(), content: 'private' }); n.clear()
  resolve({ ok: false, code: 'SCORE_PENDING' }); await new Promise(done => setImmediate(done))
  assert.equal(n.queue.length, 0); assert.equal(n.timer, null)
})
test('an uncertain speech failure is visible but never replayed, including after clear during an async start', async t => {
  const statuses = []; let calls = 0, reject
  const n = new DeviceNotifications({ context: () => ({ bound: true, ready: true, owner: 'u', tenantId: 't' }), busy: () => false,
    speak: () => { calls++; return new Promise((_, fail) => { reject = fail }) }, onStatus: value => statuses.push(value) })
  t.after(() => n.clear())
  n.receive({ eventId: 'uncertain', sentAt: Date.now(), content: 'test' }); reject(new Error('uncertain transport'))
  await new Promise(resolve => setImmediate(resolve)); n.drain()
  assert.equal(calls, 1); assert.equal(n.queue.length, 0); assert.ok(statuses.some(value => value.state === 'failed'))
})

test('queued completion replaces stale progress and is not followed by an older progress report', async t => {
  let busy = true
  const spoken = []
  const notices = new DeviceNotifications({ context: () => ({ bound: true, ready: true, owner: 'u', tenantId: 't' }),
    busy: () => busy, speak: async value => spoken.push(value), retryMs: 10 })
  t.after(() => notices.clear())
  const send = (id, progress, content) => notices.receive({ eventId: id, sentAt: Date.now(), reportKey: 'codex:task', progress, content })
  send('start', true, '正在开始'); send('progress', true, '正在检查'); send('done', false, '任务已完成'); send('late-progress', true, '过期进度')
  assert.equal(notices.queue.length, 1)
  busy = false; notices.drain(); await Promise.resolve()
  assert.equal(spoken.length, 1); assert.match(spoken[0], /任务已完成/)
  assert.doesNotMatch(spoken[0], /过期进度/)
})

test('starting a new task turn drops queued old completion and late old reports',async t=>{
  let turn='old',busy=true;const spoken=[]
  const n=new DeviceNotifications({context:()=>({bound:true,ready:true,owner:'u',tenantId:'t'}),busy:()=>busy,
    speak:async text=>spoken.push(text),isCurrent:event=>!event.reportTurnId||event.reportTurnId===turn})
  t.after(()=>n.clear())
  const send=(id,reportTurnId,progress,content)=>n.receive({eventId:id,sentAt:Date.now(),reportKey:'codex:thread',reportTurnId,progress,content})
  send('old-finished','old',false,'旧任务已结束');turn='new'
  send('new-progress','new',true,'现在真实执行的新任务');send('late-old','old',false,'迟到的旧任务结果')
  busy=false;n.drain();await Promise.resolve()
  assert.equal(spoken.length,1);assert.match(spoken[0],/现在真实执行的新任务/);assert.doesNotMatch(spoken[0],/旧任务/)
})

test('mail opt-in revoked while waiting removes queued private content',async t=>{
  let permitted=true;const spoken=[]
  const n=new DeviceNotifications({context:()=>({bound:true,ready:true,owner:'u',tenantId:'t'}),busy:()=>true,
    speak:async text=>spoken.push(text),isCurrent:event=>!event.mailContentAccount||permitted})
  t.after(()=>n.clear());n.receive({eventId:'mail',mailContentAccount:'account',sentAt:Date.now(),content:'私人邮件正文'})
  permitted=false;n.drain();assert.equal(n.queue.length,0);assert.deepEqual(spoken,[])
})

test('account reminder is accepted for a different source role without switching the applied profile', () => {
  const channel = new DeviceChannel({ deviceId: 'zhanlv:desktop-fixture', qr: async () => '' })
  channel.receive({ type: 'bind_success', deviceId: channel.state.deviceId, tenantId: 'tenant', controllerUserId: 'user' })
  const received = [], profiles = []
  channel.on('notification', event => received.push(event))
  channel.on('profile', event => profiles.push(event))
  const event = { type: 'proactive_message', deviceId: channel.state.deviceId, tenantId: 'tenant',
    controllerUserId: 'user', useCurrentAgent: true, agentId: 'different-source-role',
    content: '下班了', eventId: 'event', sentAt: Date.now() }
  channel.receive({ ...event, controllerUserId: 'other' })
  channel.receive({ ...event, tenantId: 'other' })
  channel.receive({ ...event, useCurrentAgent: false })
  channel.receive(event)
  assert.equal(received.length, 1)
  assert.equal(profiles.length, 0)
  channel.receive({ type: 'unbind', deviceId: channel.state.deviceId })
  channel.receive(event)
  assert.equal(received.length, 1)
})

test('busy dialogue queues one reminder; when idle the current role speaks, not the source role', async () => {
  let busy = true, role = 'current-role'
  const calls = []
  const notifications = new DeviceNotifications({ context: () => ({ bound: true, ready: true, owner: 'u', tenantId: 't', role }),
    busy: () => busy, speak: (...args) => { calls.push({ role, args }); return { ok: true } } })
  const event = { eventId: 'one', content: '记得下班', agentId: 'source', sentAt: Date.now() }
  notifications.receive(event)
  notifications.receive(event)
  assert.equal(calls.length, 0)
  assert.equal(notifications.queue.length, 1)
  role = 'new-current-role'; busy = false
  notifications.drain()
  assert.equal(calls.length, 1)
  assert.equal(calls[0].role, 'new-current-role')
  assert.equal(calls[0].args[1].notificationEventId, 'one')
  assert.match(calls[0].args[0], /记得下班/)
  await Promise.resolve()
  notifications.clear()
})

test('expired notifications and old-account queued content never play', () => {
  let owner = 'old', calls = 0
  const n = new DeviceNotifications({ context: () => ({ bound: true, ready: true, owner, tenantId: 't' }),
    busy: () => true, speak: () => { calls++ } })
  n.receive({ eventId: 'expired', content: 'old', sentAt: Date.now() - 11 * 60000 })
  n.receive({ eventId: 'pending', content: 'private', sentAt: Date.now() })
  owner = 'new'
  n.drain()
  assert.equal(n.queue.length, 0)
  assert.equal(calls, 0)
  n.clear()
})

test('a reminder arriving before the avatar is ready waits instead of dropping the account notice', async () => {
  let ready = false
  const spoken = []
  const n = new DeviceNotifications({ context: () => ({ bound: true, ready, owner: 'u', tenantId: 't' }),
    busy: () => false, speak: (text, options) => { spoken.push(options); return { ok: true } }, retryMs: 2 })
  n.receive({ eventId: 'early', content: '该喝水了', sentAt: Date.now() })
  assert.equal(spoken.length, 0)
  assert.equal(n.queue.length, 1)
  ready = true
  n.drain()
  await new Promise(resolve => setTimeout(resolve, 5))
  assert.equal(spoken.length, 1)
  assert.equal(spoken[0].notificationEventId, 'early')
  n.clear()
})
