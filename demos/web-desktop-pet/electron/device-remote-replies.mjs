// Share actual conversation text only with the current binding's controllers.
// History stays in memory and is discarded on owner/role context loss.
//
// The backend only stores a reply when it arrives with `finished: true`, so the
// last message of a turn is retried until its `reply_saved` receipt arrives or
// the binding changes. See ControlReplyHistory in live-broadcast-java.
export class DeviceRemoteReplies {
  constructor({ chat, context, send, intervalMs = 100, retryMs = 2000, now = Date.now, persist, onPersistError = () => {} }) {
    Object.assign(this, { chat, context, send, intervalMs, retryMs, now, persist, onPersistError })
    this.history = []
    this.outbox = new Map()
    this.requests = new Map()
    this.generation = 0
  }
  scope() {
    const value = this.context()
    return value?.bound && value.owner && value.agentId ? value : null
  }
  sameTurnScope(turn) {
    return JSON.stringify(this.scope()) === JSON.stringify(turn.context)
  }
  valid(turn) {
    return this.pending === turn && this.sameTurnScope(turn)
  }
  clear({ keepOutbox = false } = {}) {
    clearTimeout(this.timer); this.timer = null; this.pending = null
    this.history = []; this.historyScope = null
    if (!keepOutbox) { this.generation++; this.outbox.clear(); this.requests.clear(); clearTimeout(this.retryTimer); this.retryTimer = null }
  }
  saved(messageId, metadata = {}) {
    this.outbox.delete(messageId)
    if (/^[0-9a-f]{32}$/.test(metadata.historyMessageId || '')) {
      const row = this.history.find(item => item.id === messageId)
      if (!row) return
      row.historyMessageId = metadata.historyMessageId
      if (metadata.timestamp > 1) row.timestamp = metadata.timestamp
    }
  }
  deliver(payload, context) {
    if (payload.finished && this.persist) {
      const generation = this.generation
      void this.persist(payload, context).then(() => {
        if (generation !== this.generation) return
        const current = this.scope()
        if (current?.owner === context.owner && current?.tenantId === context.tenantId && current?.deviceId === context.deviceId) {
          this.sendDurable(payload, context)
        }
      }).catch(this.onPersistError)
      return
    }
    this.sendDurable(payload, context)
  }
  sendDurable(payload, context) {
    if (payload.finished && (payload.messageRole === 'assistant' || payload.source === 'device')) {
      this.outbox.set(payload.messageId, { payload, context, expiresAt: this.now() + 5 * 60000 })
      while (this.outbox.size > 128) this.outbox.delete(this.outbox.keys().next().value)
      this.scheduleRetry()
    }
    this.send(payload)
  }
  scheduleRetry() {
    clearTimeout(this.retryTimer)
    if (!this.outbox.size) return
    this.retryTimer = setTimeout(() => this.retry(), this.retryMs)
    this.retryTimer.unref?.()
  }
  retry() {
    const context = this.context()
    for (const [id, item] of this.outbox) {
      if (item.expiresAt < this.now() || context.owner !== item.context.owner ||
          context.tenantId !== item.context.tenantId) {
        this.outbox.delete(id); continue
      }
      if (context.bound) this.send(item.payload)
    }
    this.scheduleRetry()
  }
  remember(turn, role, text) {
    if (!text || !this.valid(turn)) return
    if (JSON.stringify(this.historyScope) !== JSON.stringify(turn.context)) this.history = []
    this.historyScope = turn.context
    const id = `remote-${turn.context.deviceId}-${turn.internalId}-${role}`
    const row = { id, role, text: text.slice(0, 4000), timestamp: this.now(),
      requestId: turn.requestId, source: turn.source }
    const index = this.history.findIndex(item => item.id === id)
    if (index < 0) this.history.push(row); else this.history[index] = row
    this.history = this.history.slice(-40)
  }
  replay(agentId, requestId) {
    const context = this.scope()
    if (!context || context.agentId !== agentId) return
    if (this.historyScope && JSON.stringify(this.historyScope) !== JSON.stringify(context)) return
    // Empty history still acknowledges support, distinguishing a restarted
    // device from an old executable that cannot send conversation history.
    const scoped = JSON.stringify(this.historyScope) === JSON.stringify(context)
    const history = scoped ? this.history.slice() : []
    while (history.length && Buffer.byteLength(JSON.stringify(history)) > 48000) history.shift()
    this.send({ type: 'assistant_reply', snapshot: true, protocolVersion: 2, requestId,
      deviceId: context.deviceId, agentId, history })
  }
  error(context, requestId, result) {
    const payload = { type: 'error', deviceId: context.deviceId, requestId,
      code: result.code || 'REALTIME_UNAVAILABLE', message: result.message || '对话暂不可用，请重试' }
    const previous = this.requests.get(this.requestKey(context, requestId))
    if (previous) previous.payload = payload
    this.send(payload)
  }
  requestKey(context, id) {
    return JSON.stringify([context.owner, context.tenantId, context.deviceId, context.agentId, id])
  }
  async submit(text, requestId, metadata = {}) {
    const context = this.scope()
    if (!context) return
    if (metadata.agentId && metadata.agentId !== context.agentId) {
      this.error(context, requestId, { code: 'ROLE_CHANGED', message: '设备角色已切换，请重新进入对话' })
      return
    }
    for (const [id, item] of this.requests) if (item.expiresAt < this.now()) this.requests.delete(id)
    const key = this.requestKey(context, requestId)
    const previous = this.requests.get(key)
    if (requestId && previous) {
      if (previous.text !== text) {
        this.error(context, requestId, { code: 'INVALID_TEXT', message: '请重新发送消息' })
        return
      }
      if (previous.payload) this.deliver(previous.payload, context)
      // Reconnecting controllers must not start the same paid generation twice.
      return
    }
    if (this.pending && !this.valid(this.pending)) this.clear()
    if (this.pending) {
      this.error(context, requestId, { code: 'CHAT_BUSY', message: '请等待当前回复或先停止' })
      return
    }
    const turn = { context, requestId, internalId: '', text: '', done: false, source: 'controller',
      websocketSessionId: metadata.websocketSessionId || '',
      historyUserMessageId: metadata.historyUserMessageId || '' }
    this.pending = turn
    if (requestId) {
      this.requests.set(key, { text, expiresAt: this.now() + 10 * 60000 })
      while (this.requests.size > 256) this.requests.delete(this.requests.keys().next().value)
    }
    try {
      this.submitting = turn
      const result = await this.chat(text, metadata)
      this.submitting = null
      if (!this.valid(turn)) return
      if (!result?.ok) { this.error(context, requestId, result || {}); this.finish(); return }
      if (!turn.internalId) turn.internalId = result.requestId
    } catch {
      if (this.valid(turn)) this.error(context, requestId, {})
      if (this.pending === turn) this.finish()
    } finally { if (this.submitting === turn) this.submitting = null }
  }
  flush(turn, finished) {
    if (!this.valid(turn)) { if (this.pending === turn) this.clear(); return }
    clearTimeout(this.timer); this.timer = null
    const payload = { type: 'assistant_reply', deviceId: turn.context.deviceId,
      agentId: turn.context.agentId, requestId: turn.requestId, responseId: turn.internalId,
      text: turn.text, finished, messageRole: 'assistant', source: turn.source,
      websocketSessionId: turn.websocketSessionId || '',
      notificationEventId: turn.notificationEventId || '',
      messageId: `remote-${turn.context.deviceId}-${turn.internalId}-assistant` }
    if (finished) {
      const request = this.requests.get(this.requestKey(turn.context, turn.requestId))
      if (request) request.payload = payload
    }
    this.deliver(payload, turn.context)
  }
  accept(event) {
    if (event.type === 'preparing' && !this.pending && this.scope()) {
      this.pending = { context: this.scope(), requestId: event.requestId, internalId: event.requestId,
        text: '', done: false, source: event.notificationEventId ? 'notification' : 'device',
        notificationEventId: event.notificationEventId || '',
        websocketSessionId: event.websocketSessionId || '' }
    }
    const turn = this.pending
    if (!turn) return
    if (!this.valid(turn)) { this.clear(); return }
    if (event.type === 'preparing' && this.submitting === turn && !turn.internalId) {
      turn.internalId = event.requestId
    }
    if (!turn.internalId || event.requestId !== turn.internalId) {
      if (event.type === 'reset') this.clear()
      return
    }
    if (event.type === 'user' && typeof event.text === 'string') {
      if (!turn.websocketSessionId && turn.source === 'device') {
        turn.websocketSessionId = event.websocketSessionId || ''
      }
      this.remember(turn, 'user', event.text)
      this.deliver({ type: 'assistant_reply', deviceId: turn.context.deviceId,
        agentId: turn.context.agentId, requestId: turn.requestId,
        websocketSessionId: turn.websocketSessionId || '',
        historyUserMessageId: turn.historyUserMessageId || '', responseId: turn.internalId,
        messageId: `remote-${turn.context.deviceId}-${turn.internalId}-user`, messageRole: 'user',
        source: turn.source, text: event.text, finished: true }, turn.context)
    } else if (event.type === 'assistant' && !turn.done && typeof event.text === 'string') {
      turn.text = event.text.slice(0, 16000)
      if (!this.timer) this.timer = setTimeout(() => this.flush(turn, false), this.intervalMs)
    } else if (event.type === 'done' && !turn.done) {
      this.remember(turn, 'assistant', turn.text)
      turn.done = true
      this.flush(turn, true)
    } else if (event.type === 'error') {
      this.error(turn.context, turn.requestId, event)
      this.finish()
    } else if (['complete', 'reset', 'stopped', 'interrupted'].includes(event.type)) {
      if (!turn.done && turn.text) { this.remember(turn, 'assistant', turn.text); this.flush(turn, true) }
      this.finish()
    }
  }
  finish() { clearTimeout(this.timer); this.timer = null; this.pending = null }
}
