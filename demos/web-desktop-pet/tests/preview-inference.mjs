import assert from 'node:assert/strict'
import { readdir } from 'node:fs/promises'
import { createPreviewGenerator } from '../scripts/preview-service.mjs'

const generate = createPreviewGenerator()
const jobs = new URL('../artifacts/preview-jobs/', import.meta.url)
const before = new Set(await readdir(jobs).catch(() => []))
const result = await generate('[H:shake]你好，今天我们一起看看数字人的动作。忙碌的时候也不要忘记休息，照顾好自己，慢慢把重要的事情做好。', AbortSignal.timeout(120000))
assert.ok(result.clip.captions.length > 1, 'Long dialogue must synthesize multiple bounded captions')
assert.ok(result.clip.captions.every((cue) => [...cue.text].length <= 32))
assert.equal(result.clip.captions.map((cue) => cue.text).join(''), result.behavior.text)
assert.equal(result.clip.provenance.engine, 'pytorch-original-tar')
assert.ok(result.clip.frames.some((frame) => frame[24] > 0.1))
assert.ok(result.bank.variants.natural.poses.some((pose) => Math.abs(pose[1]) > 0.1))
assert.equal('audioUrl' in result, false)
assert.deepEqual((await readdir(jobs)).filter((name) => !before.has(name)), [])
await assert.rejects(generate('[H:invalid]Hello.', AbortSignal.timeout(120000)), { status: 400 })
assert.deepEqual((await readdir(jobs)).filter((name) => !before.has(name)), [])
const controller = new AbortController()
const timer = setTimeout(() => controller.abort(), 2500)
try {
  await assert.rejects(generate('[H:nod]你好，很高兴见到你。', controller.signal), { name: 'AbortError' })
} finally { clearTimeout(timer) }
assert.deepEqual((await readdir(jobs)).filter((name) => !before.has(name)), [])
console.log(JSON.stringify({ captions: result.clip.captions.length, duration: result.clip.duration,
  frames: result.clip.frames.length, cleanup: 'success, invalid tag and actual subprocess cancellation passed' }))
