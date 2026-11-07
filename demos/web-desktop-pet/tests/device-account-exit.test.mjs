import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'

test('account exit reuses the controller-only quit command without invoking server logout', async () => {
  const exposed = {}, sent = [], invoked = []
  const electron = {
    contextBridge: { exposeInMainWorld: (name, value) => { exposed[name] = value } },
    ipcRenderer: { send: (...args) => sent.push(args), invoke: (...args) => invoked.push(args) },
  }
  const preload = await readFile(new URL('../electron/device-preload.cjs', import.meta.url), 'utf8')
  runInNewContext(preload, { require: name => { assert.equal(name, 'electron'); return electron } })
  exposed.controlDevice.logout()
  assert.equal(invoked.length, 0, 'Closing the app must not wait on account or binding services')
  assert.deepEqual(sent, [['pet:command', 'quit']])
  const windows = await readFile(new URL('../electron/device-windows.mjs', import.meta.url), 'utf8')
  assert.match(windows, /if \(!this\.trusted\(event\)\) return/)
  assert.match(windows, /name === 'quit' && control\) app\.quit\(\)/)
})
