import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import { touchObservation } from './device-touch-policy.mjs'
import { remoteCodexInput } from './device-task-intent.mjs'

export class DeviceConversation extends EventEmitter {
  constructor({ realtime, text, routing, tasks }) {
    super()
    Object.assign(this, { realtime, text, routing, tasks })
    realtime.on('event', event => this.emit('event', event))
  }
  get textOnly() { return this.routing().textOnly === true }
  get turn() { return this.taskTurn || this.text.pending || this.realtime.turn }
  get connection() { return this.realtime.connection }
  get connecting() { return this.realtime.connecting }
  get connectionState() { return this.textOnly ? 'text' : this.realtime.connectionState }
  setContext(key) {
    const route = this.routing().route
    if (this.key !== key || this.route !== route) {
      this.stopTask()
      this.text.stop()
      if (this.key !== key) {
        this.text.close()
        // Text replies bypass LAM, so its reset cannot clear their shared feed.
        // Publish a no-audio reset on role/account loss or replacement as well.
        this.emit('event', { type: 'reset', textOnly: true })
      }
      this.key = key; this.route = route
    }
    this.realtime.setContext(['platform', 'realtime'].includes(route) && key ? `${key}:${route}` : '')
  }
  send(text, options) {
    if ((options?.notificationEventId || options?.greeting) && this.textOnly) return { ok: false, code: 'TEXT_ONLY', message: '当前为纯文字来源，无法语音播报' }
    const route = !options?.notificationEventId && !options?.greeting && (remoteCodexInput(text, options)
      ? { decision: 'remote' } : this.tasks?.()?.directRoute(text))
    if (route) {
      if (options?.allowComputer === false || route.decision === 'remote' && options?.allowComputer !== true) return { ok: false, code: 'REMOTE_AUTH_REQUIRED', message: '手机远程操作尚未授权，消息未发送到 Codex。请重新进入远程对话完成授权；旧绑定请重新扫码。' }
      if (!this.key && route.decision !== 'remote') return { ok: false, code: 'AVATAR_NOT_READY', message: '请显示并加载形象' }
      return this.sendTask(text, route, options)
    }
    if (this.taskTurn) return { ok: false, code: 'CHAT_BUSY', message: '请等待当前任务请求完成' }
    return this.sendGate(() => this.textOnly ? this.text.chat(text, options) : this.realtime.send(text, options))
  }
  async sendTask(text, route, options) {
    if (this.turn) return { ok: false, code: 'CHAT_BUSY', message: '请等待当前回复或先停止' }
    const turn = this.taskTurn = { requestId: randomUUID(), controller: new AbortController() }
    const signal = AbortSignal.any([turn.controller.signal, AbortSignal.timeout(60000)])
    const emit = value => {
      if (this.taskTurn === turn && !signal.aborted) this.emit('event', { requestId: turn.requestId, textOnly: true, ...value })
    }
    emit({ type: 'preparing' }); emit({ type: 'user', input: 'text', text })
    try {
      let answer = route.message
      if (['task', 'remote'].includes(route.decision)) {
        const { decision, ...args } = route
        const result = decision === 'remote'
          ? await this.tasks().sendRemote(text, { signal, allowComputer: options.allowComputer, sessionId: options.remoteSessionId || '',
            ...(options.remoteTarget ? { target: options.remoteTarget } : {}) })
          : await this.tasks().execute(args, { signal, originalTask: text, targetSession: options?.remoteSessionId || '' })
        answer = result.message
        if (!result.ok || typeof answer !== 'string' || !answer.trim()) throw new Error(answer || 'Codex 未返回发送确认，本次不能确认已送达。')
      }
      signal.throwIfAborted()
      if (this.taskTurn !== turn) return { ok: false, code: 'CANCELLED' }
      emit({ type: 'assistant', text: answer.slice(0, 16000) })
      emit({ type: 'done' }); emit({ type: 'complete' })
      return { ok: true, requestId: turn.requestId }
    } catch (error) {
      if (this.taskTurn !== turn) return { ok: false, code: 'CANCELLED' }
      const message = signal.aborted ? 'Codex 请求超时或已取消，请核对任务状态；本次未自动重发。' : error.message.slice(0, 400)
      emit({ type: 'error', message })
      return { ok: false, code: 'TASK_DISPATCH_FAILED', message }
    } finally { if (this.taskTurn === turn) this.taskTurn = null }
  }
  stopTask() {
    const turn = this.taskTurn
    if (!turn) return
    this.taskTurn = null; turn.controller.abort()
    this.emit('event', { type: 'stopped', requestId: turn.requestId, textOnly: true })
  }
  sendTouch(value) {
    if (!this.textOnly) return this.sendGate(() => this.realtime.sendTouch(value))
    const observation = touchObservation(value)
    return observation ? this.send(`用户触碰了你：${observation.description}。请按当前人设简短回应。`, { allowComputer: false })
      : { ok: false, code: 'INVALID_TOUCH', message: '未识别到有效触碰' }
  }
  sendGate(action) {
    if (this.taskTurn) return { ok: false, code: 'CHAT_BUSY', message: '请等待当前任务请求完成' }
    const route = this.routing()
    return !route.route ? { ok: false, code: route.code, message: route.message }
      : !this.key ? { ok: false, code: 'AVATAR_NOT_READY', message: '请显示并加载形象' } : action()
  }
  sendVoice(pcm) {
    return this.textOnly ? { ok: false, code: 'TEXT_ONLY', message: '当前为纯文字来源，请选择 Realtime 以使用语音' }
      : this.sendGate(() => this.realtime.sendVoice(pcm))
  }
  interrupt() {
    if (this.taskTurn) { this.stopTask(); return { ok: true } }
    return this.textOnly ? this.text.interrupt() : this.realtime.interrupt()
  }
  played(id) { if (!this.textOnly) this.realtime.played(id) }
  fail(error) { if (!this.textOnly) this.realtime.fail(error) }
  stop(...args) { this.stopTask(); this.text.stop(); this.realtime.stop(...args) }
  async dispose() { this.stopTask(); this.text.close(); await this.realtime.dispose() }
}
