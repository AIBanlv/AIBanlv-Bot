import { randomUUID } from 'node:crypto'
import { open, realpath, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { launchDesktop } from './desktop-launch.mjs'

// Adapted from aibanlv-harness-plugin's public Host service and loopback bridge pattern.
// Model authentication stays entirely inside the user's Harness Host.
export const name = 'aibanlv-control-bridge'
export const inject = ['llm', 'agents']
const route = { provider: 'deepseek-account', model: 'deepseek-flash' }
const defaultFile = () => path.join(process.env.APPDATA || (process.platform === 'darwin'
  ? path.join(homedir(), 'Library/Application Support') : path.join(homedir(), '.config')), 'Control Device', 'harness-connection.json')
export async function readConnection(file) {
  const handle = await open(file, 'r')
  try {
    const info = await handle.stat()
    if (!info.isFile() || info.size > 4096) throw new Error('INVALID_CONNECTION')
    const bytes = Buffer.alloc(4097), { bytesRead } = await handle.read(bytes, 0, bytes.length, 0)
    if (bytesRead > 4096) throw new Error('INVALID_CONNECTION')
    const value = JSON.parse(bytes.subarray(0, bytesRead).toString('utf8')), url = new URL(value.endpoint)
    if (value.version !== 1 || url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port ||
        url.username || url.password || url.pathname !== '/' || url.search || url.hash || !/^[a-f0-9]{64}$/.test(value.token)) throw new Error('INVALID_CONNECTION')
    return value
  } finally { await handle.close() }
}
export async function modelText(ctx, text, signal) {
  let output = '', finished = false
  for await (const chunk of ctx.get('llm').stream({ ...route, maxTokens: 2048,
    messages: [{ role: 'user', content: [{ type: 'text', text }] }], signal })) {
    signal.throwIfAborted()
    if (chunk.type === 'text-delta') { output += chunk.text; if (output.length > 16000) throw new Error('OUTPUT_LIMIT') }
    if (chunk.type === 'finish') { if (chunk.reason?.kind !== 'stop') throw new Error('INCOMPLETE'); finished = true }
  }
  if (!finished || !output.trim()) throw new Error('INCOMPLETE')
  return output
}
export async function runHostTask(ctx, text, signal, workspace) {
  let cwd
  try {
    if (typeof workspace !== 'string' || !path.isAbsolute(workspace)) throw new Error()
    cwd = await realpath(workspace)
    if (path.relative(workspace, cwd) || !(await stat(cwd)).isDirectory()) throw new Error()
  } catch { throw new Error('HARNESS_WORKSPACE_REQUIRED') }
  signal.throwIfAborted()
  const id = randomUUID(); let handle, partial = '', output = '', finish
  const done = new Promise((resolve, reject) => { finish = (error, value) => error ? reject(error) : resolve(value) })
  // Cancellation can arrive while the Host is still creating the agent.
  void done.catch(() => {})
  // Public, committed output only; reasoning and tool arguments never cross the bridge.
  const unstream = ctx.on('agent/assistant-stream', ({ agent, frame }) => {
    if (agent?.session?.id !== id) return
    if (frame.type === 'start') partial = ''
    if (frame.type === 'chunk' && frame.chunk?.type === 'text-delta') partial = (partial + frame.chunk.text).slice(-16000)
    if (frame.type === 'end' && frame.outcome?.kind === 'committed' && frame.outcome.eventType === 'assistant/message') output = partial
  })
  const unevent = ctx.on('session/event', (session, event) => {
    if (session.id === id && event.type === 'turn/end') {
      if (event.data.reason?.kind === 'completed') finish(null, output || 'Harness 已结束本轮任务，请查看客户端会话结果。')
      else finish(new Error('TASK_NOT_COMPLETED'))
    }
  })
  const cancel = () => { handle?.agent.cancel({ kind: 'user' }); finish(new Error('CANCELLED')) }
  signal.addEventListener('abort', cancel, { once: true })
  try {
    signal.throwIfAborted()
    handle = await ctx.get('agents').create({ sessionId: id, agentOptions: route,
      meta: { cwd }, signal })
    signal.throwIfAborted()
    handle.agent.followup({ id: randomUUID(), role: 'user', source: { kind: 'user' },
      content: [{ type: 'text', text: `来自 AIBanlv 数字人的用户任务：\n${text}` }] })
    const result = await done
    await handle.agent.whenIdle()
    return result
  } finally {
    signal.removeEventListener('abort', cancel); unstream(); unevent()
    if (signal.aborted) handle?.agent.cancel({ kind: 'user' })
    await handle?.dispose()
  }
}
async function readPoll(response) {
  const chunks = []; let size = 0
  for await (const chunk of response.body) {
    size += chunk.length
    if (size > 512 * 1024) throw new Error('RESPONSE_LIMIT')
    chunks.push(Buffer.from(chunk))
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}
async function deliverResult(post, value, signal) {
  // Retry only the completed result, never the model or computer task. A 409
  // also ends delivery: the job was already accepted, cancelled or superseded.
  for (let attempt = 0; attempt < 3; attempt++) {
    signal.throwIfAborted()
    try {
      const response = await post('/v1/result', value, signal)
      await response.body?.cancel()
      if (response.ok || response.status === 409) return
    } catch { signal.throwIfAborted() }
    if (attempt < 2) await delay(250 * 2 ** attempt, undefined, { signal })
  }
  throw new Error('RESULT_DELIVERY_FAILED')
}
export function apply(ctx, config = {}, { launch = launchDesktop } = {}) {
  const lifetime = new AbortController(), jobs = new Map()
  let sourceId = randomUUID(), polling = false
  const reset = () => { sourceId = randomUUID(); for (const controller of jobs.values()) controller.abort(); jobs.clear() }
  ctx.on('deepseek-account/signed-out', reset)
  ctx.on('credentials/record-updated', key => { if (key === 'deepseek-account-platform/default') reset() })
  const poll = async () => {
    if (polling || lifetime.signal.aborted) return
    polling = true
    try {
      const owner = sourceId
      const peer = await readConnection(config.connectionFile || defaultFile())
      const state = await ctx.get('deepseekAccount')?.getState()
      if (owner !== sourceId || lifetime.signal.aborted) return
      const post = (endpoint, value, signal) => fetch(peer.endpoint + endpoint, { method: 'POST', redirect: 'error',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${peer.token}` }, body: JSON.stringify(value),
        signal: AbortSignal.any([lifetime.signal, AbortSignal.timeout(3000), ...(signal ? [signal] : [])]) })
      const response = await post('/v1/poll', { sourceId: owner, signedIn: state?.status === 'credential-stored', taskProtocol: 2 })
      if (!response.ok) { await response.body?.cancel(); reset(); return }
      const value = await readPoll(response)
      if (owner !== sourceId || lifetime.signal.aborted) return
      if (!Array.isArray(value.jobs) || value.jobs.length > 4 || !Array.isArray(value.active) || value.active.length > 4) return
      for (const [id, controller] of jobs) if (!value.active.includes(id)) controller.abort()
      for (const job of value.jobs) {
        if (jobs.has(job.id) || !/^[a-f0-9-]{36}$/.test(job.id) || !['run', 'llm'].includes(job.operation) || typeof job.text !== 'string' || job.text.length > 16000) continue
        const controller = new AbortController(); jobs.set(job.id, controller)
        const signal = AbortSignal.any([lifetime.signal, controller.signal, AbortSignal.timeout(120000)])
        void (async () => {
          let result
          try { result = { ok: true, text: await (job.operation === 'run' ? runHostTask(ctx, job.text, signal, job.cwd) : modelText(ctx, job.text, signal)) } }
          catch { result = { ok: false } }
          if (owner === sourceId && !signal.aborted) {
            await deliverResult(post, { sourceId: owner, id: job.id, ...result }, signal)
          }
        })().catch(() => {
          // Invalidate the lease after delivery is exhausted so waiting calls
          // fail on connection loss instead of occupying slots for two minutes.
          if (owner === sourceId && !signal.aborted) reset()
        }).finally(() => { jobs.delete(job.id) })
      }
    } catch { reset() } finally { polling = false }
  }
  ctx.effect(() => {
    if (config.autoStart !== false) void launch({ automatic: true,
      ...(config.connectionFile ? { directory: path.dirname(config.connectionFile) } : {}) })
      .catch(() => console.warn('[AIBanlv] Desktop launch unavailable; open AIBanlv manually or rerun source setup.'))
    const timer = setInterval(() => { void poll() }, 1000)
    void poll()
    return () => { lifetime.abort(); clearInterval(timer); reset() }
  })
}
