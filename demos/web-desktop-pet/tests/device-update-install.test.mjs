import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { EventEmitter } from 'node:events'
import { createHash } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createRequire } from 'node:module'
import { installedDirectory, prepareUpdateInstall } from '../electron/device-update-install.mjs'

test('only packaged AIBanlv installation with the ownership marker can install', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'update-install-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const executable = path.join(directory, 'AIBanlv.exe')
  assert.equal(await installedDirectory({ isPackaged: false, platform: 'win32', executable }), null)
  assert.equal(await installedDirectory({ isPackaged: true, platform: 'win32', executable }), null)
  await writeFile(path.join(directory, '.control-device-install'), 'Control Device\r\n')
  assert.equal(await installedDirectory({ isPackaged: true, platform: 'win32', executable }), directory)
  assert.equal(await installedDirectory({ isPackaged: true, platform: 'darwin', executable }), null)
})

test('real helper survives Electron exit and launches the verified installer fixture', { skip: process.platform !== 'win32', timeout: 30000 }, async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "update-after-exit 中文 ' & spaces-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  await writeFile(path.join(directory, '.control-device-install'), 'Control Device\r\n')
  // This hidden test executable only records its arguments; it never installs,
  // touches registry/shortcuts, or writes outside the fixture directory.
  const source = path.join(directory, 'Fixture.cs')
  await writeFile(source, 'using System; using System.IO; class Fixture { static void Main(string[] args) { File.WriteAllText(Environment.GetEnvironmentVariable("UPDATE_FIXTURE_RECEIPT"), string.Join(" ", args)); } }')
  const execute = promisify(execFile)
  await execute(path.join(process.env.SystemRoot, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'),
    ['/nologo', '/target:winexe', `/out:${path.join(directory, 'Setup.exe')}`, source], { windowsHide: true })
  const require = createRequire(import.meta.url), receipt = path.join(directory, 'installer-started.txt')
  const env = { ...process.env, UPDATE_INSTALL_FIXTURE_ROOT: directory, UPDATE_FIXTURE_RECEIPT: receipt }
  delete env.ELECTRON_RUN_AS_NODE
  try {
    await execute(require('electron'), [path.resolve('tests/device-update-install-parent.mjs')], { env, windowsHide: true, timeout: 15000 })
  } catch (error) {
    t.diagnostic(await readFile(path.join(directory, 'parent-trace.txt'), 'utf8').catch(() => 'No parent trace'))
    t.diagnostic(await readFile(path.join(directory, 'handoff.json'), 'utf8').catch(() => 'No helper receipt'))
    throw error
  }
  const until = Date.now() + 10000
  let state
  while (Date.now() < until) {
    state = JSON.parse(await readFile(path.join(directory, 'handoff.json'), 'utf8').catch(() => '{}'))
    if (state.status === 'completed' || state.status === 'error') break
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  assert.equal(state.status, 'completed', 'Helper must continue beyond READY after the Electron parent exits')
  assert.equal(await readFile(receipt, 'utf8'), `/D=${directory}`)
})

test('handoff accepts only the current receipt and cancels failed or timed-out preparation', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'update-handoff-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const file = path.join(directory, "setup ' & space.exe")
  for (const mode of ['ready', 'error', 'exit', 'timeout']) {
    let killed = false, detached = false
    let config
    const launchImpl = value => {
      config = value
      assert.equal(config.Installer, file)
      const child = new EventEmitter()
      child.exitCode = null
      child.kill = () => { killed = true }; child.unref = () => { detached = true }
      void writeFile(config.Receipt, JSON.stringify({ status: 'armed', token: 'stale', pid: 123 })).then(() => {
        if (mode === 'exit') { child.emit('exit', 1); return }
        if (mode === 'timeout') return
        return writeFile(config.Receipt, JSON.stringify({ status: mode === 'ready' ? 'armed' : 'error', token: config.Token, pid: 123, code: 'verify' }))
      })
      return child
    }
    const action = prepareUpdateInstall({ file, directory, installDirectory: directory,
      manifest: { bytes: 10, sha256: 'a'.repeat(64) }, launchImpl, timeoutMs: mode === 'timeout' ? 80 : 1000 })
    if (mode === 'ready') { assert.equal((await action).pid, 123); assert.equal(detached, true); assert.equal(killed, false) }
    else { await assert.rejects(action); assert.equal(killed, true); assert.equal(await readFile(config.CancelFile, 'utf8'), '') }
  }
})

test('Windows launcher uses a hidden shell-free process and encodes paths as data', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'update-launch-options-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  await assert.rejects(prepareUpdateInstall({ directory, installDirectory: directory, file: path.join(directory, "setup ' &.exe"),
    manifest: { bytes: 1, sha256: 'a'.repeat(64) }, spawnImpl: (command, args, options) => {
      assert.equal(path.isAbsolute(command), true); assert.equal(options.shell, false)
      assert.equal(options.windowsHide, true); assert.equal(options.stdio, 'ignore')
      assert.ok(args.includes('-EncodedCommand')); assert.equal(args.join(' ').includes(directory), false)
      const child = new EventEmitter(); child.exitCode = 1
      setImmediate(() => child.emit('error', new Error('fixture launch failure')))
      return child
    } }))
})

test('real Windows helper validates cache and arms without executing while parent is alive', { skip: process.platform !== 'win32' }, async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'update-helper-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  await writeFile(path.join(directory, '.control-device-install'), 'Control Device\r\n')
  const file = path.join(directory, "setup ' & space.exe"), bytes = Buffer.from('not an executable; must never execute')
  await writeFile(file, bytes)
  const helper = await prepareUpdateInstall({ file, directory, installDirectory: directory,
    manifest: { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') } })
  assert.equal(JSON.parse(await readFile(path.join(directory, 'handoff.json'), 'utf8')).status, 'armed')
  process.kill(helper.pid)
  await new Promise(resolve => setTimeout(resolve, 100))
  // A changed cache cannot even arm the helper, so no post-exit launch is possible.
  await assert.rejects(prepareUpdateInstall({ file, directory, installDirectory: directory,
    manifest: { bytes: bytes.length, sha256: '0'.repeat(64) }, timeoutMs: 5000 }))
  assert.equal(JSON.parse(await readFile(path.join(directory, 'handoff.json'), 'utf8')).status, 'error')
})
