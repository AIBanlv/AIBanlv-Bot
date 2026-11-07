import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { DEFAULT_UPDATE_URL, checkDesktopUpdate, desktopVersion, DeviceUpdate } from '../electron/device-update.mjs'

const payload = Buffer.from('local installer fixture')
const manifest = () => ({ version: '0.1.5', platform: 'win32', arch: 'x64',
  url: new URL('AIBanlv-0.1.5-win-x64-Setup.exe', DEFAULT_UPDATE_URL).href,
  bytes: payload.length, sha256: createHash('sha256').update(payload).digest('hex'), notes: '更新说明' })

test('Cloudflare is the default feed and an explicit legacy feed remains supported', async () => {
  assert.equal(DEFAULT_UPDATE_URL, 'https://download.aibanlv.ai/desktop-updates/windows/x64/latest.json')
  const legacy = 'https://zhanlvgpt.ieasysell.com/desktop-updates/windows/x64/latest.json'
  const result = await checkDesktopUpdate({ version: '0.1.4', url: legacy,
    fetchImpl: async url => {
      assert.equal(url, legacy)
      return Response.json({ ...manifest(), url: new URL('Setup.exe', legacy).href })
    } })
  assert.equal(result.ok, true)
  assert.equal(result.available, true)
  assert.equal(new URL(result.manifest.url).origin, new URL(legacy).origin)
})

test('development reads application manifest, packaged app uses packaged version', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'update-version-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const file = path.join(directory, 'package.json')
  await writeFile(file, '{"version":"0.1.4"}')
  assert.equal(await desktopVersion({ isPackaged: false, version: '44.9.0', file }), '0.1.4')
  assert.equal(await desktopVersion({ isPackaged: true, version: '0.2.0', file }), '0.2.0')
})

test('default feed checks versions numerically and distinguishes errors from no update', async () => {
  for (const [version, available] of [['0.1.4', true], ['0.1.5', false], ['0.1.10', false]]) {
    const result = await checkDesktopUpdate({ version, fetchImpl: async (url, options) => {
      assert.equal(url, DEFAULT_UPDATE_URL); assert.equal(options.redirect, 'error')
      return Response.json(manifest())
    } })
    assert.equal(result.ok, true); assert.equal(result.available, available)
    assert.equal(result.manifest.sha256, manifest().sha256)
  }
  assert.match((await checkDesktopUpdate({ version: '0.1.4', fetchImpl: async () => new Response('', { status: 404 }) })).message, /404/)
  assert.equal((await checkDesktopUpdate({ version: '0.1.4', platform: 'darwin' })).ok, false)
})

test('invalid source, metadata, platform, architecture and download origins are rejected', async () => {
  let calls = 0
  for (const url of ['http://bad.example/a', 'https://user:pass@example.com/a', 'https://example.com/a#x']) {
    assert.equal((await checkDesktopUpdate({ version: '0.1.4', url, fetchImpl: async () => { calls++ } })).ok, false)
  }
  assert.equal(calls, 0)
  for (const patch of [{ platform: 'darwin' }, { arch: 'arm64' }, { bytes: 0 }, { bytes: 20 * 1024 ** 3 },
    { sha256: 'fake' }, { version: '1.2.3-beta' }, { version: '999999999999999999999.0.0' },
    { url: 'https://evil.example/installer.exe' }, { url: 'http://zhanlvgpt.ieasysell.com/a.exe' },
    { url: 'https://u:p@zhanlvgpt.ieasysell.com/a.exe' }, { url: 'https://zhanlvgpt.ieasysell.com/a.exe#x' }]) {
    const result = await checkDesktopUpdate({ version: '0.1.4', fetchImpl: async () => Response.json({ ...manifest(), ...patch }) })
    assert.equal(result.ok, false, JSON.stringify(patch))
  }
  const oversized = await checkDesktopUpdate({ version: '0.1.4', fetchImpl: async () => new Response(' '.repeat(65537)) })
  assert.equal(oversized.ok, false)
})

test('optional blockmap descriptors are bounded and same-origin, while old feeds remain supported', async () => {
  const blockmap = { url: `${manifest().url}.blockmap`, bytes: 1200, sha256: 'a'.repeat(64) }
  const valid = await checkDesktopUpdate({ version: '0.1.4', fetchImpl: async () => Response.json({ ...manifest(), blockmap }) })
  assert.deepEqual(valid.manifest.blockmap, blockmap)
  for (const patch of [{ bytes: 0 }, { bytes: 8 * 1024 ** 2 + 1 }, { sha256: 'fake' },
    { url: 'https://evil.example/a.blockmap' }, { url: 'http://zhanlvgpt.ieasysell.com/a.blockmap' },
    { url: `${manifest().url}.blockmap#x` }]) {
    assert.equal((await checkDesktopUpdate({ version: '0.1.4', fetchImpl: async () => Response.json({ ...manifest(), blockmap: { ...blockmap, ...patch } }) })).ok, false)
  }
})

async function updater(t, overrides = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'update-download-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const states = [], installs = []
  const service = new DeviceUpdate({ directory, version: '0.1.4', platform: 'win32', arch: 'x64', installed: true,
    fetchImpl: async url => url === DEFAULT_UPDATE_URL ? Response.json(manifest()) : new Response(payload),
    onState: value => states.push(value), handoff: async file => installs.push(file), ...overrides })
  t.after(() => service.dispose())
  return { service, directory, states, installs }
}

test('download verifies bytes and hash before becoming installable; rechecks tampered cache', async t => {
  const { service, directory, states, installs } = await updater(t)
  assert.equal((await service.download()).ok, false)
  assert.equal((await service.check()).status, 'available')
  assert.equal((await service.download()).status, 'ready')
  assert.equal(service.snapshot().runMode, 'installed')
  assert.equal(service.snapshot().mode, 'full', 'download mode is independent from the app run mode')
  assert.deepEqual(await readFile(path.join(directory, 'setup.exe')), payload)
  assert.ok(states.some(state => state.received === payload.length))
  assert.equal(states.some(state => JSON.stringify(state).includes(directory)), false)
  await writeFile(path.join(directory, 'setup.exe'), 'tampered')
  assert.equal((await service.install()).ok, false)
  assert.equal(installs.length, 0)
})

test('only a verified installed Windows package can hand off installation once', async t => {
  const { service, installs } = await updater(t)
  await service.check(); await service.download()
  assert.equal((await service.install()).status, 'installing')
  assert.equal((await service.install()).ok, false)
  assert.equal(installs.length, 1)
  const dev = await updater(t, { installed: false })
  await dev.service.check(); await dev.service.download()
  assert.equal((await dev.service.install()).ok, false)
  assert.equal(dev.installs.length, 0)
})

test('pending install preparation rejects concurrent checks and downloads; failed handoff is retryable', async t => {
  let finish, entered
  const started = new Promise(resolve => { entered = resolve })
  const pending = new Promise((_resolve, reject) => { finish = reject })
  const { service } = await updater(t, { handoff: async () => { entered(); return pending } })
  await service.check(); await service.download()
  const installation = service.install()
  assert.equal(service.snapshot().status, 'preparing')
  assert.equal((await service.check()).ok, false)
  assert.equal((await service.download()).ok, false)
  assert.equal((await service.install()).ok, false)
  await started
  finish(new Error('helper failed'))
  assert.equal((await installation).ok, false)
  assert.equal(service.snapshot().canDownload, true)
})

test('truncated, oversized, failed and corrupt downloads clean files and never permit installation', async t => {
  for (const response of [() => new Response('x'), () => new Response(Buffer.alloc(payload.length + 1)),
    () => new Response(Buffer.alloc(payload.length)), () => new Response('', { status: 500 }),
    () => new Response(payload, { status: 206 }), () => new Response(payload, { headers: { 'content-length': '999' } })]) {
    const { service, directory, installs } = await updater(t, { fetchImpl: async url => url === DEFAULT_UPDATE_URL ? Response.json(manifest()) : response() })
    await service.check()
    assert.equal((await service.download()).ok, false)
    assert.deepEqual(await readdir(directory), [])
    assert.equal((await service.install()).ok, false); assert.equal(installs.length, 0)
  }
})

test('cancel and idle timeout terminate stalled streams; concurrent operations cannot replace a download', async t => {
  for (const cancel of [true, false]) {
    let started
    const streaming = new Promise(resolve => { started = resolve })
    const { service, directory } = await updater(t, { idleMs: 30, fetchImpl: async url => url === DEFAULT_UPDATE_URL
      ? Response.json(manifest()) : (started(), new Response(new ReadableStream({ pull() { return new Promise(() => {}) } }))) })
    await service.check()
    const pending = service.download()
    await streaming
    assert.equal((await service.download()).ok, false)
    assert.equal((await service.check()).ok, false)
    if (cancel) service.cancel()
    assert.equal((await pending).ok, false)
    assert.match(service.snapshot().message, cancel ? /取消/ : /超时/)
    assert.deepEqual(await readdir(directory), [])
  }
})
