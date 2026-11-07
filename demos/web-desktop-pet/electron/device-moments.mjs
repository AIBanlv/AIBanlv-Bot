export const momentOperations = ['moments_feed', 'moments_roles', 'moments_publish', 'moments_comment', 'moments_like',
  'moments_delete', 'moments_comment_edit', 'moments_comment_delete']
export function momentMediaUrl(value) {
  return typeof value === 'string' && /^https:\/\/zhanlvgpt\.ieasysell\.com\/[A-Za-z0-9_%.-]+\/moments\/[A-Za-z0-9_%.-]+\/[A-Za-z0-9-]+\.(jpg|png|webp|mp4|mov)$/.test(value) ? value : ''
}
export function momentAvatar(value) {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && !url.port &&
    ['zhanlvgpt.ieasysell.com', 'qn.ieasysell.com', 'scrm.ieasysell.com'].includes(url.hostname) ? url.href : '' } catch { return '' }
}

export function latestMomentAuthor(online = [], local = [], roles = []) {
  const candidates = [...online, ...local.map(post => ({ ...post, local: true }))]
    .filter(post => typeof post.agentId === 'string' && post.agentId.trim())
    .map(post => ({ post, time: Number.isFinite(post.timestamp) ? post.timestamp : Date.parse(post.createdAt) }))
    .filter(row => Number.isFinite(row.time)).sort((a, b) => b.time - a.time)
  const latest = candidates[0]?.post
  if (!latest) return null
  const role = roles.find(role => role.agentId === latest.agentId && (role.source === 'local' || role.local === true) === (latest.local === true))
  const image = latest.avatar || role?.agentPhotoUrl || ''
  const avatar = latest.local && /^\/assets\/local-local-[a-f0-9-]{36}\.png$/.test(image) ? image : momentAvatar(image)
  return { agentId: latest.agentId, avatar }
}
export function momentResourceAllowed(details, controllerId) {
  return Boolean(controllerId && details.webContentsId === controllerId &&
    (details.resourceType === 'image' && momentAvatar(details.url) || details.resourceType === 'media' && momentMediaUrl(details.url)))
}
export function momentPage(data) {
  if (!data || !Array.isArray(data.records) || data.records.length > 20 || typeof data.hasMore !== 'boolean' ||
      typeof data.nextCursor !== 'string' || data.nextCursor.length > 180 || data.hasMore && !data.nextCursor) throw new Error('MOMENTS_RESPONSE')
  const text = (value, max) => typeof value === 'string' ? value.slice(0, max) : ''
  const row = value => {
    if (!value || !/^[a-f0-9]{64}$/.test(value.id)) throw new Error('MOMENTS_RESPONSE')
    return { id: value.id, agentId: text(value.agentId, 128), authorName: text(value.authorName, 128),
      content: text(value.content, 2000), avatar: momentAvatar(value.avatar), createdAt: text(value.createdAt, 64),
      replyToName: text(value.replyToName, 128) }
  }
  return { records: data.records.map(value => ({ ...row(value), liked: value.liked === true,
    media: (Array.isArray(value.media) ? value.media : []).slice(0, 9).filter(item => item &&
      ['image', 'video'].includes(item.type) && momentMediaUrl(item.url) && (item.type === 'video' ? /\.(mp4|mov)$/.test(item.url) : /\.(jpg|png|webp)$/.test(item.url))),
    comments: (Array.isArray(value.comments) ? value.comments : []).slice(0, 100).map(row) })),
    hasMore: data.hasMore, nextCursor: data.nextCursor }
}

// Only visible timelines poll. Writes are explicit, single-flight and never auto-retried.
export class MomentsTimeline {
  constructor({ request, changed = () => {}, now = Date.now }) {
    Object.assign(this, { request, changed, now }); this.scope = ''; this.generation = 0; this.active = false
    this.reset()
  }
  reset() { this.rows = []; this.cursor = ''; this.hasMore = false; this.loading = false; this.saving = false; this.error = ''; this.failures = 0; this.nextAt = 0 }
  context(scope, connected, supported) {
    if (this.scope !== scope) { this.scope = scope; this.generation++; this.reset() }
    this.connected = connected; this.supported = supported
    if (!scope) this.error = 'BIND_REQUIRED'
    else if (!connected) this.error = 'OFFLINE'
    else if (!supported) this.error = 'SERVER_UPDATE_REQUIRED'
    else if (['BIND_REQUIRED', 'OFFLINE', 'SERVER_UPDATE_REQUIRED'].includes(this.error)) this.error = ''
    this.changed()
  }
  async load({ more = false, automatic = false, menuPreview = false } = {}) {
    if (!this.active && !menuPreview || !this.scope || !this.connected || !this.supported || this.loading || this.saving || more && !this.hasMore || automatic && this.now() < this.nextAt) return
    const generation = this.generation, scope = this.scope
    this.loading = true; this.changed()
    try {
      const result = await this.request('moments_feed', { cursor: more ? this.cursor : '' })
      if (generation !== this.generation || scope !== this.scope) return
      if (!result?.ok) throw new Error(result?.code || 'MOMENTS_FAILED')
      const page = momentPage(result.data)
      this.rows = more ? [...this.rows, ...page.records.filter(row => !this.rows.some(old => old.id === row.id))].slice(0, 200) : page.records
      this.cursor = page.nextCursor; this.hasMore = page.hasMore && this.rows.length < 200; this.error = ''; this.failures = 0; this.nextAt = this.now() + 30000
    } catch (error) {
      if (generation === this.generation) { this.error = error.message; this.failures++; this.nextAt = this.now() + Math.min(300000, 30000 * 2 ** Math.min(4, this.failures - 1)) }
    } finally { if (generation === this.generation) { this.loading = false; this.changed() } }
  }
  async write(operation, payload) {
    if (this.saving || !this.scope || !this.connected || !this.supported || !momentOperations.includes(operation) || operation === 'moments_feed') return { ok: false, code: 'BUSY' }
    const generation = this.generation
    this.saving = true; this.changed()
    try {
      const result = await this.request(operation, payload)
      return generation === this.generation ? result : { ok: false, code: 'BIND_REQUIRED' }
    } catch { return { ok: false, code: 'OFFLINE' } }
    finally { if (generation === this.generation) { this.saving = false; this.changed() } }
  }
}
