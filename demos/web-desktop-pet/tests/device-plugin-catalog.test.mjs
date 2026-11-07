import assert from 'node:assert/strict'
import test from 'node:test'
import { OnlinePluginCatalog, PLUGIN_CATALOG_URL } from '../electron/device-plugin-catalog.mjs'

const plugin = { id: 'sample', name: '示例插件', version: '1.0.0', description: '<img src=x onerror=alert(1)>' }
const response = plugins => Response.json({ schema: 1, plugins })

test('queries the fixed public catalog without credentials, filters unavailable entries and returns text metadata only', async () => {
  const catalog = new OnlinePluginCatalog({ fetchImpl: async (url, options) => {
    assert.equal(url, PLUGIN_CATALOG_URL)
    assert.equal(url, 'https://download.aibanlv.ai/desktop-plugins/catalog.json')
    assert.equal(options.redirect, 'error'); assert.equal(options.credentials, 'omit'); assert.equal(options.cache, 'no-store')
    assert.equal(options.headers.Authorization, undefined)
    return response([{ ...plugin, downloadUrl: 'https://example.invalid/file.zip', entry: 'run.js' },
      { id: 'hidden', name: '已下架', enabled: false }, { id: 'minimal', name: '最小条目' }])
  } })
  assert.deepEqual(await catalog.query(), { ok: true, plugins: [plugin, { id: 'minimal', name: '最小条目', version: '', description: '' }] })
})

test('coalesces simultaneous reads and queries again after completion so publication changes become visible', async () => {
  let release, reads = 0
  const gate = new Promise(resolve => { release = resolve })
  const catalog = new OnlinePluginCatalog({ fetchImpl: async () => { reads++; await gate; return response(reads === 1 ? [plugin] : []) } })
  const first = catalog.query(), second = catalog.query()
  release()
  assert.deepEqual(await first, await second); assert.equal(reads, 1)
  assert.deepEqual(await catalog.query(), { ok: true, plugins: [] }); assert.equal(reads, 2)
})

test('distinguishes a missing catalog from an empty catalog and transport failure', async () => {
  for (const [status, code] of [[404, 'NOT_PUBLISHED'], [403, 'UNAVAILABLE'], [500, 'UNAVAILABLE']]) {
    const catalog = new OnlinePluginCatalog({ fetchImpl: async () => new Response('', { status }) })
    assert.deepEqual(await catalog.query(), { ok: false, code })
  }
  assert.deepEqual(await new OnlinePluginCatalog({ fetchImpl: async () => response([]) }).query(), { ok: true, plugins: [] })
  assert.deepEqual(await new OnlinePluginCatalog({ fetchImpl: async () => { throw new Error('network failed') } }).query(), { ok: false, code: 'UNAVAILABLE' })
})

test('rejects malformed catalogs, duplicate identifiers, oversized fields and nonboolean availability', async () => {
  const values = [null, {}, { schema: 2, plugins: [] }, { schema: 1, plugins: {} },
    { schema: 1, plugins: [plugin, plugin] }, { schema: 1, plugins: [{ ...plugin, name: '' }] },
    { schema: 1, plugins: [{ ...plugin, id: '../file' }] }, { schema: 1, plugins: [{ ...plugin, enabled: 'false' }] },
    { schema: 1, plugins: [{ ...plugin, version: 1 }] }, { schema: 1, plugins: [{ ...plugin, description: 'a'.repeat(2001) }] },
    { schema: 1, plugins: Array.from({ length: 201 }, (_, i) => ({ ...plugin, id: `plugin-${i}` })) }]
  for (const value of values) {
    const catalog = new OnlinePluginCatalog({ fetchImpl: async () => Response.json(value) })
    assert.deepEqual(await catalog.query(), { ok: false, code: 'INVALID_CATALOG' })
  }
  assert.deepEqual(await new OnlinePluginCatalog({ fetchImpl: async () => new Response('<html>error</html>') }).query(), { ok: false, code: 'INVALID_CATALOG' })
})

test('bounds both declared and streamed response sizes', async () => {
  for (const headers of [{}, { 'Content-Length': String(256 * 1024 + 1) }]) {
    const catalog = new OnlinePluginCatalog({ fetchImpl: async () => new Response('x'.repeat(256 * 1024 + 1), { headers }) })
    assert.deepEqual(await catalog.query(), { ok: false, code: 'INVALID_CATALOG' })
  }
})

test('aborts stalled reads and allows retry after timeout', async () => {
  let reads = 0
  const catalog = new OnlinePluginCatalog({ timeoutMs: 20, fetchImpl: async (_url, { signal }) => {
    if (reads++) return response([])
    return new Promise((resolve, reject) => {
      const keepAlive = setTimeout(() => reject(new Error('timeout was not enforced')), 1000)
      signal.addEventListener('abort', () => { clearTimeout(keepAlive); reject(signal.reason) }, { once: true })
    })
  } })
  assert.deepEqual(await catalog.query(), { ok: false, code: 'UNAVAILABLE' })
  assert.deepEqual(await catalog.query(), { ok: true, plugins: [] })
})
