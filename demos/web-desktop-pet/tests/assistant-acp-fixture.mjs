import { agent, methods, ndJsonStream, PROTOCOL_VERSION, RequestError } from '@agentclientprotocol/sdk'
import { Readable, Writable } from 'node:stream'

let sessionCount = 0, waiting
const app = agent({ name: 'fixture' })
  .onRequest(methods.agent.initialize, () => ({
    protocolVersion: PROTOCOL_VERSION, agentInfo: { name: 'deepseek-harness-acp', version: 'fixture' },
    agentCapabilities: { sessionCapabilities: { close: {} } }, authMethods: [],
  }))
  .onRequest(methods.agent.session.new, () => ({ sessionId: `session-${++sessionCount}` }))
  .onRequest(methods.agent.session.close, () => { waiting?.(); return {} })
  .onNotification(methods.agent.session.cancel, () => waiting?.())
  .onRequest(methods.agent.session.prompt, async ({ params, client }) => {
    const text = params.prompt[0].text
    if (text === 'exit') process.exit(9)
    // The real harness reports a failed turn as a JSON-RPC error carrying the
    // provider's own wording, which is the only thing that crosses the boundary.
    if (text.startsWith('fail:')) throw new RequestError(-32603, `Internal error: turn failed: ${text.slice(5)}`)
    if (text === 'wait') {
      await new Promise(resolve => { waiting = resolve })
      waiting = null
      return { stopReason: 'cancelled' }
    }
    await client.notify(methods.client.session.update, { sessionId: params.sessionId,
      update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: `result:${params.sessionId}:${text}` } } })
    return { stopReason: 'end_turn' }
  })
const connection = app.connect(ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin)))
await connection.closed
