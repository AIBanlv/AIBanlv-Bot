import { EventEmitter } from 'node:events'
import { touchObservation } from './device-touch-policy.mjs'

export class DeviceConversation extends EventEmitter {
  constructor({ realtime, text, routing }) {
    super()
    Object.assign(this, { realtime, text, routing })
    realtime.on('event', event => this.emit('event', event))
  }
  get textOnly() { return this.routing().textOnly === true }
  get turn() { return this.text.pending || this.realtime.turn }
  get connection() { return this.realtime.connection }
  get connecting() { return this.realtime.connecting }
  get connectionState() { return this.textOnly ? 'text' : this.realtime.connectionState }
  setContext(key) {
    const route = this.routing().route
    if (this.key !== key || this.route !== route) {
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
    return this.sendGate(() => this.textOnly ? this.text.chat(text, options) : this.realtime.send(text, options))
  }
  sendTouch(value) {
    if (!this.textOnly) return this.sendGate(() => this.realtime.sendTouch(value))
    const observation = touchObservation(value)
    return observation ? this.send(`用户触碰了你：${observation.description}。请按当前人设简短回应。`, { allowComputer: false })
      : { ok: false, code: 'INVALID_TOUCH', message: '未识别到有效触碰' }
  }
  sendGate(action) {
    const route = this.routing()
    return !route.route ? { ok: false, code: route.code, message: route.message }
      : !this.key ? { ok: false, code: 'AVATAR_NOT_READY', message: '请显示并加载形象' } : action()
  }
  sendVoice(pcm) {
    return this.textOnly ? { ok: false, code: 'TEXT_ONLY', message: '当前为纯文字来源，请选择 Realtime 以使用语音' }
      : this.sendGate(() => this.realtime.sendVoice(pcm))
  }
  interrupt() { return this.textOnly ? this.text.interrupt() : this.realtime.interrupt() }
  played(id) { if (!this.textOnly) this.realtime.played(id) }
  fail(error) { if (!this.textOnly) this.realtime.fail(error) }
  stop(...args) { this.text.stop(); this.realtime.stop(...args) }
  async dispose() { this.text.close(); await this.realtime.dispose() }
}
