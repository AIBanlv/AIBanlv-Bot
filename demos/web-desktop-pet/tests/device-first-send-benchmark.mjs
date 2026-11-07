import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { DeviceLam } from '../electron/device-lam.mjs'
import { createLamEngine } from '../electron/device-lam-engine.mjs'
import { knownSpeech } from './lam-fixture.mjs'

const pcm = knownSpeech(process.cwd()).subarray(0, 48000)
const results = []
for (let run = 0; run < 3; run++) {
  for (const warm of [false, true]) {
    let factories = 0, firstAudioMs, started
    const lam = new DeviceLam({ engineFactory: signal => { factories++; return createLamEngine(signal) },
      emit: event => { if (event.type === 'audio' && firstAudioMs === undefined) firstAudioMs = performance.now() - started },
      onFailure: () => assert.fail('Original inference must succeed') })
    try {
      const startup = performance.now()
      if (warm) assert.equal((await lam.prewarm()).ok, true)
      const backgroundMs = performance.now() - startup
      started = performance.now()
      await lam.begin('first', new AbortController().signal)
      const preparationMs = performance.now() - started
      lam.accept({ type: 'audio', requestId: 'first', pcm: pcm.toString('base64'), sampleRate: 24000 })
      await lam.drain()
      assert.equal(factories, 1)
      assert.ok(Number.isFinite(firstAudioMs))
      results.push({ run, mode: warm ? 'prewarmed' : 'cold', backgroundMs, preparationMs, firstAudioMs })
    } finally { await lam.dispose() }
  }
}
const median = (mode, key) => results.filter(row => row.mode === mode).map(row => row[key]).sort((a, b) => a - b)[1]
const report = { localOriginalModelOnly: true, samplesPerMode: 3, results,
  medianColdPreparationMs: median('cold', 'preparationMs'), medianWarmPreparationMs: median('prewarmed', 'preparationMs'),
  medianColdFirstAudioMs: median('cold', 'firstAudioMs'), medianWarmFirstAudioMs: median('prewarmed', 'firstAudioMs') }
assert.ok(report.medianWarmPreparationMs < report.medianColdPreparationMs / 4)
assert.ok(report.medianWarmFirstAudioMs < report.medianColdFirstAudioMs / 4)
await mkdir('artifacts', { recursive: true })
await writeFile('artifacts/first-send-benchmark.json', JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
