import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { LocalAttachmentStore } from '@deepseek-ai/dsh-attachment-local'
import sharp from 'sharp'
import { mountComputerTools } from '../electron/device-computer-use.mjs'
import { computerTarget, validateComputer } from '../electron/device-computer-policy.mjs'
import { controlProfile } from '../electron/device-assistant-runtime.mjs'
import { deviceDependencyNames } from '../electron/device-package.mjs'
import { AssistantProcess } from '../electron/device-assistant-process.mjs'
import { AssistantService } from '../electron/device-assistant-service.mjs'

test('computer-use profile is platform-gated, pinned and does not import the upstream shell bundle', () => {
  const entries = controlProfile('test-home')
  assert.equal(entries.some(entry => entry.id === 'control-computer-use'), process.platform === 'win32')
  assert.doesNotMatch(JSON.stringify(entries), /cordis\.patch|tool-pwsh|tool-bash|tool-fs/)
  assert.ok(deviceDependencyNames({ dependencies: { fflate: '0.8.2' } }, 'win32').includes('dsh-computer-use-mode'))
  assert.ok(!deviceDependencyNames({ dependencies: {} }, 'darwin').includes('dsh-computer-use-mode'))
  assert.equal(validateComputer('computer', { action: 'windows' }).observation, true)
  assert.equal(validateComputer('computer', { action: 'click', x: 10, y: 20 }).observation, false)
  assert.equal(computerTarget({ y: 2, x: 1 }), computerTarget({ x: 1, y: 2 }))
  for (const args of [{ action: 'shortcut', keys: ['win', 'r'] }, { action: 'focus_window', title: 'PowerShell' },
    { action: 'type', text: 'x'.repeat(513) }, { action: 'click', x: 10, y: 20, sleep: 120000 }]) {
    assert.throws(() => validateComputer('computer', args))
  }
  assert.throws(() => validateComputer('computer_batch', { actions: [{ action: 'type', text: 'send' }] }))
})

test('native actions require the authenticated broker and first captures remain lossless JSON with images', async t => {
  const requests = [], nativeCalls = [], registered = new Map()
  let allowed = false, foreground = 'Local fixture'
  const server = createServer(async (request, response) => {
    assert.equal(request.headers.authorization, `Bearer ${'a'.repeat(64)}`)
    let text = ''; for await (const part of request) text += part
    requests.push(JSON.parse(text))
    response.writeHead(allowed ? 200 : 409, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify(allowed ? { authorized: true } : { message: 'fixture denied' }))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve) }))
  const upstream = { apply(ctx) {
    for (const name of ['computer', 'computer_batch']) ctx.tools.register({ name, description: 'fixture',
      output: { render: (_args, value) => [{ type: 'text', text: value.status }, ...value.images || []] },
      execute: async args => {
        nativeCalls.push(args.action)
        if (args.action === 'windows') return { foreground: { title: foreground }, windows: [] }
        return { status: 'ok', screenshot: { changed: undefined }, images: [{ type: 'image', attachment: { attachmentId: 'fixture' } }] }
      } })
  } }
  mountComputerTools({ tools: { register: tool => registered.set(tool.name, tool) }, get: () => undefined }, upstream,
    { endpoint: `http://127.0.0.1:${server.address().port}/tools`, token: 'a'.repeat(64), outputDirectory: 'fixture' })
  const exec = { callId: 'fixture-call', agent: { session: { id: 'fixture-session' } }, signal: new AbortController().signal }
  await assert.rejects(registered.get('computer').execute({ action: 'screenshot' }, exec), /fixture denied/)
  assert.deepEqual(nativeCalls, [])
  allowed = true
  const value = await registered.get('computer').execute({ action: 'screenshot' }, exec)
  assert.equal(Object.hasOwn(value.screenshot, 'changed'), false)
  assert.equal(JSON.parse(JSON.stringify(value)).images.length, 1)
  assert.equal(requests[1].sessionId, 'fixture-session')
  foreground = 'Windows Terminal'
  await assert.rejects(registered.get('computer').execute({ action: 'click', x: 1, y: 1 }, exec), /停止电脑操作/)
  assert.ok(!nativeCalls.includes('click'))
  const stopped = new AbortController(); stopped.abort()
  await assert.rejects(registered.get('computer').execute({ action: 'screenshot' }, { ...exec, signal: stopped.signal }))
})

test('official attachment service stores and projects a real synthetic image without a provider request', async t => {
  const home = await mkdtemp(path.resolve('artifacts/computer-attachments-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  const ctx = new Context()
  const store = new LocalAttachmentStore(ctx, { dshHome: home })
  const image = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#44ccbb' } }).png().toBuffer()
  const ref = await store.saveImage({ data: image, mediaType: 'image/png', name: 'fixture.png' })
  assert.match(ref.attachmentId, /^sha256:/)
  assert.equal(ref.width, 2)
  const saved = await store.readImage(ref)
  assert.ok(saved)
})

test('ACP computer permits preserve exact arguments and GUI input fails closed without confirmation', async () => {
  const calls = []
  const process = new AssistantProcess({ launch: {}, onToolCall: (...args) => calls.push(args) })
  process.sessionId = 'session'; process.turn = { signal: new AbortController().signal }
  process.accept({ sessionId: 'session', update: { sessionUpdate: 'tool_call', title: 'computer', toolCallId: 'call', rawInput: { y: 20, action: 'click', x: 10 } } })
  assert.deepEqual(calls[0], ['session', 'call', { name: 'computer', target: computerTarget({ action: 'click', x: 10, y: 20 }) }])
  const service = new AssistantService({ settings: {}, root: 'fixture' })
  const action = { name: 'computer', target: computerTarget({ action: 'click', x: 10, y: 20 }) }
  const signal = new AbortController().signal
  await assert.rejects(service.runAction(action, signal), { code: 'ACTION_DENIED' })
  service.active = { task: 'fixture task' }
  await assert.rejects(service.runAction(action, signal), { code: 'ACTION_DENIED' })
})
