import { readFile, writeFile, rename } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { platformCreditsMessage, guestCreditsMessage, guestLoginMessage } from './device-pet-policy.mjs'
import { guestIdentityMessages } from './device-guest-identity.mjs'

const fail = code => Object.assign(new Error(code), { code })
const defaults = { source: 'auto', platformEnabled: true, remember: false, region: 'cn-beijing',
  workspaceId: '', model: 'qwen-audio-3.0-realtime-flash', voice: 'longanlingxi' }
export function realtimeRegion(countryCode, locale = '') {
  let country = String(countryCode || '').trim().toUpperCase()
  if (!country) { try { country = new Intl.Locale(locale.replace('_', '-')).region || '' } catch {} }
  return country === 'CN' ? 'cn-beijing' : 'ap-southeast-1'
}
function preferences(value) {
  const next = { ...defaults, ...value }
  if (!['auto', 'deepseek', 'realtime', 'platform'].includes(next.source) ||
      typeof next.platformEnabled !== 'boolean' || typeof next.remember !== 'boolean' ||
      !['cn-beijing', 'ap-southeast-1'].includes(next.region) ||
      typeof next.workspaceId !== 'string' || !/^[a-zA-Z0-9-]{0,128}$/.test(next.workspaceId) ||
      typeof next.model !== 'string' || !/^qwen[a-zA-Z0-9.-]{1,100}-realtime(?:-(?:flash|plus))?(?:-[0-9-]+)?$/.test(next.model) ||
      typeof next.voice !== 'string' || !/^[a-zA-Z0-9_-]{1,256}$/.test(next.voice)) throw fail('INVALID_MODEL_SETTINGS')
  return Object.fromEntries(Object.keys(defaults).map(key => [key, next[key]]))
}

export class ModelSettings {
  #key = ''
  constructor({ file, encryption, region }) { Object.assign(this, { file, encryption, region }); this.state = { ...defaults, ...(region ? { region } : {}) } }
  key() { return this.#key }
  snapshot() { return { ...this.state, configured: Boolean(this.#key), storageAvailable: this.encryption.isEncryptionAvailable() } }
  async load() {
    try {
      const raw = await readFile(this.file, 'utf8')
      if (raw.length > 16384) throw fail('MODEL_STORAGE_UNAVAILABLE')
      const value = JSON.parse(raw), state = preferences(value)
      // Older releases persisted the initial defaults as ordinary preferences.
      // Only migrate that exact pair; new explicit saves carry a revision marker.
      if (value.defaultsRevision === undefined && state.model === 'qwen3.8-omni-flash-realtime' && state.voice === 'Tina') {
        state.model = defaults.model; state.voice = defaults.voice
      }
      let key = ''
      if (value.encryptedKey) {
        if (!this.encryption.isEncryptionAvailable()) throw fail('MODEL_STORAGE_UNAVAILABLE')
        key = this.encryption.decryptString(Buffer.from(value.encryptedKey, 'base64'))
        if (!/^[\x21-\x7e]{8,512}$/.test(key)) throw fail('INVALID_KEY')
      }
      this.state = { ...state, ...(this.region ? { region: this.region } : {}) }; this.#key = key
    } catch (error) { if (error.code !== 'ENOENT') throw fail('MODEL_STORAGE_UNAVAILABLE') }
  }
  #candidate(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        Object.keys(value).some(key => ![...Object.keys(defaults), 'apiKey', 'forget'].includes(key)) ||
        ('apiKey' in value && typeof value.apiKey !== 'string') || ('forget' in value && value.forget !== true)) throw fail('INVALID_MODEL_SETTINGS')
    const state = preferences({ ...this.state, ...value, ...(this.region ? { region: this.region } : {}) })
    const supplied = value.apiKey?.trim().replace(/^Bearer\s+/i, '') || ''
    const key = value.forget ? '' : supplied || this.#key
    if (key && !/^[\x21-\x7e]{8,512}$/.test(key)) throw fail('INVALID_KEY')
    return { state, key }
  }
  preview(value = {}) {
    const { state, key } = this.#candidate(value)
    return { snapshot: () => ({ ...state }), key: () => key }
  }
  async configure(value) {
    const { state, key } = this.#candidate(value)
    const stored = { ...state, defaultsRevision: 1 }
    if (state.remember && key) {
      if (!this.encryption.isEncryptionAvailable()) throw fail('MODEL_STORAGE_UNAVAILABLE')
      stored.encryptedKey = this.encryption.encryptString(key).toString('base64')
    }
    await writeFile(`${this.file}.tmp`, JSON.stringify(stored), { mode: 0o600 })
    await rename(`${this.file}.tmp`, this.file)
    this.state = state; this.#key = key
    return this.snapshot()
  }
}

export function modelRoute(settings, deepseek, { profile, bound = false, guest = false, connected = false, score = null, scoreError = '' } = {}) {
  const roleSource = profile?.agentId ? profile.source ?? 'online' : ''
  const denied = (code, message) => ({ route: '', roleSource, code, message, textOnly: true })
  if (!['online', 'local'].includes(roleSource)) return denied('AVATAR_NOT_READY', '请先选择可用的角色')
  if (roleSource === 'online') {
    if ((!bound && !(guest && profile.publicAvatar === true)) || !connected) return denied('BIND_REQUIRED', '线上角色需要连接平台并扫码绑定')
    if (guest && scoreError === 'GUEST_LOGIN_REQUIRED') return denied('GUEST_LOGIN_REQUIRED', guestLoginMessage)
    if (guest && Object.hasOwn(guestIdentityMessages, scoreError)) return denied(scoreError, guestIdentityMessages[scoreError])
    if (score === null) return denied('SCORE_PENDING', '正在确认平台积分，请稍后重试')
    if (score < 30) return denied('SCORE_DEPLETED', guest ? guestCreditsMessage : platformCreditsMessage)
    return { route: 'platform', roleSource, textOnly: false, funding: 'platform' }
  }
  const route = settings.configured ? 'realtime' : deepseek ? 'deepseek' : ''
  if (!route) return denied('KEY_REQUIRED', '本地角色需要填写模型 Key，或登录 Harness 客户端')
  return { route, roleSource, textOnly: route === 'deepseek', funding: 'own' }
}

export function ownRealtimeSession(settings, profile) {
  const value = preferences(settings.snapshot()), apiKey = settings.key()
  if (!apiKey) throw fail('REALTIME_KEY_REQUIRED')
  if (!value.workspaceId && !value.model.startsWith('qwen-audio-')) throw fail('WORKSPACE_REQUIRED')
  if (!profile?.agentId) throw fail('PERSONA_REQUIRED')
  const host = value.workspaceId ? `${value.workspaceId}.${value.region}.maas.aliyuncs.com`
    : value.region === 'ap-southeast-1' ? 'dashscope-intl.aliyuncs.com' : 'dashscope.aliyuncs.com'
  const url = new URL(`wss://${host}/api-ws/v1/realtime`)
  url.searchParams.set('model', value.model)
  return { funding: 'own', sessionId: randomUUID(), apiKey, providerUrl: url.href, voiceId: profile.voiceId || value.voice,
    instructions: profile.characterSetting || `你是${profile.agentName || '数字人'}。`,
    modelId: value.model, expiresAt: Date.now() + 30 * 60000, sampleRate: 24000 }
}
