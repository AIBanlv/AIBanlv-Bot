import { createHmac } from 'node:crypto'
import { readFile, writeFile, rename, unlink } from 'node:fs/promises'

// Pairing secret is never exposed to renderer/model, logged, or persisted as plaintext.
export class DeviceBindingProof {
  constructor({ channel, file, encryption }) {
    Object.assign(this, { channel, file, encryption }); this.queue = Promise.resolve()
    channel.decorateMessage = value => {
      if (['ping', 'pong', 'heartbeat'].includes(value.type) || !this.key || !this.nonce) return value
      return { ...value, deviceProof: this.httpProof() }
    }
    channel.on('pairing-offer', token => { this.pending = token })
    channel.on('paired', () => {
      if (this.pending) { this.key = this.pending; this.pending = ''; void this.save().catch(() => {}) }
      this.nonce = ''; this.registration = false
      this.publish()
    })
    channel.on('device-challenge', (nonce, registration) => {
      this.nonce = nonce; this.registration = registration === true; this.publish()
      if (registration && this.key) channel.online()
      else if (registration) channel.publish({ error: '此设备已有绑定，但本机授权凭据缺失，请在 App 解绑后重新扫码' })
    })
    channel.on('state', state => { if (state.connection !== 'connected' && this.nonce) { this.nonce = ''; this.publish() } })
    channel.on('revoked', () => {
      this.key = this.nonce = this.pending = ''
      this.queue = this.queue.catch(() => {}).then(() => unlink(this.file).catch(error => { if (error.code !== 'ENOENT') throw error }))
      void this.queue.catch(() => {}); this.publish()
    })
  }
  httpProof() {
    return this.key && this.nonce ? createHmac('sha256', this.key)
      .update(`${this.channel.state.deviceId}\n${this.nonce}`).digest('hex') : ''
  }
  publish() { this.channel.publish({ accountAuthReady: Boolean(this.key && this.nonce && !this.registration) }) }
  async load() {
    try {
      const raw = await readFile(this.file, 'utf8'); if (raw.length > 16384) return
      const value = JSON.parse(raw)
      if (value.deviceId === this.channel.state.deviceId && this.encryption.isEncryptionAvailable()) {
        const key = this.encryption.decryptString(Buffer.from(value.encrypted, 'base64'))
        if (typeof key === 'string' && key.length >= 16 && key.length <= 1024) this.key = key
      }
    } catch { /* Legacy bindings have no proof; new capabilities remain locked until QR pairing. */ }
  }
  save() {
    if (!this.encryption.isEncryptionAvailable()) return Promise.resolve()
    const data = JSON.stringify({ deviceId: this.channel.state.deviceId, encrypted: this.encryption.encryptString(this.key).toString('base64') })
    this.queue = this.queue.catch(() => {}).then(async () => { await writeFile(`${this.file}.tmp`, data, { mode: 0o600 }); await rename(`${this.file}.tmp`, this.file) })
    return this.queue
  }
}
