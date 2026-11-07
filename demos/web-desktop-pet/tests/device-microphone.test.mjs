import test from 'node:test'
import assert from 'node:assert/strict'
import { VoiceActivity, DeviceMicrophone } from '../electron/device-microphone.mjs'

const block = level => new Float32Array(320).fill(level)

test('a recoverable voice submission failure resumes capture without revoking microphone permission', async t => {
  let receive, now = 1000, attempts = 0
  const authorizations = [], states = []
  const mic = new DeviceMicrophone({ authorize: async enabled => { authorizations.push(enabled); return true },
    onState: value => states.push(value), now: () => now,
    capture: async (_signal, callback) => { receive = callback; return { pause() {}, dispose() {} } },
    onUtterance: async () => { attempts++; return { ok: false, code: 'REALTIME_UNAVAILABLE', message: '正在重连，请再说一次' } } })
  t.after(() => mic.stop())
  await mic.start()
  for (let i = 0; i < 30; i++) receive(block(0.2))
  for (let i = 0; i < 40; i++) receive(block(0))
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(attempts, 1); assert.equal(mic.enabled, true); assert.equal(mic.paused, false)
  assert.deepEqual(authorizations, [true])
  assert.equal(states.at(-1).state, 'listening')
  now += 1000
  for (let i = 0; i < 30; i++) receive(block(0.2))
  for (let i = 0; i < 40; i++) receive(block(0))
  await new Promise(resolve => setImmediate(resolve)); assert.equal(attempts, 2)
})
test('silence and short noise do not submit; a spoken phrase ends after a pause as bounded little-endian PCM16', () => {
  const vad = new VoiceActivity()
  for (let i = 0; i < 200; i++) assert.equal(vad.push(block(0)).pcm, undefined)
  vad.push(block(0.2))
  for (let i = 0; i < 40; i++) assert.equal(vad.push(block(0)).pcm, undefined)
  for (let i = 0; i < 30; i++) vad.push(block(0.25))
  let pcm
  for (let i = 0; i < 40; i++) pcm ||= vad.push(block(0)).pcm
  assert.ok(pcm instanceof Uint8Array)
  assert.ok(pcm.length >= 6400 && pcm.length <= 640000)
  const view = new DataView(pcm.buffer)
  assert.ok([...Array(pcm.length / 2).keys()].some(i => view.getInt16(i * 2, true) === 8191))
  assert.equal(vad.active, false)
})

test('continuous speech is capped at twenty seconds and reset discards an unsubmitted phrase', () => {
  const vad = new VoiceActivity()
  let pcm
  for (let i = 0; i < 1100; i++) { const result = vad.push(block(0.4)); if (result.pcm) { pcm = result.pcm; break } }
  assert.equal(pcm.length, 640000)
  vad.push(block(0.3)); vad.reset()
  for (let i = 0; i < 50; i++) assert.equal(vad.push(block(0)).pcm, undefined)
})

test('canceling permission/capture cannot revive a microphone, and failure releases resources', async () => {
  let resolve, disposed = 0
  const states = []
  const mic = new DeviceMicrophone({ authorize: async () => true, onState: state => states.push(state),
    capture: () => new Promise(done => { resolve = done }), onUtterance() {} })
  const pending = mic.start()
  await Promise.resolve()
  mic.stop()
  resolve({ pause() {}, dispose() { disposed++ } })
  await pending
  assert.equal(mic.enabled, false)
  assert.equal(disposed, 1)
  assert.equal(states.at(-1).state, 'off')
})

test('reply pause mutes capture, clears buffered speech and closing prevents stale submissions', async () => {
  let samples, closed = 0
  const pauses = [], utterances = []
  const mic = new DeviceMicrophone({ authorize: async () => true, onState() {}, now: () => 1000,
    capture: async (_signal, receive) => { samples = receive; return { pause: value => pauses.push(value), dispose() { closed++ } } },
    onUtterance: pcm => utterances.push(pcm) })
  await mic.start()
  for (let i = 0; i < 30; i++) samples(block(0.2))
  mic.pause(true)
  for (let i = 0; i < 50; i++) samples(block(0))
  assert.equal(utterances.length, 0)
  assert.equal(pauses.at(-1), true)
  mic.stop()
  for (let i = 0; i < 100; i++) samples(block(0.4))
  assert.equal(utterances.length, 0)
  assert.equal(closed, 1)
})

test('microphone reports bounded energy levels and clears them on pause or stop', async () => {
  let samples
  const levels = []
  const mic = new DeviceMicrophone({ authorize: async () => true, onState() {}, now: () => 1000,
    capture: async (_signal, receive) => { samples = receive; return { pause() {}, dispose() {} } },
    onUtterance() {}, onLevel: value => levels.push(value) })
  await mic.start()
  samples(block(0.05))
  assert.ok(levels.at(-1) > 0.05 && levels.at(-1) < 1)
  samples(block(1))
  assert.equal(levels.at(-1), 1)
  mic.pause(true)
  assert.equal(levels.at(-1), 0)
  mic.stop()
  assert.equal(levels.at(-1), 0)
})

test('permission denial never starts capture and leaves a visible retryable error', async () => {
  let captures = 0
  const states = [], permissions = []
  const mic = new DeviceMicrophone({ authorize: async enabled => { permissions.push(enabled); return false },
    capture: async () => { captures++ }, onState: value => states.push(value), onUtterance() {} })
  await mic.start()
  assert.equal(captures, 0)
  assert.equal(mic.enabled, false)
  assert.equal(states.at(-1).state, 'error')
  assert.match(states.at(-1).message, /权限/)
  assert.deepEqual(permissions, [true, false])
})

test('a rejected old upload cannot stop a microphone that the user has opened again', async () => {
  let samples, reject
  const mic = new DeviceMicrophone({ authorize: async () => true, onState() {}, now: () => 1000,
    capture: async (_signal, receive) => { samples = receive; return { pause() {}, dispose() {} } },
    onUtterance: () => new Promise((_resolve, fail) => { reject = fail }) })
  await mic.start()
  for (let i = 0; i < 30; i++) samples(block(0.2))
  for (let i = 0; i < 40; i++) samples(block(0))
  assert.equal(mic.paused, true)
  mic.stop(); await mic.start()
  reject(new Error('old failure'))
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(mic.enabled, true)
  mic.stop()
})

test('while the pet is speaking an interruption has to sound like a person talking over it', () => {
  const phrase = (vad, guard, level, voiced) => {
    for (let i = 0; i < voiced; i++) vad.push(block(level), guard)
    for (let i = 0; i < 40; i++) { const result = vad.push(block(0), guard); if (result.pcm) return result.pcm }
    return undefined
  }
  // A short phrase is enough in silence, but not while the pet is audible.
  assert.ok(phrase(new VoiceActivity(), false, 0.2, 15))
  assert.equal(phrase(new VoiceActivity(), true, 0.2, 15), undefined)
  // The pet's own voice, and whatever echo cancellation leaves of it, never
  // reaches an interrupting level however long it plays.
  const echo = new VoiceActivity()
  for (let i = 0; i < 300; i++) { assert.equal(echo.push(block(0.03), true).pcm, undefined) }
  assert.equal(echo.active, false)
  // Somebody leaning in does interrupt.
  assert.ok(phrase(new VoiceActivity(), true, 0.5, 30))
})

test('a submitted phrase keeps listening so the next one can interrupt the reply', async () => {
  let samples, asked = 0
  const pauses = [], utterances = []
  const mic = new DeviceMicrophone({ authorize: async () => true, onState() {}, now: () => 1000,
    guarded: () => { asked++; return true },
    capture: async (_signal, receive) => { samples = receive; return { pause: value => pauses.push(value), dispose() {} } },
    onUtterance: async pcm => { utterances.push(pcm); return { ok: true } } })
  await mic.start()
  for (let i = 0; i < 30; i++) samples(block(0.25))
  for (let i = 0; i < 40; i++) samples(block(0))
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(utterances.length, 1)
  assert.deepEqual(pauses.slice(-2), [true, false])
  assert.equal(mic.paused, false)
  assert.ok(asked > 0, 'the echo guard is consulted while capture is live')
  mic.stop()
})
