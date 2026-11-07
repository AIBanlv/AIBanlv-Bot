import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { registerHistoryControls } from '../electron/device-history-control.mjs'
import { ConversationStore } from '../electron/device-conversation-store.mjs'

test('confirmed clear stops the producer and drains its final writes before deleting the archive', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'history-clear-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const encryption = { isEncryptionAvailable: () => true, encryptString: value => Buffer.from(value), decryptString: value => value.toString() }
  const store = new ConversationStore({ directory, encryption }); await store.load()
  const scope = { deviceId: 'device', owner: 'owner', tenantId: 'tenant' }; await store.setScope(scope)
  const reply = { type: 'assistant_reply', deviceId: 'device', agentId: 'role', requestId: 'turn', responseId: 'turn',
    messageId: 'old-reply', messageRole: 'assistant', source: 'device', text: '清除前的回复', finished: true }
  const handlers = new Map(); let running = true, resumed = false
  const clear = store.clear.bind(store)
  store.clear = async () => {
    await clear()
    // A producer that has not been stopped finishes while the deletion is pending.
    if (running) await store.record(reply, scope)
  }
  registerHistoryControls({ ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
    windows: { fromController: () => true }, store, dialog: { showMessageBox: async () => ({ response: 1 }) },
    beforeClear: () => { running = false; void store.record(reply, scope) },
    changed: () => { running = false }, resume: () => { resumed = true } })
  assert.equal((await handlers.get('device:history-clear')({})).ok, true)
  await store.queue
  assert.deepEqual(await store.export(), [])
  assert.deepEqual(store.pending(), [])
  assert.equal(resumed, true)
})

test('an account change during quiescence cancels deletion and always releases the input gate', async () => {
  const handlers = new Map(); let resumed = false
  const store = { scope: { owner: 'a' }, queue: Promise.resolve(), clear: () => assert.fail('must not clear the replacement account') }
  registerHistoryControls({ ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
    windows: { fromController: () => true }, store, dialog: { showMessageBox: async () => ({ response: 1 }) },
    beforeClear: async () => { store.scope = { owner: 'b' } }, changed() {}, resume: () => { resumed = true } })
  assert.equal((await handlers.get('device:history-clear')({})).ok, false)
  assert.equal(resumed, true)
})
