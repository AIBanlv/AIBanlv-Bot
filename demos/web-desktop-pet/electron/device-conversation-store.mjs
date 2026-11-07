import { readFile, writeFile, rename } from 'node:fs/promises'
import { randomUUID, createHash } from 'node:crypto'
import path from 'node:path'

const fail = code => Object.assign(new Error(code), { code })
const str = (value, limit = 512) => typeof value === 'string' && value.length > 0 && value.length <= limit
const same = (a, b) => a?.owner === b?.owner && a?.tenantId === b?.tenantId && a?.deviceId === b?.deviceId &&
  (a?.roleSource ?? 'online') === (b?.roleSource ?? 'online')
const scopeOf = value => {
  if (!str(value?.deviceId) || Boolean(value.owner) !== Boolean(value.tenantId) ||
      value.owner && (!str(value.owner) || !str(value.tenantId))) throw fail('INVALID_HISTORY_SCOPE')
  const roleSource = value.roleSource ?? 'online'
  if (!['online', 'local'].includes(roleSource)) throw fail('INVALID_HISTORY_SCOPE')
  return { deviceId: value.deviceId, owner: roleSource === 'local' ? '' : value.owner || '',
    tenantId: roleSource === 'local' ? '' : value.tenantId || '', roleSource }
}
const payloadOf = row => Object.fromEntries(['type', 'deviceId', 'agentId', 'requestId', 'responseId', 'messageId',
  'messageRole', 'source', 'text', 'finished', 'historyUserMessageId', 'websocketSessionId', 'notificationEventId']
  .filter(key => row[key] !== undefined).map(key => [key, row[key]]))
function validateRow(row) {
  scopeOf(row)
  if (row.type !== 'assistant_reply' || row.finished !== true || !['user', 'assistant'].includes(row.messageRole) ||
      !['device', 'controller', 'notification'].includes(row.source) || typeof row.synced !== 'boolean' || !str(row.batch) ||
      !Number.isSafeInteger(row.timestamp) || !str(row.text, 16000) ||
      !['messageId', 'requestId', 'responseId', 'agentId'].every(key => str(row[key]))) throw fail('INVALID_HISTORY')
}

export class ConversationStore {
  constructor({ directory, encryption }) {
    Object.assign(this, { file: path.join(directory, 'conversation-store.json'), encryption })
    this.queue = Promise.resolve()
    this.data = { version: 1, guestId: randomUUID(), rows: [], migrationDone: false }
  }
  async load() {
    try {
      const raw = await readFile(this.file, 'utf8')
      if (raw.length > 64 * 1024 * 1024 || !this.encryption.isEncryptionAvailable()) throw fail('HISTORY_STORAGE_UNAVAILABLE')
      const envelope = JSON.parse(raw)
      if (typeof envelope.encrypted !== 'string') throw fail('INVALID_HISTORY')
      const data = JSON.parse(this.encryption.decryptString(Buffer.from(envelope.encrypted, 'base64')))
      if (data.version !== 1 || !str(data.guestId) || !Array.isArray(data.rows) || data.rows.length > 100000 ||
          typeof data.migrationDone !== 'boolean') throw fail('INVALID_HISTORY')
      data.rows.forEach(validateRow)
      if (data.lastScope) scopeOf(data.lastScope)
      for (const row of data.rows) if (row.complete === false) row.complete = true
      this.data = data
    } catch (error) { if (error.code !== 'ENOENT') { this.failed = true; throw fail('HISTORY_STORAGE_UNAVAILABLE') } }
    this.guestId = this.data.guestId
    this.loaded = true
  }
  mutate(change, { recover = false } = {}) {
    const work = this.queue.then(async () => {
      if (this.failed && !recover || !this.loaded || !this.encryption.isEncryptionAvailable()) throw fail('HISTORY_STORAGE_UNAVAILABLE')
      const next = structuredClone(this.data), result = change(next)
      const raw = JSON.stringify(next)
      if (next.rows.length > 100000 || Buffer.byteLength(raw, 'utf8') > 40 * 1024 * 1024) throw fail('HISTORY_CAPACITY')
      const encrypted = this.encryption.encryptString(raw).toString('base64')
      const envelope = JSON.stringify({ version: 1, encrypted })
      if (Buffer.byteLength(envelope, 'utf8') > 64 * 1024 * 1024) throw fail('HISTORY_CAPACITY')
      await writeFile(`${this.file}.tmp`, envelope, { mode: 0o600 })
      await rename(`${this.file}.tmp`, this.file)
      this.data = next
      return result
    })
    this.queue = work.catch(() => { this.failed = true })
    return work
  }
  setScope(value) {
    const scope = scopeOf(value), previous = this.scope
    if (same(scope, previous)) return this.queue
    void this.flushTurn().catch(() => {})
    this.scope = scope; this.turn = null
    const claim = scope.owner && !previous?.owner ? this.guestId : ''
    if (claim) this.guestId = randomUUID()
    const guestId = this.guestId
    return this.mutate(data => {
      if (claim) for (const row of data.rows) {
        if (row.roleSource !== 'local' && !row.owner && row.batch === claim && row.deviceId === scope.deviceId) Object.assign(row, scope)
      }
      data.guestId = guestId
      if (scope.roleSource !== 'local') data.lastScope = scope
    })
  }
  matches(row, scope = this.scope) {
    return scope && same(row, scope) && (scope.roleSource === 'local' || scope.owner || row.batch === this.guestId)
  }
  context(agentId) {
    return this.data.rows.filter(row => this.matches(row) && row.agentId === agentId).slice(-40)
      .map(row => ({ role: row.messageRole, text: row.text }))
  }
  pending(limit = 64) {
    return this.scope?.owner ? this.data.rows.filter(row => row.roleSource !== 'local' && this.matches(row) && !row.synced && row.complete !== false).slice(0, limit).map(payloadOf) : []
  }
  async export() { await this.queue; return structuredClone(this.data.rows.filter(row => this.matches(row))) }
  clear() {
    const scope = this.scope, batch = this.guestId
    clearTimeout(this.turn?.timer); this.turn = null
    return this.mutate(data => { data.rows = data.rows.filter(row => !(same(row, scope) && (scope.roleSource === 'local' || scope.owner || row.batch === batch))) }, { recover: true })
      .then(() => { this.failed = false })
  }
  acknowledge(messageId, value) {
    const scope = scopeOf(value)
    if (!scope.owner) return Promise.resolve()
    return this.mutate(data => {
      const row = data.rows.find(row => row.messageId === messageId && same(row, scope))
      if (row) row.synced = true
    })
  }
  record(payload, value = this.scope, batch = this.guestId, complete = true) {
    const scope = scopeOf(value)
    // Old phone clients save their own input separately and supply no receipt ID.
    // Retain that mirror locally; replaying it would duplicate the phone's history.
    const externalInput = payload.source === 'controller' && payload.messageRole === 'user' && !payload.historyUserMessageId
    const row = { ...payloadOf(payload), ...scope, batch, synced: externalInput, complete,
      timestamp: Number.isSafeInteger(payload.timestamp) ? payload.timestamp : Date.now() }
    validateRow(row)
    return this.mutate(data => {
      const existing = data.rows.find(item => item.messageId === row.messageId && same(item, row))
      if (!existing) data.rows.push(row)
      else if (existing.complete === false && row.messageRole === 'assistant') Object.assign(existing, row)
      else if (existing.text !== row.text) throw fail('HISTORY_MESSAGE_CONFLICT')
    })
  }
  accept(event, context) {
    if (!this.scope || !str(event?.requestId) || !str(context?.agentId) || context.deviceId !== this.scope.deviceId) return Promise.resolve()
    if (event.type === 'preparing') this.turn = { id: event.requestId, scope: { ...this.scope }, agentId: context.agentId,
      batch: this.guestId, user: '', assistant: '' }
    const turn = this.turn
    if (!turn || turn.id !== event.requestId || turn.agentId !== context.agentId || !same(turn.scope, this.scope)) return Promise.resolve()
    if (['user', 'assistant'].includes(event.type) && typeof event.text === 'string') {
      turn[event.type] = event.text.slice(0, event.type === 'user' ? 4000 : 16000)
      if (event.type === 'user' && turn.user) return this.record(this.turnPayload(turn, 'user'), turn.scope, turn.batch)
      if (!turn.timer && turn.assistant) {
        turn.timer = setTimeout(() => {
          turn.timer = null
          if (this.turn === turn) void this.flushTurn(false).catch(() => {})
        }, 500)
        turn.timer.unref?.()
      }
    }
    if (['done', 'error', 'reset', 'stopped', 'interrupted'].includes(event.type)) {
      const result = this.flushTurn(); this.turn = null; return result
    }
    return Promise.resolve()
  }
  turnPayload(turn, role) {
    return { type: 'assistant_reply', deviceId: turn.scope.deviceId, agentId: turn.agentId, requestId: turn.id, responseId: turn.id,
      messageId: `remote-${turn.scope.deviceId}-${turn.id}-${role}`, messageRole: role, source: 'device', text: turn[role], finished: true }
  }
  flushTurn(complete = true) {
    const turn = this.turn
    if (!turn) return Promise.resolve()
    clearTimeout(turn.timer); turn.timer = null
    return turn.assistant ? this.record(this.turnPayload(turn, 'assistant'), turn.scope, turn.batch, complete) : this.queue
  }
  migrate(saved, deviceId) {
    if (this.data.migrationDone) return this.queue
    const scope = scopeOf({ deviceId, ...(saved?.claimOwner || {}) }), batch = this.guestId
    return this.mutate(data => {
      const history = saved?.historyRows || [], counts = new Map(), extras = []
      const key = (agent, role, text) => JSON.stringify([agent, role, text])
      for (const row of history) {
        const id = key(row.agentId, row.messageRole, row.text); counts.set(id, (counts.get(id) || 0) + 1)
      }
      for (const [agentId, rows] of saved?.memories || []) for (const [index, row] of rows.entries()) {
        const id = key(agentId, row.role, row.text), count = counts.get(id) || 0
        if (count) { counts.set(id, count - 1); continue }
        const responseId = `legacy-context-${createHash('sha256').update(agentId).digest('hex').slice(0, 32)}-${index}`
        extras.push({ type: 'assistant_reply', deviceId, agentId, requestId: responseId, responseId,
          messageId: `${responseId}-${row.role}`, messageRole: row.role, source: 'device', text: row.text, finished: true })
      }
      for (const payload of [...extras, ...history]) {
        const row = { ...payloadOf(payload), ...scope, batch, synced: false, timestamp: Date.now() }
        validateRow(row)
        if (!data.rows.some(item => item.messageId === row.messageId && same(item, row))) data.rows.push(row)
      }
      data.migrationDone = true
    })
  }
}
