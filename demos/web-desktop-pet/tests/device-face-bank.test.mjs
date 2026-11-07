import assert from 'node:assert/strict'
import test from 'node:test'
import { buildFaceBank, createFaceBank, sampleFaceBank, FACE_BANK_VERSION, faceBankFps } from '../electron/device-face-bank.mjs'
import { names } from '../src/expression.mjs'
import { motionTags } from '../src/text-motion.mjs'

const pascal = name => name[0].toUpperCase() + name.slice(1)
const poseChannels = ['HeadYaw', 'HeadPitch', 'HeadRoll', 'LeftEyeYaw', 'LeftEyePitch', 'LeftEyeRoll',
  'RightEyeYaw', 'RightEyePitch', 'RightEyeRoll']
const channels = [...names.map(pascal), ...poseChannels]
const frame = overrides => {
  const row = channels.map(() => 0)
  for (const [name, value] of Object.entries(overrides)) {
    const index = channels.indexOf(pascal(name))
    if (index < 0) throw new Error(`unknown channel ${name}`)
    row[index] = value
  }
  return row
}
const clip = (id, emotion, frames, fps = 30) => ({ id, emotion, fps, source: 'test', frames })
const library = clips => ({ schemaVersion: 1, selectionRevision: 'test', channels, clips })
const hold = (seconds, overrides) => Array.from({ length: Math.round(seconds * 30) + 1 }, () => frame(overrides))
const ramp = (seconds, name) => Array.from({ length: Math.round(seconds * 30) + 1 },
  (_value, index) => frame({ [name]: index / Math.round(seconds * 30) }))
const at = (sample, name) => sample[name]

test('the captured library is folded onto the 52 channels the face understands', () => {
  const bank = buildFaceBank(library([clip('kf_1', 'happy', hold(1, { mouthSmileLeft: 0.5, tongueOut: 1 }))]))
  assert.equal(bank.version, FACE_BANK_VERSION)
  assert.equal(bank.fps, faceBankFps)
  assert.deepEqual(bank.channels, names, 'the bank speaks the renderer channel list verbatim')
  const [row] = bank.clips[0].frames
  assert.equal(row.length, 52)
  assert.equal(row[names.indexOf('mouthSmileLeft')], 128, '0.5 is stored as a byte')
  assert.equal(row[names.indexOf('tongueOut')], 255)
  assert.equal(row[names.indexOf('mouthSmileRight')], 0)
})

test('head and eye aim from the capture never hijack the gaze layer', () => {
  const bank = buildFaceBank(library([clip('kf_1', 'neutral', hold(1, { eyeLookOutLeft: 1, mouthSmileLeft: 1 }))]))
  const [row] = bank.clips[0].frames
  assert.equal(row[names.indexOf('eyeLookOutLeft')], 89, 'captured eye aim is damped to leave room for the follow')
  assert.equal(row[names.indexOf('mouthSmileLeft')], 255, 'the face itself keeps its full amplitude')
  assert.equal(bank.channels.includes('headYaw'), false, 'head motion stays with the gesture layer')
})

test('a clip is resampled to the bank rate and still lasts as long', () => {
  const bank = buildFaceBank(library([clip('kf_1', 'happy', hold(2, { mouthSmileLeft: 1 }))]))
  const entry = bank.clips[0]
  assert.equal(entry.duration, 2)
  assert.equal(entry.frames.length, Math.round(2 * faceBankFps) + 1)
  assert.equal(entry.emotion, 'happy')
  assert.equal(entry.id, 'kf_1')
})

test('sampling interpolates between stored frames and clamps at the ends', () => {
  const bank = buildFaceBank(library([clip('kf_1', 'happy', ramp(2, 'jawOpen'))]))
  const handle = createFaceBank(bank)
  const entry = handle.clip('happy', 1, () => 0)
  assert.ok(at(handle.sample(entry, 0), 'jawOpen') < 0.02)
  assert.ok(Math.abs(at(handle.sample(entry, 1), 'jawOpen') - 0.5) < 0.02, `mid ${at(handle.sample(entry, 1), 'jawOpen')}`)
  assert.ok(at(handle.sample(entry, 2), 'jawOpen') > 0.98)
  assert.ok(at(handle.sample(entry, 9), 'jawOpen') > 0.98, 'past the end the last frame holds')
  assert.ok(at(handle.sample(entry, -3), 'jawOpen') < 0.02, 'a negative time clamps to the first frame')
  assert.equal(sampleFaceBank(null, 1), null)
  assert.equal(sampleFaceBank(entry, Number.NaN), null)
})

test('the bank keeps every emotion the tag library can ask for', () => {
  const clips = motionTags.emotion.map((emotion, index) => clip(`kf_${index}`, emotion, hold(1, { jawOpen: 0.2 })))
  const handle = createFaceBank(buildFaceBank(library(clips)))
  assert.deepEqual(handle.emotions, motionTags.emotion)
  for (const emotion of motionTags.emotion) {
    const entry = handle.clip(emotion, 2, () => 0)
    assert.ok(entry, emotion)
    assert.equal(entry.emotion, emotion)
  }
  assert.equal(handle.clip('nonexistent', 2, () => 0), null)
})

test('a gesture is given a clip long enough to cover it', () => {
  const clips = [clip('short', 'happy', hold(0.5, { jawOpen: 0.3 })), clip('long', 'happy', hold(3, { jawOpen: 0.7 }))]
  const handle = createFaceBank(buildFaceBank(library(clips)))
  assert.equal(handle.clip('happy', 2, () => 0).id, 'long')
  assert.equal(handle.clip('happy', 0.4, () => 0).id, 'short')
  // Nothing long enough: the longest one wins so the action is cut to fit.
  const only = createFaceBank(buildFaceBank(library([clip('tiny', 'happy', hold(0.5, { jawOpen: 0.3 }))])))
  assert.equal(only.clip('happy', 4, () => 0).id, 'tiny')
})

test('a bank that cannot be trusted is refused instead of half used', () => {
  assert.equal(createFaceBank(null), null)
  assert.equal(createFaceBank({ version: FACE_BANK_VERSION + 1, channels: names, clips: [] }), null)
  assert.equal(createFaceBank({ version: FACE_BANK_VERSION, channels: names.slice(1), clips: [] }), null)
  assert.equal(createFaceBank({ version: FACE_BANK_VERSION, channels: names.slice().reverse(), clips: [] }), null,
    'the channel order must match, not just the names')
  assert.equal(createFaceBank({ version: FACE_BANK_VERSION, channels: names, clips: [] }), null, 'no clips, no bank')
  assert.equal(createFaceBank({ version: FACE_BANK_VERSION, channels: names,
    clips: [{ emotion: 'happy', duration: 1, frames: [1, 2] }] }), null, 'one frame is not a clip')
  assert.throws(() => buildFaceBank({ schemaVersion: 2, channels, clips: [] }), /表情库/)
  assert.throws(() => buildFaceBank(library([clip('kf_1', 'happy', [channels.map(() => 0)])])), /没有可用片段/)
  assert.throws(() => buildFaceBank({ schemaVersion: 1, channels: ['MouthSmileLeft'], clips: [] }), /缺少面部通道/)
})

// The renderer harness: a fake clock, a fake surface and captured frames. One
// clock and one animation queue are shared by every director in the same test,
// which is exactly how two directors would behave against a single window.
async function harness() {
  const saved = { window: globalThis.window, document: globalThis.document,
    raf: globalThis.requestAnimationFrame, caf: globalThis.cancelAnimationFrame }
  let clock = 0, queue = []
  globalThis.window = { addEventListener() {}, removeEventListener() {} }
  globalThis.document = { hidden: false, addEventListener() {}, removeEventListener() {} }
  globalThis.requestAnimationFrame = callback => queue.push(callback)
  globalThis.cancelAnimationFrame = () => { queue = [] }
  const { installMoodDirector } = await import('../electron/device-mood.mjs')
  const installed = []
  return {
    open({ bank = null } = {}) {
      const surface = { dataset: {}, addEventListener() {}, removeEventListener() {},
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 360, height: 590 }) }
      const frames = []
      const mood = installMoodDirector({ surface, canPlay: () => true, faceBank: bank,
        onExpression: value => frames.push(value), now: () => clock })
      installed.push(mood)
      return { mood, surface, frames }
    },
    step(steps = 1) {
      for (let i = 0; i < steps; i++) { const pending = queue; queue = []; clock += 16; for (const callback of pending) callback(clock) }
    },
    dispose() {
      for (const mood of installed) mood.dispose()
      globalThis.window = saved.window; globalThis.document = saved.document
      globalThis.requestAnimationFrame = saved.raf; globalThis.cancelAnimationFrame = saved.caf
    },
  }
}

test('an emotion plays a captured clip instead of a handful of held blendshapes', async () => {
  // cheekPuff and mouthDimple are channels the procedural face never writes, so
  // seeing them move proves the clip is what the face is showing.
  const bank = createFaceBank(buildFaceBank(library(
    motionTags.emotion.map((emotion, index) => clip(`kf_${index}`, emotion, hold(4, { cheekPuff: 0.7, mouthDimpleLeft: 0.6 }))))))
  const stage = await harness()
  try {
    const captured = stage.open({ bank }), synthetic = stage.open()
    for (const run of [captured, synthetic]) run.mood.observe('tap')
    stage.step(80)
    const played = captured.frames.at(-1).weights, fallback = synthetic.frames.at(-1).weights
    assert.ok(played.cheekPuff > 0.4, `captured cheekPuff ${played.cheekPuff}`)
    assert.ok(played.mouthDimpleLeft > 0.35, `captured mouthDimpleLeft ${played.mouthDimpleLeft}`)
    assert.equal(fallback.cheekPuff, 0, 'without a bank the face stays synthesised')
    assert.equal(captured.surface.dataset.bank, 'clips')
    assert.equal(synthetic.surface.dataset.bank, 'synth', 'no library means the synthesised face')
    // Both still own the face.
    assert.equal(captured.frames.at(-1).pose.owned, true)
  } finally { stage.dispose() }
})

test('a clip that arrives after the window is up is picked up, and can be dropped again', async () => {
  const stage = await harness()
  try {
    const run = stage.open()
    assert.equal(run.mood.bank, null)
    const handle = createFaceBank(buildFaceBank(library(
      motionTags.emotion.map((emotion, index) => clip(`kf_${index}`, emotion, hold(2, { cheekPuff: 0.7 }))))))
    run.mood.use(handle)
    assert.equal(run.mood.bank, handle)
    assert.equal(run.surface.dataset.bank, 'clips')
    run.mood.observe('tap')
    stage.step(80)
    assert.ok(run.frames.at(-1).weights.cheekPuff > 0.3, 'the late bank is used')
    run.mood.use(null)
    assert.equal(run.mood.bank, null)
    assert.equal(run.surface.dataset.bank, 'synth')
    run.mood.use({ not: 'a bank' })
    assert.equal(run.mood.bank, null, 'anything but a bank is ignored')
  } finally { stage.dispose() }
})
