import test from 'node:test'
import assert from 'node:assert/strict'
import { microphonePermission } from '../electron/device-media-policy.mjs'

test('only the explicitly enabled pet main frame can request or check audio permission', () => {
  const petUrl = 'http://127.0.0.1:1234/device/device-pet.html'
  const contents = { getURL: () => petUrl }
  const base = { contents, expected: contents, petUrl, permission: 'media', enabled: true,
    details: { requestingUrl: petUrl, isMainFrame: true, mediaTypes: ['audio'], mediaType: 'audio' } }
  assert.equal(microphonePermission(base), true)
  assert.equal(microphonePermission({ ...base, check: true }), true)
  for (const patch of [{ enabled: false }, { contents: null }, { contents: { getURL: () => petUrl } }, { permission: 'camera' },
    { details: { ...base.details, requestingUrl: `${petUrl}?other` } }, { details: { ...base.details, isMainFrame: false } },
    { details: { ...base.details, mediaTypes: ['audio', 'video'] } }, { details: { ...base.details, mediaTypes: [] } }]) {
    assert.equal(microphonePermission({ ...base, ...patch }), false)
  }
  assert.equal(microphonePermission({ ...base, check: true, details: { ...base.details, mediaType: 'video' } }), false)
  assert.equal(microphonePermission({ ...base, check: true, details: { ...base.details, mediaType: 'unknown' } }), false)
})
