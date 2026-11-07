import { EventEmitter } from 'node:events'
import { readFileSync, writeFileSync, renameSync } from 'node:fs'
import { workbuddyLaunch } from './device-workbuddy-agent.mjs'

// Association is not a paid network test: configured Harness is ready on demand,
// Codex must finish its actual handshake, and WorkBuddy must have a local runtime.
export function aiToolStatuses({ assistant = {}, codex = {}, workbuddy = {} } = {}) {
  const harnessReady = assistant.configured === true && assistant.enabled === true && assistant.state !== 'error'
  return [
    { id: 'harness', name: 'Harness', page: 'assistant-heading', available: harnessReady,
      state: harnessReady ? 'ready' : assistant.state === 'error' ? 'error' : assistant.configured ? 'disabled' : 'unconfigured',
      label: harnessReady ? '已就绪' : assistant.state === 'error' ? '暂不可用' : assistant.configured ? '未开启' : '未配置 Key',
      detail: harnessReady ? '已启用本机配置，调用时连接模型服务' : '填写 DeepSeek API Key 后保存并启用' },
    { id: 'codex', name: 'Codex', page: 'codex-heading', available: codex.status === 'ready',
      state: codex.status === 'ready' ? 'ready' : codex.status === 'connecting' ? 'checking' : 'offline',
      label: codex.status === 'ready' ? '已连接' : codex.status === 'connecting' ? '连接中' : '未连接',
      detail: codex.status === 'ready' ? '已连接本机 Codex，使用已有登录' : '自动查找本机 Codex 并复用登录状态' },
    { id: 'workbuddy', name: 'WorkBuddy', page: 'workbuddy-heading', available: workbuddy.status === 'associated',
      state: workbuddy.status === 'associated' ? 'ready' : workbuddy.status === 'checking' ? 'checking' : workbuddy.status === 'missing' ? 'missing' : 'offline',
      label: workbuddy.status === 'associated' ? '已关联' : workbuddy.status === 'checking' ? '检测中' : workbuddy.status === 'missing' ? '未发现' : '暂不可用',
      detail: workbuddy.status === 'associated' ? '已发现本机运行时，登录与网络在实际执行时验证' : '自动查找本机 WorkBuddy，点击查看配置' },
  ]
}

export class DeviceAiTools extends EventEmitter {
  constructor({ file, context, assistant, codex, discoverWorkbuddy = workbuddyLaunch, now = Date.now,
    discoveryMs = 30000, settleMs = 35000 } = {}) {
    super(); Object.assign(this, { file, context, assistant, codex, discoverWorkbuddy, now, discoveryMs, settleMs })
    this.workbuddy = { status: 'checking' }; this.seen = new Set(); this.generation = 0; this.scope = ''; this.guide = false
    try {
      const raw = readFileSync(file, 'utf8')
      if (raw.length < 16384) for (const value of JSON.parse(raw).completed || [])
        if (typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)) this.seen.add(value)
    } catch { /* A new or read-only profile does not prevent local discovery. */ }
  }
  snapshot() {
    return { items: aiToolStatuses({ assistant: this.assistant?.(), codex: this.codex?.(), workbuddy: this.workbuddy }),
      guide: this.guide && this.scope ? { id: this.scope, page: 'assistant-heading' } : null }
  }
  complete() {
    this.seen.add(this.scope)
    while (this.seen.size > 64) this.seen.delete(this.seen.values().next().value)
    try {
      writeFileSync(`${this.file}.tmp`, JSON.stringify({ completed: [...this.seen] }), { mode: 0o600 })
      renameSync(`${this.file}.tmp`, this.file)
    } catch { /* Keep the in-memory marker; do not repeat on reconnect. */ }
  }
  observe() {
    const context = this.context?.() || {}, scope = context.bound && context.connected && context.authorized && /^[a-f0-9]{64}$/.test(context.scope) ? context.scope : ''
    if (this.scope !== scope) {
      clearTimeout(this.settleTimer); this.settleTimer = null; this.scope = scope; this.guide = false; this.deadline = this.now() + this.settleMs
    }
    const items = this.snapshot().items
    if (items.some(item => item.available)) this.guide = false
    if (scope && !this.seen.has(scope)) {
      if (items.some(item => item.available)) this.complete()
      else if (items.some(item => item.state === 'checking') && this.now() < this.deadline) {
        this.settleTimer ||= setTimeout(() => { this.settleTimer = null; this.observe() }, Math.max(1, this.deadline - this.now()))
        this.settleTimer.unref?.()
      } else { this.guide = true; this.complete() }
    }
    const snapshot = this.snapshot(), serialized = JSON.stringify(snapshot)
    if (serialized !== this.lastState) { this.lastState = serialized; this.emit('state', snapshot) }
    return snapshot
  }
  acknowledge() { this.guide = false; return this.observe() }
  async discover() {
    if (this.pending) return this.pending
    const generation = this.generation
    this.pending = (async () => {
      // Defer even a synchronous discovery stub until pending has been assigned.
      await Promise.resolve()
      try { await this.discoverWorkbuddy(); if (generation === this.generation) this.workbuddy = { status: 'associated' } }
      catch (error) { if (generation === this.generation) this.workbuddy = { status: /未找到|not found/i.test(error.message || '') ? 'missing' : 'error' } }
      finally { if (generation === this.generation) { this.pending = null; this.observe() } }
    })()
    return this.pending
  }
  start() {
    if (this.running) return
    this.running = true; void this.discover(); this.observe()
    this.timer = setInterval(() => { void this.discover() }, this.discoveryMs); this.timer.unref?.()
  }
  stop() { this.running = false; this.generation++; clearInterval(this.timer); clearTimeout(this.settleTimer); this.pending = null }
}
