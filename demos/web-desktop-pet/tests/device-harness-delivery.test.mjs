import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { HarnessClient } from '../electron/device-harness-client.mjs'
import { apply } from '../harness-client-plugin/plugin.mjs'

async function until(accept) {
  const deadline = Date.now() + 5000
  while (!accept()) {
    assert.ok(Date.now() < deadline, 'bridge did not settle within five seconds')
    await new Promise(resolve => setTimeout(resolve, 20))
  }
}

async function fixture(t, upload) {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), 'control-harness-delivery-')))
  const client = new HarnessClient({ file: path.join(directory, 'connection.json'), leaseMs: 1500, timeoutMs: 7000,
    authorizeTask: async () => directory })
  const original = globalThis.fetch, events = new EventEmitter(), cleanup = [], uploads = []
  let executions = 0
  const ctx = {
    on: (name, work) => { events.on(name, work); return () => events.off(name, work) },
    effect: work => cleanup.push(work()),
    get: name => ({
      deepseekAccount: { getState: async () => ({ status: 'credential-stored' }) },
      llm: { stream: async function* () {
        executions++
        yield { type: 'text-delta', text: '已完成的结果' }
        yield { type: 'finish', reason: { kind: 'stop' } }
      } },
      agents: { create: async ({ sessionId }) => ({ agent: {
        cancel() {}, whenIdle: async () => {}, followup() {
          executions++
          const agent = { session: { id: sessionId } }
          events.emit('agent/assistant-stream', { agent, frame: { type: 'start' } })
          events.emit('agent/assistant-stream', { agent, frame: { type: 'chunk', chunk: { type: 'text-delta', text: '已完成的结果' } } })
          events.emit('agent/assistant-stream', { agent, frame: { type: 'end', outcome: { kind: 'committed', eventType: 'assistant/message' } } })
          events.emit('session/event', agent.session, { type: 'turn/end', data: { reason: { kind: 'completed' } } })
        },
      }, dispose: async () => {} }) },
    })[name],
  }
  t.after(async () => {
    cleanup.forEach(work => work())
    globalThis.fetch = original
    await client.stop()
    await rm(directory, { recursive: true, force: true })
  })
  await client.start()
  globalThis.fetch = async (url, options) => {
    assert.ok(String(url).startsWith(client.connection.endpoint), 'only the fixture bridge may be contacted')
    if (String(url).endsWith('/v1/result')) {
      uploads.push(JSON.parse(options.body))
      return upload({ attempt: uploads.length, send: () => original(url, options), signal: options.signal })
    }
    return original(url, options)
  }
  apply(ctx, { connectionFile: client.file })
  await until(() => client.ready())
  return { client, events, uploads, executions: () => executions }
}

for (const operation of ['llm', 'run']) test(`${operation}: transient result upload failures retry the same result without repeating execution`, async t => {
  const f = await fixture(t, ({ attempt, send }) => {
    if (attempt === 1) return Response.json({}, { status: 503 })
    if (attempt === 2) throw new TypeError('fixture connection reset')
    return send()
  })
  assert.equal(await f.client.request(operation, '只执行一次'), '已完成的结果')
  assert.equal(f.executions(), 1)
  assert.equal(f.uploads.length, 3)
  assert.deepEqual(f.uploads, Array(3).fill(f.uploads[0]))
  assert.equal(f.client.jobs.size, 0)
})

test('a lost upload acknowledgement does not repeat execution or invalidate the current owner', async t => {
  const f = await fixture(t, async ({ attempt, send }) => {
    const response = await send()
    if (attempt === 1) { await response.body.cancel(); throw new TypeError('fixture acknowledgement lost') }
    return response
  })
  const owner = f.client.owner
  assert.equal(await f.client.request('run', '已完成的电脑任务'), '已完成的结果')
  // Either a retry gets 409 or the next heartbeat removes the completed job.
  // Both must preserve the owner and let a new task complete exactly once.
  assert.equal(await f.client.request('llm', '下一次调用'), '已完成的结果')
  assert.equal(f.client.owner, owner)
  assert.equal(f.executions(), 2)
  assert.equal(f.client.jobs.size, 0)
})

test('persistent upload failure invalidates the bridge and frees waiting jobs before their task timeout', async t => {
  const f = await fixture(t, () => Response.json({}, { status: 503 }))
  await assert.rejects(f.client.request('run', '不能丢失结果后继续占位'), { code: 'HARNESS_CLIENT_CHANGED' })
  assert.equal(f.uploads.length, 3)
  assert.equal(f.executions(), 1)
  assert.equal(f.client.jobs.size, 0)
})

test('logout aborts an in-flight result upload and prevents a retry under the next owner', async t => {
  let uploadSignal
  const f = await fixture(t, ({ signal }) => {
    uploadSignal = signal
    return new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
  })
  const pending = assert.rejects(f.client.request('run', '退出时停止结果上传'), { code: 'HARNESS_CLIENT_CHANGED' })
  await until(() => uploadSignal)
  f.events.emit('deepseek-account/signed-out')
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(uploadSignal.aborted, true)
  await pending
  assert.equal(f.uploads.length, 1)
  assert.equal(f.executions(), 1)
})
