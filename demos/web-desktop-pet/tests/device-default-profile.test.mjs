import test from 'node:test'
import assert from 'node:assert/strict'
import { loadDefaultProfile } from '../electron/device-default-profile.mjs'

const waner = { id: 'public-waner', name: 'waner', tenantId: '1',
  digitalHumanId: 'model-waner', voiceId: 'original-voice', languageCode: 'zh' }
const catalog = roles => async (url, options) => {
  assert.equal(new URL(url).pathname, '/jwt/client/desktop-public/roles')
  assert.equal(options.redirect, 'error')
  assert.equal(options.credentials, 'omit')
  return Response.json({ data: roles })
}

test('default uses the public waner catalog record and Control ZIP layout, preserving its voice', async () => {
  const profile = await loadDefaultProfile(undefined, catalog([
    { ...waner, id: 'private', tenantId: 'other' }, waner,
  ]))
  assert.equal(profile.agentId, 'public-waner')
  assert.equal(profile.agentName, '上官婉儿')
  assert.equal(profile.publicAvatar, true)
  assert.equal(profile.voiceId, 'original-voice')
  assert.equal(profile.zipUrl, 'https://zhanlvgpt.ieasysell.com/1/model-waner/model-waner.zip')
  assert.equal(profile.profileVersion, 0)
})

test('explicit supported ZIP URL wins; untrusted URL and ambiguous/missing catalog are rejected', async () => {
  const zipUrl = 'https://qn.ieasysell.com/waner.zip'
  assert.equal((await loadDefaultProfile(undefined, catalog([{ ...waner, zipUrl }]))).zipUrl, zipUrl)
  for (const roles of [[], [waner, waner], [{ ...waner, tenantId: 'other' }],
    [{ ...waner, zipUrl: 'https://evil.example/waner.zip' }], [{ ...waner, digitalHumanId: '' }]]) {
    await assert.rejects(loadDefaultProfile(undefined, catalog(roles)))
  }
})

test('catalog errors and oversized responses fail; lookup cancellation reaches transport', async () => {
  await assert.rejects(loadDefaultProfile(undefined, async () => new Response('', { status: 503 })))
  await assert.rejects(loadDefaultProfile(undefined, async () => new Response('x'.repeat(1024 * 1024 + 1))))
  const abort = new AbortController()
  abort.abort()
  await assert.rejects(loadDefaultProfile(abort.signal, async (_url, options) => {
    options.signal.throwIfAborted()
  }))
})
