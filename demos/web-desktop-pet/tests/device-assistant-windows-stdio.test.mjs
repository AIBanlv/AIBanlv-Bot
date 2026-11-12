import test from 'node:test'
import assert from 'node:assert/strict'
import childProcess from 'node:child_process'
import { syncBuiltinESMExports } from 'node:module'
import { listWindowsApps } from '../electron/device-assistant-windows.mjs'

test('native helper receives EOF and the configured PowerShell module path', { skip: process.platform !== 'win32' }, async t => {
  const original = process.env.PSModulePath
  process.env.PSModulePath = 'C:\\Fixture\\PowerShell Modules'
  t.after(() => { if (original === undefined) delete process.env.PSModulePath; else process.env.PSModulePath = original })
  let childEnv
  const execFile = childProcess.execFile
  const mocked = t.mock.method(childProcess, 'execFile', (_command, _args, options, callback) => {
    childEnv = options.env
    return execFile(process.execPath, ['-e', `
      process.stdin.resume()
      process.stdin.on('end', () => process.stdout.write('[]'))
    `], { ...options, timeout: 2000 }, callback)
  })
  syncBuiltinESMExports()
  t.after(() => { mocked.mock.restore(); syncBuiltinESMExports() })
  assert.deepEqual(await listWindowsApps({ signal: new AbortController().signal }), [])
  assert.equal(childEnv.PSModulePath, process.env.PSModulePath)
  assert.equal(childEnv.NODE_OPTIONS, undefined)
})
