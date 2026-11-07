import { randomUUID } from 'node:crypto'

const failure = code => Object.assign(new Error({
  HISTORY_UNAVAILABLE: '无法加载历史记录，请检查连接后重试',
  HISTORY_SCOPE_CHANGED: '账号或形象已改变，请重新发起对话',
  HISTORY_CANCELLED: '历史记录加载已取消',
  HISTORY_TIMEOUT: '历史记录加载超时，请重试',
  HISTORY_INVALID: '历史记录格式无效，请重试',
}[code]), { code })

function rows(value) {
  if (!Array.isArray(value) || value.length > 20) throw failure('HISTORY_INVALID')
  let length = 0
  return value.map(row => {
    if (!row || !['user', 'assistant'].includes(row.role) || typeof row.text !== 'string' ||
        !row.text.trim() || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(row.text)) throw failure('HISTORY_INVALID')
    length += row.text.length
    if (length > 8000) throw failure('HISTORY_INVALID')
    return { role: row.role, text: row.text }
  })
}

export class DeviceHistory {
  constructor({ channel, timeoutMs = 15000 }) {
    Object.assign(this, { channel, timeoutMs })
    this.jobs = new Set()
  }

  identity() {
    const { state, tenantId, controllerUserId } = this.channel
    return state.binding === 'bound' && state.connection === 'connected' &&
      state.deviceId && state.owner && tenantId && controllerUserId && state.owner === controllerUserId
      ? { deviceId: state.deviceId, tenantId, controllerUserId } : null
  }

  async load(agentId, signal) {
    if (this.disposed) throw failure('HISTORY_UNAVAILABLE')
    if (signal?.aborted) throw failure('HISTORY_CANCELLED')
    if (this.channel.state.guest === true) return []
    const scope = this.identity()
    if (!scope || typeof agentId !== 'string' || !agentId.trim() || agentId.length > 256 ||
        /[\u0000-\u001f]/.test(agentId)) throw failure('HISTORY_UNAVAILABLE')
    const requestId = randomUUID()
    return new Promise((resolve, reject) => {
      let settled = false, timer
      const sameScope = () => JSON.stringify(scope) === JSON.stringify(this.identity()) && this.channel.state.guest !== true
      const finish = (error, history) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        this.jobs.delete(cancel)
        signal?.removeEventListener('abort', cancel)
        this.channel.removeListener('device-history', receive)
        this.channel.removeListener('state', changed)
        this.channel.removeListener('revoked', revoked)
        if (error) reject(error)
        else resolve(history)
      }
      const cancel = () => finish(failure('HISTORY_CANCELLED'))
      const revoked = () => finish(failure('HISTORY_SCOPE_CHANGED'))
      const changed = () => { if (!sameScope()) revoked() }
      const receive = message => {
        if (message?.requestId !== requestId) return
        if (sameScope() && message.type === 'error') { finish(failure('HISTORY_UNAVAILABLE')); return }
        if (!sameScope() || message.agentId !== agentId || Object.entries(scope).some(([key, value]) => message[key] !== value)) {
          revoked(); return
        }
        if (message.error || message.ok === false) { finish(failure('HISTORY_UNAVAILABLE')); return }
        try { finish(null, rows(message.history)) } catch (error) { finish(error) }
      }
      this.jobs.add(cancel)
      this.channel.on('device-history', receive)
      this.channel.on('state', changed)
      this.channel.on('revoked', revoked)
      signal?.addEventListener('abort', cancel, { once: true })
      timer = setTimeout(() => finish(failure('HISTORY_TIMEOUT')), this.timeoutMs)
      try {
        if (!this.channel.send({ type: 'device_history_request', deviceId: scope.deviceId, agentId, requestId })) {
          finish(failure('HISTORY_UNAVAILABLE'))
        }
      } catch { finish(failure('HISTORY_UNAVAILABLE')) }
    })
  }

  dispose() {
    this.disposed = true
    for (const cancel of [...this.jobs]) cancel()
  }
}
