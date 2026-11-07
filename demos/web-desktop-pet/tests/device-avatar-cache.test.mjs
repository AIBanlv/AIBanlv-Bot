import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DeviceAvatarCache } from '../electron/device-avatar-cache.mjs'
import { archiveFixture } from './avatar-fixture.mjs'

const url = 'https://qn.ieasysell.com/avatar.zip?token=private-signed-value'
async function fixture(t, options = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'control-avatar-cache-'))
  t.after(() => rm(directory, { force: true, recursive: true }))
  return { directory, cache: new DeviceAvatarCache({ directory, ...options }) }
}
test('validated avatar persists across runtime restart, with no raw account, URL or signed token in filenames', async t => {
  const { cache, directory } = await fixture(t), bytes = archiveFixture()
  await cache.put(url, 'tenant-owner', bytes)
  const restarted = new DeviceAvatarCache({ directory })
  assert.deepEqual(await restarted.get(url, 'tenant-owner'), bytes)
  assert.equal(await restarted.get(url, 'other-owner'), null)
  assert.equal(await restarted.get(url + '2', 'tenant-owner'), null)
  assert.ok((await readdir(directory)).every(name => /^[a-f0-9]{64}-[a-f0-9]{64}\.zip$/.test(name)))
})
test('corrupt caches are misses, unsafe URLs/invalid archives cannot populate cache, cancellation wins', async t => {
  const { cache, directory } = await fixture(t), bytes = archiveFixture()
  await cache.put(url, 'account', bytes)
  const file = path.join(directory, (await readdir(directory))[0])
  const corrupt = Buffer.from(bytes); corrupt[40] ^= 1; await writeFile(file, corrupt)
  assert.equal(await cache.get(url, 'account'), null)
  await assert.rejects(cache.put(url, 'account', Buffer.from('not a ZIP')))
  assert.throws(() => cache.put('https://evil.test/a.zip', 'account', bytes))
  const abort = new AbortController(); abort.abort()
  await assert.rejects(cache.get(url, 'account', abort.signal))
  await assert.rejects(cache.put(url, 'account', bytes, abort.signal))
})
test('disk LRU is bounded across accounts and removes only owned cache entries', async t => {
  const { cache, directory } = await fixture(t, { maxEntries: 2 }), bytes = archiveFixture()
  await writeFile(path.join(directory, 'unrelated.txt'), 'preserve')
  for (const owner of ['one', 'two', 'three']) await cache.put(url, owner, bytes)
  assert.equal((await readdir(directory)).filter(name => name.endsWith('.zip')).length, 2)
  assert.ok((await readdir(directory)).includes('unrelated.txt'))
})
