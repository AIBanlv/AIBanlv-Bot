import assert from 'node:assert/strict'
import test from 'node:test'
import { names } from '../src/expression.mjs'
import { validateControl, sampleControl, pipeline } from '../src/control.mjs'

const pose = [0.2, -0.1, 0.05, 0, 0, 0]
function fixture() {
  const track = { frames: [Array(52).fill(0), Array(52).fill(0.5)],
    poses: [pose, pose], closingFrames: [Array(52).fill(0)], closingPoses: [pose] }
  return { version: 1, pipeline, fps: 30, duration: 2 / 30, names,
    sourceSha256: 'a'.repeat(64), variants: Object.fromEntries(['natural', 'smile', 'surprise', 'focus'].map((key) => [key, structuredClone(track)])) }
}

test('Control tracks validate their origin, dimensions, channels and poses', () => {
  const value = fixture()
  assert.equal(validateControl(value, 'a'.repeat(64), 2 / 30), value)
  assert.throws(() => validateControl(value, 'b'.repeat(64), 2 / 30))
  for (const mutate of [
    (v) => { v.variants.focus = null },
    (v) => { v.names[1] = v.names[0] },
    (v) => { v.variants.natural.frames[0][24] = NaN },
    (v) => { v.variants.natural.poses[0][0] = 2 },
    (v) => { v.variants.natural.poses.pop() },
    (v) => { v.variants.natural.closingPoses = [] },
    (v) => { v.pipeline = 'legacy' },
  ]) {
    const bad = fixture()
    mutate(bad)
    assert.throws(() => validateControl(bad, 'a'.repeat(64), 2 / 30))
  }
})

test('face and owned pose use the same audio slot, closure ends explicitly', () => {
  const data = fixture()
  const result = sampleControl(data, 'natural', 1 / 60)
  assert.equal(result.weights.jawOpen, 0.25)
  assert.equal(result.pose.pitch, 0.2)
  assert.equal(result.pose.owned, true)
  assert.equal(sampleControl(data, 'natural', 2 / 30), null)
  assert.equal(sampleControl(data, 'natural', -1), null)
  assert.equal(sampleControl(data, 'natural', NaN), null)
  assert.equal(sampleControl(data, 'natural', 0, true).weights.jawOpen, 0)
  assert.equal(sampleControl(data, 'natural', 1, true), null)
  assert.throws(() => sampleControl(data, 'unknown', 0))
})
