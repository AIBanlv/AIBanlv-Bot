import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { names } from '../src/expression.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const workspace = path.resolve(root, '../../..')
const python = process.env.PET_PYTHON || path.join(workspace, '.venv-lam-coreml/Scripts/python.exe')
const source = process.env.PET_LAM_SOURCE || path.join(workspace, 'LAM_Audio2Expression-main/LAM_Audio2Expression-main')
const fixture = spawnSync(python, ['-B', '-c', `
import base64, json, sys, wave
import numpy as np
import torch
from torchaudio.transforms import Resample
torch.set_num_threads(4)
resampler = Resample(16000, 24000)
windows = []
for filename in sys.argv[1:]:
    with wave.open(filename, "rb") as audio:
        assert (audio.getnchannels(), audio.getsampwidth(), audio.getframerate()) == (1, 2, 16000)
        samples = np.frombuffer(audio.readframes(16000), dtype="<i2").astype(np.float32)
    samples = resampler(torch.from_numpy(samples)).numpy()
    window = np.zeros(51200, dtype="<i2")
    window[27200:27200 + min(24000, len(samples))] = np.rint(samples[:24000]).clip(-32768, 32767).astype("<i2")
    windows.append(base64.b64encode(window.tobytes()).decode("ascii"))
print(json.dumps(windows))
`, path.join(root, 'assets/phrase-0.wav'), path.join(root, 'assets/phrase-1.wav')],
{ windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024 })
assert.equal(fixture.status, 0, 'Local speech fixtures must be readable without downloads')
const [first, second] = JSON.parse(fixture.stdout.toString('utf8'))
assert.notEqual(first === second, true, 'Fixtures must contain different speech')

const digest = createHash('sha256')
for await (const chunk of createReadStream(path.join(source, 'pretrained_models/LAM_audio2exp_streaming.tar'))) {
  digest.update(chunk)
}
const checkpointSha256 = digest.digest('hex')
const started = performance.now()
const child = spawn(python, ['-B', '-u', path.join(root, 'scripts/device_lam_worker.py'), '--source', source],
  { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
let output = '', readyMs, stderrBytes = 0, streamError
const timer = setTimeout(() => { streamError = 'Worker timeout'; child.kill() }, 120000)
child.stdout.setEncoding('utf8')
child.stdout.on('data', chunk => {
  output += chunk
  if (readyMs === undefined && output.includes('\n')) readyMs = performance.now() - started
  if (output.length > 1024 * 1024) { streamError = 'Oversized protocol output'; child.kill() }
})
child.stderr.on('data', chunk => { stderrBytes += chunk.length })
child.stdin.on('error', () => { streamError = 'Worker input pipe closed' })
try {
  const closed = new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', code => resolve(code))
  })
  child.stdin.end([first, second, first].map((pcm, index) =>
    JSON.stringify({ id: index + 1, pcm })).join('\n') + '\n')
  assert.equal(await closed, 0, 'Worker must exit successfully after EOF')
  assert.equal(streamError, undefined)
} finally {
  clearTimeout(timer)
}

const messages = output.trim().split('\n').map(line => JSON.parse(line))
assert.equal(messages.length, 4, 'Exactly one ready and three inference responses')
assert.deepEqual(messages[0], { type: 'ready', engine: 'pytorch-original-tar', fps: 30, names, checkpointSha256 })
for (const [index, result] of messages.slice(1).entries()) {
  assert.equal(result.id, index + 1)
  assert.equal(result.error, undefined)
  assert.equal(result.frames.length, 30)
  assert.ok(result.frames.every(frame => frame.length === 52 &&
    frame.every(value => Number.isFinite(value) && value >= 0 && value <= 1)))
  assert.ok(Number.isFinite(result.inferenceMs) && result.inferenceMs >= 0)
}
assert.deepEqual(messages[1].frames, messages[3].frames, 'A -> B -> A must not retain speech state')
const firstValues = messages[1].frames.flat(), secondValues = messages[2].frames.flat()
const maximumDifference = Math.max(...firstValues.map((value, index) => Math.abs(value - secondValues[index])))
assert.ok(maximumDifference > 0.0001, 'Different speech must produce different model output')
console.log(JSON.stringify({ engine: messages[0].engine, checkpointSha256, startupMs: Math.round(readyMs),
  inferenceMs: messages.slice(1).map(result => result.inferenceMs), maximumDifference,
  deterministicReplay: true, stderrBytes }, null, 2))
