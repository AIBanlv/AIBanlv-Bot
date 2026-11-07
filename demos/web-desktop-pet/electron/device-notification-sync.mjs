// Read-only recovery of notifications issued while this bound app is running.
// This does not schedule messages, acknowledge phone delivery or create speech
// sessions. Both push and recovery enter the same bounded/deduplicated queue.
export class DeviceNotificationSync {
  constructor({ channel, services, notifications, now = Date.now, intervalMs = 15000, onStatus = () => {} }) {
    Object.assign(this, { channel, services, notifications, now, intervalMs, onStatus })
    this.since = now(); this.generation = 0; this.state = { state: 'unbound' }
    this.changed = () => { if (this.running) void this.sync() }
    this.revoked = () => { this.generation++; this.pending = null; this.since = now(); this.publish('unbound') }
    channel.on('state', this.changed); channel.on('revoked', this.revoked)
  }
  snapshot() { return { ...this.state } }
  publish(state, code = '') {
    if (this.state.state === state && this.state.code === code) return
    this.state = { state, code }; this.onStatus(this.snapshot())
  }
  start() {
    if (this.running) return
    this.running = true
    this.timer = setInterval(() => void this.sync(true), this.intervalMs); this.timer.unref?.()
    void this.sync()
  }
  async sync(force = false) {
    const { state } = this.channel
    if (state.connection !== 'connected') { this.publish('offline'); return }
    if (state.binding !== 'bound') { this.publish('unbound'); return }
    if (!state.desktopNotificationsSupported) { this.publish('unsupported', 'SERVER_UPDATE_REQUIRED'); return }
    if (state.proofRequired && !state.accountAuthReady) { this.publish('unauthorized', 'PAIRING_PROOF_REQUIRED'); return }
    const scope = JSON.stringify([state.owner, this.channel.tenantId, this.channel.sequence])
    if (this.pending?.scope === scope || !force && this.lastScope === scope) return
    const job = { scope, generation: this.generation }; this.pending = job; this.lastScope = scope
    try {
      const result = await this.services.request('notification_sync', { since: Math.max(this.since, this.now() - 600000) })
      if (!this.running || job.generation !== this.generation || this.pending !== job ||
          scope !== JSON.stringify([this.channel.state.owner, this.channel.tenantId, this.channel.sequence]) ||
          this.channel.state.binding !== 'bound' || this.channel.state.connection !== 'connected') return
      if (!result?.ok) { this.publish('error', result?.code || 'OFFLINE'); return }
      if (!Array.isArray(result.data?.events) || result.data.events.length > 100) { this.publish('error', 'INVALID_RESPONSE'); return }
      if (result.data.notificationsEnabled === false) { this.publish('disabled'); return }
      for (const event of result.data.events) {
        if (typeof event?.eventId !== 'string' || event.eventId.length > 128 || typeof event.content !== 'string' || event.content.length > 1000 ||
            !Number.isSafeInteger(event.sentAt) || event.sentAt < this.since) continue
        this.notifications.receive({ eventId: event.eventId, sentAt: event.sentAt, content: event.content, source: 'server' })
      }
      this.publish('ready')
    } catch { if (job.generation === this.generation && this.pending === job) this.publish('error', 'OFFLINE') }
    finally { if (this.pending === job) this.pending = null }
  }
  stop() {
    this.running = false; this.generation++; this.pending = null
    clearInterval(this.timer)
    this.channel.removeListener('state', this.changed); this.channel.removeListener('revoked', this.revoked)
  }
}
