import { EventEmitter } from 'node:events'
import { bindingCode } from './device-binding-code.mjs'

export const DEFAULT_CONTROL_ENDPOINT = 'wss://scrm.ieasysell.com/ws/control/desktop'

export function controlEndpoint(value = DEFAULT_CONTROL_ENDPOINT) {
  const url = new URL(value)
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
  if ((url.protocol !== 'wss:' && !(local && url.protocol === 'ws:')) ||
      url.username || url.password || url.hash || url.search ||
      !['/ws/control', '/ws/control/desktop'].includes(url.pathname)) {
    throw new Error('Invalid control WebSocket endpoint')
  }
  // Preserve configured hosts while migrating old environment overrides to the desktop route.
  url.pathname = '/ws/control/desktop'
  return url.href
}

function text(value, limit = 256) {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string' || value.length > limit || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) {
    throw new Error('Invalid profile field')
  }
  return value.trim()
}

function controlError(message) {
  const field = (value, limit) => typeof value === 'string'
    ? value.replace(/[\s\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]+/g, ' ').trim().slice(0, limit) : ''
  const code = field(message.code, 64) || (Number.isSafeInteger(message.code) ? String(message.code) : 'UNKNOWN')
  const reason = field(message.message, 300)
  const requestId = field(message.requestId, 128)
  return `控制服务拒绝了请求 [${code}]${reason ? `：${reason}` : '，请刷新连接后重试'}${requestId ? `（requestId: ${requestId}）` : ''}`
}

export function normalizeProfile(message) {
  const agentId = text(message.agentId || message.avatarId || message.humanModelId)
  const profileVersion = Number(message.profileVersion || 0)
  if (!agentId || !Number.isSafeInteger(profileVersion) || profileVersion < 0) throw new Error('Invalid role')
  return {
    source: 'online', agentId, agentName: text(message.agentName || message.displayName, 120),
    voiceId: text(message.voiceId), language: text(message.language || message.languageCode || 'zh', 32),
    zipUrl: text(message.zipUrl || message.zip_url || message.zipPath || message.zip_path, 2048),
    zipName: text(message.zipName || message.zip_name),
    agentPhotoUrl: text(message.agentPhotoUrl, 2048),
    characterSetting: text(message.characterSetting, 12000),
    welcomeMessage: text(message.welcomeMessage, 1000),
    profileVersion,
  }
}

export class DeviceChannel extends EventEmitter {
  constructor({ deviceId, endpoint, qr, socketFactory = url => new WebSocket(url), now = Date.now }) {
    super()
    if (!/^zhanlv:desktop-[a-zA-Z0-9-]{1,80}$/.test(deviceId)) throw new Error('Invalid device ID')
    this.endpoint = controlEndpoint(endpoint)
    this.socketFactory = socketFactory
    this.qr = qr
    this.now = now
    this.state = { deviceId, connection: 'offline', binding: 'unknown', owner: '', qr: '', expiresAt: 0, error: '' }
    this.socket = null
    this.started = false
    this.tenantId = ''
    this.controllerUserId = ''
    this.sequence = 0
    this.attempt = 0
  }

  publish(patch) {
    if (patch.connection && patch.connection !== 'connected' || patch.binding && patch.binding !== 'unbound') this.offer = null
    Object.assign(this.state, patch)
    this.emit('state', { ...this.state })
  }

  bindingOffer() {
    return this.state.connection === 'connected' && this.state.binding === 'unbound' &&
      this.state.expiresAt > Date.now() && this.offer?.expiresAt === this.state.expiresAt ? { ...this.offer } : null
  }

  start() {
    if (this.started) return
    this.started = true
    this.connect()
    this.timer = setInterval(() => this.tick(), 1000)
  }

  connect() {
    if (!this.started) return
    clearTimeout(this.retryTimer)
    this.retryTimer = null
    const previous = this.socket
    this.socket = null
    previous?.close()
    this.sequence++
    this.emit('control-diagnostic', { code: 'CONNECTING', attempt: this.attempt })
    this.publish({ connection: 'connecting', binding: 'unknown', qr: '', expiresAt: 0, error: '', refreshing: false })
    this.lastSeen = this.now()
    this.lastPing = 0
    this.registrationDeadline = 0
    this.registrationAttempts = 0
    let socket
    try { socket = this.socketFactory(this.endpoint) }
    catch { this.disconnected(); return }
    this.socket = socket
    socket.addEventListener('open', () => {
      if (this.socket !== socket) return
      this.attempt = 0
      this.lastSeen = this.now()
      this.registrationDeadline = this.now() + 10000
      this.registrationAttempts = 1
      this.emit('control-diagnostic', { code: 'SOCKET_OPEN' })
      this.publish({ connection: 'connected' })
      this.online()
    })
    socket.addEventListener('message', event => {
      if (this.socket !== socket || typeof event.data !== 'string' || event.data.length > 4 * 1024 * 1024) return
      if (event.data.length > 65536) {
        try { if (JSON.parse(event.data).type !== 'desktop_result') return } catch { return }
      }
      this.lastSeen = this.now()
      try {
        const message = JSON.parse(event.data)
        if (message && typeof message === 'object' && !Array.isArray(message)) this.receive(message)
      } catch { this.publish({ error: '控制服务消息格式无效' }) }
    })
    const disconnected = () => {
      if (this.socket !== socket) return
      this.socket = null
      socket.close()
      this.disconnected()
    }
    socket.addEventListener('close', disconnected)
    socket.addEventListener('error', disconnected)
  }

  disconnected() {
    this.sequence++
    this.emit('control-diagnostic', { code: 'DISCONNECTED' })
    this.publish({ connection: 'offline', binding: 'unknown', qr: '', expiresAt: 0, error: '连接已断开，正在重连' })
    if (!this.started) return
    clearTimeout(this.retryTimer)
    this.retryTimer = setTimeout(() => { this.retryTimer = null; this.connect() }, Math.min(30000, 1000 * 2 ** Math.min(this.attempt++, 5)))
  }

  send(payload) {
    if (this.socket?.readyState !== 1) return false
    try { this.socket.send(JSON.stringify(this.decorateMessage ? this.decorateMessage(payload) : payload)); return true } catch { return false }
  }

  online() { return this.send({ type: 'device_online', role: 'device', deviceId: this.state.deviceId }) }

  refresh() {
    if (!this.started || this.state.refreshing || this.state.connection === 'connecting') return false
    if (this.socket?.readyState !== 1) { this.connect(); return true }
    // Refresh registration on the live socket, retaining a valid QR until its replacement arrives.
    this.registrationAttempts = 1; this.registrationDeadline = this.now() + 10000
    this.publish({ refreshing: true, error: '' })
    return this.online()
  }

  receive(message) {
    const noticeDiagnostic = code => {
      if (message.type === 'proactive_message') this.emit('notification-diagnostic', { code })
    }
    if (message.deviceId && message.deviceId !== this.state.deviceId) { noticeDiagnostic('DEVICE_MISMATCH'); return }
    const type = message.type
    if (['switch_avatar', 'apply_agent_config', 'agent_state_desired', 'distribute_agent', 'send_text',
      'proactive_message', 'reply_saved', 'device_history'].includes(type) &&
        (message.controllerUserId && message.controllerUserId !== this.state.owner ||
        message.tenantId && this.tenantId && message.tenantId !== this.tenantId)) { noticeDiagnostic('IDENTITY_MISMATCH'); return }
    if (type === 'proactive_message' && this.state.binding !== 'bound') noticeDiagnostic('BIND_REQUIRED')
    if (type === 'ping' || type === 'heartbeat') {
      this.send({ type: 'pong', deviceId: this.state.deviceId })
    } else if (type === 'bind_offer') {
      if (message.deviceId !== this.state.deviceId || message.bound !== false && message.bound !== undefined) return
      const token = text(message.bindToken, 1024)
      let expiresAt = Number(message.expireAt)
      if (expiresAt < 1e12) expiresAt *= 1000
      if (!token || !Number.isSafeInteger(expiresAt) || expiresAt <= Date.now()) {
        this.publish({ qr: '', expiresAt: 0, error: '绑定二维码已过期，请刷新' }); return
      }
      const duplicate = this.offer?.bindToken === token && this.offer?.expiresAt === expiresAt
      if (duplicate && (this.state.qr || this.qrJob)) { this.registrationDeadline = 0; this.publish({ refreshing: false, error: '' }); return }
      const sequence = ++this.sequence
      if (this.state.owner) this.emit('revoked')
      this.emit('pairing-offer', token)
      this.tenantId = ''
      this.controllerUserId = ''
      this.state.account = null; this.state.accountSupported = false
      this.offer = { bindToken: token, expiresAt }
      this.registrationDeadline = 0
      this.emit('control-diagnostic', { code: 'OFFER_CONFIRMED' })
      this.publish({ binding: 'unbound', owner: '', qr: '', expiresAt, error: '', refreshing: false })
      const job = Promise.resolve().then(() => this.qr(bindingCode({ deviceId: this.state.deviceId,
        bindToken: token, expireAt: message.expireAt }))).then(qr => {
        if (sequence === this.sequence && this.started && expiresAt > Date.now()) this.publish({ qr })
      }).catch(() => {
        if (sequence === this.sequence) this.publish({ error: '二维码生成失败，请刷新' })
      }).finally(() => { if (this.qrJob === job) this.qrJob = null })
      this.qrJob = job
    } else if (type === 'bind_success') {
      if (message.deviceId !== this.state.deviceId) return
      const owner = text(message.controllerUserId || message.tenantId)
      if (!owner) return
      const tenantId = text(message.tenantId)
      if (this.state.owner && (this.state.owner !== owner || this.tenantId !== tenantId)) this.emit('revoked')
      this.tenantId = tenantId
      this.controllerUserId = text(message.controllerUserId)
      this.sequence++
      this.registrationDeadline = 0
      this.emit('control-diagnostic', { code: 'BIND_CONFIRMED',
        online: typeof message.online === 'boolean' ? message.online : 'unknown' })
      const metadata = this.accountMetadata(message.account)
      this.publish({ binding: 'bound', owner, qr: '', expiresAt: 0, error: '', account: metadata,
        refreshing: false,
        accountAuthReady: false,
        accountSupported: message.capabilities?.deviceAccount === true, directTransferSupported: message.capabilities?.directTransferV1 === true,
        proofRequired: message.capabilities?.deviceProofRequired === true,
        turnFallbackSupported: message.capabilities?.turnFallbackV1 === true,
        desktopMemoSupported: message.capabilities?.desktopMemoV1 === true,
        desktopNotificationsSupported: message.capabilities?.desktopNotificationsV1 === true,
        desktopServicesSupported: message.capabilities?.desktopServicesV1 === true,
        desktopMomentsSupported: message.capabilities?.desktopMomentsV1 === true })
      this.emit('paired')
    } else if (type === 'device_challenge' && (this.state.binding === 'bound' || message.phase === 'registration') && /^[a-f0-9-]{36}$/.test(message.nonce)) {
      this.emit('device-challenge', message.nonce, message.phase === 'registration')
    } else if (['bind_lost', 'unbind', 'unbind_success'].includes(type)) {
      this.sequence++
      this.tenantId = ''
      this.controllerUserId = ''
      this.publish({ binding: 'unbound', owner: '', qr: '', expiresAt: 0, error: '', account: null, accountSupported: false })
      this.emit('revoked')
      this.registrationAttempts = 1; this.registrationDeadline = this.now() + 10000
      this.online()
    } else if (['switch_avatar', 'apply_agent_config', 'agent_state_desired', 'distribute_agent'].includes(type)) {
      if (this.state.binding !== 'bound') return
      try { this.emit('profile', normalizeProfile(message), text(message.requestId), type) }
      catch { this.publish({ error: '角色配置无效，请在 Control App 重新切换' }) }
    } else if (type === 'send_text' && this.state.binding === 'bound') {
      // A controller that just reconnected asks for the visible transcript
      // instead of starting a turn, so it must never reach the pet's mouth.
      if (message.operation === 'sync_history') {
        this.emit('history', text(message.agentId), text(message.requestId))
        return
      }
      const value = text(message.text, 1000)
      if (value) this.emit('text', value, text(message.requestId), {
        agentId: text(message.agentId), websocketSessionId: text(message.websocketSessionId),
        historyUserMessageId: text(message.historyUserMessageId), originSessionId: text(message.originSessionId, 128),
        computerAuthorized: message.computerAuthorized === true && this.state.directTransferSupported && (!this.state.proofRequired || this.state.accountAuthReady) })
    } else if (type === 'transfer_signal' && this.state.binding === 'bound' && this.state.directTransferSupported &&
        message.deviceId === this.state.deviceId && message.controllerUserId === this.state.owner && message.tenantId === this.tenantId) {
      this.emit('transfer-signal', message)
    } else if (type === 'transfer_ice' && this.state.binding === 'bound' && this.state.turnFallbackSupported &&
        message.deviceId === this.state.deviceId && message.controllerUserId === this.state.owner && message.tenantId === this.tenantId) {
      this.emit('transfer-ice', message)
    } else if (type === 'device_account' && this.state.binding === 'bound' && this.state.accountSupported &&
        message.deviceId === this.state.deviceId && message.controllerUserId === this.state.owner && message.tenantId === this.tenantId) {
      this.publish({ account: this.accountMetadata(message.account) })
      this.emit('account', { requestId: text(message.requestId) })
    } else if (type === 'desktop_result' && this.state.binding === 'bound' &&
        message.deviceId === this.state.deviceId && message.tenantId === this.tenantId && message.controllerUserId === this.state.owner) {
      this.emit('desktop-result', message)
    } else if (type === 'device_history' && this.state.binding === 'bound') {
      this.emit('device-history', message)
    } else if (type === 'reply_saved' && this.state.binding === 'bound') {
      this.emit('reply-saved', text(message.messageId),
        { historyMessageId: text(message.historyMessageId), timestamp: Number(message.timestamp) })
    } else if (type === 'proactive_message' && this.state.binding === 'bound') {
      // Account-scoped reminder, not an instruction to apply the source role.
      if (message.useCurrentAgent !== true || !message.tenantId || !message.controllerUserId) { noticeDiagnostic('INVALID_SCOPE'); return }
      const eventId = text(message.eventId), content = text(message.content, 1000)
      const sentAt = Number(message.sentAt)
      if (eventId && content && Number.isSafeInteger(sentAt) && sentAt > 0) {
        noticeDiagnostic('ACCEPTED')
        this.emit('notification', { eventId, content, sentAt, source: 'server' })
      } else noticeDiagnostic('INVALID_NOTIFICATION')
    } else if (type === 'error') {
      const diagnostic = (value, limit) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').trim().slice(0, limit) : ''
      this.emit('request-error', { requestId: diagnostic(message.requestId, 128), code: diagnostic(message.code, 64) })
      if (message.requestId) this.emit('device-history', message)
      this.publish({ error: controlError(message) })
      if (['DEVICE_NOT_BOUND', 'BIND_REQUIRED'].includes(message.code)) {
        this.sequence++
        this.tenantId = ''
        this.publish({ binding: 'unbound', owner: '', qr: '', expiresAt: 0 })
        this.emit('revoked')
        this.online()
      }
    }
  }

  report(profile, applyStatus, lastError = '') {
    if (this.state.binding !== 'bound' || !['unknown', 'applied', 'failed'].includes(applyStatus)) return false
    return this.send({ ...normalizeProfile(profile), type: 'agent_state_report', deviceId: this.state.deviceId,
      applyStatus, ...(lastError ? { lastError: String(lastError).slice(0, 300) } : {}) })
  }

  accountMetadata(value) {
    if (!value || typeof value !== 'object') return null
    const name = text(value.name, 120)
    const points = typeof value.points === 'number' && Number.isSafeInteger(value.points) ? value.points : null
    return { name, points }
  }

  tick() {
    if (!this.started || this.retryTimer || !this.socket) return
    const now = this.now()
    // A pong confirms transport liveness, not that device_online completed.
    // Retry once without replacing the socket; never periodically replay a
    // confirmed binding (the server also replays desired avatar configuration).
    if (this.registrationDeadline && now >= this.registrationDeadline) {
      if (this.registrationAttempts >= 2) {
        this.emit('control-diagnostic', { code: 'REGISTRATION_TIMEOUT' })
        this.connect()
        return
      }
      this.registrationAttempts++
      this.registrationDeadline = now + 10000
      this.emit('control-diagnostic', { code: 'REGISTRATION_RETRY' })
      this.online()
    }
    if (this.state.expiresAt && now >= this.state.expiresAt) {
      this.sequence++
      this.publish({ qr: '', expiresAt: 0, error: '二维码已过期，正在刷新' })
      this.registrationAttempts = 1; this.registrationDeadline = now + 10000
      this.online()
    }
    if (now - this.lastSeen > 45000) { this.connect(); return }
    if (this.socket?.readyState === 1 && now - this.lastPing > 15000) {
      this.lastPing = now
      this.send({ type: 'ping', deviceId: this.state.deviceId })
    }
  }

  stop() {
    this.offer = null
    this.started = false
    this.sequence++
    clearInterval(this.timer)
    clearTimeout(this.retryTimer)
    this.send({ type: 'device_offline', role: 'device', deviceId: this.state.deviceId })
    const socket = this.socket
    this.socket = null
    socket?.close()
  }
}
