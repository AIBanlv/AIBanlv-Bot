import test from 'node:test'
import assert from 'node:assert/strict'
import { DeviceAudio } from '../electron/device-audio.mjs'
import { pipeline } from '../src/control.mjs'

class AudioContext {
  currentTime = 1
  state = 'running'
  sources = []
  destination = {}
  createGain() { return { gain: { value: 1 }, connect() {} } }
  createAnalyser() { return { connect() {}, getFloatTimeDomainData(array) { array.fill(0.1) } } }
  createBuffer(channels, length, rate) {
    const data = new Float32Array(length)
    return { duration: length / rate, getChannelData: () => data }
  }
  createBufferSource() {
    const source = { connect() {}, disconnect() {}, start(time) { this.time = time }, stop() { this.stopped = true } }
    this.sources.push(source)
    return source
  }
  async resume() {}
  async close() {}
}
const pcm = Buffer.from([0, 0, 255, 127, 0, 128]).toString('base64')
const expression = (count = 1) => ({ pipeline, fps: 30,
  frames: Array.from({ length: count }, (_, i) => Array(52).fill(i / count * 0.5 + 0.1)),
  poses: Array.from({ length: count }, () => Array(6).fill(0.1)) })

test('online PCM plays at 24kHz in order with real signed samples and controllable volume', async () => {
  const context = new AudioContext()
  const player = new DeviceAudio({ createContext: () => context, raf: () => 1, cancelRaf() {} })
  await player.prepare()
  player.volume(0.4)
  player.push(pcm, 24000, expression())
  player.push(pcm, 24000, expression())
  assert.deepEqual([...context.sources[0].buffer.getChannelData(0)], [0, 32767 / 32768, -1])
  assert.ok(context.sources[1].time > context.sources[0].time)
  assert.equal(player.gain.gain.value, 0.4)
  let complete = false
  const done = player.finish().then(value => { complete = value })
  context.sources[0].onended()
  assert.equal(complete, false)
  context.sources[1].onended()
  await done
  assert.equal(complete, true)
  await player.dispose()
})

test('stop removes queued audio and prevents a stale playback-completed acknowledgement', async () => {
  const context = new AudioContext()
  const player = new DeviceAudio({ createContext: () => context, raf: () => 1, cancelRaf() {} })
  await player.prepare()
  player.push(pcm, 24000, expression())
  const done = player.finish()
  player.stop()
  assert.equal(await done, false)
  assert.equal(context.sources[0].stopped, true)
  context.sources[0].onended?.()
  assert.equal(player.sources.size, 0)
  assert.throws(() => player.push(pcm, 48000))
  assert.throws(() => player.push('AA==', 24000))
  await player.dispose()
})

test('LAM face samples follow actual audio scheduling, not arrival or volume, and silence between blocks', async () => {
  const context = new AudioContext(), frames = []
  let tick
  const player = new DeviceAudio({ createContext: () => context,
    raf: callback => { tick = callback; return 1 }, cancelRaf() {}, onExpression: value => frames.push(value) })
  await player.prepare()
  assert.throws(() => player.push(pcm, 24000), /LAM/)
  player.push(Buffer.alloc(48000).toString('base64'), 24000, expression(30))
  tick()
  assert.equal(frames.at(-1).speaking, false, 'Queued PCM must not animate early')
  context.currentTime = context.sources[0].time + 0.5
  tick()
  assert.equal(frames.at(-1).weights.mouthPucker, 0.35)
  const sample = frames.at(-1)
  player.volume(0)
  tick()
  assert.deepEqual(frames.at(-1), sample, 'Volume cannot affect articulation')
  context.currentTime = context.sources[0].time + 1.1
  tick()
  assert.equal(frames.at(-1).speaking, false, 'A gap cannot replay a held phoneme')
  const staleTick = tick
  player.stop()
  const stopped = frames.length
  staleTick()
  assert.equal(frames.length, stopped, 'A cancelled animation cannot update a new turn')
  await player.dispose()
})

test('normal completion runs Control closing on the audio clock, while stop interrupts it immediately', async () => {
  const context = new AudioContext(), frames = []
  let tick
  const player = new DeviceAudio({ createContext: () => context,
    raf: callback => { tick = callback; return 1 }, cancelRaf() {}, onExpression: value => frames.push(value) })
  await player.prepare()
  player.push(pcm, 24000, expression())
  let ended = false
  const done = player.finish(expression(30)).then(result => { ended = result })
  context.sources[0].onended()
  await Promise.resolve()
  assert.equal(ended, false)
  context.currentTime += 0.3
  tick()
  assert.equal(frames.at(-1).pipeline, pipeline)
  player.stop()
  await done
  assert.equal(ended, false)
  assert.equal(frames.at(-1).weights.jawOpen, 0)
  await player.dispose()
})

test('the player reports whether the pet is audible so the microphone can guard against its own voice', async () => {
  const context = new AudioContext()
  const player = new DeviceAudio({ createContext: () => context, raf: () => 1, cancelRaf() {} })
  await player.prepare()
  assert.equal(player.speaking, false)
  player.push(pcm, 24000, expression())
  assert.equal(player.speaking, true)
  // The closing animation is still the pet's own voice on screen.
  player.finish(expression(30))
  context.sources[0].onended()
  assert.equal(player.speaking, true)
  player.stop()
  assert.equal(player.speaking, false)
  // And a reply that simply ends leaves nothing audible.
  player.push(pcm, 24000, expression())
  context.sources.at(-1).onended()
  assert.equal(player.speaking, false)
  await player.dispose()
})
