import test from 'node:test'
import assert from 'node:assert/strict'
import { DeviceChannel } from '../electron/device-channel.mjs'
import { DesktopServices } from '../electron/device-desktop-services.mjs'
import { DeviceNotifications } from '../electron/device-notifications.mjs'
import { DeviceNotificationSync } from '../electron/device-notification-sync.mjs'

const flush = () => new Promise(resolve => setImmediate(resolve))
function fixture(t, options = {}) {
  let now = 1800000000000, busy = false, requests = []
  const channel = new DeviceChannel({ deviceId: 'zhanlv:desktop-fixture', qr: async () => '' })
  channel.publish({ connection: 'connected' })
  channel.receive({ type: 'bind_success', deviceId: channel.state.deviceId, tenantId: 't', controllerUserId: 'u',
    capabilities: { desktopNotificationsV1: true } })
  const notices = [], spoken = []
  const notifications = new DeviceNotifications({ now: () => now, context: () => ({ bound: channel.state.binding === 'bound',
    ready: true, owner: channel.state.owner, tenantId: channel.tenantId }), busy: () => busy,
    onNotice: value => notices.push(value), speak: (text, value) => { spoken.push(value); return { ok: true } } })
  channel.on('notification', value => notifications.receive(value))
  const services = new DesktopServices({ channel, timeoutMs: 100 })
  let result = { ok: true, data: { notificationsEnabled: true, events: [] } }
  channel.send = message => {
    requests.push(message)
    const data = result
    queueMicrotask(() => channel.receive({ type: 'desktop_result', requestId: message.requestId, deviceId: channel.state.deviceId,
      controllerUserId: 'u', tenantId: 't', ...data }))
    return true
  }
  const sync = new DeviceNotificationSync({ channel, services, notifications, now: () => now, intervalMs: 100000, ...options })
  t.after(() => { sync.stop(); notifications.clear(); services.clear() })
  return { channel, sync, notifications, notices, spoken, requests, services,
    setResult: value => { result = value }, advance: () => now += 1000, busy: value => { busy = value },
    event: id => ({ eventId: id, sentAt: now, content: '该休息了' }) }
}
test('same-account recovery reaches the shared speech queue when push was missed, and never executes a task', async t => {
  const f = fixture(t); const event = f.event('phone-received')
  f.setResult({ ok: true, data: { notificationsEnabled: true, events: [event] } })
  f.sync.start(); await flush()
  assert.equal(f.sync.snapshot().state, 'ready')
  assert.equal(f.requests.length, 1); assert.equal(f.requests[0].operation, 'notification_sync')
  assert.deepEqual(Object.keys(f.requests[0].payload), ['since'])
  assert.equal(f.spoken.length, 1); assert.equal(f.spoken[0].notificationEventId, event.eventId)
  await f.sync.sync(true); await flush()
  assert.equal(f.spoken.length, 1, 'Recovery must not speak the same delivery twice')
  f.channel.receive({ type: 'proactive_message', deviceId: f.channel.state.deviceId, controllerUserId: 'u', tenantId: 't',
    useCurrentAgent: true, ...event })
  assert.equal(f.notices.length, 1, 'A late push is deduplicated against recovery')
})
test('live push and recovered duplicates are deduplicated, and account reminders survive task report floods', async t => {
  const f = fixture(t); const event = f.event('live')
  f.busy(true)
  f.channel.receive({ type: 'proactive_message', deviceId: f.channel.state.deviceId, controllerUserId: 'u', tenantId: 't', useCurrentAgent: true, ...event })
  for (let i = 0; i < 300; i++) f.notifications.receive({ ...f.event(`task-${i}`), reportKey: `task-${i}`, progress: true })
  f.setResult({ ok: true, data: { notificationsEnabled: true, events: [event] } })
  f.sync.start(); await flush()
  assert.equal(f.notices.filter(row => row.eventId === 'live').length, 1)
  assert.equal(f.notifications.queue.length, 16); assert.equal(f.notifications.queue[0].eventId, 'live')
  f.busy(false); f.notifications.drain(); await flush()
  assert.equal(f.spoken[0].notificationEventId, 'live')
})
test('unsupported server, missing proof and disabled account notifications stay explicit without changing preferences', async t => {
  const f = fixture(t)
  f.channel.state.desktopNotificationsSupported = false
  f.sync.start(); await flush()
  assert.equal(f.sync.snapshot().state, 'unsupported'); assert.equal(f.requests.length, 0)
  f.channel.publish({ desktopNotificationsSupported: true, proofRequired: true, accountAuthReady: false }); await flush()
  assert.equal(f.sync.snapshot().state, 'unauthorized'); assert.equal(f.requests.length, 0)
  f.setResult({ ok: true, data: { events: [f.event('disabled')], notificationsEnabled: false } })
  f.channel.publish({ accountAuthReady: true }); await flush()
  assert.equal(f.sync.snapshot().state, 'disabled'); assert.equal(f.spoken.length, 0)
  assert.ok(f.requests.every(row => row.operation === 'notification_sync'))
})
test('a reconnect automatically rechecks; stale results cannot enter a different binding', async t => {
  const f = fixture(t)
  f.sync.start(); await flush()
  f.channel.sequence++; f.channel.publish({ connection: 'offline' })
  assert.equal(f.sync.snapshot().state, 'offline')
  f.setResult({ ok: true, data: { events: [f.event('reconnect')] } })
  f.channel.publish({ connection: 'connected' }); await flush()
  assert.equal(f.spoken.length, 1)
  let resolve
  f.services.request = () => new Promise(done => { resolve = done })
  const pending = f.sync.sync(true)
  const finishOld = resolve
  f.channel.receive({ type: 'bind_success', deviceId: f.channel.state.deviceId, tenantId: 'other', controllerUserId: 'other',
    capabilities: { desktopNotificationsV1: true } })
  finishOld({ ok: true, data: { events: [f.event('old-account')] } }); await pending
  assert.equal(f.notices.some(row => row.eventId === 'old-account'), false)
})
test('malformed, pre-start and expired recovery entries never speak; failed requests are retried on the next poll', async t => {
  const f = fixture(t)
  f.setResult({ ok: false, code: 'TIMEOUT' }); f.sync.start(); await flush()
  assert.equal(f.sync.snapshot().code, 'TIMEOUT')
  const event = f.event('malformed')
  f.setResult({ ok: true, data: { events: [{ ...event, sentAt: 'not-a-timestamp' }, { ...event, sentAt: event.sentAt - 1 },
    { ...event, eventId: 'bad-content', content: {} }] } })
  await f.sync.sync(true); await flush()
  assert.equal(f.sync.snapshot().state, 'ready'); assert.equal(f.spoken.length, 0)
})
