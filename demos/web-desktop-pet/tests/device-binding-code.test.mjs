import test from 'node:test'
import assert from 'node:assert/strict'
import { bindingCode, parseBindingCode } from '../electron/device-binding-code.mjs'

test('aggregate QR opens the exact HTTPS landing page and keeps pairing secret out of query/referrer', () => {
  const offer = { deviceId: 'zhanlv:desktop-fixture', bindToken: 'private+token/&', expireAt: Date.now() + 60000 }
  const link = bindingCode(offer), url = new URL(link)
  assert.equal(url.origin + url.pathname, 'https://aibanlv.ai/')
  assert.equal(url.searchParams.get('deviceCode'), offer.deviceId)
  assert.equal(url.searchParams.has('bindToken'), false)
  assert.deepEqual(parseBindingCode(link), { deviceId: offer.deviceId, bindToken: offer.bindToken })
  assert.deepEqual(parseBindingCode(JSON.stringify(offer)), { deviceId: offer.deviceId, bindToken: offer.bindToken })
  assert.deepEqual(parseBindingCode(offer.deviceId), { deviceId: offer.deviceId, bindToken: '' })
})
test('expired, malformed or spoofed aggregate QR cannot initiate binding', () => {
  const offer = { deviceId: 'zhanlv:desktop-fixture', bindToken: 'secret', expireAt: Date.now() - 1 }
  assert.throws(() => parseBindingCode(bindingCode(offer)), /expired/)
  for (const link of ['https://aibanlv.ai.evil.test/?deviceCode=zhanlv:test', 'http://aibanlv.ai/?deviceCode=zhanlv:test',
    'https://aibanlv.ai/other?deviceCode=zhanlv:test', 'https://aibanlv.ai/?deviceCode=%QQ', '{broken']) assert.throws(() => parseBindingCode(link))
})
