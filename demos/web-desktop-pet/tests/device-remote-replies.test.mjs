import test from 'node:test'
import assert from 'node:assert/strict'
import { DeviceRemoteReplies } from '../electron/device-remote-replies.mjs'

test('clearing replies invalidates persistence completions even when the account is unchanged', async () => {
  const sent = []; let release
  const context = { bound: true, owner: 'a', tenantId: 'tenant', deviceId: 'device', agentId: 'role' }
  const replies = new DeviceRemoteReplies({ context: () => context, send: row => sent.push(row),
    persist: () => new Promise(resolve => { release = resolve }) })
  replies.deliver({ finished: true, source: 'device', messageRole: 'assistant', messageId: 'old' }, context)
  replies.clear(); release()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(sent, [])
  assert.equal(replies.outbox.size, 0)
  replies.clear()
})

test('finished replies wait for durable local storage and never cross to a replacement owner', async () => {
  const sent = []; let release
  let context = { bound: true, owner: 'a', tenantId: 'tenant-a', deviceId: 'device', agentId: 'role' }
  const replies = new DeviceRemoteReplies({ context: () => context, send: row => sent.push(row),
    persist: () => new Promise(resolve => { release = resolve }) })
  replies.deliver({ finished: true, source: 'device', messageRole: 'assistant', messageId: 'one' }, { ...context })
  assert.equal(sent.length, 0)
  context = { ...context, owner: 'b' }; release()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(sent.length, 0)
  replies.clear()
})

function fixture(chat) {
  let context = { bound: true, owner: 'owner', tenantId: 'tenant', deviceId: 'device', agentId: 'role' }
  const sent = []
  const relay = new DeviceRemoteReplies({ context: () => context, send: value => sent.push(value),
    chat: text => chat(relay, text), intervalMs: 5 })
  return { relay, sent, change: value => { context = { ...context, ...value } } }
}

test('remote snapshots and final reply retain correlation; no duplicate final or local reply', async () => {
  const { relay, sent } = fixture((relay, text) => {
    assert.equal(text, '你在哪')
    relay.accept({ type: 'preparing', requestId: 'internal' })
    return { ok: true, requestId: 'internal' }
  })
  await relay.submit('你在哪', 'remote')
  relay.accept({ type: 'assistant', requestId: 'other', text: 'local reply' })
  relay.accept({ type: 'assistant', requestId: 'internal', text: '我在这里' })
  await new Promise(resolve => setTimeout(resolve, 15))
  relay.accept({ type: 'done', requestId: 'internal' })
  relay.accept({ type: 'done', requestId: 'internal' })
  relay.accept({ type: 'complete', requestId: 'internal' })
  assert.deepEqual(sent.map(row => row.finished), [false, true])
  for (const row of sent) {
    assert.equal(row.requestId, 'remote')
    assert.equal(row.responseId, 'internal')
    assert.equal(row.text, '我在这里')
    assert.equal(row.agentId, 'role')
    assert.equal(row.type, 'assistant_reply')
  }
})

test('concurrent request cannot steal reply; context loss discards queued private snapshots', async () => {
  let release
  const { relay, sent, change } = fixture(relay => {
    relay.accept({ type: 'preparing', requestId: 'first' })
    return new Promise(resolve => { release = resolve })
  })
  const pending = relay.submit('hello', 'request-1')
  await relay.submit('again', 'request-2')
  assert.equal(sent[0].requestId, 'request-2')
  assert.equal(sent[0].code, 'CHAT_BUSY')
  release({ ok: true, requestId: 'first' })
  await pending
  relay.accept({ type: 'assistant', requestId: 'first', text: 'private' })
  change({ owner: 'different-owner' })
  await new Promise(resolve => setTimeout(resolve, 15))
  relay.accept({ type: 'done', requestId: 'first' })
  assert.equal(sent.length, 1)
})

test('failed submission and provider error emit one correlated error, not fabricated replies', async () => {
  const { relay, sent } = fixture(relay => {
    relay.accept({ type: 'preparing', requestId: 'internal' })
    relay.accept({ type: 'error', requestId: 'internal', code: 'REALTIME_UNAVAILABLE', message: 'failed' })
    return { ok: false }
  })
  await relay.submit('hello', 'remote')
  assert.equal(sent.length, 1)
  assert.equal(sent[0].type, 'error')
  assert.equal(sent[0].requestId, 'remote')
})

test('local device turns sync both roles and can replay a bounded memory snapshot after controller reconnect', () => {
  const { relay, sent, change } = fixture(() => ({ ok: false }))
  relay.accept({ type: 'preparing', requestId: 'local' })
  relay.accept({ type: 'user', requestId: 'local', text: '设备端输入' })
  relay.accept({ type: 'assistant', requestId: 'local', text: '设备上的回答' })
  relay.accept({ type: 'done', requestId: 'local' })
  relay.accept({ type: 'complete', requestId: 'local' })
  assert.equal(sent[0].messageRole, 'user')
  assert.equal(sent[0].source, 'device')
  assert.equal(sent[1].messageRole, 'assistant')
  assert.equal(sent[1].finished, true)
  relay.replay('different-role', 'denied')
  assert.equal(sent.length, 2)
  relay.replay('role', 'history-request')
  assert.equal(sent[2].snapshot, true)
  assert.equal(sent[2].requestId, 'history-request')
  assert.deepEqual(sent[2].history.map(row => row.role), ['user', 'assistant'])
  assert.deepEqual(sent[2].history.map(row => row.text), ['设备端输入', '设备上的回答'])
  assert.equal(sent[0].messageId, sent[2].history[0].id, 'stream and snapshot share IDs for dedupe')
  change({ owner: 'other' })
  relay.replay('role', 'must-not-leak')
  assert.equal(sent.length, 3)
  relay.clear()
})

test('stale phone role fails without invoking generation', async () => {
  let called = 0
  const { relay, sent } = fixture(() => { called++; return { ok: true } })
  await relay.submit('hello', 'request', { agentId: 'old-role' })
  assert.equal(called, 0)
  assert.equal(sent[0].code, 'ROLE_CHANGED')
})

test('a fresh or restarted device acknowledges empty history without generating a reply', () => {
  const { relay, sent } = fixture(() => { throw new Error('must not generate') })
  relay.replay('role', 'fresh-history')
  assert.equal(sent[0].protocolVersion, 2)
  assert.equal(sent[0].snapshot, true)
  assert.deepEqual(sent[0].history, [])
  relay.clear()
})

test('final reply retries persistence only, retains phone session, and clears on server acknowledgement', async () => {
  let calls = 0
  const { relay, sent, change } = fixture(relay => {
    calls++
    relay.accept({ type: 'preparing', requestId: 'internal' })
    return { ok: true, requestId: 'internal' }
  })
  await relay.submit('question', 'phone', { websocketSessionId: 'owned-session' })
  relay.accept({ type: 'assistant', requestId: 'internal', text: 'real reply' })
  relay.accept({ type: 'done', requestId: 'internal' })
  relay.accept({ type: 'complete', requestId: 'internal' })
  assert.equal(sent[0].websocketSessionId, 'owned-session')
  assert.equal(relay.outbox.size, 1)
  change({ bound: false }); relay.retry(); assert.equal(sent.length, 1)
  change({ bound: true }); relay.retry(); assert.equal(sent.length, 2); assert.equal(calls, 1)
  assert.equal(sent[0].messageId, sent[1].messageId)
  const savedId = 'a'.repeat(32)
  relay.saved(sent[0].messageId, { historyMessageId: savedId, timestamp: 123456 })
  relay.retry()
  assert.equal(sent.length, 2)
  relay.replay('role', 'snapshot-after-save')
  assert.equal(sent.at(-1).history[0].historyMessageId, savedId)
  relay.clear()
})

test('reminder envelope is not shared as a user message; only the spoken reply is synced', () => {
  const { relay, sent } = fixture(() => ({ ok: false }))
  relay.accept({ type: 'preparing', requestId: 'notification', notificationEventId: 'event' })
  relay.accept({ type: 'assistant', requestId: 'notification', text: '忙了一天，快下班吧！' })
  relay.accept({ type: 'done', requestId: 'notification' })
  assert.equal(sent.length, 1)
  assert.equal(sent[0].source, 'notification')
  assert.equal(sent[0].notificationEventId, 'event')
  assert.equal(sent[0].messageRole, 'assistant')
  relay.clear()
})

test('repeated controller request replays its actual result without a second paid generation', async () => {
  let calls = 0
  const { relay, sent } = fixture(relay => {
    calls++
    relay.accept({ type: 'preparing', requestId: 'internal' })
    return { ok: true, requestId: 'internal' }
  })
  await relay.submit('same question', 'phone')
  await relay.submit('same question', 'phone')
  assert.equal(calls, 1)
  relay.accept({ type: 'assistant', requestId: 'internal', text: 'actual answer' })
  relay.accept({ type: 'done', requestId: 'internal' })
  relay.accept({ type: 'complete', requestId: 'internal' })
  await relay.submit('same question', 'phone')
  assert.equal(calls, 1)
  assert.equal(sent.at(-1).text, 'actual answer')
  relay.clear()
})

test('an interrupted turn still reports the partial reply it spoke', () => {
  const { relay, sent } = fixture(() => ({ ok: false }))
  relay.accept({ type: 'preparing', requestId: 'local' })
  relay.accept({ type: 'user', requestId: 'local', text: '继续' })
  relay.accept({ type: 'assistant', requestId: 'local', text: '好的，我接着说' })
  relay.accept({ type: 'interrupted', requestId: 'local' })
  // Full duplex stops a reply without losing the transcript: whatever was said
  // before the interruption stays visible on every controller.
  assert.equal(sent.at(-1).messageRole, 'assistant')
  assert.equal(sent.at(-1).finished, true)
  assert.equal(sent.at(-1).text, '好的，我接着说')
  relay.clear()
})

test('a request ID cannot be replayed against a different tool', async () => {
  let calls = 0
  const { relay, sent } = fixture(() => { calls++; return { ok: false, code: 'FIXTURE' } })
  await relay.submit('同一句话', 'target-replay', { remoteTarget: 'codex' })
  await relay.submit('同一句话', 'target-replay', { remoteTarget: 'harness' })
  assert.equal(calls, 1)
  assert.equal(sent.at(-1).code, 'INVALID_TEXT')
  relay.clear()
})

test('history capability snapshot adds safe tool readiness without starting a turn', () => {
  const { relay, sent } = fixture(() => assert.fail('catalog must not start a model turn'))
  relay.tools = () => ({ version: 1, defaultTarget: 'codex', items: [{ id: 'codex', available: true }] })
  relay.replay('role', 'catalog')
  assert.equal(sent.at(-1).remoteTools.version, 1)
  assert.equal(sent.at(-1).remoteTools.items[0].id, 'codex')
  relay.clear()
})

test('tools-only refresh does not replay conversation history', () => {
  const { relay, sent } = fixture(() => assert.fail('readiness must not start a turn'))
  relay.tools = () => ({ version: 1, items: [] })
  relay.replay('role', 'tools', { toolsOnly: true })
  assert.equal(sent.at(-1).toolsOnly, true)
  assert.deepEqual(sent.at(-1).history, [])
  assert.equal(sent.at(-1).remoteTools.version, 1)
  relay.clear()
})
