import { mkdir, readFile, rename, unlink } from 'node:fs/promises'
import path from 'node:path'
import { verifyInstaller, validDigest } from './device-update-io.mjs'
import { MAX_BLOCKMAP_BYTES, saveBaseline } from './device-update-delta.mjs'
import { downloadInstaller } from './device-update-download.mjs'
export { verifyInstaller } from './device-update-io.mjs'

export const DEFAULT_UPDATE_URL = 'https://download.aibanlv.ai/desktop-updates/windows/x64/latest.json'
export const MAX_INSTALLER_BYTES = 8 * 1024 ** 3
const validVersion = value => typeof value === 'string' && /^\d+\.\d+\.\d+$/.test(value)
  && value.split('.').every(part => Number.isSafeInteger(Number(part)))

export async function desktopVersion({ isPackaged, version, file = new URL('../package.json', import.meta.url) }) {
  const value = isPackaged ? version : JSON.parse(await readFile(file, 'utf8')).version
  if (!validVersion(value)) throw new Error('应用版本无效')
  return value
}

export function updateSource(value) {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error('更新源必须使用 HTTPS，且不能包含凭据或片段')
  return url
}

export function updateManifest(data, source) {
  if (!data || !validVersion(data.version) || data.platform !== 'win32' || data.arch !== 'x64'
    || !Number.isSafeInteger(data.bytes) || data.bytes <= 0 || data.bytes > MAX_INSTALLER_BYTES
    || typeof data.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(data.sha256)
    || typeof data.url !== 'string' || data.notes !== undefined && (typeof data.notes !== 'string' || data.notes.length > 8000)) {
    throw new Error('更新清单格式无效或平台不匹配')
  }
  const url = updateSource(data.url)
  if (url.origin !== updateSource(source).origin || !url.pathname.toLowerCase().endsWith('.exe')) throw new Error('安装包必须使用更新源同源的 HTTPS EXE 地址')
  let blockmap
  if (data.blockmap !== undefined) {
    const descriptor = data.blockmap
    if (!descriptor || !Number.isSafeInteger(descriptor.bytes) || descriptor.bytes <= 0 || descriptor.bytes > MAX_BLOCKMAP_BYTES
      || !validDigest(descriptor.sha256) || typeof descriptor.url !== 'string') throw new Error('块图描述无效')
    const mapUrl = updateSource(descriptor.url)
    if (mapUrl.origin !== url.origin || !mapUrl.pathname.endsWith('.blockmap')) throw new Error('块图地址必须同源')
    blockmap = { url: mapUrl.href, bytes: descriptor.bytes, sha256: descriptor.sha256.toLowerCase() }
  }
  return { version: data.version, platform: data.platform, arch: data.arch, url: url.href,
    bytes: data.bytes, sha256: data.sha256.toLowerCase(), notes: data.notes || '', ...(blockmap ? { blockmap } : {}) }
}

export async function checkDesktopUpdate({ version, url = DEFAULT_UPDATE_URL, platform = 'win32', arch = 'x64', fetchImpl = globalThis.fetch, signal }) {
  if (platform !== 'win32' || arch !== 'x64') return { ok: false, version, message: '在线更新目前仅支持 Windows x64 安装版' }
  try {
    if (!validVersion(version)) throw new Error('应用版本无效')
    const source = updateSource(url)
    const response = await fetchImpl(source.href, { redirect: 'error', credentials: 'omit', cache: 'no-store',
      signal: AbortSignal.any([AbortSignal.timeout(10000), ...(signal ? [signal] : [])]), headers: { Accept: 'application/json' } })
    if (!response.ok) {
      await response.body?.cancel().catch(() => {})
      return { ok: false, version, message: response.status === 404 ? '更新清单尚未发布（404），请联系管理员' : `更新服务返回 HTTP ${response.status}，请稍后重试` }
    }
    const reader = response.body.getReader(), chunks = []; let size = 0
    try {
      for (;;) {
        const { done, value } = await reader.read(); if (done) break
        size += value.length; if (size > 65536) throw new Error('更新清单过大')
        chunks.push(value)
      }
    } finally { await reader.cancel().catch(() => {}) }
    const manifest = updateManifest(JSON.parse(Buffer.concat(chunks).toString('utf8')), source.href)
    const current = version.split('.').map(Number), latest = manifest.version.split('.').map(Number)
    const difference = latest.findIndex((part, index) => part !== current[index])
    const available = difference >= 0 && latest[difference] > current[difference]
    return { ok: true, version, latestVersion: manifest.version, available, manifest,
      message: available ? `发现新版本 ${manifest.version}` : `当前版本 ${version}，没有可用更新。` }
  } catch { return { ok: false, version, message: '检查更新失败，请检查网络或 Windows 更新源配置与清单格式' } }
}

// Only the main process owns the manifest and cached executable. Public state
// contains display fields, never a launchable path or renderer-supplied command.
export class DeviceUpdate {
  constructor({ directory, version, platform, arch, installed = false, url = DEFAULT_UPDATE_URL,
    fetchImpl = (...args) => globalThis.fetch(...args), onState = () => {}, handoff,
    idleMs = 30000, totalMs = 60 * 60 * 1000 }) {
    Object.assign(this, { directory, version, platform, arch, installed, url, fetchImpl, onState, handoff, idleMs, totalMs })
    this.state = { status: 'idle', version, message: `当前版本 ${version}` }
  }
  snapshot() { return { ...this.state, runMode: 'installed', canCheck: !this.disposed } }
  publish(status, message, extra = {}) {
    this.state = { status, version: this.version, latestVersion: this.manifest?.version, notes: this.manifest?.notes || '',
      bytes: this.manifest?.bytes || 0, canDownload: Boolean(this.manifest) && !this.disposed && !this.busy && status !== 'installing',
      canInstall: status === 'ready' && this.installed, message, ...extra }
    this.onState(this.snapshot())
    return this.snapshot()
  }
  denied() { return { ...this.snapshot(), ok: false, message: '更新操作暂不可用，请等待当前操作完成' } }
  async clean() {
    for (const name of ['setup.exe.part', 'setup.exe']) await unlink(path.join(this.directory, name)).catch(error => { if (error.code !== 'ENOENT') throw error })
  }
  async check() {
    if (this.busy || this.disposed || this.state.status === 'installing') return this.denied()
    this.busy = true; this.manifest = null; this.controller = new AbortController()
    this.publish('checking', '正在检查更新…')
    try {
      await this.clean()
      const result = await checkDesktopUpdate({ version: this.version, platform: this.platform, arch: this.arch,
        url: this.url, fetchImpl: this.fetchImpl, signal: this.controller.signal })
      this.busy = false
      if (result.ok && result.available) this.manifest = result.manifest
      return { ...this.publish(result.ok ? result.available ? 'available' : 'current' : 'error', result.message), ok: result.ok }
    } catch {
      this.busy = false
      return { ...this.publish('error', '无法清理更新缓存，请稍后重试'), ok: false }
    } finally { this.busy = false; this.controller = null }
  }
  async download() {
    if (this.busy || this.disposed || !this.manifest || ['ready', 'installing'].includes(this.state.status)) return this.denied()
    this.busy = true; this.controller = new AbortController()
    const controller = this.controller, partial = path.join(this.directory, 'setup.exe.part')
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(this.totalMs)])
    let lastProgress = 0
    this.publish('downloading', '正在下载安装包…', { received: 0 })
    try {
      await mkdir(this.directory, { recursive: true }); await this.clean()
      const result = await downloadInstaller({ directory: this.directory, manifest: this.manifest, fetchImpl: this.fetchImpl,
        signal, idleMs: this.idleMs, onProgress: progress => {
        if (Date.now() - lastProgress >= 150) {
          lastProgress = Date.now(); this.publish('downloading', progress.mode === 'differential' ? '正在增量下载并重建安装包…'
            : progress.fallback ? '增量不可用，正在下载完整安装包…' : '正在下载完整安装包…', progress)
        }
      } })
      signal.throwIfAborted()
      await rename(partial, path.join(this.directory, 'setup.exe'))
      const cacheStored = await saveBaseline({ directory: this.directory, manifest: this.manifest, blockmap: result.blockmap })
      signal.throwIfAborted()
      this.busy = false
      const { mode, received, networkBytes, reusedBytes, fallback } = result
      return { ...this.publish('ready', this.installed ? '安装包已校验，可退出并安装' : '安装包已校验；开发模式不能覆盖安装，请使用 Windows 安装版',
        { mode, received, networkBytes, reusedBytes, fallback, cacheStored }), ok: true }
    } catch (error) {
      await this.clean().catch(() => {})
      this.busy = false
      return { ...this.publish('error', controller.signal.reason === 'cancel' ? '下载已取消，可重新下载'
        : signal.aborted || error?.name === 'TimeoutError' ? '下载超时，请检查网络后重试' : '下载失败或安装包校验不通过，请重试'), ok: false }
    } finally { this.controller = null; this.busy = false }
  }
  cancel() { this.controller?.abort('cancel'); return this.snapshot() }
  async install() {
    if (this.busy || this.disposed || this.state.status !== 'ready' || !this.installed || !this.handoff) return this.denied()
    this.busy = true
    this.publish('preparing', '正在校验安装包并准备升级…')
    try {
      const file = path.join(this.directory, 'setup.exe')
      await verifyInstaller(file, this.manifest)
      await this.handoff(file, { ...this.manifest })
      return { ...this.publish('installing', '正在退出，随后打开安装向导…'), ok: true }
    } catch {
      this.busy = false
      return { ...this.publish('error', '无法启动升级：安装包被更改或安装交接失败，请重新下载后重试'), ok: false }
    } finally { this.busy = false }
  }
  dispose() { this.disposed = true; this.cancel() }
}
