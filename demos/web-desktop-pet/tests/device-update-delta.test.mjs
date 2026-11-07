import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises'
import { gzipSync } from 'node:zlib'
import { createHash, randomBytes } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { createServer } from 'node:http'
import { createInstallerBlockmap } from '../electron/device-update-blockmap.mjs'
import { parseBlockmap, deltaPlan, saveBaseline } from '../electron/device-update-delta.mjs'
import { downloadInstaller } from '../electron/device-update-download.mjs'
import { DeviceUpdate } from '../electron/device-update.mjs'

const digest = bytes => createHash('sha256').update(bytes).digest('hex')

async function fixture(t, replaceAll = false, largeChange = false) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'delta-update-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const before = randomBytes(2 * 1024 ** 2), after = replaceAll ? randomBytes(before.length) : Buffer.from(before)
  after.fill(0x77, 900000, 904096)
  if (largeChange) randomBytes(1536 * 1024).copy(after, 64 * 1024)
  const make = async (payload, name) => {
    const file = path.join(directory, name)
    await writeFile(file, payload)
    const blockmap = await createInstallerBlockmap(file)
    return { payload, file, map: await readFile(blockmap.file), manifest: { version: '0.1.5', bytes: payload.length, sha256: digest(payload),
      url: 'https://updates.example.test/setup.exe', blockmap: { bytes: blockmap.bytes, sha256: blockmap.sha256, url: 'https://updates.example.test/setup.exe.blockmap' } } }
  }
  const old = await make(before, 'old-fixture.bin'), next = await make(after, 'new-fixture.bin')
  const baselineFile = path.join(directory, 'setup.exe')
  await writeFile(baselineFile, old.payload)
  assert.equal(await saveBaseline({ directory, manifest: old.manifest, blockmap: old.map }), true)
  const serverStats = { requests: [], bytes: 0, mode: 'normal' }
  const server = createServer((request, response) => {
    serverStats.requests.push(request.headers.range || request.url)
    if (request.url.endsWith('.blockmap')) { response.end(next.map); serverStats.bytes += next.map.length; return }
    const match = /^bytes=(\d+)-(\d+)$/.exec(request.headers.range || '')
    if (!match) { response.end(next.payload); serverStats.bytes += next.payload.length; return }
    if (serverStats.mode === 'stall') { request.on('close', () => response.destroy()); return }
    if (serverStats.mode === 'redirect') { response.writeHead(302, { Location: 'https://evil.example/a.exe' }).end(); return }
    if (serverStats.mode === 'no-range') { response.end(next.payload); return }
    const start = Number(match[1]), end = Number(match[2])
    if (serverStats.mode === 'limited-range' && end - start + 1 > 1024 ** 2) { response.writeHead(413).end(); return }
    const data = Buffer.from(next.payload.subarray(start, end + 1))
    if (serverStats.mode === 'corrupt') data.fill(0)
    response.writeHead(206, { 'Content-Range': `bytes ${serverStats.mode === 'bad-range' ? start + 1 : start}-${end}/${next.payload.length}`, 'Content-Length': data.length })
    response.end(data); serverStats.bytes += data.length
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => { server.closeAllConnections(); server.close() })
  // Production URL validation remains HTTPS-only. Only this injected transport
  // maps the trusted fixture URLs to a loopback HTTP range server.
  const fetchImpl = (url, options) => fetch(`http://127.0.0.1:${server.address().port}${new URL(url).pathname}`, options)
  const states = []
  const run = (options = {}) => downloadInstaller({ directory, manifest: next.manifest, fetchImpl,
    signal: AbortSignal.timeout(5000), idleMs: 1000, onProgress: value => states.push(value), ...options })
  return { directory, old, next, serverStats, states, run, fetchImpl }
}

test('real generated blockmaps produce a reusable plan and reject malformed or oversized input', async t => {
  const { old, next } = await fixture(t)
  const oldMap = parseBlockmap(old.map, old.payload.length), newMap = parseBlockmap(next.map, next.payload.length)
  const plan = deltaPlan(oldMap, newMap, old.payload.length, next.payload.length)
  assert.ok(plan.downloadBytes < next.payload.length / 10)
  assert.ok(plan.reusedBytes > next.payload.length * 0.9)
  for (const patch of [{ version: '3' }, { files: [] }, { files: [{ ...newMap.files[0], offset: 1 }] },
    { files: [{ ...newMap.files[0], sizes: [0] }] }, { files: [{ ...newMap.files[0], checksums: ['bad'] }] }]) {
    assert.throws(() => parseBlockmap(gzipSync(JSON.stringify({ ...newMap, ...patch })), next.payload.length))
  }
  assert.throws(() => parseBlockmap(gzipSync(' '.repeat(32 * 1024 ** 2 + 1)), next.payload.length))
})

test('loopback Range transfer reconstructs identical bytes with substantially less network traffic', async t => {
  const { directory, next, serverStats, run } = await fixture(t)
  const result = await run()
  assert.equal(result.mode, 'differential')
  assert.deepEqual(await readFile(path.join(directory, 'setup.exe.part')), next.payload)
  assert.ok(serverStats.bytes < next.payload.length / 10)
  assert.equal(result.networkBytes, serverStats.bytes)
  assert.ok(serverStats.requests.some(value => value.startsWith('bytes=')))
})

test('large changed regions use bounded Range requests and still verify the complete installer', async t => {
  const { directory, old, next, serverStats, run } = await fixture(t, false, true)
  const plan = deltaPlan(parseBlockmap(old.map, old.payload.length), parseBlockmap(next.map, next.payload.length), old.payload.length, next.payload.length)
  assert.ok(plan.operations.some(op => op.kind === 1 && op.end - op.start > 1024 ** 2))
  serverStats.mode = 'limited-range'
  const result = await run()
  assert.equal(result.mode, 'differential')
  assert.equal(result.fallback, false)
  assert.deepEqual(await readFile(path.join(directory, 'setup.exe.part')), next.payload)
  const ranges = serverStats.requests.filter(value => value.startsWith('bytes='))
  assert.ok(ranges.length > 1)
  assert.ok(ranges.every(value => { const [, start, end] = /^bytes=(\d+)-(\d+)$/.exec(value); return Number(end) - Number(start) + 1 <= 1024 ** 2 }))
  assert.equal(serverStats.requests.includes('/setup.exe'), false)
})

test('bad range, no range, redirect and corrupt delta fall back only once to a verified full download', async t => {
  for (const mode of ['bad-range', 'no-range', 'redirect', 'corrupt']) {
    const { directory, next, serverStats, run } = await fixture(t)
    serverStats.mode = mode
    const result = await run()
    assert.equal(result.mode, 'full', mode)
    assert.deepEqual(await readFile(path.join(directory, 'setup.exe.part')), next.payload)
    assert.equal(serverStats.requests.filter(value => value === '/setup.exe').length, 1)
  }
})

test('damaged baseline or missing blockmap falls back; cancellation and timeout never start a full download', async t => {
  const broken = await fixture(t)
  // Baseline may share a hard link with setup.exe, so modify only the owned base.
  await writeFile(path.join(broken.directory, 'base.exe'), 'broken')
  assert.equal((await broken.run()).mode, 'full')
  const missing = await fixture(t)
  await rm(path.join(missing.directory, 'base.blockmap'))
  assert.equal((await missing.run()).mode, 'full')
  for (const cancel of [true, false]) {
    const { run, serverStats } = await fixture(t)
    serverStats.mode = 'stall'
    const controller = new AbortController()
    const pending = run({ signal: controller.signal, idleMs: 50 })
    if (cancel) {
      while (!serverStats.requests.some(value => value.startsWith('bytes='))) await new Promise(resolve => setTimeout(resolve, 5))
      controller.abort('cancel')
    }
    await assert.rejects(pending)
    assert.equal(serverStats.requests.filter(value => value === '/setup.exe').length, 0)
  }
})

test('service retains one baseline across restart and never exposes blockmap bytes or paths to the renderer', async t => {
  const { directory, next, fetchImpl, serverStats } = await fixture(t)
  let latest = '0.1.5'
  const options = { directory, version: '0.1.4', platform: 'win32', arch: 'x64', url: 'https://updates.example.test/latest.json',
    fetchImpl: (url, options) => url.endsWith('/latest.json') ? Promise.resolve(Response.json({ ...next.manifest,
      version: latest, platform: 'win32', arch: 'x64' })) : fetchImpl(url, options) }
  const first = new DeviceUpdate(options)
  await first.check()
  const downloaded = await first.download()
  assert.equal(downloaded.mode, 'differential'); assert.equal(downloaded.cacheStored, true)
  assert.equal(JSON.stringify(downloaded).includes(directory), false)
  assert.equal(downloaded.blockmap, undefined)
  first.dispose()
  latest = '0.1.6'
  const restarted = new DeviceUpdate({ ...options, version: '0.1.5' })
  serverStats.requests.length = 0
  await restarted.check()
  const sameBytes = await restarted.download()
  assert.equal(sameBytes.mode, 'differential'); assert.equal(sameBytes.reusedBytes, next.payload.length)
  assert.equal(sameBytes.networkBytes, next.map.length)
  assert.equal(serverStats.requests.some(value => value.startsWith('bytes=')), false)
  assert.deepEqual(await readFile(path.join(directory, 'setup.exe')), next.payload)
  restarted.dispose()
})

test('cache write failure does not damage the verified candidate or delete unknown cache directories', async t => {
  const { directory, next } = await fixture(t)
  await writeFile(path.join(directory, 'setup.exe'), next.payload)
  await mkdir(path.join(directory, 'base.next.json'))
  assert.equal(await saveBaseline({ directory, manifest: next.manifest, blockmap: next.map }), false)
  assert.deepEqual(await readFile(path.join(directory, 'setup.exe')), next.payload)
})

test('no reusable content and invalid remote blockmaps go directly to a complete transfer', async t => {
  const replaced = await fixture(t, true)
  assert.equal((await replaced.run()).mode, 'full')
  assert.equal(replaced.serverStats.requests.some(value => value.startsWith('bytes=')), false)
  const corruptMap = await fixture(t)
  const result = await corruptMap.run({ fetchImpl: (url, options) => url.endsWith('.blockmap')
    ? Promise.resolve(new Response(Buffer.alloc(corruptMap.next.map.length))) : corruptMap.fetchImpl(url, options) })
  assert.equal(result.mode, 'full')
  assert.equal(result.blockmap, null)
  assert.deepEqual(await readFile(path.join(corruptMap.directory, 'setup.exe.part')), corruptMap.next.payload)
})
