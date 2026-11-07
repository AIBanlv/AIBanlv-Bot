import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { registerDesktop, launchDesktop, pauseAutomaticLaunch, setAutomaticLaunch, launchStatus } from '../harness-client-plugin/desktop-launch.mjs'

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'aibanlv 启动 & '))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const root = path.join(directory, 'source with spaces'), executable = path.join(root, 'node_modules/electron/dist/electron.exe')
  await mkdir(path.dirname(executable), { recursive: true })
  await mkdir(path.join(root, 'electron'))
  await writeFile(executable, 'fixture'); await writeFile(path.join(root, 'electron/device-main.mjs'), '')
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'control-web-desktop-pet-demo' }))
  const launches = []
  const spawnImpl = (...args) => {
    launches.push(args)
    const child = new EventEmitter(); child.unref = () => {}
    queueMicrotask(() => child.emit('spawn')); return child
  }
  return { directory, root, executable, launches, spawnImpl, platform: 'win32' }
}

test('source launches use fixed arguments and scrub the host Node environment', async t => {
  const f = await fixture(t)
  await registerDesktop({ ...f, isPackaged: false })
  const result = await launchDesktop({ ...f, automatic: true, env: { PATH: 'fixture', ELECTRON_RUN_AS_NODE: '1', NODE_OPTIONS: '--require hostile.js' } })
  assert.equal(result.status, 'launched')
  const [executable, args, options] = f.launches[0]
  assert.equal(executable, f.executable)
  assert.deepEqual(args, [path.join(f.root, 'electron/device-main.mjs'), '--aibanlv-auto-start'])
  assert.equal(options.shell, false); assert.equal(options.detached, true); assert.equal(options.windowsHide, true)
  assert.equal(options.env.ELECTRON_RUN_AS_NODE, undefined); assert.equal(options.env.NODE_OPTIONS, undefined)
  assert.equal(options.env.PATH, 'fixture')
})

test('explicit quit pauses new automatic launches until manual open, without enabling a disabled preference', async t => {
  const f = await fixture(t)
  await registerDesktop({ ...f, isPackaged: false })
  pauseAutomaticLaunch(f.directory)
  assert.equal((await launchDesktop({ ...f, automatic: true })).status, 'paused')
  assert.equal(f.launches.length, 0)
  assert.equal((await launchDesktop(f)).status, 'launched')
  assert.equal((await launchDesktop({ ...f, automatic: true })).status, 'launched')
  await setAutomaticLaunch(false, f.directory)
  await registerDesktop({ ...f, isPackaged: false })
  assert.equal((await launchDesktop({ ...f, automatic: true })).status, 'disabled')
  assert.equal((await launchDesktop(f)).status, 'launched')
  assert.equal((await launchStatus(f.directory)).autoStart, false)
})

test('unconfigured, broken and arbitrary launch targets never spawn', async t => {
  const f = await fixture(t)
  assert.equal((await launchDesktop({ ...f, automatic: true })).status, 'unconfigured')
  await writeFile(path.join(f.directory, 'desktop-launch.json'), JSON.stringify({ version: 1, kind: 'app', executable: 'cmd.exe', autoStart: true }))
  await assert.rejects(launchDesktop({ ...f, automatic: true }), /INVALID_LAUNCH_TARGET/)
  await registerDesktop({ ...f, isPackaged: false })
  await rm(f.executable)
  await assert.rejects(launchDesktop({ ...f, automatic: true }), /LAUNCH_TARGET_MISSING/)
  assert.equal(f.launches.length, 0)
})

test('packaged target is independent of a cached plugin directory and has no source arguments', async t => {
  const f = await fixture(t)
  const executable = path.join(f.directory, 'AIBanlv.exe'); await writeFile(executable, 'fixture')
  await registerDesktop({ ...f, executable, isPackaged: true })
  await launchDesktop({ ...f, automatic: true })
  assert.equal(f.launches[0][0], executable)
  assert.deepEqual(f.launches[0][1], ['--aibanlv-auto-start'])
  assert.equal(await readFile(path.join(f.directory, 'desktop-launch-runtime'), 'utf8'), executable)
})

test('a failed spawn remains a visible failure rather than a successful launch', async t => {
  const f = await fixture(t)
  await registerDesktop({ ...f, isPackaged: false })
  await assert.rejects(launchDesktop({ ...f, spawnImpl: () => {
    const child = new EventEmitter(); queueMicrotask(() => child.emit('error', new Error('ENOENT'))); return child
  } }), /ENOENT/)
})

test('concurrent manual activations keep a complete launch registration', async t => {
  const f = await fixture(t)
  await Promise.all(Array.from({ length: 6 }, () => registerDesktop({ ...f, isPackaged: false })))
  assert.equal((await launchStatus(f.directory)).configured, true)
  const mcp = JSON.parse(await readFile(path.join(f.directory, 'desktop-mcp-config.json'), 'utf8'))
  assert.equal(mcp.mcpServers.aibanlv.command, f.executable)
})
