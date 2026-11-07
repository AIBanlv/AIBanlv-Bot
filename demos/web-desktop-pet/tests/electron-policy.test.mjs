import assert from 'node:assert/strict'
import test from 'node:test'
import { petSize, constrainBounds, hitPet, validRelay, trustedSender } from '../electron/policy.mjs'

test('desktop bounds preserve negative monitor coordinates and keep pet in work area', () => {
  const area = { x: -1920, y: 20, width: 1920, height: 1040 }
  assert.deepEqual(constrainBounds({ x: -2100, y: 1000, width: 300, height: 491 }, area),
    { x: -1920, y: 569, width: 300, height: 491 })
  assert.deepEqual(petSize(300), { width: 300, height: 491 })
  assert.throws(() => petSize(NaN))
  assert.throws(() => petSize(10000))
})

test('transparent caption margins pass clicks through while figure and toolbar remain interactive', () => {
  assert.equal(hitPet(0, 0, 300), false)
  assert.equal(hitPet(150, 60, 300), false)
  assert.equal(hitPet(150, 270, 300), true)
  assert.equal(hitPet(1, 130, 300), false)
  assert.equal(hitPet(150, 468, 300), true)
})

test('relay accepts bounded avatar messages, rejects unknown types and channels', () => {
  assert.equal(validRelay({ type: 'expression', weights: { jawOpen: 0.5 }, pose: null, pipeline: 'raw', speaking: true }), true)
  for (const data of [
    { type: 'expression', weights: { unknown: 0.5 }, speaking: true },
    { type: 'expression', weights: { jawOpen: Infinity }, speaking: true },
    { type: 'caption', text: 'a'.repeat(33) },
    { type: 'shell', command: 'anything' },
  ]) assert.equal(validRelay(data), false)
  assert.equal(validRelay({ type: 'caption', text: 'Hello', label: 'Preview' }), true)
})

test('privileged bridge accepts only the exact window and main frame', () => {
  const frame = { url: 'http://127.0.0.1:1234/desktop/controller.html' }
  const sender = { mainFrame: frame }
  const win = { webContents: sender, isDestroyed: () => false }
  assert.equal(trustedSender({ sender, senderFrame: frame }, win, frame.url), true)
  assert.equal(trustedSender({ sender, senderFrame: { ...frame } }, win, frame.url), false)
  assert.equal(trustedSender({ sender, senderFrame: frame }, win, 'http://evil.example/'), false)
})
