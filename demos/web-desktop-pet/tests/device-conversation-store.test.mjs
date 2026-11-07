import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { ConversationStore } from '../electron/device-conversation-store.mjs'

const encryption = { isEncryptionAvailable: () => true,
  encryptString: value => Buffer.from(value).map(byte => byte ^ 73),
  decryptString: value => Buffer.from(value).map(byte => byte ^ 73).toString() }
const deviceId = 'fixture-device', agentId = 'fixture-role'
const guest = { deviceId }, accountA = { deviceId, owner: 'account-a', tenantId: 'tenant-a' }
const accountB = { deviceId, owner: 'account-b', tenantId: 'tenant-b' }
async function fixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'conversation-store-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const reopen = async () => {
    const store = new ConversationStore({ directory, encryption }); await store.load(); return store
  }
  return { directory, reopen, store: await reopen() }
}
async function turn(store, id, user = `问题-${id}`, assistant = `回复-${id}`) {
  for (const event of [{ type: 'preparing' }, { type: 'user', text: user },
    { type: 'assistant', text: assistant }, { type: 'done' }]) {
    await store.accept({ ...event, requestId: id }, { deviceId, agentId })
  }
}

test('local role history is never claimed or uploaded after scan, switching or restart', async t => {
  const f = await fixture(t), local = { ...guest, roleSource: 'local' }
  await f.store.setScope(local); await turn(f.store, 'local-before-scan')
  await f.store.setScope({ ...accountA, roleSource: 'local' }); await turn(f.store, 'local-after-scan')
  assert.equal(f.store.pending().length, 0)
  assert.equal((await f.store.export()).length, 4)
  assert.ok((await f.store.export()).every(row => row.roleSource === 'local' && !row.owner))
  await f.store.setScope(accountA); await turn(f.store, 'online')
  assert.deepEqual(f.store.pending().map(row => row.text), ['问题-online', '回复-online'])
  const restored = await f.reopen(); await restored.setScope(local)
  assert.equal(restored.context(agentId).length, 4)
  assert.equal(restored.pending().length, 0)
  await restored.clear()
  await restored.setScope(accountA)
  assert.equal(restored.pending().length, 2, 'clearing local history preserves online archive')
})

test('more than eighty messages survive restart while model context stays at forty messages', async t => {
  const f = await fixture(t); await f.store.setScope(guest)
  for (let index = 0; index < 45; index++) await turn(f.store, `turn-${index}`)
  assert.equal((await f.store.export()).length, 90)
  assert.equal(f.store.context(agentId).length, 40)
  assert.equal(f.store.context(agentId).at(-1).text, '回复-turn-44')
  const restored = await f.reopen(); await restored.setScope(guest)
  assert.equal((await restored.export()).length, 90)
  assert.equal(restored.context(agentId).at(-1).text, '回复-turn-44')
})

test('pending account A history never blocks a new guest batch or transfers to account B', async t => {
  const f = await fixture(t); await f.store.setScope(guest); await turn(f.store, 'old-guest')
  await f.store.setScope(accountA)
  const originalIds = f.store.pending().map(row => row.messageId)
  assert.equal(originalIds.length, 2)
  await f.store.setScope(guest); await turn(f.store, 'new-guest')
  await f.store.setScope(accountB)
  assert.deepEqual(f.store.pending().map(row => row.text), ['问题-new-guest', '回复-new-guest'])
  const restored = await f.reopen(); await restored.setScope(accountA)
  assert.deepEqual(restored.pending().map(row => row.messageId), originalIds)
  assert.deepEqual(restored.context(agentId).map(row => row.text), ['问题-old-guest', '回复-old-guest'])
})

test('only matching owner tenant and device acknowledgements can mark pending messages synced', async t => {
  const f = await fixture(t); await f.store.setScope(accountA); await turn(f.store, 'ack')
  const [first, second] = f.store.pending()
  for (const wrong of [accountB, { ...accountA, tenantId: 'wrong' }, { ...accountA, deviceId: 'wrong' }]) {
    await f.store.acknowledge(first.messageId, wrong)
    assert.equal(f.store.pending().length, 2)
  }
  await f.store.acknowledge('unknown-message', accountA)
  await f.store.acknowledge(first.messageId, accountA)
  await f.store.acknowledge(first.messageId, accountA)
  assert.deepEqual(f.store.pending().map(row => row.messageId), [second.messageId])
  assert.equal((await f.store.export()).length, 2, 'sync acknowledgement retains the local archive')
  const restored = await f.reopen(); await restored.setScope(accountA)
  assert.deepEqual(restored.pending().map(row => row.messageId), [second.messageId])
})

test('account-owned turns persist without a platform connection and do not become another guest claim', async t => {
  const f = await fixture(t); await f.store.setScope(accountA); await turn(f.store, 'offline-account')
  const restored = await f.reopen(); await restored.setScope(accountA)
  assert.equal(restored.pending().length, 2)
  await restored.setScope(guest); await restored.setScope(accountB)
  assert.equal(restored.pending().length, 0)
  assert.equal(restored.context(agentId).length, 0)
})

test('late events from an interrupted identity cannot append a turn to the newly scanned account', async t => {
  const f = await fixture(t); await f.store.setScope(guest)
  await f.store.accept({ type: 'preparing', requestId: 'late' }, { deviceId, agentId })
  await f.store.accept({ type: 'user', requestId: 'late', text: '旧身份问题' }, { deviceId, agentId })
  await f.store.setScope(accountA)
  await f.store.accept({ type: 'assistant', requestId: 'late', text: '旧身份回复' }, { deviceId, agentId })
  await f.store.accept({ type: 'done', requestId: 'late' }, { deviceId, agentId })
  assert.equal(f.store.pending().length, 1, 'the already entered user message is preserved, not the late assistant event')
  assert.equal((await f.store.export())[0].text, '旧身份问题')
})

test('duplicate completed turn IDs cannot create duplicate local messages or upload intents', async t => {
  const f = await fixture(t); await f.store.setScope(accountA)
  await turn(f.store, 'same-request'); await turn(f.store, 'same-request')
  assert.equal(f.store.pending().length, 2)
  assert.equal(new Set(f.store.pending().map(row => row.messageId)).size, 2)
  assert.equal((await f.store.export()).length, 2)
})

test('clearing the current account preserves other accounts and their pending sync batches', async t => {
  const f = await fixture(t); await f.store.setScope(accountA); await turn(f.store, 'private-a')
  await f.store.setScope(accountB); await turn(f.store, 'private-b'); await f.store.clear()
  assert.equal((await f.store.export()).length, 0)
  const restored = await f.reopen(); await restored.setScope(accountA)
  assert.deepEqual(restored.pending().map(row => row.text), ['问题-private-a', '回复-private-a'])
})

test('persisted storage never contains plaintext conversation contents', async t => {
  const f = await fixture(t); await f.store.setScope(accountA)
  await turn(f.store, 'encrypted', 'PRIVATE_LOCAL_QUESTION', 'PRIVATE_LOCAL_ANSWER')
  const files = (await readdir(f.directory, { recursive: true, withFileTypes: true })).filter(row => row.isFile())
  assert.ok(files.length > 0)
  for (const file of files) {
    const bytes = await readFile(path.join(file.parentPath, file.name), 'utf8')
    assert.doesNotMatch(bytes, /PRIVATE_LOCAL_QUESTION|PRIVATE_LOCAL_ANSWER/)
  }
})

test('legacy guest rows migrate once and retain their previously claimed owner', async t => {
  const f = await fixture(t)
  const old = { claimOwner: { owner: accountA.owner, tenantId: accountA.tenantId }, historyRows: [{
    type: 'assistant_reply', deviceId, agentId, requestId: 'legacy', responseId: 'legacy', messageId: 'legacy-id',
    messageRole: 'assistant', source: 'device', text: '旧版记录', finished: true }] }
  await f.store.migrate(old, deviceId); await f.store.migrate(old, deviceId)
  await f.store.setScope(accountB); assert.equal(f.store.pending().length, 0)
  await f.store.setScope(accountA); assert.equal(f.store.pending().length, 1)
  assert.equal(f.store.pending()[0].messageId, 'legacy-id')
})

test('last confirmed archive identity survives an offline restart without authorizing platform calls', async t => {
  const f = await fixture(t); await f.store.setScope(accountA); await turn(f.store, 'owned')
  const restored = await f.reopen()
  assert.deepEqual(restored.data.lastScope, { ...accountA, roleSource: 'online' })
  await restored.setScope(restored.data.lastScope); await turn(restored, 'offline-restart')
  await restored.setScope(accountB)
  assert.equal(restored.pending().length, 0)
  await restored.setScope(accountA); assert.equal((await restored.export()).length, 4)
})

test('guest interruption preserves entered user text and partial visible assistant reply', async t => {
  const f = await fixture(t); await f.store.setScope(guest)
  await f.store.accept({ type: 'preparing', requestId: 'cut' }, { deviceId, agentId })
  await f.store.accept({ type: 'user', requestId: 'cut', text: '不要丢失问题' }, { deviceId, agentId })
  await f.store.accept({ type: 'assistant', requestId: 'cut', text: '部分回答' }, { deviceId, agentId })
  await f.store.accept({ type: 'interrupted', requestId: 'cut' }, { deviceId, agentId })
  const restored = await f.reopen(); await restored.setScope(guest)
  assert.deepEqual((await restored.export()).map(row => row.text), ['不要丢失问题', '部分回答'])
})

test('old memory-only context is retained without duplicating known transcript rows', async t => {
  const f = await fixture(t)
  await f.store.migrate({ memories: [[agentId, [{ role: 'user', text: '旧版仅上下文' }]]], historyRows: [] }, deviceId)
  await f.store.setScope(guest)
  assert.equal(f.store.context(agentId)[0].text, '旧版仅上下文')
})

test('an unreadable encrypted archive is never overwritten by a subsequent clear attempt', async t => {
  const f = await fixture(t), original = '{"encrypted":"not-a-valid-archive"}'
  await writeFile(f.store.file, original)
  const broken = new ConversationStore({ directory: f.directory, encryption })
  await assert.rejects(broken.load(), { code: 'HISTORY_STORAGE_UNAVAILABLE' })
  await assert.rejects(broken.clear(), { code: 'HISTORY_STORAGE_UNAVAILABLE' })
  assert.equal(await readFile(f.store.file, 'utf8'), original)
})

test('Chinese history is bounded by encoded bytes so every successfully saved archive can reopen', async t => {
  const f = await fixture(t); await f.store.setScope(accountA); await turn(f.store, 'capacity')
  const original = await readFile(f.store.file, 'utf8')
  const sample = (await f.store.export())[0]
  await assert.rejects(f.store.mutate(data => {
    data.rows = Array.from({ length: 1200 }, (_, index) => ({ ...sample, messageId: `capacity-${index}`, text: '中'.repeat(16000) }))
  }), { code: 'HISTORY_CAPACITY' })
  assert.equal(await readFile(f.store.file, 'utf8'), original)
  const restored = await f.reopen(); await restored.setScope(accountA)
  assert.equal((await restored.export()).length, 2)
})

test('legacy phone inputs remain local mirrors without an unacknowledgeable upload backlog', async t => {
  const f = await fixture(t); await f.store.setScope(accountA)
  const row = { type: 'assistant_reply', deviceId, agentId, requestId: 'phone', responseId: 'turn', messageId: 'phone-input',
    source: 'controller', messageRole: 'user', text: '手机已经负责保存的输入', finished: true }
  await f.store.record(row, accountA)
  assert.equal((await f.store.export()).length, 1); assert.equal(f.store.pending().length, 0)
  await f.store.record({ ...row, messageId: 'negotiated-input', historyUserMessageId: 'a'.repeat(32) }, accountA)
  assert.equal(f.store.pending().length, 1, 'negotiated inputs still wait for server acknowledgement')
})
