import assert from 'node:assert/strict'
import test from 'node:test'
import { names, validateClip, sampleExpression, speechCaption, blendPreset } from '../src/expression.mjs'

function fixture() {
  return { version: 1, fps: 30, duration: 0.1, names,
    frames: [Array(52).fill(0), Array(52).fill(1), Array(52).fill(0.5)],
    captions: [{ start: 0, end: 0.05, text: 'First' }, { start: 0.05, end: 0.1, text: 'Second' }] }
}

test('samples coefficients from audio time with linear interpolation', () => {
  const clip = validateClip(fixture())
  assert.equal(sampleExpression(clip, 1 / 60).jawOpen, 0.5)
  assert.equal(sampleExpression(clip, 0.09).jawOpen, 0.5)
  for (const time of [-1, 0.1, Infinity, NaN]) assert.deepEqual(sampleExpression(clip, time), {})
})

test('captions follow segment boundaries and clear at end', () => {
  const clip = fixture()
  assert.equal(speechCaption(clip, 0.049), 'First')
  assert.equal(speechCaption(clip, 0.05), 'Second')
  assert.equal(speechCaption(clip, 0.1), '')
})

test('rejects malformed or unbounded clips before playback', () => {
  for (const change of [
    { version: 2 }, { fps: 0 }, { duration: Infinity }, { frames: [] },
    { names: Array(52).fill('jawOpen') }, { names: [...names.slice(1), '__proto__'] },
    { frames: [Array(52).fill(NaN), ...fixture().frames.slice(1)] },
    { frames: [Array(51).fill(0), ...fixture().frames.slice(1)] },
    { frames: [Array(52).fill(2), ...fixture().frames.slice(1)] },
    { captions: [{ start: 0, end: 5, text: 'Invalid' }] },
  ]) assert.throws(() => validateClip({ ...fixture(), ...change }))
})

test('manual presets preserve speech jaw and clamp their own channels', () => {
  const raw = { jawOpen: 0.7, mouthSmileLeft: 0.9 }
  const result = blendPreset(raw, 'smile')
  assert.equal(result.jawOpen, 0.7)
  assert.ok(result.mouthSmileLeft <= 1 && result.mouthSmileRight > 0)
  assert.deepEqual(raw, { jawOpen: 0.7, mouthSmileLeft: 0.9 })
  assert.deepEqual(blendPreset({}, 'unknown'), {})
  assert.ok(blendPreset({}, 'surprise').eyeWideLeft > 0)
})
