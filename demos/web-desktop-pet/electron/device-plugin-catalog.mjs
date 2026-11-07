export const PLUGIN_CATALOG_URL = 'https://download.aibanlv.ai/desktop-plugins/catalog.json'
const MAX_BYTES = 256 * 1024
const invalid = () => Object.assign(new Error('Invalid plugin catalog'), { code: 'INVALID_CATALOG' })
const field = (value, limit, required = false) => {
  if (value === undefined && !required) return ''
  if (typeof value !== 'string' || value.length > limit || required && !value.trim() || /[\u0000-\u001f\u007f]/.test(value)) throw invalid()
  return value.trim()
}

function pluginsFrom(value) {
  if (value?.schema !== 1 || !Array.isArray(value.plugins) || value.plugins.length > 200) throw invalid()
  const ids = new Set(), plugins = []
  for (const row of value.plugins) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw invalid()
    const id = field(row.id, 80, true)
    if (!/^[a-z0-9][a-z0-9._-]*$/.test(id) || ids.has(id) || row.enabled !== undefined && typeof row.enabled !== 'boolean') throw invalid()
    ids.add(id)
    const plugin = { id, name: field(row.name, 120, true), version: field(row.version, 80), description: field(row.description, 2000) }
    if (row.enabled !== false) plugins.push(plugin)
  }
  return plugins
}

// Public metadata only. This transport never uses the paired-device HTTP adapter.
export class OnlinePluginCatalog {
  constructor({ fetchImpl = (...args) => globalThis.fetch(...args), timeoutMs = 10000 } = {}) {
    Object.assign(this, { fetchImpl, timeoutMs })
  }
  query() {
    if (!this.job) this.job = this.load().finally(() => { this.job = null })
    return this.job
  }
  async load() {
    const signal = AbortSignal.timeout(this.timeoutMs)
    let response
    try {
      response = await this.fetchImpl(PLUGIN_CATALOG_URL, { signal, redirect: 'error', credentials: 'omit',
        cache: 'no-store', headers: { Accept: 'application/json' } })
      if (!response.ok) return { ok: false, code: response.status === 404 ? 'NOT_PUBLISHED' : 'UNAVAILABLE' }
      if (!response.body || Number(response.headers.get('content-length')) > MAX_BYTES) throw invalid()
      const chunks = []; let size = 0
      for await (const chunk of response.body) {
        signal.throwIfAborted(); size += chunk.byteLength
        if (size > MAX_BYTES) throw invalid()
        chunks.push(Buffer.from(chunk))
      }
      signal.throwIfAborted()
      let value
      try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { throw invalid() }
      return { ok: true, plugins: pluginsFrom(value) }
    } catch (error) {
      return { ok: false, code: error.code === 'INVALID_CATALOG' ? error.code : 'UNAVAILABLE' }
    } finally { await response?.body?.cancel().catch(() => {}) }
  }
}
