import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { assetUrl, validateAvatarZip, downloadAvatar, prepareLocalAvatar } from '../electron/device-assets.mjs'
import { archiveFixture } from './avatar-fixture.mjs'

test('asset URL policy rejects local files, credentials, other hosts and insecure transport', () => {
  assert.equal(assetUrl('https://qn.ieasysell.com/avatar.zip?download=1').hostname, 'qn.ieasysell.com')
  for (const url of ['file:///C:/secret.zip', 'http://qn.ieasysell.com/avatar.zip',
    'https://qn.ieasysell.com.evil.test/a.zip', 'https://127.0.0.1/a.zip',
    'https://user:pass@qn.ieasysell.com/a.zip', 'https://qn.ieasysell.com:444/a.zip']) {
    assert.throws(() => assetUrl(url))
  }
})

test('validates the renderer archive structure, rejects malformed input and incompatible package', async () => {
  const data = process.env.PET_TEST_AVATAR_ZIP ? await readFile(process.env.PET_TEST_AVATAR_ZIP) : archiveFixture()
  const result = await validateAvatarZip(data)
  assert.ok(result.expandedBytes > 1000)
  assert.ok(result.files.includes('oac/skin.glb'))
  await assert.rejects(validateAvatarZip(Buffer.from('not an avatar')))
  const invalid = Buffer.from(data)
  // Change both local and central file names without changing their lengths.
  for (let pos = invalid.indexOf('skin.glb'); pos >= 0; pos = invalid.indexOf('skin.glb', pos + 8)) {
    invalid.write('nope.glb', pos)
  }
  await assert.rejects(validateAvatarZip(invalid), { code: 'LAM_FILES_MISSING' })
})

test('LAM packages accept root or nested avatar files but reject incomplete or ambiguous roots', async () => {
  for (const prefix of ['', 'oac/', 'assets/role/']) {
    const result = await validateAvatarZip(archiveFixture(prefix))
    assert.ok(result.files.includes(`${prefix}skin.glb`))
    const prepared = await validateAvatarZip(await prepareLocalAvatar(archiveFixture(prefix)))
    assert.ok(prepared.files.includes('oac/skin.glb'))
    assert.equal(prepared.files.at(-1), 'oac/', 'The renderer must select the explicit avatar directory')
  }
  await assert.rejects(validateAvatarZip(archiveFixture('', ['skin.glb', 'animation.glb', 'offset.ply'])), { code: 'LAM_FILES_MISSING' })
  await assert.rejects(validateAvatarZip(archiveFixture('', ['skin.glb', 'animation.glb', 'offset.ply', 'vertex_order.json', 'other/skin.glb'])), { code: 'LAM_FILES_MISSING' })
})

test('local avatar normalization includes only entries whose data passed validation', async () => {
  const data = archiveFixture('oac/', ['skin.glb', 'animation.glb', 'offset.ply', 'vertex_order.json', 'unchecked.txt'])
  // The two ZIP entry counts disagree; the unvalidated fifth entry must never be imported.
  data.writeUInt16LE(4, data.length - 22 + 10)
  const checked = await validateAvatarZip(data)
  assert.equal(checked.files.includes('oac/unchecked.txt'), false)
  const prepared = await validateAvatarZip(await prepareLocalAvatar(data))
  assert.deepEqual(prepared.files, [...checked.files, 'oac/'])
  assert.equal(prepared.expandedBytes, checked.expandedBytes)
})

test('downloads are bounded, cancelable, reject redirects and never fetch disallowed URLs', async () => {
  let requests = 0
  const fetcher = async (_url, options) => {
    requests++
    assert.equal(options.redirect, 'error')
    assert.ok(options.signal)
    return new Response('too large', { headers: { 'content-length': String(70 * 1024 * 1024) } })
  }
  await assert.rejects(downloadAvatar('https://localhost/private.zip', { fetcher }))
  assert.equal(requests, 0)
  await assert.rejects(downloadAvatar('https://qn.ieasysell.com/avatar.zip', { fetcher }), /large/i)
})

test('transient CDN connection failures retry the exact allowed asset and validate the completed ZIP', async () => {
  let calls = 0
  const retries = []
  const data = archiveFixture()
  const result = await downloadAvatar('https://qn.ieasysell.com/avatar.zip', { retryMs: 0,
    onRetry: value => retries.push(value.attempt), fetcher: async () => {
      if (++calls < 3) throw new TypeError('fetch failed', { cause: { code: 'UND_ERR_CONNECT_TIMEOUT' } })
      return new Response(data)
    } })
  assert.deepEqual(result, data)
  assert.deepEqual(retries, [2, 3])
  assert.equal(calls, 3)
})

test('bad archives and missing assets do not retry, while server failures have a bounded retry count', async () => {
  let calls = 0
  await assert.rejects(downloadAvatar('https://qn.ieasysell.com/a.zip', { retryMs: 0,
    fetcher: async () => { calls++; return new Response('bad ZIP') } }), { code: 'AVATAR_ARCHIVE' })
  assert.equal(calls, 1)
  calls = 0
  await assert.rejects(downloadAvatar('https://qn.ieasysell.com/a.zip', { retryMs: 0,
    fetcher: async () => { calls++; return new Response('', { status: 404 }) } }), { code: 'AVATAR_HTTP' })
  assert.equal(calls, 1)
  calls = 0
  await assert.rejects(downloadAvatar('https://qn.ieasysell.com/a.zip', { retryMs: 0,
    fetcher: async () => { calls++; return new Response('', { status: 503 }) } }), { code: 'AVATAR_NETWORK' })
  assert.equal(calls, 3)
})

test('cancelling between CDN attempts prevents another network request', async () => {
  let calls = 0
  const abort = new AbortController()
  await assert.rejects(downloadAvatar('https://qn.ieasysell.com/a.zip', { signal: abort.signal,
    onRetry: () => abort.abort(), fetcher: async () => {
      calls++; throw new TypeError('fetch failed', { cause: { code: 'ECONNRESET' } })
    } }))
  assert.equal(calls, 1)
})
