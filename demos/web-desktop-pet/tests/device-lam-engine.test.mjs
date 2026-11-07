import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { LamEngine, packagedLamPaths } from '../electron/device-lam-engine.mjs'

test('installed inference resolves only bundled runtime files, including paths with spaces', () => {
  const root = path.resolve('fixture install/runtime')
  const tools = packagedLamPaths(root, 'win32')
  assert.deepEqual(tools, {
    python: path.join(root, 'python/python.exe'),
    source: path.join(root, 'model'),
    java: path.join(root, 'java/bin/java.exe'),
    classpath: [path.join(root, 'control/classes'), path.join(root, 'control/gson.jar')].join(path.delimiter),
    library: path.join(root, 'control/AIBANLVKeyframeFace.json'),
  })
  assert.throws(() => packagedLamPaths('relative/runtime'))
})

test('Mac installed inference uses bundled native worker and Java', () => {
  const root = path.resolve('fixture install/runtime')
  const tools = packagedLamPaths(root, 'darwin')
  assert.equal(tools.python, path.join(root, 'mac/lam-worker'))
  assert.equal(tools.java, path.join(root, 'java/bin/java'))
})

test('a cached engine with an exited Python worker cannot pass preparation', async () => {
  const python = { dead: false }, java = { dead: false, request: async () => ({}) }
  const engine = new LamEngine(python, java, {})
  await engine.reset()
  python.dead = true
  await assert.rejects(engine.reset(), { code: 'LAM_UNAVAILABLE' })
})

test('worker death during Control reset is checked again before preparation succeeds', async () => {
  const python = { dead: false }
  const java = { dead: false, request: async () => { python.dead = true } }
  const engine = new LamEngine(python, java, {})
  await assert.rejects(engine.reset(), { code: 'LAM_UNAVAILABLE' })
  java.dead = true
  await assert.rejects(engine.reset(), { code: 'LAM_UNAVAILABLE' })
})

test('Control reply bridge passes raw bounded text and rejects invalid input without RPC', async () => {
  const requests = []
  const engine = new LamEngine({}, { request: async value => { requests.push(value) } }, {})
  await engine.reply('[E:surprised]你好', '请惊讶')
  assert.deepEqual(requests, [{ action: 'reply', text: '[E:surprised]你好', userText: '请惊讶' }])
  for (const [text, user] of [[null, ''], ['x'.repeat(16001), ''], ['', 'x'.repeat(1001)]]) {
    await assert.rejects(engine.reply(text, user), { code: 'LAM_UNAVAILABLE' })
  }
  assert.equal(requests.length, 1)
})
