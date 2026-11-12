import test from 'node:test'
import assert from 'node:assert/strict'
import childProcess from 'node:child_process'
import { syncBuiltinESMExports } from 'node:module'
import { listWindowsApps } from '../electron/device-assistant-windows.mjs'

test('native helper receives EOF without waiting for its timeout', { skip: process.platform !== 'win32' }, async t => {
  const execFile = childProcess.execFile
  const mocked = t.mock.method(childProcess, 'execFile', (_command, _args, options, callback) =>
    execFile(process.execPath, ['-e', `
      process.stdin.resume()
      process.stdin.on('end', () => process.stdout.write('[]'))
    `], { ...options, timeout: 2000 }, callback))
  syncBuiltinESMExports()
  t.after(() => { mocked.mock.restore(); syncBuiltinESMExports() })
  assert.deepEqual(await listWindowsApps({ signal: new AbortController().signal }), [])
})
