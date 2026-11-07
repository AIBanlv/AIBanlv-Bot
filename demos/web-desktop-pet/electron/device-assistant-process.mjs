import { spawn } from 'node:child_process'
import { Readable, Writable, Transform } from 'node:stream'
import { client, methods, ndJsonStream, PROTOCOL_VERSION } from '@agentclientprotocol/sdk'
import { localTools } from './device-assistant-plugin.mjs'
import { computerTools, computerTarget } from './device-computer-policy.mjs'

export const assistantError = code => Object.assign(new Error(code), { code })
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))

// Only the provider's own wording crosses the ACP boundary, and it must never be
// forwarded: it can carry credential fragments. It is read here purely to pick a
// code, so "wrong Key", "no network" and "out of credit" stop looking identical
// to the user — they used to share one sentence blaming both network and Key.
const providerFailures = [
  [/no api key for provider|missing api key|api key is not set/i, 'KEY_REQUIRED'],
  [/authentication fails|api key[^\n]*invalid|invalid[^\n]*api key|unauthori[sz]ed|authentication_error|permission_error/i, 'KEY_REJECTED'],
  [/insufficient balance|quota|payment required|request failed \(402\)/i, 'PROVIDER_QUOTA'],
  [/rate limit|too many requests|overloaded|api_error|request failed \(429\)|request failed \(5\d\d\)/i, 'PROVIDER_BUSY'],
  [/model[^\n]*(?:not exist|not found|no access|unsupported|not available|not allowed)|unknown model|invalid model/i, 'PROVIDER_MODEL'],
  [/context window|context length|request failed \(4\d\d\)|invalid_request|too long/i, 'PROVIDER_REQUEST'],
  [/transport failed|fetch failed|socket hang up|network|timed? ?out|econnrefused|econnreset|enotfound|eai_again|certificate|self.signed/i, 'PROVIDER_UNREACHABLE'],
]
export function classifyHarnessFailure(message) {
  if (typeof message !== 'string') return 'HARNESS_UNAVAILABLE'
  for (const [pattern, code] of providerFailures) if (pattern.test(message)) return code
  return 'HARNESS_UNAVAILABLE'
}
async function bounded(work, ms) {
  let timer
  try {
    return await Promise.race([work, new Promise((_, reject) => {
      timer = setTimeout(() => reject(assistantError('HARNESS_TIMEOUT')), ms)
    })])
  } finally { clearTimeout(timer) }
}

export class AssistantProcess {
  constructor({ launch, startMs = 30000, taskMs = 90000, cancelMs = 2000, maxPromptChars = 2000,
    onStatus = () => {}, onToolCall = () => {}, onActivity = () => {}, log = null }) {
    Object.assign(this, { launch, startMs, taskMs, cancelMs, onStatus, onToolCall, onActivity, log })
    this.maxPromptChars = Math.min(16000, Math.max(2000, Number.isSafeInteger(maxPromptChars) ? maxPromptChars : 2000))
    this.startedAt = Date.now()
  }
  trace(name, fields) { this.log?.event(`harness.${name}`, fields) }
  start() {
    if (this.closed) return Promise.reject(assistantError('HARNESS_UNAVAILABLE'))
    this.starting ||= this.initialize().catch(async error => {
      // Everything the provider said lives here and nowhere else: the code shown
      // to the user is a category, the wording is what names the real cause.
      this.trace('start-failed', { code: error.code, message: error.message, stderr: this.stderrTail })
      await this.close()
      throw assistantError('HARNESS_UNAVAILABLE')
    })
    return this.starting
  }
  async initialize() {
    const { command, args, cwd, env } = this.launch
    const child = this.child = spawn(command, args, { cwd, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    this.trace('spawn', { command, args: args.length, cwd, env: Object.keys(env).sort().join(',') })
    this.exited = new Promise(resolve => {
      child.once('close', code => { this.trace('exit', { code, stderr: this.stderrTail }); resolve(code) })
      child.once('error', error => { this.trace('spawn-error', { message: error.message }); resolve() })
    })
    // The child writes the provider's complaint to stderr; it used to be drained
    // and dropped, which is why a rejected Key had no evidence anywhere.
    this.stderrTail = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', chunk => { this.stderrTail = (this.stderrTail + chunk).slice(-8192) })
    // Bound each NDJSON frame before the ACP library decodes it.
    let lineBytes = 0
    const limited = new Transform({ transform(chunk, _encoding, done) {
      for (const byte of chunk) {
        lineBytes = byte === 10 ? 0 : lineBytes + 1
        if (lineBytes > 1024 * 1024) { done(assistantError('HARNESS_PROTOCOL')); return }
      }
      done(null, chunk)
    } })
    limited.on('error', () => { child.kill(); this.connection?.close() })
    child.stdout.pipe(limited)
    this.connection = client({ name: 'control-windows' })
      .onRequest(methods.client.session.requestPermission, () => ({ outcome: { outcome: 'cancelled' } }))
      .onNotification(methods.client.session.update, ({ params }) => this.accept(params))
      .connect(ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(limited)))
    this.connection.closed.catch(() => {})
    this.exited.then(() => this.connection.close())
    await bounded((async () => {
      const initialized = await this.connection.agent.request(methods.agent.initialize,
        { protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
      if (initialized.protocolVersion !== PROTOCOL_VERSION || initialized.agentInfo?.name !== 'deepseek-harness-acp') {
        throw assistantError('HARNESS_PROTOCOL')
      }
      this.trace('ready', { ms: Date.now() - this.startedAt, agent: initialized.agentInfo?.name, version: initialized.agentInfo?.version })
      const session = await this.connection.agent.request(methods.agent.session.new, { cwd, mcpServers: [] })
      if (typeof session.sessionId !== 'string' || !session.sessionId || session.sessionId.length > 256) throw assistantError('HARNESS_PROTOCOL')
      this.sessionId = session.sessionId
      this.trace('session', { ms: Date.now() - this.startedAt })
    })(), this.startMs)
  }
  accept({ sessionId, update }) {
    const turn = this.turn
    if (!turn || sessionId !== this.sessionId || turn.signal.aborted) return
    if (update.sessionUpdate === 'tool_call' && localTools.includes(update.title)) {
      this.onToolCall(sessionId, update.toolCallId, { name: update.title.slice(8), target: update.rawInput?.target })
    }
    if (update.sessionUpdate === 'tool_call' && computerTools.includes(update.title)) {
      this.onToolCall(sessionId, update.toolCallId, { name: update.title, target: computerTarget(update.rawInput || {}) })
    }
    if (update.sessionUpdate === 'agent_message_chunk' && update.content?.type === 'text') {
      if (update.messageId && turn.messageId !== update.messageId) {
        turn.text = ''
        turn.messageId = update.messageId
      }
      turn.text += update.content.text
      this.onActivity({ kind: 'message', text: turn.text, key: turn.messageId || 'reply' })
      if (turn.text.length > 16000) { this.connection.close(assistantError('HARNESS_PROTOCOL')); return }
    }
    if (update.sessionUpdate === 'plan') this.onActivity({ kind: 'plan', text: (update.entries || []).map(entry => `${entry.status}: ${entry.content}`).join('\n'), key: 'plan' })
    if (['tool_call', 'tool_call_update'].includes(update.sessionUpdate)) {
      this.onStatus('working')
      if (typeof update.title === 'string') this.onActivity({ kind: 'tool', text: update.title.slice(0, 500), key: update.toolCallId || 'tool' })
    }
  }
  async run(text, { signal = new AbortController().signal, context = '' } = {}) {
    if (this.turn) throw assistantError('ASSISTANT_BUSY')
    if (typeof text !== 'string' || !text.trim() || text.length > this.maxPromptChars) throw assistantError('INVALID_TASK')
    if (typeof context !== 'string' || context.length > 300) throw assistantError('INVALID_TASK')
    const turn = { signal, text: '', messageId: '' }
    this.turn = turn
    this.timedOut = false
    const startedAt = Date.now()
    this.trace('prompt', { chars: text.length, text: text.slice(0, 120) })
    let cancelTimer, taskTimer
    const cancel = () => {
      if (this.sessionId) this.connection.agent.notify(methods.agent.session.cancel, { sessionId: this.sessionId }).catch(() => {})
      cancelTimer ||= setTimeout(() => { this.close().catch(() => {}) }, this.cancelMs)
    }
    signal.addEventListener('abort', cancel, { once: true })
    try {
      signal.throwIfAborted()
      await this.start()
      signal.throwIfAborted()
      this.onStatus('working')
      // Closing the child is how a stalled turn is abandoned, so remember why:
      // the ACP request then only reports a closed connection, and "timed out"
      // is a far more useful answer than "the component failed to start".
      taskTimer = setTimeout(() => { this.timedOut = true; this.close().catch(() => {}) }, this.taskMs)
      const result = await this.connection.agent.request(methods.agent.session.prompt,
        { sessionId: this.sessionId, prompt: [{ type: 'text', text: context ? `${context}\n${text}` : text }] })
      if (signal.aborted || result.stopReason === 'cancelled') throw assistantError('ASSISTANT_CANCELLED')
      if (result.stopReason !== 'end_turn' || !turn.text.trim()) throw assistantError('HARNESS_INCOMPLETE')
      this.trace('answer', { ms: Date.now() - startedAt, chars: turn.text.length })
      return turn.text.trim()
    } catch (error) {
      if (signal.aborted) throw assistantError('ASSISTANT_CANCELLED')
      if (['HARNESS_INCOMPLETE', 'INVALID_TASK'].includes(error.code)) throw assistantError(error.code)
      if (this.timedOut) { this.trace('timeout', { ms: Date.now() - startedAt, stderr: this.stderrTail }); throw assistantError('HARNESS_TIMEOUT') }
      const code = classifyHarnessFailure(error?.message)
      // The provider's sentence is the only thing that distinguishes the six
      // reasons; it reaches the log scrubbed, and only the code reaches the user.
      this.trace('failed', { ms: Date.now() - startedAt, code, message: error?.message, stderr: this.stderrTail })
      throw assistantError(code)
    } finally {
      clearTimeout(taskTimer); clearTimeout(cancelTimer)
      signal.removeEventListener('abort', cancel)
      if (this.turn === turn) this.turn = null
    }
  }
  close() {
    this.closed = true
    this.closing ||= this.dispose()
    return this.closing
  }
  async dispose() {
    if (!this.child) return
    if (this.sessionId && !this.connection.signal.aborted) {
      await bounded(this.connection.agent.request(methods.agent.session.close, { sessionId: this.sessionId }), this.cancelMs).catch(() => {})
    }
    this.connection?.close()
    this.child.stdin.end()
    if (await Promise.race([this.exited.then(() => true), pause(250).then(() => false)])) return
    this.child.kill()
    await bounded(this.exited, 5000)
  }
}
