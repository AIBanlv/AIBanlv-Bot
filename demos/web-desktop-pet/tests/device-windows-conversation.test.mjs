import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'

// Test the real window fan-out method without starting Electron or weakening
// its sandbox. Native windows are substituted; event routing is not.
const hooks = registerHooks({ resolve(specifier, context, next) {
  if (specifier !== 'electron') return next(specifier, context)
  return { shortCircuit: true, url: 'data:text/javascript,' + encodeURIComponent(
    'export const app={isPackaged:false}; export const BrowserWindow={},ipcMain={},Menu={},Tray={},nativeImage={},powerMonitor={},screen={};') }
} })
const { DeviceWindows } = await import('../electron/device-windows.mjs')
hooks.deregister()

function fixture() {
  const sent = { controller: [], pet: [] }, windows = Object.create(DeviceWindows.prototype)
  for (const name of ['controller', 'pet']) windows[name] = { isDestroyed: () => false,
    webContents: { isDestroyed: () => false, send: (channel, data) => sent[name].push({ channel, data }) } }
  windows.state = { ready: false }
  windows.update({ current: { agentId: 'role-a', source: 'local' }, phase: 'ready', accountScope: 'scope-a' })
  sent.controller.length = sent.pet.length = 0
  return { windows, sent }
}

test('live dialogue reaches both windows with main-owned scope and without private or audio buffers', () => {
  const { windows, sent } = fixture()
  for (const type of ['preparing', 'user', 'assistant', 'done', 'complete', 'error', 'reset', 'stopped', 'interrupted']) {
    const event = { type, requestId: 'turn', text: '公开的对话文字', agentId: 'forged-role', accountScope: 'forged-scope',
      pcm: 'unused-buffer', expression: [1, 2], hidden: 'not-for-controller' }
    windows.conversation(event)
    const actual = sent.controller.at(-1)
    assert.equal(actual.channel, 'device:conversation')
    assert.deepEqual(actual.data, { type, requestId: 'turn', text: event.text, agentId: 'role-a', accountScope: 'scope-a' })
    assert.equal(sent.pet.at(-1).data, event, 'Pet playback contract stays intact')
  }
  const before = sent.controller.length
  windows.conversation({ type: 'audio', requestId: 'turn', pcm: 'large-buffer', expression: [1, 2] })
  assert.equal(sent.controller.length, before)
  assert.equal(sent.pet.at(-1).data.type, 'audio')
})

test('context changes update transcript identity and a closed settings window never blocks the pet', () => {
  const { windows, sent } = fixture()
  windows.update({ current: { agentId: 'role-b', source: 'local' }, phase: 'ready', accountScope: 'scope-b' })
  windows.conversation({ type: 'assistant', requestId: 'new-turn', text: '当前角色' })
  assert.equal(sent.controller.at(-1).data.agentId, 'role-b')
  assert.equal(sent.controller.at(-1).data.accountScope, 'scope-b')
  windows.controller.isDestroyed = () => true
  const before = sent.controller.length
  windows.conversation({ type: 'assistant', requestId: 'new-turn', text: '继续' })
  assert.equal(sent.controller.length, before)
  assert.equal(sent.pet.at(-1).data.text, '继续')
})
