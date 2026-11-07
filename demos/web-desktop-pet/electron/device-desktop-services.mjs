import { randomUUID } from 'node:crypto'

// Account services use the proven pairing channel. No mobile JWT or caller-chosen
// tenant/user crosses the renderer boundary.
export class DesktopServices {
  constructor({ channel, timeoutMs = 20000 }) {
    Object.assign(this, { channel, timeoutMs }); this.pending = new Map()
    channel.on('desktop-result', message => this.finish(message.requestId, message))
    channel.on('request-error', message => this.finish(message.requestId, { ok: false, code: message.code }))
    channel.on('revoked', () => this.clear())
    channel.on('state', state => { if (state.connection !== 'connected') this.clear() })
  }
  finish(id, result) {
    const item = this.pending.get(id)
    if (!item) return
    clearTimeout(item.timer); this.pending.delete(id); item.resolve(result)
  }
  clear() { for (const id of this.pending.keys()) this.finish(id, { ok: false, code: 'BIND_REQUIRED' }) }
  request(operation, payload = {}, requestId = randomUUID()) {
    const { state } = this.channel
    if (state.binding !== 'bound' || state.connection !== 'connected') return Promise.resolve({ ok: false, code: 'BIND_REQUIRED' })
    if (operation.startsWith('moments_') && !state.desktopMomentsSupported) return Promise.resolve({ ok: false, code: 'SERVER_UPDATE_REQUIRED' })
    if (!state.desktopServicesSupported && !(state.desktopMemoSupported && ['memo_list', 'memo_create', 'memo_delete'].includes(operation)) &&
        !(state.desktopNotificationsSupported && operation === 'notification_sync'))
      return Promise.resolve({ ok: false, code: 'SERVER_UPDATE_REQUIRED' })
    if (state.proofRequired && !state.accountAuthReady) return Promise.resolve({ ok: false, code: 'PAIRING_PROOF_REQUIRED' })
    if (this.pending.size >= 16 || this.pending.has(requestId)) return Promise.resolve({ ok: false, code: 'BUSY' })
    return new Promise(resolve => {
      const timer = setTimeout(() => this.finish(requestId, { ok: false, code: 'TIMEOUT' }), this.timeoutMs)
      this.pending.set(requestId, { resolve, timer })
      if (!this.channel.send({ type: 'desktop_action', deviceId: state.deviceId, operation, requestId, payload })) {
        this.finish(requestId, { ok: false, code: 'OFFLINE' })
      }
    })
  }
}
