import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import { writeFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { downloadAvatar } from './device-assets.mjs'
import { loadDefaultProfile } from './device-default-profile.mjs'

export class DeviceRuntime extends EventEmitter {
  constructor({ channel, files, directory, download = downloadAvatar, save = writeFile,
    remove = file => rm(file, { force: true }), defaultProfile = loadDefaultProfile, renderMs = 45000, assetCache }) {
    super()
    Object.assign(this, { channel, files, directory, download, save, remove, defaultProfile, renderMs, assetCache })
    this.cache = new Map()
    this.state = { current: null, desired: null, roles: [], renderId: '', renderAsset: '',
      phase: 'idle', progress: null, error: '' }
    this.version = 0
    this.sequence = 0
    this.preferDefault = true
    this.owned = new Set()
    this.jobs = new Set()
    channel.on('profile', (profile, _requestId, type) => {
      if ((this.state.desired || this.state.current)?.source === 'local') return
      // Replayed desired state must not replace the startup choice.
      if (type === 'agent_state_desired' && this.preferDefault) return
      this.track(this.apply({ ...profile, source: 'online' }))
    })
    channel.on('revoked', () => {
      if (this.retainLocalRole()) return
      this.clear(); void this.ensureInitialProfile()
    })
    channel.on('state', state => {
      const active = this.state.desired || this.state.current
      // A local conversation does not acquire ownership of an inherited online
      // private image. Identity loss removes that visual, not the local bot.
      if (active?.source === 'local' && this.visual?.private && !this.visualAllowed()) this.publish(this.clearVisual())
      if (active?.source === 'local' || active?.publicAvatar || this.initialAbort || !active && this.state.phase === 'error') return
      if (state.binding === 'bound' && state.connection === 'connected') { this.ensureInitialProfile(); return }
      this.cancelInitialProfile()
      this.sequence++
      this.abort?.abort()
      this.dropPending()
      this.emit('stop-speech')
      this.publish({ desired: null, phase: this.state.current ? 'ready' : 'idle', progress: null,
        renderAsset: this.currentAsset || '', renderId: this.currentRenderId || '' })
    })
  }

  cancelInitialProfile() {
    this.initialAbort?.abort()
    this.initialAbort = null
  }

  retainLocalRole() {
    const { desired, current } = this.state
    if (desired?.source !== 'local' && current?.source !== 'local') return false
    this.cache.clear(); this.version = 0
    const patch = { roles: this.state.roles.filter(profile => profile.source === 'local') }
    if (this.visual?.private) Object.assign(patch, this.clearVisual())
    if (desired?.source !== 'local') {
      this.sequence++; this.abort?.abort(); this.dropPending(); this.emit('stop-speech')
      Object.assign(patch, { desired: current, phase: 'ready', progress: null, error: '',
        renderAsset: this.currentAsset || '', renderId: this.currentRenderId || '' })
    } else if (current?.source !== 'local') {
      if (this.currentAsset) this.dropAsset(this.currentAsset)
      this.currentAsset = null; this.currentRenderId = ''
      patch.current = null
      if (!this.pending) Object.assign(patch, { renderAsset: '', renderId: '' })
    }
    this.publish(patch)
    return true
  }

  visualIdentity() { return JSON.stringify([this.channel.state.deviceId || '', this.channel.tenantId || '', this.channel.state.owner || '']) }
  visualAllowed() {
    return !this.visual?.private || this.channel.state.binding === 'bound' && this.channel.state.connection === 'connected' && this.visual.identity === this.visualIdentity()
  }
  clearVisual() {
    if (this.currentAsset) this.dropAsset(this.currentAsset)
    if (this.visual?.private) this.cache.clear()
    this.currentAsset = null; this.currentRenderId = ''; this.visual = null
    return { renderAsset: '', renderId: '' }
  }

  ensureInitialProfile() {
    if (this.disposed || this.initialAbort || this.state.current || this.state.desired) return
    const abort = this.initialAbort = new AbortController()
    this.publish({ phase: 'syncing', error: '' })
    return this.track((async () => {
      try {
        const profile = await this.defaultProfile(abort.signal)
        if (!abort.signal.aborted) await this.apply(profile, { initial: true })
      } catch {
        if (!abort.signal.aborted) {
          this.cancelInitialProfile()
          this.publish({ phase: 'error', error: '上官婉儿加载失败，请检查网络后重试，或选择其他公共角色' })
        }
      }
    })())
  }

  publish(patch) {
    Object.assign(this.state, patch)
    this.emit('state', { ...this.state })
  }

  accessible() {
    const state = this.channel.state
    const profile = this.pending?.profile || this.state.desired || this.state.current
    return profile?.source === 'local' || profile?.publicAvatar === true || state.binding === 'bound' && state.connection === 'connected'
  }

  report(profile, status, message) {
    if (profile.source !== 'local' && this.channel.state.binding === 'bound') this.channel.report(profile, status, message)
  }

  track(job) {
    this.jobs.add(job)
    job.finally(() => this.jobs.delete(job)).catch(() => {})
    return job
  }

  async apply(profile, { initial = false } = {}) {
    if (profile.source !== 'local' && !profile.publicAvatar && !(this.channel.state.binding === 'bound' && this.channel.state.connection === 'connected')) return
    if (profile.profileVersion > 0 && profile.profileVersion < this.version) return
    if (JSON.stringify(profile) === JSON.stringify(this.state.desired) && this.state.phase !== 'error') return
    this.cancelInitialProfile()
    if (!initial) this.preferDefault = false
    this.version = Math.max(this.version, profile.profileVersion || 0)
    const prior = this.state.roles.find(item => item.agentId === profile.agentId)
    if (!profile.zipUrl && prior && profile.source !== 'local') profile = { ...profile, zipUrl: prior.zipUrl, zipName: prior.zipName }
    this.abort?.abort()
    this.abort = new AbortController()
    const signal = this.abort.signal
    const sequence = ++this.sequence
    this.dropPending()
    this.emit('stop-speech')
    if (profile.source === 'local' && !profile.zipUrl) {
      // No asset import means "keep the current picture", not "download a
      // missing local ZIP". Persona, voice, history and funding still switch.
      if (!this.visualAllowed()) this.clearVisual()
      this.version = 0
      const roles = [...this.state.roles.filter(item => item.agentId !== profile.agentId), profile].slice(-12)
      this.publish({ current: profile, desired: profile, roles, phase: 'ready', progress: null, error: '',
        renderAsset: this.currentAsset || '', renderId: this.currentRenderId || '' })
      return
    }
    this.publish({ desired: profile, phase: 'downloading', progress: 0, error: '',
      renderAsset: this.currentAsset || '', renderId: this.currentRenderId || '' })
    // The control protocol has no loading status; application is not confirmed yet.
    this.report(profile, 'unknown')
    let asset, file, stage = 'download'
    try {
      if (!profile.zipUrl) throw new Error('missing asset')
      const local = profile.source === 'local'
      const scope = profile.publicAvatar ? 'public-avatars' : JSON.stringify([this.channel.tenantId || '', this.channel.state.owner || '', this.channel.state.guest === true])
      // Local imports live in LocalWorkspace. The online cache deliberately rejects
      // local: URLs, so do not pass them through its HTTPS allowlist or disk index.
      let data = this.cache.get(profile.zipUrl)
      if (!data && !local && this.assetCache) data = await this.assetCache.get(profile.zipUrl, scope, signal)
      const cached = Boolean(data)
      data ||= await this.download(profile.zipUrl, { signal, progress: progress => {
        if (sequence === this.sequence) this.publish({ progress })
      }, onRetry: ({ attempt }) => {
        if (sequence === this.sequence) this.publish({ error: `形象资源连接不稳定，正在重试（${attempt}/3）…` })
      } })
      if (sequence !== this.sequence || signal.aborted || !this.accessible()) return
      if (!cached && !local && this.assetCache) await this.assetCache.put(profile.zipUrl, scope, data, signal).catch(error => {
        signal.throwIfAborted()
        this.emit('diagnostic', { agentId: profile.agentId, stage: 'cache', code: error.code || 'CACHE_WRITE' })
      })
      if (sequence !== this.sequence || signal.aborted || !this.accessible()) return
      this.cache.delete(profile.zipUrl)
      this.cache.set(profile.zipUrl, data)
      while (this.cache.size > 2 || [...this.cache.values()].reduce((sum, value) => sum + value.length, 0) > 64 * 1024 * 1024) {
        this.cache.delete(this.cache.keys().next().value)
      }
      const id = randomUUID()
      file = path.join(this.directory, `${id}.zip`)
      asset = `/assets/device-${id}.zip`
      this.owned.add(file)
      stage = 'write'
      await this.save(file, data)
      if (sequence !== this.sequence || signal.aborted || !this.accessible()) {
        await this.remove(file); this.owned.delete(file); return
      }
      this.files.set(asset, file)
      this.pending = { profile, asset }
      stage = 'render'
      this.renderTimer = setTimeout(() => {
        if (this.pending?.asset !== asset) return
        this.dropPending()
        this.fail(profile, '形象画面加载超时，请重试形象；无需刷新绑定连接')
      }, this.renderMs)
      this.publish({ phase: 'rendering', progress: 100, renderId: id, renderAsset: asset, error: '' })
    } catch (error) {
      if (file) {
        await this.remove(file).then(() => this.owned.delete(file)).catch(() => {})
        if (asset) this.files.delete(asset)
      }
      if (sequence !== this.sequence || signal.aborted) return
      this.emit('diagnostic', { agentId: profile.agentId, stage, code: error.code || error.name || 'UNKNOWN' })
      this.fail(profile, profile.source === 'local'
        ? error.code === 'ENOENT' ? '本地形象文件不存在，请在编辑角色中重新导入 LAM 资产包'
          : stage === 'write' ? '本地形象暂存失败，请检查磁盘空间和目录权限后重试'
            : '本地形象读取失败，请检查资产包或重新导入；无需刷新绑定'
        : error.code === 'AVATAR_NETWORK' || error.name === 'TimeoutError'
        ? '形象资源连接超时，已重试；请重试形象，无需重新绑定'
        : error.code === 'AVATAR_ARCHIVE' ? '形象资源格式校验失败，请重新分发有效的形象包'
          : ['EACCES', 'ENOSPC', 'ENOENT'].includes(error.code) ? '形象缓存写入失败，请检查本机存储后重试'
            : '形象加载失败，请检查网络或在 Control App 重新分发')
    }
  }

  rendered(id, status) {
    if (id !== this.state.renderId || !this.accessible()) return
    if (status === 'ready' && this.pending) {
      clearTimeout(this.renderTimer)
      const { profile, asset } = this.pending
      this.pending = null
      if (this.currentAsset && this.currentAsset !== asset) this.dropAsset(this.currentAsset)
      this.currentAsset = asset
      this.currentRenderId = id
      this.visual = { private: profile.source !== 'local' && profile.publicAvatar !== true, identity: this.visualIdentity() }
      this.version = Math.max(this.version, profile.profileVersion || 0)
      const roles = [...this.state.roles.filter(item => item.agentId !== profile.agentId), profile].slice(-12)
      this.publish({ current: profile, roles, phase: 'ready', error: '' })
      this.report(profile, 'applied')
    } else if (status === 'error' && this.pending) {
      const { profile } = this.pending
      this.dropPending()
      this.fail(profile, '新形象无法显示，已保留原角色')
    } else if (status === 'error') {
      if (this.state.current?.source === 'local' && !this.state.current.zipUrl) this.publish({ ...this.clearVisual(), phase: 'ready', error: '' })
      else this.publish({ phase: 'error', error: '形象渲染失败，请重试' })
    }
  }

  fail(profile, message) {
    this.publish({ phase: 'error', error: message, progress: null,
      renderAsset: this.currentAsset || '', renderId: this.currentRenderId || '' })
    this.report(profile, 'failed', message)
  }

  dropAsset(asset) {
    const file = this.files.get(asset)
    this.files.delete(asset)
    if (file) this.track(this.remove(file).then(() => this.owned.delete(file)).catch(() => {}))
  }

  dropPending() {
    clearTimeout(this.renderTimer)
    if (this.pending) this.dropAsset(this.pending.asset)
    this.pending = null
  }

  retry() {
    const profile = this.state.desired || this.state.current
    if (profile) {
      this.state.desired = null
      return this.track(this.apply(profile, { initial: this.preferDefault }))
    }
    this.ensureInitialProfile()
  }

  select(agentId) {
    const profile = this.state.roles.find(item => item.agentId === agentId)
    if (profile) return this.track(this.apply({ ...profile, profileVersion: 0 }))
  }

  clear() {
    this.cancelInitialProfile()
    this.sequence++
    this.abort?.abort()
    this.emit('stop-speech')
    this.dropPending()
    if (this.currentAsset) this.dropAsset(this.currentAsset)
    this.currentAsset = null
    this.currentRenderId = ''
    this.visual = null
    this.cache.clear()
    this.version = 0
    this.preferDefault = true
    this.publish({ current: null, desired: null, roles: [], renderId: '', renderAsset: '',
      phase: 'idle', progress: null, error: '' })
  }

  async dispose() {
    this.disposed = true
    this.clear()
    await Promise.allSettled([...this.jobs])
    await Promise.allSettled([...this.owned].map(file => this.remove(file)))
  }
}
