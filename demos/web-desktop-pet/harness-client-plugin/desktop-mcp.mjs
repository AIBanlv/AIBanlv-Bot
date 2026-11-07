import { once } from 'node:events'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchDesktop, launchStatus } from './desktop-launch.mjs'

const tools = [
  { name: 'aibanlv_open', description: 'Open the local AIBanlv desktop companion. Also resumes host launch after a manual quit.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'aibanlv_status', description: 'Read whether local desktop launch is configured, enabled or paused. Does not report process readiness.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true } },
]

export async function serveDesktopMcp({ input = process.stdin, output = process.stdout, launch = launchDesktop, status = launchStatus } = {}) {
  let buffer = '', initialized = false
  const send = async value => { if (!output.write(`${JSON.stringify({ jsonrpc: '2.0', ...value })}\n`)) await once(output, 'drain') }
  const error = (id, code, message) => send({ id: id ?? null, error: { code, message } })
  const handle = async line => {
    let message
    try { message = JSON.parse(line) } catch { await error(null, -32700, 'Parse error'); return }
    if (!message || message.jsonrpc !== '2.0' || typeof message.method !== 'string') { await error(null, -32600, 'Invalid request'); return }
    if (!Object.hasOwn(message, 'id')) return
    const { id, method, params } = message
    if (method === 'initialize') {
      await send({ id, result: { protocolVersion: ['2025-11-25', '2025-06-18', '2024-11-05'].includes(params?.protocolVersion) ? params.protocolVersion : '2025-06-18',
        capabilities: { tools: {} }, serverInfo: { name: 'aibanlv-desktop', version: '0.2.0' } } })
      if (!initialized) { initialized = true; await launch({ automatic: true }).catch(() => {}) }
    } else if (!initialized) await error(id, -32000, 'Initialize first')
    else if (method === 'ping') await send({ id, result: {} })
    else if (method === 'tools/list') await send({ id, result: { tools } })
    else if (method === 'tools/call') {
      if (!tools.some(tool => tool.name === params?.name) ||
          (params.arguments !== undefined && (!params.arguments || Array.isArray(params.arguments) || typeof params.arguments !== 'object' || Object.keys(params.arguments).length))) {
        await error(id, -32602, 'Unknown tool or unexpected arguments'); return
      }
      try {
        const value = await (params.name === 'aibanlv_open' ? launch({ automatic: false }) : status())
        await send({ id, result: { content: [{ type: 'text', text: JSON.stringify(value) }] } })
      } catch {
        await send({ id, result: { isError: true, content: [{ type: 'text', text: 'AIBanlv launch unavailable. Run source setup or open the installed app once.' }] } })
      }
    } else await error(id, -32601, 'Method not found')
  }
  input.setEncoding('utf8')
  for await (const chunk of input) {
    buffer += chunk
    let end
    while ((end = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, end); buffer = buffer.slice(end + 1)
      if (Buffer.byteLength(line) > 65536) { await error(null, -32600, 'Request too large'); return }
      if (line.trim()) await handle(line)
    }
    if (Buffer.byteLength(buffer) > 65536) { await error(null, -32600, 'Request too large'); return }
  }
  if (buffer.trim()) await handle(buffer)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await serveDesktopMcp().catch(error => { console.error(`[AIBanlv MCP] ${error.code || error.name}`); process.exitCode = 1 })
}
