import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { AssistantProcess, classifyHarnessFailure } from '../electron/device-assistant-process.mjs'
import { assistantMessage } from '../electron/device-assistant-service.mjs'

function fixture(t) {
  const process = new AssistantProcess({ launch: {
    command: globalThis.process.execPath, args: [path.resolve('tests/assistant-acp-fixture.mjs')],
    cwd: globalThis.process.cwd(), env: { ...globalThis.process.env, ELECTRON_RUN_AS_NODE: '1' },
  }, startMs: 3000, cancelMs: 500 })
  t.after(() => process.close())
  return process
}
test('real stdio ACP initializes once and reuses exactly one session', async t => {
  const process = fixture(t)
  assert.equal(await process.run('one'), 'result:session-1:one')
  assert.equal(await process.run('two'), 'result:session-1:two')
  const child = process.child
  await process.close()
  assert.ok(child.exitCode !== null || child.signalCode !== null)
})
test('concurrent tasks reject; cancellation settles before another task is accepted', async t => {
  const process = fixture(t)
  await process.start()
  const abort = new AbortController()
  const pending = process.run('wait', { signal: abort.signal })
  await assert.rejects(process.run('overlap'), /ASSISTANT_BUSY/)
  setTimeout(() => abort.abort(), 50)
  await assert.rejects(pending, /ASSISTANT_CANCELLED/)
  assert.equal(await process.run('after'), 'result:session-1:after')
})
test('process loss rejects without leaking stderr or pretending success', async t => {
  const process = fixture(t)
  await assert.rejects(process.run('exit'), /HARNESS_UNAVAILABLE/)
})

test('ordinary execution keeps its task limit while internal routing permits bounded context', async t => {
  const worker = fixture(t)
  await assert.rejects(worker.run('字'.repeat(2001)), /INVALID_TASK/)
  assert.equal(worker.child, undefined, 'oversized executable tasks are refused before spawning')
  worker.maxPromptChars = 16000
  assert.match(await worker.run('字'.repeat(3000)), /^result:session-1:/)
  await assert.rejects(worker.run('字'.repeat(16001)), /INVALID_TASK/)
})
test('a stalled task times out and releases its child process', async t => {
  const process = fixture(t)
  process.taskMs = 30
  process.cancelMs = 50
  await process.start()
  await assert.rejects(process.run('wait'), /HARNESS_TIMEOUT/)
  await process.close()
  assert.equal(process.closed, true)
  assert.ok(process.child.exitCode !== null || process.child.signalCode !== null)
})

test('provider wording is classified into the one thing the user can change', t => {
  const cases = [
    ['Internal error: turn failed: Authentication Fails, Your api key: ****abcd is invalid (request_id: 1)',
      'KEY_REJECTED'],
    ['Internal error: turn failed: Insufficient Balance', 'PROVIDER_QUOTA'],
    ['Internal error: turn failed: DeepSeek Messages request failed (402)', 'PROVIDER_QUOTA'],
    ['Internal error: turn failed: Rate limit reached for requests', 'PROVIDER_BUSY'],
    ['Internal error: turn failed: DeepSeek Messages request failed (503)', 'PROVIDER_BUSY'],
    ['Internal error: turn failed: DeepSeek Messages request failed (404)', 'PROVIDER_REQUEST'],
    ['Internal error: turn failed: context length exceeded', 'PROVIDER_REQUEST'],
    ['Internal error: turn failed: Model Not Exist', 'PROVIDER_MODEL'],
    ['llm-deepseek: no API key for provider route "deepseek-official"', 'KEY_REQUIRED'],
    ['Internal error: turn failed: DeepSeek Messages transport failed', 'PROVIDER_UNREACHABLE'],
    ['connect ENOTFOUND api.deepseek.com', 'PROVIDER_UNREACHABLE'],
    ['something nobody has seen yet', 'HARNESS_UNAVAILABLE'],
    [undefined, 'HARNESS_UNAVAILABLE'],
  ]
  for (const [message, code] of cases) assert.equal(classifyHarnessFailure(message), code, String(message))
})

test('a real rejected prompt reports the classified code without echoing the provider text', async t => {
  const process = fixture(t)
  await process.start()
  const error = await process.run('fail:Authentication Fails, Your api key: ****abcd is invalid').catch(value => value)
  assert.equal(error.code, 'KEY_REJECTED')
  // The provider message can carry credential fragments; only the code escapes.
  const wire = `${error.message} ${error.stack || ''}`
  assert.equal(wire.includes('abcd'), false)
  assert.equal(error.message, 'KEY_REJECTED')
  const blocked = await process.run('fail:DeepSeek Messages transport failed').catch(value => value)
  assert.equal(blocked.code, 'PROVIDER_UNREACHABLE')
})

test('every failure a user can hit explains itself instead of sharing one sentence', t => {
  const codes = ['KEY_REQUIRED', 'KEY_REJECTED', 'PROVIDER_QUOTA', 'PROVIDER_BUSY', 'PROVIDER_UNREACHABLE',
    'PROVIDER_MODEL', 'PROVIDER_REQUEST',
    'HARNESS_UNAVAILABLE', 'HARNESS_PROTOCOL', 'HARNESS_TIMEOUT', 'HARNESS_INCOMPLETE',
    'INVALID_TASK', 'ACTION_FAILED', 'INVALID_SETTINGS']
  const messages = codes.map(code => assistantMessage(code))
  for (const message of messages) {
    assert.equal(typeof message, 'string')
    assert.equal(message.includes('未能完成任务，请检查网络和 DeepSeek Key'), false)
  }
  assert.equal(new Set(messages).size, codes.length)
  // The network hint belongs to network failures only.
  assert.match(assistantMessage('PROVIDER_UNREACHABLE'), /网络|代理/)
  assert.doesNotMatch(assistantMessage('KEY_REJECTED'), /网络/)
  assert.match(assistantMessage('KEY_REJECTED'), /Key/)
})

test('an unknown failure no longer blames the network or the Key', t => {
  assert.doesNotMatch(assistantMessage(undefined), /网络|DeepSeek Key/)
  assert.doesNotMatch(assistantMessage('SOMETHING_NEW'), /网络|DeepSeek Key/)
})
