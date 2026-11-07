import test from 'node:test'
import assert from 'node:assert/strict'
import { validateLamTrack, sampleLamTrack, neutralExpression } from '../src/lam-track.mjs'
import { pipeline } from '../src/control.mjs'

const track = () => ({ pipeline, fps: 30, frames: [Array(52).fill(0), Array(52).fill(0.4)],
  poses: [Array(6).fill(0), Array(6).fill(0.2)] })

test('LAM tracks validate canonical dimensions and sample the existing Control interpolation', () => {
  const value = validateLamTrack(track(), 2)
  const sampled = sampleLamTrack(value, 1 / 60, 2 / 30)
  assert.equal(sampled.weights.jawOpen, 0.2)
  assert.equal(sampled.weights.mouthPucker, 0.2)
  assert.equal(sampled.pose.yaw, 0.1)
  assert.equal(sampled.pipeline, pipeline)
  assert.equal(sampleLamTrack(value, -1, 2 / 30), null)
  assert.equal(neutralExpression().weights.jawOpen, 0)
  assert.equal(neutralExpression().pose.owned, false, 'Silence must release control, not command a zero head pose')
  for (const invalid of [
    { ...track(), pipeline: 'raw' }, { ...track(), fps: 60 },
    { ...track(), frames: [Array(52).fill(NaN)] },
    { ...track(), poses: [Array(6).fill(5), Array(6).fill(0)] },
  ]) assert.throws(() => validateLamTrack(invalid, 2))
})
