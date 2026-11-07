import assert from 'node:assert/strict'
import { createLamEngine } from '../electron/device-lam-engine.mjs'
import { names } from '../src/expression.mjs'
import { knownSpeech } from './lam-fixture.mjs'

const input = knownSpeech()
const started = performance.now()
const engine = await createLamEngine(new AbortController().signal)
try {
  const startupMs = performance.now() - started
  assert.equal(engine.provenance.engine, 'pytorch-original-tar')
  await engine.reset()
  let history = Buffer.alloc(54400)
  const rawFrames = [], prepared = [], elapsed = []
  for (let i = 0; i < 3; i++) {
    const window = Buffer.alloc(102400)
    history.copy(window)
    input.subarray(i * 48000, (i + 1) * 48000).copy(window, 54400)
    history = Buffer.from(window.subarray(48000))
    const tick = performance.now()
    const raw = await engine.infer(window)
    const track = await engine.process(raw, 24000)
    elapsed.push(performance.now() - tick)
    assert.equal(track.frames.length, 30)
    assert.equal(track.poses.length, 30)
    rawFrames.push(...raw); prepared.push(...track.frames)
  }
  const mouthNames = ['jawOpen', 'mouthPucker', 'mouthFunnel', 'mouthClose', 'mouthUpperUpLeft', 'mouthLowerDownLeft']
  const variation = Object.fromEntries(mouthNames.map(name => {
    const index = names.indexOf(name), values = rawFrames.map(frame => frame[index])
    return [name, Math.max(...values) - Math.min(...values)]
  }))
  assert.ok(Object.values(variation).filter(range => range > 0.005).length >= 3, 'Real speech must drive more than a single jaw')
  assert.notDeepEqual(prepared, rawFrames, 'Control filtering must actually run')
  const closing = await engine.finish()
  assert.equal(closing.frames.length, 30)
  await engine.reset()
  const silent = await engine.infer(Buffer.alloc(102400))
  assert.notDeepEqual(silent, rawFrames.slice(0, 30), 'Original model must depend on PCM')
  engine.python.child.kill()
  await engine.python.closed
  await assert.rejects(engine.reset(), { code: 'LAM_UNAVAILABLE' })
  console.log(JSON.stringify({ engine: engine.provenance.engine, checkpointSha256: engine.provenance.checkpointSha256,
    startupMs: Math.round(startupMs), blockMs: elapsed.map(Math.round), mouthVariation: variation,
    frames: prepared.length, exitedWorkerBlocked: true }, null, 2))
} finally { await engine.dispose() }
