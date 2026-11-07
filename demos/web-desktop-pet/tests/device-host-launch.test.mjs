import test from 'node:test'
import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { serveDesktopMcp } from '../harness-client-plugin/desktop-mcp.mjs'
import { apply } from '../harness-client-plugin/plugin.mjs'

const flush = () => new Promise(resolve => setImmediate(resolve))
test('MCP starts once at initialization and permits only explicit open/status without command arguments', async () => {
  const input = new PassThrough(), output = new PassThrough(), responses = [], launches = []
  output.setEncoding('utf8'); output.on('data', chunk => responses.push(...chunk.trim().split('\n').map(JSON.parse)))
  const pending = serveDesktopMcp({ input, output, launch: async options => { launches.push(options); return { status: 'launched' } },
    status: async () => ({ configured: true }) })
  const send = (id, method, params) => input.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
  send(1, 'initialize', { protocolVersion: '2025-06-18' })
  send(2, 'initialize', { protocolVersion: '2025-06-18' })
  send(3, 'tools/list')
  send(4, 'tools/call', { name: 'aibanlv_open', arguments: { command: 'untrusted' } })
  send(5, 'tools/call', { name: 'aibanlv_open', arguments: {} })
  send(6, 'tools/call', { name: 'aibanlv_status' })
  send(7, 'tools/call', { name: 'shell' })
  input.end(); await pending
  assert.equal(responses[0].result.protocolVersion, '2025-06-18')
  assert.deepEqual(responses.find(r => r.id === 3).result.tools.map(t => t.name), ['aibanlv_open', 'aibanlv_status'])
  assert.equal(responses.find(r => r.id === 4).error.code, -32602)
  assert.equal(responses.find(r => r.id === 7).error.code, -32602)
  assert.equal(responses.find(r => r.id === 6).result.content[0].text, '{"configured":true}')
  assert.deepEqual(launches, [{ automatic: true }, { automatic: false }])
})

test('automatic launch failure does not break MCP discovery or cause a retry loop', async () => {
  const input = new PassThrough(), output = new PassThrough(); let calls = 0, text = ''
  output.on('data', chunk => { text += chunk })
  const pending = serveDesktopMcp({ input, output, launch: async () => { calls++; throw new Error('fixture failure') } })
  input.end('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}\n{"jsonrpc":"2.0","id":2,"method":"tools/list"}\n')
  await pending
  assert.equal(calls, 1)
  assert.equal(JSON.parse(text.trim().split('\n')[1]).result.tools.length, 2)
})

test('MCP rejects malformed and oversized input with bounded responses', async () => {
  const input = new PassThrough(), output = new PassThrough(); let text = ''
  output.on('data', chunk => { text += chunk })
  const pending = serveDesktopMcp({ input, output })
  input.end(`not json\n${'x'.repeat(65537)}`)
  await pending
  assert.ok(text.length < 1024)
  assert.match(text, /-32700/); assert.match(text, /-32600/)
})

test('Harness starts once per plugin activation and honors autoStart false', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'aibanlv-host-launch-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const effects = [], launches = []
  const ctx = { on: () => () => {}, get: () => undefined, effect: work => effects.push(work()) }
  apply(ctx, { connectionFile: path.join(directory, 'connection.json') }, { launch: async options => launches.push(options) })
  await flush(); effects.splice(0).forEach(dispose => dispose())
  assert.deepEqual(launches, [{ automatic: true, directory }])
  apply(ctx, { connectionFile: path.join(directory, 'connection.json'), autoStart: false }, { launch: async options => launches.push(options) })
  await flush(); effects.splice(0).forEach(dispose => dispose())
  assert.equal(launches.length, 1)
})

test('Codex package carries a trusted-lifecycle hook with a portable plugin-root reference', async () => {
  const directory = new URL('../harness-client-plugin/', import.meta.url)
  const manifest = JSON.parse(await readFile(new URL('.codex-plugin/plugin.json', directory), 'utf8'))
  const hooks = JSON.parse(await readFile(new URL(manifest.hooks, directory), 'utf8'))
  const event = hooks.hooks.SessionStart[0]
  assert.equal(event.matcher, 'startup|resume')
  assert.match(event.hooks[0].command, /PLUGIN_ROOT/)
  const encoded = event.hooks[0].commandWindows.split(' -EncodedCommand ')[1]
  assert.match(Buffer.from(encoded, 'base64').toString('utf16le'), /Join-Path \$env:PLUGIN_ROOT 'run.ps1'/)
  assert.equal(event.hooks[0].timeout, 10)
})
