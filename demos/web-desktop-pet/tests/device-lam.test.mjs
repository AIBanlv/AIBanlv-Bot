import test from 'node:test'
import assert from 'node:assert/strict'
import { DeviceLam } from '../electron/device-lam.mjs'
import { pipeline } from '../src/control.mjs'

const track = count => ({ pipeline, fps: 30,
  frames: Array.from({ length: count }, () => Array(52).fill(0.2)),
  poses: Array.from({ length: count }, () => Array(6).fill(0)) })
const flush = () => new Promise(resolve => setImmediate(resolve))

test('Mac warm weights survive stop and interruption but hide releases owned workers', async t => {
  let calls = 0, disposed = 0, resets = 0
  const signals = []
  const engine = { provenance: { backend: 'cpuAndGPU' }, reset: async () => { resets++ }, dispose: async () => { disposed++ } }
  const lam = new DeviceLam({ keepWarm: true, engineFactory: async signal => { signals.push(signal); calls++; return engine },
    emit: () => {}, onFailure: () => assert.fail('Unexpected failure') })
  t.after(() => lam.dispose())
  lam.setActive(true)
  await new Promise(resolve => setTimeout(resolve, 5)); await lam.drain()
  for (const type of ['stopped', 'interrupted', 'reset']) {
    await lam.begin(type, new AbortController().signal)
    lam.accept({ type }); await lam.drain()
    assert.equal(calls, 1); assert.equal(disposed, 0)
    assert.equal(signals[0].aborted, false)
  }
  assert.ok(resets >= 6)
  assert.equal(lam.status.backend, 'cpuAndGPU')
  lam.setActive(false); await lam.drain()
  assert.equal(disposed, 1)
})

test('Mac first message without completed prewarm owns a model independent of its turn', async t => {
  let signal, disposed = 0
  const lam = new DeviceLam({ keepWarm: true, engineFactory: async value => {
    signal = value; return { reset: async () => {}, dispose: async () => { disposed++ } }
  }, emit: () => {}, onFailure: () => {} })
  t.after(() => lam.dispose())
  lam.setActive(true)
  const turn = new AbortController()
  await lam.begin('first', turn.signal)
  turn.abort(); await lam.drain()
  assert.equal(signal.aborted, false)
  assert.equal(disposed, 0)
  lam.setActive(false); await lam.drain()
  assert.equal(disposed, 1)
})
function fixture(overrides = {}) {
  const windows = [], counts = [], events = [], errors = []
  let disposed = 0
  const engine = {
    reset: async () => {}, reply: async () => {}, infer: async window => { windows.push(Buffer.from(window)); return track(30).frames },
    process: async (frames, count) => { counts.push(count); return track(frames.length) },
    finish: async () => track(30), dispose: async () => { disposed++ }, ...overrides,
  }
  const lam = new DeviceLam({ engineFactory: async () => engine, emit: event => events.push(event),
    onFailure: error => errors.push(error) })
  return { lam, windows, counts, events, errors, get disposed() { return disposed } }
}

test('background warmup emits no turn, and first begin reuses one pending engine startup', async t => {
  let release, calls = 0, resets = 0
  const engine = { reset: async () => { resets++ }, dispose: async () => {} }
  const lam = new DeviceLam({ engineFactory: () => { calls++; return new Promise(resolve => { release = resolve }) },
    emit: () => assert.fail('Warmup must not emit dialogue'), onFailure: () => assert.fail('Warmup must not fail a turn') })
  t.after(() => lam.dispose())
  const warm = lam.prewarm()
  await flush()
  assert.equal(lam.turn, undefined)
  const first = lam.begin('first', new AbortController().signal)
  await flush()
  assert.equal(calls, 1)
  release(engine)
  assert.equal((await warm).ok, true)
  await first
  assert.equal(calls, 1)
  assert.equal(resets, 1, 'Only the real turn initializes private Control state')
})

test('hide during warmup aborts and drains even a late factory without installing an engine', async t => {
  let release, signal, disposed = 0
  const lam = new DeviceLam({ engineFactory: value => {
    signal = value; return new Promise(resolve => { release = resolve })
  }, emit: () => {}, onFailure: () => {} })
  t.after(() => lam.dispose())
  lam.setActive(true)
  await new Promise(resolve => setTimeout(resolve, 5))
  lam.setActive(false)
  assert.equal(signal.aborted, true)
  let closed = false
  const shutdown = lam.dispose().then(() => { closed = true })
  await flush(); assert.equal(closed, false)
  release({ dispose: async () => { disposed++ } })
  await shutdown
  assert.equal(disposed, 1)
  assert.equal(lam.engine, null)
})

test('failed background startup can be retried by a real message without exposing background errors', async t => {
  let calls = 0, errors = 0
  const lam = new DeviceLam({ engineFactory: async () => {
    if (++calls === 1) throw new Error('model detail')
    return { reset: async () => {}, dispose: async () => {} }
  }, emit: () => { errors++ }, onFailure: () => { errors++ } })
  t.after(() => lam.dispose())
  assert.equal((await lam.prewarm()).ok, false)
  await lam.begin('retry', new AbortController().signal)
  assert.equal(calls, 2); assert.equal(errors, 0)
})

test('cancelled warmup cannot detach a replacement startup from shutdown cleanup', async () => {
  const starts = []
  let disposed = 0
  const lam = new DeviceLam({ engineFactory: () => new Promise(resolve => starts.push(resolve)),
    emit: () => {}, onFailure: () => {} })
  const old = lam.prewarm(); await flush()
  lam.cancel()
  const next = lam.prewarm()
  starts[0]({ dispose: async () => { disposed++ } })
  assert.equal((await old).ok, false)
  await flush(); assert.equal(starts.length, 2)
  let closed = false
  const shutdown = lam.dispose().then(() => { closed = true })
  await flush(); assert.equal(closed, false)
  starts[1]({ dispose: async () => { disposed++ } })
  assert.equal((await next).ok, false)
  await shutdown
  assert.equal(disposed, 2)
  assert.equal(lam.engine, null)
})

test('a visible stop prepares the next engine but a hidden stop cannot restart workers', async t => {
  let calls = 0, disposed = 0
  const lam = new DeviceLam({ engineFactory: async () => {
    calls++; return { reset: async () => {}, dispose: async () => { disposed++ } }
  }, emit: () => {}, onFailure: () => {} })
  t.after(() => lam.dispose())
  lam.setActive(true)
  await new Promise(resolve => setTimeout(resolve, 5)); await lam.drain()
  assert.equal(calls, 1)
  await lam.begin('used', new AbortController().signal)
  lam.accept({ type: 'stopped' })
  await new Promise(resolve => setTimeout(resolve, 5)); await lam.drain()
  assert.equal(calls, 2); assert.equal(disposed, 1)
  lam.setActive(false)
  lam.accept({ type: 'reset' })
  await new Promise(resolve => setTimeout(resolve, 5)); await lam.drain()
  assert.equal(calls, 2); assert.equal(disposed, 2)
})

test('an unused model can warm during avatar loading without a role reset restarting its factory', async t => {
  let release, calls = 0, disposed = 0
  const engine = { reset: async () => {}, dispose: async () => { disposed++ } }
  const lam = new DeviceLam({ engineFactory: () => {
    calls++; return calls === 1 ? new Promise(resolve => { release = resolve }) : Promise.resolve(engine)
  }, emit: () => {}, onFailure: () => {} })
  t.after(() => lam.dispose())
  lam.setActive(true)
  await new Promise(resolve => setTimeout(resolve, 5))
  lam.accept({ type: 'reset' })
  release(engine)
  await new Promise(resolve => setTimeout(resolve, 5)); await lam.drain()
  assert.equal(calls, 1)
  assert.equal(disposed, 0)
  await lam.begin('first', new AbortController().signal)
  assert.equal(calls, 1)
})

test('LAM gates audio on inference and keeps original PCM, window history, partial duration and done order', async () => {
  const f = fixture()
  await f.lam.begin('turn', new AbortController().signal)
  const pcm = Buffer.alloc(60000, 1)
  f.lam.accept({ type: 'audio', requestId: 'turn', pcm: pcm.subarray(0, 12000).toString('base64'), sampleRate: 24000 })
  await flush()
  assert.equal(f.events.length, 0)
  f.lam.accept({ type: 'audio', requestId: 'turn', pcm: pcm.subarray(12000).toString('base64'), sampleRate: 24000 })
  f.lam.accept({ type: 'done', requestId: 'turn' })
  await f.lam.drain()
  assert.deepEqual(f.counts, [24000, 6000])
  assert.equal(f.windows[0].length, 102400)
  assert.ok(f.windows[0].subarray(0, 54400).every(value => value === 0))
  assert.deepEqual(f.windows[0].subarray(54400), pcm.subarray(0, 48000))
  assert.deepEqual(f.windows[1].subarray(0, 54400), f.windows[0].subarray(48000))
  assert.deepEqual(Buffer.concat(f.events.filter(e => e.type === 'audio').map(e => Buffer.from(e.pcm, 'base64'))), pcm)
  assert.deepEqual(f.events.map(e => e.type), ['audio', 'audio', 'done'])
  assert.equal(f.events[1].expression.frames.length, 8)
  assert.equal(f.events[2].closing.frames.length, 30)
  assert.deepEqual(f.errors, [])
  await f.lam.dispose()
})

test('raw assistant directives reach Control before processing and latest streamed snapshot is coalesced', async () => {
  const replies = [], order = []
  let release
  const f = fixture({
    infer: () => new Promise(resolve => { release = resolve }),
    reply: async (text, userText) => { replies.push({ text, userText }); order.push('reply') },
    process: async frames => { order.push('process'); return track(frames.length) },
  })
  await f.lam.begin('turn', new AbortController().signal)
  f.lam.accept({ type: 'user', requestId: 'turn', text: '请惊讶地向左看' })
  f.lam.accept({ type: 'assistant', requestId: 'turn', text: '[E:sur' })
  f.lam.accept({ type: 'audio', requestId: 'turn', pcm: Buffer.alloc(48000).toString('base64'), sampleRate: 24000 })
  await flush()
  const text = '[E:surprised][head:look_left]真没想到！'
  f.lam.accept({ type: 'assistant', requestId: 'turn', text })
  f.lam.accept({ type: 'assistant', requestId: 'other', text: '[E:sad]' })
  release(track(30).frames)
  await f.lam.drain()
  assert.deepEqual(replies, [{ text, userText: '请惊讶地向左看' }])
  assert.deepEqual(order, ['reply', 'process'])
  assert.equal(f.events.find(event => event.type === 'assistant' && event.text === text)?.text, text)
  assert.equal(f.events.some(event => event.requestId === 'other'), false)
  f.lam.accept({ type: 'done', requestId: 'turn' })
  await f.lam.drain()
  f.lam.accept({ type: 'complete', requestId: 'turn' })
  await f.lam.begin('next', new AbortController().signal)
  f.lam.accept({ type: 'audio', requestId: 'next', pcm: Buffer.alloc(48000).toString('base64'), sampleRate: 24000 })
  await flush()
  release(track(30).frames)
  await f.lam.drain()
  assert.deepEqual(replies.at(-1), { text: '', userText: '' }, 'A new turn cannot inherit private directives')
  await f.lam.dispose()
})

test('stop or context loss discards late inference and cancels the worker', async () => {
  let release
  const f = fixture({ infer: () => new Promise(resolve => { release = resolve }) })
  const abort = new AbortController()
  await f.lam.begin('old', abort.signal)
  f.lam.accept({ type: 'audio', requestId: 'old', pcm: Buffer.alloc(48000).toString('base64'), sampleRate: 24000 })
  await flush()
  abort.abort()
  release(track(30).frames)
  await f.lam.drain()
  assert.deepEqual(f.events, [])
  assert.equal(f.disposed, 1)
  await f.lam.dispose()
})

test('final reply arriving during a slow Control acknowledgement is applied before the last audio block', async () => {
  let release, appliedText
  const processedText = []
  const f = fixture({
    reply: async text => {
      if (!release) await new Promise(resolve => { release = resolve })
      appliedText = text
    },
    process: async frames => { processedText.push(appliedText); return track(frames.length) },
  })
  await f.lam.begin('turn', new AbortController().signal)
  f.lam.accept({ type: 'assistant', requestId: 'turn', text: '[E:sur' })
  f.lam.accept({ type: 'audio', requestId: 'turn', pcm: Buffer.alloc(48000).toString('base64'), sampleRate: 24000 })
  await flush()
  const text = '[E:surprised] Really!'
  f.lam.accept({ type: 'assistant', requestId: 'turn', text })
  f.lam.accept({ type: 'done', requestId: 'turn' })
  release()
  await f.lam.drain()
  assert.deepEqual(processedText, [text])
  assert.deepEqual(f.errors, [])
  await f.lam.dispose()
})

test('cancellation during a Control reply acknowledgement cannot process or publish the old block', async () => {
  let release, processed = false
  const f = fixture({
    reply: () => new Promise(resolve => { release = resolve }),
    process: async frames => { processed = true; return track(frames.length) },
  })
  await f.lam.begin('turn', new AbortController().signal)
  f.lam.accept({ type: 'audio', requestId: 'turn', pcm: Buffer.alloc(48000).toString('base64'), sampleRate: 24000 })
  await flush()
  f.lam.cancel()
  release()
  await f.lam.drain()
  assert.equal(processed, false)
  assert.deepEqual(f.events, [])
  await f.lam.dispose()
})

test('wrong-turn audio is ignored, normal completion reuses a worker, failures never emit raw audio', async () => {
  const f = fixture()
  await f.lam.begin('turn', new AbortController().signal)
  f.lam.accept({ type: 'audio', requestId: 'other', pcm: Buffer.alloc(48000).toString('base64'), sampleRate: 24000 })
  f.lam.accept({ type: 'done', requestId: 'turn' })
  await f.lam.drain()
  assert.equal(f.windows.length, 0)
  f.lam.accept({ type: 'complete', requestId: 'turn' })
  await f.lam.begin('next', new AbortController().signal)
  assert.equal(f.disposed, 0)
  await f.lam.dispose()
  const broken = fixture({ infer: async () => { throw new Error('private-audio') } })
  await broken.lam.begin('bad', new AbortController().signal)
  broken.lam.accept({ type: 'audio', requestId: 'bad', pcm: Buffer.alloc(48000).toString('base64'), sampleRate: 24000 })
  await broken.lam.drain()
  assert.deepEqual(broken.events, [])
  assert.equal(broken.errors[0].code, 'LAM_UNAVAILABLE')
  assert.doesNotMatch(broken.errors[0].message, /private-audio/)
  await broken.lam.dispose()
})

test('late cancelled startup cannot detach a newer startup from shutdown cleanup', async () => {
  let releaseFirst, releaseSecond, releaseDisposal, releaseSecondDisposal, secondDisposed = false
  const firstEngine = { dispose: () => new Promise(resolve => { releaseDisposal = resolve }) }
  const secondEngine = { dispose: async () => {
    await new Promise(resolve => { releaseSecondDisposal = resolve })
    secondDisposed = true
  } }
  const factories = [
    new Promise(resolve => { releaseFirst = resolve }),
    new Promise(resolve => { releaseSecond = resolve }),
  ]
  const lam = new DeviceLam({ engineFactory: () => factories.shift(), emit: () => {}, onFailure: () => {} })
  const first = lam.begin('first', new AbortController().signal).catch(error => error)
  await flush()
  lam.cancel()
  const second = lam.begin('second', new AbortController().signal).catch(error => error)
  releaseFirst(firstEngine)
  await flush()
  releaseDisposal()
  assert.equal((await first).code, 'LAM_UNAVAILABLE')
  await flush()
  let closed = false
  const shutdown = lam.dispose().then(() => { closed = true })
  await flush()
  const closedBeforeStartupSettled = closed
  releaseSecond(secondEngine)
  await flush()
  const closedBeforeCleanupSettled = closed
  releaseSecondDisposal()
  assert.equal((await second).code, 'LAM_UNAVAILABLE')
  await shutdown
  assert.equal(closedBeforeStartupSettled, false, 'Shutdown must wait for the newer worker startup')
  assert.equal(closedBeforeCleanupSettled, false, 'Shutdown must also wait for the cancelled worker to close')
  assert.equal(secondDisposed, true)
})

test('shutdown prevents a queued begin from creating another worker after the previous startup closes', async () => {
  let release, factoryCalls = 0
  const engine = { reset: async () => {}, dispose: async () => {} }
  const pending = new Promise(resolve => { release = resolve })
  const lam = new DeviceLam({ engineFactory: () => ++factoryCalls === 1 ? pending : Promise.resolve(engine),
    emit: () => {}, onFailure: () => {} })
  const first = lam.begin('first', new AbortController().signal).catch(error => error)
  await flush()
  const next = lam.begin('next', new AbortController().signal).catch(error => error)
  const shutdown = lam.dispose()
  release(engine)
  const [, result] = await Promise.all([first, next, shutdown])
  const callsAfterShutdown = factoryCalls
  await lam.dispose()
  assert.equal(callsAfterShutdown, 1, 'Closing the device must not start another model')
  assert.equal(result.code, 'LAM_UNAVAILABLE')
})

test('an interrupted reply releases the expression engine exactly like a stopped one', async () => {
  const f = fixture()
  await f.lam.begin('turn', new AbortController().signal)
  await flush()
  assert.equal(f.lam.turn.requestId, 'turn')
  f.lam.accept({ type: 'interrupted', requestId: 'turn' })
  assert.equal(f.lam.turn, null)
  assert.deepEqual(f.events.map(event => event.type), ['interrupted'])
  // Pending audio from a cancelled reply must not queue more inference.
  f.lam.accept({ type: 'audio', requestId: 'turn', pcm: Buffer.alloc(48000).toString('base64'), sampleRate: 24000 })
  await flush()
  assert.equal(f.windows.length, 0)
})
