import test from 'node:test'
import assert from 'node:assert/strict'
import { reviewTaskRequest } from '../electron/device-task-review.mjs'

const task = { instruction: 'inspect this project', cwd: process.cwd(), status: 'inProgress' }
const methods = ['item/commandExecution/requestApproval', 'item/fileChange/requestApproval',
  'item/permissions/requestApproval', 'item/tool/requestUserInput']
const denied = method => method === methods[2] ? { permissions: {}, scope: 'turn' }
  : method === methods[3] ? { answers: {} } : { decision: 'decline' }

test('model allow never substitutes for a local user response', async () => {
  for (const method of methods) {
    const assistant = { review: async () => ({ decision: 'allow' }) }
    assert.deepEqual(await reviewTaskRequest({ assistant, task, method, params: {} }), denied(method))
  }
})

test('only local confirmation can grant the exact requested turn permissions', async () => {
  const params = { permissions: { network: { enabled: true } } }
  const confirm = async value => {
    assert.deepEqual(value.request, params)
    params.permissions.fileSystem = { write: ['/unreviewed'] }
    return { decision: 'allow' }
  }
  assert.deepEqual(await reviewTaskRequest({ confirm, task, method: methods[2], params }),
    { permissions: { network: { enabled: true } }, scope: 'turn' })
  for (const method of methods.slice(0, 2)) {
    assert.deepEqual(await reviewTaskRequest({ confirm: async () => ({ decision: 'allow' }), task, method, params: {} }), { decision: 'accept' })
  }
})

test('unknown, external, completed, oversized and unsupported requests never ask for approval', async () => {
  const confirm = async () => assert.fail('must not prompt')
  for (const value of [null, { ...task, external: true }, { ...task, status: 'completed' }, { ...task, cwd: '' }]) {
    assert.deepEqual(await reviewTaskRequest({ confirm, task: value, method: methods[0], params: {} }), denied(methods[0]))
  }
  assert.deepEqual(await reviewTaskRequest({ confirm, task, method: 'unknown', params: {} }), { decision: 'decline' })
  assert.deepEqual(await reviewTaskRequest({ confirm, task, method: methods[0], params: { command: 'x'.repeat(25000) } }), denied(methods[0]))
})

test('rejection, confirmation failure, timeout and cancellation all fail closed', async () => {
  for (const method of methods) {
    for (const confirm of [async () => ({ decision: 'deny' }), async () => { throw new Error('closed') }]) {
      assert.deepEqual(await reviewTaskRequest({ confirm, task, method, params: {} }), denied(method))
    }
    const controller = new AbortController()
    const confirm = async () => { controller.abort(); return { decision: 'allow' } }
    assert.deepEqual(await reviewTaskRequest({ confirm, task, method, params: {}, signal: controller.signal }), denied(method))
  }
})

test('user choices must match the options and cancelled questions never invent answers', async () => {
  const params = { questions: [{ id: 'q', question: 'Continue?', options: [{ label: 'Yes' }, { label: 'No' }] }] }
  for (const selected of ['Yes', 'invented']) {
    const confirm = async () => ({ decision: 'allow', answers: { q: selected } })
    assert.deepEqual(await reviewTaskRequest({ confirm, task, method: methods[3], params }),
      selected === 'Yes' ? { answers: { q: { answers: ['Yes'] } } } : { answers: {} })
  }
})

test('explicitly continued external turns require their own matching local confirmation', async () => {
  const managed = { ...task, id: 'thread', external: true, managedTurnId: 'continued' }
  const confirm = async () => ({ decision: 'allow' })
  assert.deepEqual(await reviewTaskRequest({ confirm, task: managed, method: methods[0],
    params: { threadId: managed.id, turnId: 'continued' } }), { decision: 'accept' })
  for (const turnId of ['previous', undefined]) {
    assert.deepEqual(await reviewTaskRequest({ confirm: async () => assert.fail('unmanaged turn must not prompt'),
      task: managed, method: methods[0], params: { threadId: managed.id, turnId } }), { decision: 'decline' })
  }
})
