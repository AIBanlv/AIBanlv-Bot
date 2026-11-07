import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DeviceGuestMemory } from '../electron/device-guest-memory.mjs'

const encryption = { isEncryptionAvailable: () => true,
  encryptString: value => Buffer.from(value).map(byte => byte ^ 73),
  decryptString: value => Buffer.from(value).map(byte => byte ^ 73).toString() }
async function setup(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'guest-memory-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return path.join(dir, 'guest.json')
}
const snapshot = text => ({ historyRows: [], memories: [['waner', [{ role: 'user', text }]]] })

test('claimed pending transcripts retain their account and tenant across restart', async t => {
  const file = await setup(t)
  const store = new DeviceGuestMemory({ file, encryption })
  const data = { ...snapshot('MAX'), claimOwner: { owner: 'account-a', tenantId: 'tenant-a' } }
  assert.equal((await store.save(data)).ok, true)
  assert.deepEqual(await new DeviceGuestMemory({ file, encryption }).load(), { ok: true, ...data })
  for (const claimOwner of [null, {}, { owner: 'a' }, { owner: '', tenantId: 'b' },
    { owner: 'a', tenantId: 'x'.repeat(513) }, { owner: 'a', tenantId: 'b', token: 'secret' }]) {
    assert.equal((await store.save({ ...snapshot('invalid'), claimOwner })).ok, false)
  }
  assert.deepEqual((await store.load()).claimOwner, data.claimOwner)
})

test('encrypted guest context survives a new instance including MAX golden retriever memory', async t => {
  const file = await setup(t)
  const store = new DeviceGuestMemory({ file, encryption })
  assert.deepEqual(await store.load(), { ok: true, historyRows: [], memories: [] })
  const data = snapshot('我的金毛叫 MAX')
  data.historyRows.push({ type: 'assistant_reply', deviceId: 'device', agentId: 'waner', requestId: 'turn',
    responseId: 'turn', messageId: 'guest-device-turn-user', messageRole: 'user', source: 'device', text: '我的金毛叫 MAX', finished: true })
  assert.equal((await store.save(data)).ok, true)
  assert.doesNotMatch(await readFile(file, 'utf8'), /MAX|金毛|waner/)
  assert.deepEqual(await new DeviceGuestMemory({ file, encryption }).load(), { ok: true, ...data })
})

test('corruption and unavailable encryption fail closed without exposing plaintext', async t => {
  const file = await setup(t)
  await writeFile(file, 'broken MAX')
  const store = new DeviceGuestMemory({ file, encryption })
  assert.deepEqual(await store.load(), { ok: false, code: 'GUEST_MEMORY_UNAVAILABLE' })
  const locked = new DeviceGuestMemory({ file, encryption: { isEncryptionAvailable: () => false } })
  assert.equal((await locked.save(snapshot('MAX'))).ok, false)
  assert.equal(await readFile(file, 'utf8'), 'broken MAX')
  await store.save(snapshot('safe'))
  const wrongKey = new DeviceGuestMemory({ file, encryption: { ...encryption, decryptString: () => { throw new Error('secret MAX') } } })
  assert.deepEqual(await wrongKey.load(), { ok: false, code: 'GUEST_MEMORY_UNAVAILABLE' })
})

test('schema rejects oversized, invalid and duplicate role snapshots without replacing saved context', async t => {
  const file = await setup(t)
  const store = new DeviceGuestMemory({ file, encryption })
  await store.save(snapshot('valid'))
  for (const invalid of [
    { historyRows: Array(81).fill({}), memories: [] },
    { historyRows: [], memories: Array.from({ length: 21 }, (_, i) => [`role-${i}`, []]) },
    { historyRows: [], memories: [['a', Array(41).fill({ role: 'user', text: 'x' })]] },
    { historyRows: [], memories: [['a', []], ['a', []]] },
    snapshot('x'.repeat(4001)),
    { historyRows: [], memories: [['a', [{ role: 'system', text: 'untrusted' }]]] },
  ]) assert.equal((await store.save(invalid)).ok, false)
  assert.equal((await store.load()).memories[0][1][0].text, 'valid')
})

test('a delayed first write cannot overwrite a newer queued snapshot', async t => {
  const file = await setup(t)
  let release, started
  const ready = new Promise(resolve => { started = resolve })
  const fs = await import('node:fs/promises')
  let count = 0
  const store = new DeviceGuestMemory({ file, encryption, fs: { ...fs, writeFile: async (...args) => {
    if (++count === 1) { started(); await new Promise(resolve => { release = resolve }) }
    return fs.writeFile(...args)
  } } })
  const first = store.save(snapshot('old'))
  await ready
  const last = store.save(snapshot('new'))
  release()
  await Promise.all([first, last])
  assert.equal((await new DeviceGuestMemory({ file, encryption }).load()).memories[0][1][0].text, 'new')
})

test('queued snapshots are captured when saved and newest snapshot wins', async t => {
  const file = await setup(t)
  const store = new DeviceGuestMemory({ file, encryption })
  const first = snapshot('first'), second = snapshot('last')
  const writes = [store.save(first), store.save(second)]
  second.memories[0][1][0].text = 'mutated'
  assert.ok((await Promise.all(writes)).every(result => result.ok))
  assert.equal((await store.load()).memories[0][1][0].text, 'last')
  assert.equal((await store.clear()).ok, true)
  assert.deepEqual(await store.load(), { ok: true, historyRows: [], memories: [] })
})
