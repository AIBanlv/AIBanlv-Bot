import { DeviceTextConversation } from './device-text-conversation.mjs'

export const remoteToolIds = ['codex', 'deepseek', 'harness', 'workbuddy']
const scopeKey = value => JSON.stringify([value?.bound, value?.owner, value?.tenantId, value?.deviceId, value?.agentId])

export class RemoteTools {
  constructor({ context, settings, assistant, codex, codexChat, workbuddy, statuses = () => [],
    project = () => '', beforeSend = async () => {}, fetchImpl = fetch }) {
    Object.assign(this, { context, settings, assistant, codex, codexChat, workbuddy, statuses, project, beforeSend, fetchImpl })
    this.histories = new Map()
    this.generation = 0
  }
  clear() { this.generation++; this.histories.clear(); this.historyScope = '' }
  catalog() {
    const key = Boolean(this.settings?.key()), enabled = this.assistant?.enabled?.() === true
    const client = this.assistant?.client
    const available = [this.codex?.status === 'ready', key,
      enabled && (client?.ready() ? client.state?.taskProtocol === 2 : key),
      this.statuses().some(row => row.id === 'workbuddy' && row.available === true)]
    const items = remoteToolIds.map((id, i) => ({ id, available: Boolean(available[i]),
      state: available[i] ? 'ready' : 'unavailable', ...(id === 'workbuddy' ? { mode: 'create' } : {}) }))
    return { version: 1, defaultTarget: items.find(row => row.available)?.id || '', items }
  }
  async send(text, { target, allowComputer, sessionId = '', signal = new AbortController().signal } = {}) {
    if (allowComputer !== true) throw new Error('手机远程操作尚未授权，消息未发送。')
    if (!remoteToolIds.includes(target)) throw new Error('工具目标无效，消息未发送。')
    if (typeof text !== 'string' || !text.trim() || text.length > 2000 || text.includes('\0')) throw new Error('请输入 1-2000 字的消息。')
    if (typeof sessionId !== 'string' || sessionId.length > 128) throw new Error('手机对话标识无效。')
    const scope = this.context(), expected = scopeKey(scope), generation = this.generation
    if (!scope?.bound || !scope.owner || !scope.deviceId || !scope.agentId) throw new Error('设备绑定已失效，请重新进入远程对话。')
    const check = () => {
      signal.throwIfAborted()
      if (generation !== this.generation || scopeKey(this.context()) !== expected) throw new Error('远程对话上下文已变化，请核对原工具；本次未自动重发。')
    }
    check()
    // Codex connects/discovers on demand, including while its catalog is checking.
    if (target === 'codex') return this.codexChat.send(text, { allowComputer, sessionId, signal })
    if (!this.catalog().items.find(row => row.id === target)?.available) throw new Error(`${{ deepseek: 'DeepSeek', harness: 'Harness', workbuddy: 'WorkBuddy' }[target]} 尚未连接或配置，请先在电脑端配置。`)
    await this.beforeSend(signal); check()
    if (target === 'deepseek') return this.deepseek(text, { signal, sessionId, expected, check })
    if (target === 'harness') {
      const answer = await this.assistant.run(text, { signal, targetSession: sessionId, originalTask: text })
      check()
      if (typeof answer !== 'string' || !answer.trim()) throw new Error('Harness 未返回有效结果，请在原工具中核对。')
      return { ok: true, message: answer.slice(0, 16000) }
    }
    const cwd = this.project()
    if (!cwd) throw new Error('请先在电脑插件中心选择 WorkBuddy 的任务项目文件夹。')
    check()
    const result = await this.workbuddy.create(text, cwd, { signal, scope,
      isCurrent: () => generation === this.generation && scopeKey(this.context()) === expected })
    check()
    return result
  }
  async deepseek(text, { signal, sessionId, expected, check }) {
    if (this.historyScope !== expected) { this.histories.clear(); this.historyScope = expected }
    if (!this.histories.has(sessionId)) {
      this.histories.set(sessionId, [])
      if (this.histories.size > 16) this.histories.delete(this.histories.keys().next().value)
    }
    const history = this.histories.get(sessionId)
    let answer = ''
    const chat = new DeviceTextConversation({ settings: this.settings, fetchImpl: this.fetchImpl,
      context: () => ({ ...this.context(), persona: '你是用户的 DeepSeek 助手。' }), getHistory: () => history,
      beforeSend: async () => check(), onEvent: event => { if (event.type === 'assistant') answer = event.text } })
    const stop = () => chat.stop()
    signal.addEventListener('abort', stop, { once: true })
    try {
      check()
      const result = await chat.chat(text, { allowComputer: false })
      check()
      if (!result.ok) throw new Error(result.message || 'DeepSeek 请求已取消，消息未完成。')
      history.push({ role: 'user', text }, { role: 'assistant', text: answer })
      history.splice(0, Math.max(0, history.length - 20))
      return { ok: true, message: answer }
    } finally { signal.removeEventListener('abort', stop); chat.close() }
  }
}
