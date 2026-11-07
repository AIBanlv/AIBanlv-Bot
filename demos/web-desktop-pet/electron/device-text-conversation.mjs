import { randomUUID } from 'node:crypto'
import { NATURAL_CHAT_INSTRUCTIONS } from '../src/natural-messages.mjs'
import { validateTaskRoute } from './device-task-routing.mjs'

// Text fallback deliberately has no realtime, audio, tools or billing dependency.
// History belongs to the caller so guest-to-owner migration can preserve it.
export class DeviceTextConversation {
  constructor({ settings, context, onEvent, getHistory = () => [], fetchImpl = fetch, timeoutMs = 60000, assistant, client, beforeSend = async () => {} }) {
    Object.assign(this, { settings, context, onEvent, getHistory, fetchImpl, timeoutMs, assistant, client, beforeSend })
  }
  valid(turn) { return this.pending === turn && JSON.stringify(this.context()) === turn.scope }
  emit(turn, event) { if (this.valid(turn)) this.onEvent({ requestId: turn.id, ...event }) }
  stop() {
    const turn = this.pending
    if (!turn) return
    this.emit(turn, { type: 'stopped' })
    this.pending = null
    turn.controller.abort()
  }
  interrupt() { this.stop(); return { ok: true } }
  close() { this.stop() }
  async chat(text, { allowComputer = true, remoteSessionId = '' } = {}) {
    const key = this.settings.key()
    const clientSource = this.client?.ready()
    if (!key && !clientSource) return { ok: false, code: 'KEY_REQUIRED', message: '请在模型设置中填写自己的 DeepSeek API Key，或连接已登录的 Harness 客户端' }
    const context = this.context()
    if (!context?.agentId || !context.persona?.trim()) return { ok: false, code: 'PERSONA_REQUIRED', message: '人设尚未加载，请重新选择形象' }
    if (typeof text !== 'string' || !text.trim() || text.length > 4000) return { ok: false, code: 'INVALID_TEXT', message: '请输入 1 至 4000 字的消息' }
    if (this.pending) return { ok: false, code: 'BUSY', message: '请等待当前回复完成' }
    const turn = { id: randomUUID(), controller: new AbortController(), scope: JSON.stringify(context) }
    this.pending = turn
    this.emit(turn, { type: 'preparing', spoken: false, textOnly: true })
    const timer = setTimeout(() => turn.controller.abort(), this.timeoutMs)
    timer.unref?.()
    try {
      let rows = this.getHistory(turn.controller.signal)
      if (rows?.then) rows = await rows
      if (!this.valid(turn)) return { ok: false, code: 'CANCELLED' }
      const history = rows.filter(row => ['user', 'assistant'].includes(row.role) && typeof row.text === 'string' && row.text.trim())
        .slice(-20).map(row => ({ role: row.role, content: row.text.slice(0, 4000) }))
      this.emit(turn, { type: 'user', input: 'text', text })
      await this.beforeSend(turn.controller.signal)
      if (!this.valid(turn)) return { ok: false, code: 'CANCELLED' }
      if (allowComputer && this.assistant?.enabled()) {
        const route = validateTaskRoute(await this.assistant.planTask(text, { signal: turn.controller.signal, context: rows }))
        if (!this.valid(turn)) return { ok: false, code: 'CANCELLED' }
        if (route.decision !== 'chat') {
          let answer = route.message
          if (route.decision === 'task') {
            const { decision, ...args } = route
            const result = await this.assistant.dispatch(args, { signal: turn.controller.signal,
              targetSession: typeof remoteSessionId === 'string' && remoteSessionId.length <= 128 ? remoteSessionId : '', originalTask: text })
            answer = typeof result.result === 'string' ? result.result : result.message || (result.ok ? '任务已提交，请查看实时任务进度' : '任务未完成，请查看实时信息')
          }
          this.emit(turn, { type: 'assistant', text: answer.slice(0, 16000) })
          this.emit(turn, { type: 'done', textOnly: true }); this.emit(turn, { type: 'complete' })
          return { ok: true, requestId: turn.id }
        }
      }
      let answer
      if (clientSource) {
        answer = await this.client.request('llm', `仅作对话回复，不执行工具。人设：${context.persona.slice(0, 4000)}\n${NATURAL_CHAT_INSTRUCTIONS}\n历史：${JSON.stringify(history).slice(-6000)}\n用户：${text}`, turn.controller.signal)
      } else {
        const response = await this.fetchImpl('https://api.deepseek.com/chat/completions', {
          method: 'POST', redirect: 'error', signal: turn.controller.signal,
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
          body: JSON.stringify({ model: 'deepseek-flash', stream: false, max_tokens: 2048,
            messages: [{ role: 'system', content: `${context.persona}\n${NATURAL_CHAT_INSTRUCTIONS}` }, ...history, { role: 'user', content: text }] }) })
        if (!response.ok) throw new Error('MODEL_FAILED')
        if (!response.body) throw new Error('EMPTY_REPLY')
        const chunks = []; let bytes = 0
        for await (const chunk of response.body) {
          turn.controller.signal.throwIfAborted()
          bytes += chunk.byteLength
          if (bytes > 256 * 1024) throw new Error('REPLY_TOO_LARGE')
          chunks.push(Buffer.from(chunk))
        }
        const result = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        answer = result?.choices?.[0]?.message?.content
      }
      if (typeof answer !== 'string' || !answer.trim()) throw new Error('EMPTY_REPLY')
      if (!this.valid(turn)) return { ok: false, code: 'CANCELLED' }
      this.emit(turn, { type: 'assistant', text: answer.slice(0, 16000) })
      this.emit(turn, { type: 'done', textOnly: true })
      this.emit(turn, { type: 'complete' })
      return { ok: true, requestId: turn.id }
    } catch (error) {
      if (!this.valid(turn)) return { ok: false, code: 'CANCELLED' }
      const message = error?.code?.startsWith('HARNESS_CLIENT_') ? 'Harness 客户端连接或任务失败，请在客户端核对后重试；本次未改用自有 Key'
        : error?.code?.startsWith('HISTORY_') ? '历史记忆恢复失败，请检查控制服务连接后重试'
        : 'DeepSeek 文字回复失败，请检查 Key 或网络后重试'
      this.emit(turn, { type: 'error', message })
      return { ok: false, code: 'MODEL_FAILED', message }
    } finally {
      clearTimeout(timer)
      if (this.pending === turn) this.pending = null
    }
  }
}
