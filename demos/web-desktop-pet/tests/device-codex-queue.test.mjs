import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { queueCodexMessage } from '../electron/device-codex-queue.mjs'
import { DeviceCodex, codexFailure } from '../electron/device-codex.mjs'

const fixture = fileURLToPath(new URL('./codex-queue-fixture.mjs', import.meta.url))
const cwd = fileURLToPath(new URL('../', import.meta.url))
async function setup(t, mode = '') {
  const directory = await mkdtemp(path.join(tmpdir(), 'codex-queue-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const inbox = path.join(directory, 'inbox.jsonl')
  return { inbox, launch: { command: process.execPath, args: [fixture, 'app-server', '--listen', 'stdio://'],
    env: { ...process.env, QUEUE_FIXTURE_INBOX: inbox, QUEUE_FIXTURE_MODE: mode } } }
}

test('native queue preserves the exact thread and text as arguments without shell evaluation', async t => {
  const { inbox, launch } = await setup(t)
  const text = '继续（来自安卓端仅测试） "$(secret)" & | `echo test`'
  await queueCodexMessage({ launch, threadId: 'original-thread', text })
  assert.deepEqual(JSON.parse((await readFile(inbox, 'utf8')).trim()), { thread: 'original-thread', text })
})

test('queue failure is sanitized and timeout is explicitly uncertain', async t => {
  const failed = await setup(t, 'fail')
  await assert.rejects(queueCodexMessage({ launch: failed.launch, threadId: 'original', text: 'private-message' }),
    error => /排队失败/.test(error.message) && !/private-message/.test(error.message))
  const waiting = await setup(t, 'wait')
  await assert.rejects(queueCodexMessage({ launch: waiting.launch, threadId: 'original', text: '继续', timeoutMs: 100 }),
    error => error.submissionUncertain === true && /确认/.test(error.message))
})

test('cancelled queue never starts a process', async t => {
  const { launch } = await setup(t)
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(queueCodexMessage({ launch, threadId: 'original', text: '继续', signal: controller.signal,
    spawnProcess: () => assert.fail('cancelled message must not be queued') }), /abort/i)
})

test('externally owned completed and running threads queue without acquiring their active writer', async t => {
  for (const status of ['completed', 'inProgress']) {
    const queued = []
    const client = new DeviceCodex({ queueMessage: async value => { queued.push(value) } })
    t.after(() => client.shutdown()); client.status = 'ready'
    client.launchSpec = { command: 'codex.exe', args: ['app-server', '--listen', 'stdio://'] }
    client.request = async method => assert.fail(`external thread must stay owned by its window: ${method}`)
    const task = { id: 'original', title: '原窗口', external: true, status, cwd, lastTurnId: 'old', records: [] }
    client.tasks.set(task.id, task)
    const result = await client.continue(task.id, '继续')
    assert.equal(queued.length, 1)
    assert.equal(queued[0].threadId, task.id)
    assert.equal(queued[0].text, '继续')
    assert.equal(result.status, 'queued')
    assert.match(result.message, /已排队.*原 Codex 会话/)
    assert.equal(result.turnId, undefined)
    assert.equal(task.status, status)
    assert.equal(task.managedTurnId, undefined)
  }
})

test('an uncertain external queue is not resubmitted and keeps read-only rollout monitoring', async t => {
  let calls = 0
  const client = new DeviceCodex({ queueMessage: async () => {
    calls++
    throw Object.assign(new Error('unknown'), { submissionUncertain: true })
  }, rolloutReader: { read: async () => ({ turnId: 'old', status: 'completed', items: [], modifiedAt: Date.now() }) } })
  t.after(() => client.shutdown()); client.status = 'ready'
  client.tasks.set('original', { id: 'original', title: '原窗口', cwd, external: true,
    rolloutPath: 'fixture', status: 'completed', lastTurnId: 'old', records: [] })
  client.request = async method => assert.fail(`must not claim writer ownership: ${method}`)
  await assert.rejects(client.continue('original', '继续'), /确认/)
  await client.refresh()
  await assert.rejects(client.continue('original', '继续'), /确认/)
  assert.equal(calls, 1)
})

test('writer ownership conflict is not reported as a login or project permission problem', () => {
  assert.match(codexFailure('thread original already has an active writer'), /原.*窗口.*持有/)
  assert.doesNotMatch(codexFailure('thread original already has an active writer'), /登录|权限/)
})

test('context loss after queue acknowledgement never tells the user to resubmit the queued message', async t => {
  let current = true, calls = 0
  const client = new DeviceCodex({ queueMessage: async () => { calls++; current = false } })
  t.after(() => client.shutdown()); client.status = 'ready'
  client.tasks.set('original', { id: 'original', title: '原窗口', cwd, external: true,
    status: 'completed', lastTurnId: 'old', records: [] })
  await assert.rejects(client.continue('original', '继续', { isCurrent: () => current }), /确认.*不要重复发送/)
  await assert.rejects(client.continue('original', '继续'), /确认/)
  assert.equal(calls, 1)
})

test('remote messages can queue to a running companion-owned task without interrupting its current turn', async t => {
  const queued = []
  const client = new DeviceCodex({ queueMessage: async value => queued.push(value) })
  t.after(() => client.shutdown()); client.status = 'ready'
  client.tasks.set('owned', { id: 'owned', title: '新建任务', cwd, status: 'inProgress', turnId: 'running', records: [] })
  client.request = async method => assert.fail(`queue must not interrupt the live turn: ${method}`)
  const answer = await client.continue('owned', '再增加一个检查', { queueWhileActive: true })
  assert.equal(answer.status, 'queued')
  assert.equal(queued[0].text, '再增加一个检查')
  assert.equal(client.tasks.get('owned').turnId, 'running')
})
