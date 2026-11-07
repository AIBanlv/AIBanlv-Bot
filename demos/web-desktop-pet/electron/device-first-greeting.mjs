import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs'
import path from 'node:path'
import { conversationInputResult } from './device-pet-policy.mjs'

const greetings = {
  'zh-Hans': '很高兴认识你，以后由我来陪伴你工作。',
  'zh-Hant': '很高興認識你，以後由我來陪伴你工作。',
  en: "It's lovely to meet you. I'll be here to keep you company while you work.",
  ja: 'はじめまして。これからは私があなたのお仕事に寄り添います。',
}
export function firstGreetingPrompt(language) {
  const text = Object.hasOwn(greetings, language) ? greetings[language] : greetings['zh-Hans']
  return `这是首次使用的欢迎语，不是用户发出的任务。请用当前角色的声音亲切、自然地说出下面这一句话，保留角色的表演标签格式，不补充其它内容，不提问、不调用工具、不回顾历史任务：${text}`
}

// Installation-wide, not account/role/session-wide. This state is deliberately
// outside conversation history so clearing chats or upgrading cannot replay it.
export class DeviceFirstGreeting {
  constructor({ directory, context, speak, delayMs = 1200, onError = () => {} }) {
    Object.assign(this, { context, speak, delayMs, onError })
    this.file = path.join(directory, 'first-greeting.json')
    try {
      if (existsSync(this.file)) {
        const data = JSON.parse(readFileSync(this.file, 'utf8'))
        if (data.version !== 1 || !['pending', 'claimed', 'skipped'].includes(data.state)) throw new Error('Invalid greeting state')
        this.pending = data.state === 'pending'
      } else {
        // Existing installations do not suddenly greet after an upgrade.
        this.pending = !existsSync(path.join(directory, 'device-identity.json'))
        writeFileSync(this.file, JSON.stringify({ version: 1, state: this.pending ? 'pending' : 'skipped' }), { flag: 'wx', mode: 0o600 })
      }
    } catch { this.pending = false; this.onError('GREETING_STORAGE_UNAVAILABLE') }
  }
  schedule() {
    if (!this.pending || this.timer || this.disposed) return
    this.timer = setTimeout(() => { this.timer = null; this.check() }, this.delayMs)
    this.timer.unref?.()
  }
  check() {
    if (!this.pending || this.disposed) return
    const state = this.context()
    if (!state.visible || state.closing || state.busy || !state.speechReady ||
        state.conversationState !== 'ready' || !state.models?.voiceAvailable || !conversationInputResult(state).ok) return
    if (state.current?.source !== 'local' && (state.binding !== 'bound' || state.connection !== 'connected')) return
    try {
      // Commit the claim before invoking a generation. No await between the
      // readiness check and send(), which synchronously reserves the real turn.
      // An uncertain network failure/crash must never replay a paid greeting.
      writeFileSync(`${this.file}.tmp`, JSON.stringify({ version: 1, state: 'claimed' }), { mode: 0o600 })
      renameSync(`${this.file}.tmp`, this.file)
    } catch { this.pending = false; this.onError('GREETING_STORAGE_UNAVAILABLE'); return }
    this.pending = false
    try {
      Promise.resolve(this.speak(firstGreetingPrompt(state.language), { greeting: true, allowComputer: false }))
        .then(result => { if (result?.ok === false) this.onError('GREETING_NOT_STARTED') })
        .catch(() => this.onError('GREETING_START_UNCERTAIN'))
    } catch { this.onError('GREETING_START_UNCERTAIN') }
  }
  dispose() { this.disposed = true; clearTimeout(this.timer); this.timer = null }
}
