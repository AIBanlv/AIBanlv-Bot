import { execFileSync } from 'node:child_process'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { controlToolchain } from '../scripts/prepare-control.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { jar, sources, library } = await controlToolchain()
const output = path.join(root, 'artifacts', 'device-lam-control-java')
await mkdir(output, { recursive: true })
const classpath = [output, jar].join(path.delimiter)
const options = { cwd: root, stdio: 'inherit', windowsHide: true, timeout: 60_000 }
execFileSync(process.env.JAVAC || 'javac', ['-encoding', 'UTF-8', '-cp', jar, '-d', output,
  ...sources, path.join(root, 'scripts/ControlLamStream.java'),
  path.join(root, 'tests/ControlLamStreamTest.java')], options)
execFileSync(process.env.JAVA || 'java', ['-cp', classpath, 'ControlLamStreamTest', library], options)

const cases = []
const add = (request, error = false) => cases.push({ request: { ...request, id: cases.length + 1 }, error })
add({ action: 'reply', text: 'before reset' }, true)
add({ action: 'reset' })
for (const text of [undefined, null, 42, true, [], {}, 'x'.repeat(16001)]) {
  add({ action: 'reply', text }, true)
}
for (const userText of [42, false, [], {}, 'x'.repeat(1001)]) {
  add({ action: 'reply', text: '[E:surprise]', userText }, true)
}
add({ action: 'reply', text: 'x'.repeat(16000), userText: 'y'.repeat(1000) })
add({ action: 'reply', text: '\u{1f642}'.repeat(8000), userText: '\u{1f642}'.repeat(500) })
add({ action: 'reply', text: '\u{1f642}'.repeat(8001) }, true)
add({ action: 'reply', text: '', userText: null })
add({ action: 'reply', text: '', userText: '' })
add({ action: 'reply', text: '  [\u60ca\u8bb6]\nReally?  ' })
add({ action: 'process', samples: 24000, frames: Array.from({ length: 30 }, () => Array(52).fill(.1)) })
add({ action: 'reply', text: '[E:surprise] Really?', userText: '\u8bf7\u5411\u53f3\u770b' })
add({ action: 'finish' })
add({ action: 'reply', text: 'after finish' }, true)
add({ action: 'reset' })
add({ action: 'reply', text: '[E:happy] Great!' })
add({ action: 'process', samples: 1, frames: [Array(52).fill(.1)] })
add({ action: 'finish' })
add({ action: 'reset' })
add({ action: 'finish' })

const stdout = execFileSync(process.env.JAVA || 'java',
  ['-cp', classpath, 'ControlLamStream', library], {
    ...options, stdio: ['pipe', 'pipe', 'inherit'], encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
    input: cases.map(({ request }) => JSON.stringify(request)).join('\n') + '\n',
  })
const [ready, ...responses] = stdout.trim().split(/\r?\n/).map((line) => JSON.parse(line))
assert.equal(ready.type, 'ready')
assert.equal(ready.pipeline, 'ios-expression-v1-2e75b5f')
assert.equal(ready.names.length, 52)
assert.equal(new Set(ready.names).size, 52)
assert.equal(responses.length, cases.length, 'one JSON response per request and clean EOF')
for (let i = 0; i < cases.length; i++) {
  const { request, error } = cases[i]
  const response = responses[i]
  assert.equal(response.id, request.id)
  if (error) {
    assert.deepEqual(response, { id: request.id, error: 'INVALID_INPUT' })
  } else if (request.action === 'reply' || request.action === 'reset') {
    assert.deepEqual(response, { id: request.id }, 'ack must not echo raw text')
  } else {
    assert.equal(response.pipeline, ready.pipeline)
    assert.equal(response.fps, 30)
    assert.equal(response.error, undefined)
    const count = request.action === 'process' ? Math.ceil(request.samples / 800)
      : cases[i - 1].request.action === 'reset' ? 0 : 30
    assert.equal(response.frames.length, count)
    assert.equal(response.poses.length, count)
    for (const [rows, width] of [[response.frames, 52], [response.poses, 6]]) {
      for (const row of rows) {
        assert.equal(row.length, width)
        assert.ok(row.every(Number.isFinite))
      }
    }
  }
}
console.log(`PASS: ${cases.length} Java RPC requests (text types/bounds, no text echo, streaming, reset and EOF)`)
for (const test of ['ControlPostprocessTest', 'ControlPreviewTest']) {
  execFileSync(process.env.JAVA || 'java', ['-cp', classpath, test, library], options)
}
