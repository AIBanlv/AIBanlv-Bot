import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { LineWorker } from '../electron/device-lam-worker.mjs'

function fixture(options = {}) {
  const child = new EventEmitter()
  child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough()
  child.kill = () => { child.killed = true; queueMicrotask(() => child.emit('close', 0)); return true }
  const worker = new LineWorker('fixture', [], { spawnImpl: () => child, ...options })
  const emit = data => child.stdout.write(JSON.stringify(data) + '\n')
  return { child, worker, emit }
}

test('local worker correlates one request and keeps malformed replies out of the renderer', async () => {
  const f = fixture()
  f.emit({ type: 'ready' }); await f.worker.ready
  let input
  f.child.stdin.on('data', bytes => { input = JSON.parse(bytes) })
  const pending = f.worker.request({ action: 'reset' })
  await assert.rejects(f.worker.request({ action: 'reset' }))
  assert.equal(input.action, 'reset')
  f.emit({ id: input.id, frames: [] })
  assert.deepEqual((await pending).frames, [])
  await f.worker.dispose()
  assert.equal(f.child.killed, true)
})

test('wrong IDs, oversized output and worker failures reject pending work with sanitized errors', async () => {
  for (const kind of ['wrong-id', 'oversized', 'error', 'invalid-json']) {
    const f = fixture()
    f.emit({ type: 'ready' }); await f.worker.ready
    const pending = f.worker.request({ action: 'reset' })
    if (kind === 'wrong-id') f.emit({ id: 999, secret: 'private-data' })
    if (kind === 'oversized') f.child.stdout.write('x'.repeat(512 * 1024 + 1))
    if (kind === 'error') f.child.emit('error', new Error('private-data'))
    if (kind === 'invalid-json') f.child.stdout.write('private-data\n')
    await assert.rejects(pending, error => error.code === 'LAM_UNAVAILABLE' && !error.message.includes('private-data'))
    await f.worker.dispose()
  }
})

test('startup and request deadlines close stalled workers; disposal cancels work', async () => {
  const startup = fixture({ startupMs: 10 })
  await assert.rejects(startup.worker.ready, { code: 'LAM_UNAVAILABLE' })
  await startup.worker.dispose()
  const f = fixture({ timeoutMs: 10 })
  f.emit({ type: 'ready' }); await f.worker.ready
  await assert.rejects(f.worker.request({ action: 'reset' }), { code: 'LAM_UNAVAILABLE' })
  await f.worker.dispose()
  const cancelled = fixture()
  cancelled.emit({ type: 'ready' }); await cancelled.worker.ready
  const pending = cancelled.worker.request({ action: 'reset' })
  const rejected = assert.rejects(pending, { code: 'LAM_UNAVAILABLE' })
  await cancelled.worker.dispose()
  await rejected
})
