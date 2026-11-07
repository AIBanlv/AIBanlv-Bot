import test from 'node:test'
import assert from 'node:assert/strict'
import { releaseManifest } from '../electron/device-update-release.mjs'
import { DEFAULT_UPDATE_URL } from '../electron/device-update.mjs'

test('release URLs follow the Cloudflare default or the explicitly selected transition feed', () => {
  const name = 'AIBanlv-0.2.3-win-x64-Setup.exe'
  const build = { installer: name, version: '0.2.3', bytes: 1234, sha256: 'a'.repeat(64),
    blockmap: { file: `${name}.blockmap`, bytes: 200, sha256: 'b'.repeat(64) } }
  const feeds = ['https://download.aibanlv.ai/desktop-updates/windows/x64/latest.json',
    'https://zhanlvgpt.ieasysell.com/desktop-updates/windows/x64/latest.json']
  for (const [index, feed] of feeds.entries()) {
    const manifest = releaseManifest(build, index ? { feedUrl: feed } : {})
    assert.equal(manifest.url, new URL(name, feed).href)
    assert.equal(manifest.blockmap.url, new URL(`${name}.blockmap`, feed).href)
  }
})

test('public release metadata derives version, filename, size and hash without local build paths', () => {
  const build = { installer: 'F:/private/build/AIBanlv-0.1.5-win-x64-Setup.exe', version: '0.1.5',
    bytes: 1234, sha256: 'a'.repeat(64), unsigned: true }
  const result = releaseManifest(build, { notes: '本次更新' })
  assert.equal(result.url, new URL('AIBanlv-0.1.5-win-x64-Setup.exe', DEFAULT_UPDATE_URL).href)
  assert.equal(result.sha256, build.sha256); assert.equal(result.bytes, build.bytes)
  assert.equal(result.version, build.version); assert.equal(result.notes, '本次更新')
  assert.equal(JSON.stringify(result).includes('private'), false)
  assert.throws(() => releaseManifest({ ...build, sha256: 'fake' }))
  assert.throws(() => releaseManifest({ ...build, installer: 'Wrong-0.1.4.exe' }))
  const blockmap = { file: `${build.installer}.blockmap`, bytes: 200, sha256: 'b'.repeat(64) }
  const differential = releaseManifest({ ...build, blockmap })
  assert.deepEqual(differential.blockmap, { url: `${result.url}.blockmap`, bytes: 200, sha256: blockmap.sha256 })
  assert.equal(JSON.stringify(differential).includes('private'), false)
})
