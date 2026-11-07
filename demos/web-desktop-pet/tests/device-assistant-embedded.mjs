// Explicit integration check: embedded Harness, loopback Messages model, no paid APIs.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { prepareHarnessLaunch } from '../electron/device-assistant-runtime.mjs'
import { AssistantProcess } from '../electron/device-assistant-process.mjs'
import { allowedTools, localTools } from '../electron/device-assistant-plugin.mjs'

await mkdir('artifacts', { recursive: true })
const home = await mkdtemp(path.resolve('artifacts/harness-embedded-'))
const requests = [], calls = []
const token = 'a'.repeat(64)
const server = createServer(async (req, res) => {
  let raw = ''
  for await (const chunk of req) raw += chunk
  const body = JSON.parse(raw)
  if (req.url === '/tools') {
    assert.equal(req.headers.authorization, `Bearer ${token}`)
    calls.push(body)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ opened: true, target: body.action.target }))
    return
  }
  assert.equal(req.url, '/v1/messages')
  requests.push(body)
  res.writeHead(200, { 'Content-Type': 'text/event-stream' })
  const send = value => res.write(`event: ${value.type}\ndata: ${JSON.stringify(value)}\n\n`)
  send({ type: 'message_start', message: { id: 'fixture-message', type: 'message', role: 'assistant',
    model: body.model, content: [], usage: { input_tokens: 5, output_tokens: 0 } } })
  const first = requests.length === 1
  send({ type: 'content_block_start', index: 0, content_block: first
    ? { type: 'tool_use', id: 'fixture-call', name: 'control_open_url', input: {} }
    : { type: 'text', text: '已打开测试网页。' } })
  if (first) send({ type: 'content_block_delta', index: 0,
    delta: { type: 'input_json_delta', partial_json: JSON.stringify({ target: 'https://example.com/' }) } })
  send({ type: 'content_block_stop', index: 0 })
  send({ type: 'message_delta', delta: { stop_reason: first ? 'tool_use' : 'end_turn' }, usage: { output_tokens: 5 } })
  send({ type: 'message_stop' }); res.end()
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
let assistant
try {
  const base = `http://127.0.0.1:${server.address().port}`
  const launch = await prepareHarnessLaunch({ home,
    apiKey: 'fixture-only-key', endpoint: `${base}/tools`, token })
  launch.env.DEEPSEEK_BASE_URL = base
  assistant = new AssistantProcess({ launch, startMs: 30000, taskMs: 15000 })
  assert.equal(await assistant.run('打开测试网页'), '已打开测试网页。')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].sessionId, assistant.sessionId)
  assert.deepEqual(calls[0].action, { name: 'open_url', target: 'https://example.com/' })
  const advertised = requests[0].tools.map(tool => tool.name).sort()
  for (const tool of [...localTools, 'web_search', 'web_fetch']) assert.ok(advertised.includes(tool), tool)
  assert.ok(advertised.every(tool => allowedTools.includes(tool)))
  assert.equal(advertised.includes('computer'), advertised.includes('computer_batch'))
  assert.ok(requests[1].messages.some(message => message.content.some(block => block.type === 'tool_result')))
  console.log(JSON.stringify({ embeddedHarness: 'passed', tools: advertised,
    computerUseNativeAvailable: advertised.includes('computer'), productionRequests: 0 }))
} finally {
  await assistant?.close()
  server.closeAllConnections()
  await new Promise(resolve => server.close(resolve))
  await rm(home, { recursive: true, force: true })
}
