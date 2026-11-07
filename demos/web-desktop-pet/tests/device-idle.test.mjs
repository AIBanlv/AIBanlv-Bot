import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { IdleExpressions } from '../src/device-idle.mjs'
import { names } from '../src/expression.mjs'

const library = JSON.parse(await readFile(new URL('../../../android-native/digitalhuman-core/src/main/assets/AIBANLVKeyframeFace.json', import.meta.url)))
const zero = () => Object.fromEntries(names.map(name => [name, 0]))
const rng = () => { let seed = 19; return () => ((seed = (1664525 * seed + 1013904223) >>> 0) / 2 ** 32) }

test('Control captured idle clips rotate without recent repeats and articulation stays closed', () => {
  const idle = new IdleExpressions(library, rng()), seen = []
  let last
  const before = JSON.stringify(library)
  for (let now = 0; now < 40000; now += 50) {
    const frame = idle.sample(now)
    const { clipId, durationMs, emotion } = idle.diagnostics()
    assert.ok(['neutral', 'warm', 'thinking', 'curious'].includes(emotion))
    assert.ok(durationMs > 0 && durationMs <= 5200)
    if (clipId !== last) {
      assert.equal(seen.slice(-5).includes(clipId), false)
      seen.push(clipId); last = clipId
    }
    assert.equal(Object.keys(frame).length, 52)
    for (const value of Object.values(frame)) assert.ok(value >= 0 && value <= 1)
    for (const name of ['jawOpen', 'mouthFunnel', 'mouthPucker', 'mouthClose', 'tongueOut']) assert.equal(frame[name], 0)
  }
  assert.ok(seen.length > 8)
  assert.equal(JSON.stringify(library), before, 'Sampling must never mutate the shared captures')
})

test('idle uses elapsed time and interpolates captured frames with a 550ms entry', () => {
  const data = { channels: ['BrowInnerUp'], clips: [{ id: 'one', emotion: 'warm', fps: 30,
    frames: Array.from({ length: 90 }, (_, i) => [i / 89]) }] }
  const idle = new IdleExpressions(data, () => 0)
  assert.equal(idle.sample(0).browInnerUp, 0)
  const mid = idle.sample(275).browInnerUp
  assert.ok(Math.abs(mid - (8.25 / 89) * .44 * .5) < 1e-9)
  assert.ok(Math.abs(idle.sample(550).browInnerUp - (16.5 / 89) * .44) < 1e-9)
  const other = new IdleExpressions(data, () => 0)
  for (let time = 0; time <= 550; time += 25) other.sample(time)
  assert.deepEqual(other.sample(550), idle.sample(550))
})

test('foreground speech/touch passes through exactly and resumes from the displayed face', () => {
  const idle = new IdleExpressions(library, rng())
  idle.sample(0); idle.sample(600)
  const speech = { ...zero(), jawOpen: .8, mouthSmileLeft: .6, browInnerUp: .7 }
  assert.deepEqual(idle.sample(800, { owner: 'foreground', weights: speech }), speech)
  const at = idle.diagnostics().positionMs
  idle.sample(9000, { owner: 'foreground', weights: speech })
  assert.equal(idle.diagnostics().positionMs, at, 'Foreground must not consume idle clips')
  const returning = idle.sample(9010)
  assert.equal(returning.jawOpen, speech.jawOpen)
  assert.equal(returning.browInnerUp, speech.browInnerUp)
  assert.ok(idle.sample(9130).jawOpen < speech.jawOpen)
  assert.equal(idle.sample(9250).jawOpen, 0)
  assert.notEqual(idle.sample(9600).browInnerUp, speech.browInnerUp)
})

test('mouse owns gaze while idle face and captured blinks remain alive', () => {
  const a = new IdleExpressions(library, () => 0), b = new IdleExpressions(library, () => 0)
  a.sample(0); b.sample(0)
  const gaze = { ...zero(), eyeLookOutLeft: .2, eyeLookInRight: .2, eyeBlinkLeft: .9 }
  const expected = a.sample(1000)
  const actual = b.sample(1000, { owner: 'gaze', weights: gaze })
  assert.equal(actual.browInnerUp, expected.browInnerUp)
  assert.equal(actual.mouthSmileLeft, expected.mouthSmileLeft)
  assert.equal(actual.eyeLookOutLeft, .2)
  assert.equal(actual.eyeLookInRight, .2)
  assert.ok(actual.eyeBlinkLeft >= .9)
  assert.equal(actual.jawOpen, 0)
})

test('pause resumes without skipping old time; small pools continue and invalid data is rejected', () => {
  const idle = new IdleExpressions(library, rng())
  idle.sample(0); idle.sample(1000)
  const at = idle.diagnostics().positionMs
  idle.pause()
  idle.sample(60000)
  assert.equal(idle.diagnostics().positionMs, at)
  assert.equal(new IdleExpressions({ channels: [], clips: [] }).sample(0).jawOpen, 0)
  assert.throws(() => new IdleExpressions({ channels: ['BrowInnerUp'], clips: [
    { id: 'bad', emotion: 'warm', fps: 30, frames: Array.from({ length: 60 }, () => [NaN]) },
  ] }), /Invalid/)
})
