import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ModelSettings } from '../electron/device-model-settings.mjs'
import { registerModelControls } from '../electron/device-model-control.mjs'

test('saving Keys and legacy source preferences cannot start platform or replace the selected role', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'model-controls-'))
  t.after(() => rm(directory, { force: true, recursive: true }))
  const settings = new ModelSettings({ file: path.join(directory, 'model.json'), encryption: { isEncryptionAvailable: () => false } })
  const handlers = new Map(), selected = { agentId: 'local-role', source: 'local' }
  const channel = { started: false, start() { this.started = true }, stop() { this.started = false }, publish() {} }
  const runtime = { state: { current: selected }, clear() { this.state.current = null }, async ensureInitialProfile() {} }
  registerModelControls({ ipcMain: { handle: (name, work) => handlers.set(name, work) },
    windows: { fromController: event => event === 'controller' }, settings, channel, runtime, changed: async () => {} })
  const configure = (value, sender = 'controller') => handlers.get('device:models-configure')(sender, value)
  assert.equal((await configure({ apiKey: 'fixture-realtime' }, 'pet')).code, 'FORBIDDEN')
  assert.equal(settings.key(), '')
  assert.equal((await configure({ apiKey: 'fixture-realtime', source: 'platform' })).ok, true)
  assert.equal(channel.started, false)
  assert.equal(runtime.state.current, selected)
  await configure({ platformEnabled: true }); assert.equal(channel.started, true)
  await configure({ platformEnabled: false }); assert.equal(channel.started, false)
  assert.equal(runtime.state.current, selected, 'disconnect preserves a local role')
  await configure({ workspaceId: 'fixture-space' }); assert.equal(channel.started, false)
})
