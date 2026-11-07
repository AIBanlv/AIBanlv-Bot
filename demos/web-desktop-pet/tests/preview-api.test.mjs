import assert from 'node:assert/strict'
import test from 'node:test'
import { createDemoServer } from '../server.mjs'

async function start(t, generatePreview) {
  const server = createDemoServer(new Map(), { generatePreview })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections() }))
  const base = `http://127.0.0.1:${server.address().port}`
  const post = (body, headers = {}, options = {}) => fetch(`${base}/api/previews`, {
    method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body), ...options,
  })
  return { base, post }
}

test('preview API rejects cross-origin, invalid, oversized and non-JSON input before inference', async (t) => {
  let calls = 0
  const { base, post } = await start(t, async () => { calls++; return { version: 1 } })
  assert.equal((await post({ text: 'Hello' }, { Origin: 'http://evil.example' })).status, 403)
  assert.equal((await post({ text: 'Hello' }, { Origin: '' })).status, 403)
  assert.equal((await post({ text: 'Hello' }, { 'Content-Type': 'text/plain' })).status, 415)
  for (const body of ['{', '{}', 'null', { text: '' }, { text: 3 }, { text: 'x'.repeat(161) },
    { text: 'a\u0000' }, { text: 'hello', path: 'outside' }]) {
    assert.equal((await post(body)).status, 400)
  }
  assert.equal((await post('x'.repeat(4097))).status, 413)
  assert.equal((await fetch(`${base}/api/previews`)).status, 405)
  assert.equal(calls, 0)
  const response = await post({ text: '[H:shake]Hello' })
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.deepEqual(await response.json(), { version: 1 })
  assert.equal(calls, 1)
})

test('preview API permits one job and cancels disconnected clients', { timeout: 5000 }, async (t) => {
  let entered
  const started = new Promise((resolve) => { entered = resolve })
  let aborted = false
  const { post } = await start(t, async (_text, signal) => {
    entered()
    await new Promise((resolve) => signal.addEventListener('abort', () => { aborted = true; resolve() }, { once: true }))
    signal.throwIfAborted()
  })
  const controller = new AbortController()
  const pending = post({ text: 'Hello' }, {}, { signal: controller.signal }).catch((error) => error)
  await started
  assert.equal((await post({ text: 'Again' })).status, 409)
  controller.abort()
  await pending
  for (let i = 0; i < 50 && !aborted; i++) await new Promise((resolve) => setTimeout(resolve, 10))
  assert.equal(aborted, true)
})

test('preview API sanitizes dependency failures and releases the slot for retry', async (t) => {
  let calls = 0
  const { post } = await start(t, async () => {
    if (++calls === 1) throw new Error('F:/private/path and internal details')
    return { version: 1 }
  })
  const failed = await post({ text: 'Hello' })
  assert.equal(failed.status, 503)
  const data = await failed.json()
  assert.equal(data.error.code, 'GENERATION_FAILED')
  assert.doesNotMatch(JSON.stringify(data), /private|internal/)
  assert.equal((await post({ text: 'Retry' })).status, 200)
})
