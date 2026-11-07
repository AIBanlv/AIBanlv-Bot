import { EventEmitter } from 'node:events'
import { normalizeProfile } from './device-channel.mjs'
import { assetUrl } from './device-assets.mjs'

const endpoint = 'https://scrm.ieasysell.com/jwt/client/aliBot/getBotListTWithPublic'
const id = value => typeof value === 'string' ? value.trim() : Number.isSafeInteger(value) ? String(value) : ''
const flag = value => [true, 1, '1', 'true'].includes(value)
const validId = value => Boolean(value && value.length <= 256 && !/[\u0000-\u001f]/.test(value))
const first = (...values) => values.find(value => typeof value === 'string' && value.trim())?.trim() || ''
// Only a verified public catalog marks publicAvatar. Account-scoped tenant
// characters may omit userId and must not become public merely for that reason.
export const profileKind = profile => profile.source === 'local' ? 'local' : profile.publicAvatar === true ? 'public' : 'private'

function profileFor(row, scope) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return
  const tenant = id(row.tenantId ?? row.tenant_id), owner = id(row.userId ?? row.user_id)
  const rawOwner = row.userId ?? row.user_id
  if (rawOwner != null && rawOwner !== '' && !validId(owner)) return
  if (owner && owner !== scope.controllerUserId) return
  const shared = !owner && tenant === '1'
  if (scope.guest === true && !shared) return
  if (!shared && tenant !== scope.tenantId) return
  const model = id(row.digitalHumanId || row.digital_human_id || row.humanModelId || row.human_model_id ||
    row.taskId || row.task_id || row.id || row.botImageId || row.bot_image_id)
  const agentId = id(row.id || row.aliBotId || row.ali_bot_id)
  if (!validId(agentId)) return
  const assetTenant = flag(row.isDefault) ? '1' : tenant
  const explicit = first(row.zipUrl, row.zip_url, row.zipPath, row.zip_path, row.modelUrl, row.model_url,
    row.modelPath, row.model_path, row.zipFileUrl, row.zip_file_url, row.zipFile, row.zip_file,
    row.fileUrl, row.file_url, row.resourceUrl, row.resource_url, row.downloadUrl, row.download_url)
  if (!explicit && (!validId(model) || !validId(assetTenant))) return
  const zipUrl = explicit || `https://zhanlvgpt.ieasysell.com/${encodeURIComponent(assetTenant)}/${encodeURIComponent(model)}/${encodeURIComponent(model)}.zip`
  assetUrl(zipUrl)
  return { ...normalizeProfile({ agentId, agentName: first(row.name) || agentId, zipUrl,
    voiceId: id(row.voiceId || row.voice_id || row.voiceTypeId || row.voice_type_id),
    language: first(row.languageCode, row.language_code) || 'zh',
    characterSetting: first(row.characterSetting, row.character_setting, row.description),
    welcomeMessage: first(row.welcomeMessage, row.welcome_message, row.promptInfo),
    agentPhotoUrl: first(row.picture, row.photoUrl, row.photo_url), zipName: first(row.zipName, row.zip_name) }), publicAvatar: shared,
    description: first(row.description, row.intro).slice(0, 500), kind: shared ? 'public' : 'private' }
}

export async function loadCatalog(scope, signal, fetcher = fetch) {
  if (scope?.guest !== true && (!validId(scope?.tenantId) || !validId(scope?.controllerUserId))) throw new Error('Binding identity required')
  const abort = AbortSignal.any([AbortSignal.timeout(15000), ...(signal ? [signal] : [])])
  abort.throwIfAborted()
  const url = new URL(scope.guest === true ? 'https://scrm.ieasysell.com/jwt/client/desktop-public/roles' : endpoint)
  if (scope.guest !== true) url.searchParams.set('tenantId', scope.tenantId)
  const response = await fetcher(url.href, { method: 'GET', redirect: 'error', credentials: 'omit', signal: abort })
  if (!response.ok || !response.body) throw new Error('Catalog unavailable')
  const chunks = []; let bytes = 0
  for await (const chunk of response.body) {
    abort.throwIfAborted()
    bytes += chunk.byteLength
    if (bytes > 4 * 1024 * 1024) throw new Error('Catalog too large')
    chunks.push(Buffer.from(chunk))
  }
  abort.throwIfAborted()
  const result = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if (result?.ok === false || !Array.isArray(result) && result?.code !== undefined && ![0, 200].includes(result.code)) throw new Error('Catalog denied')
  const rows = Array.isArray(result) ? result : result?.data
  return normalizeCatalogRows(rows, scope)
}

export function normalizeCatalogRows(rows, scope) {
  if (!Array.isArray(rows) || rows.length > 1000) throw new Error('Invalid catalog')
  const profiles = new Map(), duplicates = new Set()
  for (const row of rows) {
    let profile
    try { profile = profileFor(row, scope) } catch { continue }
    if (!profile) continue
    if (profiles.has(profile.agentId)) duplicates.add(profile.agentId)
    profiles.set(profile.agentId, profile)
  }
  return [...profiles.values()].filter(profile => !duplicates.has(profile.agentId))
}

export class DeviceCatalog extends EventEmitter {
  constructor({ channel, load = loadCatalog }) {
    super()
    Object.assign(this, { channel, load })
    this.key = null
    this.state = { status: 'idle', profiles: [], error: '' }
    this.onState = () => this.sync()
    this.onRevoked = () => { this.key = null; this.cancel(); this.publish('idle'); this.sync() }
    channel.on('state', this.onState)
    channel.on('revoked', this.onRevoked)
    this.sync()
  }
  identity() {
    const { state, tenantId, controllerUserId } = this.channel
    if (state.binding === 'bound' && state.connection === 'connected' && state.proofRequired && !state.accountAuthReady) return null
    return state.binding === 'bound' && state.connection === 'connected' && validId(tenantId) && validId(controllerUserId)
      ? { deviceId: state.deviceId, tenantId, controllerUserId } : { guest: true }
  }
  sync() {
    if (this.disposed) return
    const scope = this.identity(), key = scope ? JSON.stringify(scope) : ''
    if (key === this.key) return
    this.key = key
    this.cancel()
    this.publish('idle')
    if (scope) void this.refresh()
  }
  publish(status, profiles = [], error = '') {
    this.state = { status, profiles, error }
    this.emit('state', this.state)
  }
  cancel() { this.abort?.abort(); this.abort = null }
  async refresh() {
    const scope = this.identity()
    if (!scope || this.disposed) return
    this.cancel()
    const abort = this.abort = new AbortController(), key = this.key
    this.publish('loading')
    try {
      const profiles = await this.load(scope, abort.signal)
      if (abort.signal.aborted || key !== this.key || this.disposed) return
      this.publish('ready', profiles)
    } catch {
      if (!abort.signal.aborted && key === this.key && !this.disposed) {
        this.publish('error', [], '线上形象查询失败，请检查绑定权限和网络后刷新')
      }
    } finally { if (this.abort === abort) this.abort = null }
  }
  find(agentId) {
    if (this.state.status !== 'ready') return
    return this.state.profiles.find(profile => profile.agentId === agentId)
  }
  dispose() {
    this.disposed = true; this.cancel()
    this.channel.removeListener('state', this.onState)
    this.channel.removeListener('revoked', this.onRevoked)
    this.state = { status: 'idle', profiles: [], error: '' }
  }
}
