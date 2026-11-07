import { readFile, writeFile, rename } from 'node:fs/promises'

const failure = code => Object.assign(new Error(code), { code })
export const mailProviders = Object.freeze({
  qq: { host: 'imap.qq.com', domains: ['qq.com', 'foxmail.com', 'vip.qq.com'] },
  '163': { host: 'imap.163.com', domains: ['163.com'] },
  '126': { host: 'imap.126.com', domains: ['126.com'] },
})
function validate(account) {
  const provider = Object.hasOwn(mailProviders, account?.provider) ? mailProviders[account.provider] : null
  if (!provider || typeof account.user !== 'string' || account.user.length > 254 ||
      !/^[a-z0-9.!#$%&'*+\-=?^_`{|}~]+@[a-z0-9.-]+$/i.test(account.user) ||
      !provider.domains.includes(account.user.split('@')[1].toLowerCase()) ||
      typeof account.password !== 'string' || !/^[\x21-\x7e]{8,256}$/.test(account.password)) {
    throw failure('MAIL_SETTINGS_INVALID')
  }
  return { provider: account.provider, user: account.user, password: account.password }
}

export class MailSettings {
  #account = null
  constructor({ file, encryption }) {
    Object.assign(this, { file, encryption })
    this.state = { enabled: false, configured: false, remember: false, notifications: false, contentAnnouncements: false }
  }
  snapshot() { return { ...this.state, storageAvailable: this.encryption.isEncryptionAvailable(), ...(this.#account ? { user: this.#account.user, provider: this.#account.provider } : {}) } }
  credentials() {
    if (!this.state.enabled || !this.#account) throw failure('MAIL_DISABLED')
    return { ...this.#account }
  }
  async load() {
    try {
      const raw = await readFile(this.file, 'utf8')
      if (raw.length > 16384) throw failure('MAIL_STORAGE_UNAVAILABLE')
      const data = JSON.parse(raw)
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw failure('MAIL_STORAGE_UNAVAILABLE')
      if (data.encrypted) {
        if (typeof data.encrypted !== 'string' || !this.encryption.isEncryptionAvailable()) throw failure('MAIL_STORAGE_UNAVAILABLE')
        this.#account = validate(JSON.parse(this.encryption.decryptString(Buffer.from(data.encrypted, 'base64'))))
        this.state = { enabled: data.enabled !== false, configured: true, remember: true, notifications: data.notifications === true, contentAnnouncements: data.contentAnnouncements === true }
      }
    } catch (error) { if (error.code !== 'ENOENT') throw failure('MAIL_STORAGE_UNAVAILABLE') }
  }
  async configure(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key =>
      !['provider', 'user', 'password', 'remember', 'notifications', 'enabled', 'contentAnnouncements'].includes(key)) ||
      ['remember', 'notifications', 'enabled', 'contentAnnouncements'].some(key => key in value && typeof value[key] !== 'boolean')) {
      throw failure('MAIL_SETTINGS_INVALID')
    }
    const account = validate({ ...this.#account, ...value,
      password: value.password || ((value.user === undefined || value.user === this.#account?.user) &&
        (value.provider === undefined || value.provider === this.#account?.provider) ? this.#account?.password : '') })
    const next = { enabled: value.enabled ?? true, configured: true,
      remember: value.remember ?? this.state.remember, notifications: value.notifications ?? this.state.notifications,
      contentAnnouncements: value.contentAnnouncements ?? (this.#account?.provider === account.provider && this.#account?.user === account.user ? this.state.contentAnnouncements : false) }
    const stored = {}
    if (next.remember) {
      if (!this.encryption.isEncryptionAvailable()) throw failure('MAIL_STORAGE_UNAVAILABLE')
      stored.encrypted = this.encryption.encryptString(JSON.stringify(account)).toString('base64')
      stored.notifications = next.notifications
      stored.enabled = next.enabled
      stored.contentAnnouncements = next.contentAnnouncements
    }
    await this.write(stored)
    this.#account = account
    this.state = next
    return this.snapshot()
  }
  async write(value) {
    await writeFile(`${this.file}.tmp`, JSON.stringify(value), { mode: 0o600 })
    await rename(`${this.file}.tmp`, this.file)
  }
  async forget() {
    await this.write({})
    this.#account = null
    this.state = { enabled: false, configured: false, remember: false, notifications: false, contentAnnouncements: false }
    return this.snapshot()
  }
}
