import { GuestIdentity } from './device-guest-identity.mjs'

const origin = 'https://scrm.ieasysell.com'
const routes = new Map([
  ['/jwt/client/desktop-public/roles', ['GET', 'public-roles']],
  ['/jwt/client/desktop-public/guest/status', ['POST', 'guest/status']],
  ['/jwt/client/desktop-public/guest/sessions', ['POST', 'guest/sessions']],
  ['/jwt/client/aliBot/getBotListTWithPublic', ['GET', 'roles']],
  ['/jwt/client/Voice/aliyun/listClientVoices', ['POST', 'voices']],
  ['/jwt/client/desktop/metered-realtime/sessions', ['POST', 'metered-realtime/sessions']],
  ['/jwt/client/desktop/role-creation', ['POST', 'role-creation']],
  ['/jwt/client/reception/getReception', ['GET', 'account']],
])
const failure = () => Object.assign(new Error('设备接口认证失败，请检查连接或重新扫码绑定'), { code: 'DEVICE_AUTH_REQUIRED' })

export const isGuestDevice = channel => channel?.state.connection === 'connected' && channel.state.binding === 'unbound' &&
  !channel.tenantId && !channel.controllerUserId

export function deviceHttpOrigin(value = origin) {
  let url
  try { url = new URL(value) } catch { throw failure() }
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash ||
      (url.origin !== origin && (!['http:', 'https:'].includes(url.protocol) ||
        !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) throw failure()
  return url.origin
}

/** Main-process-only pairing exchange and narrowly scoped HTTP transport. */
export class DeviceHttpAuth {
  #token
  #job
  #scope = ''
  constructor({ channel, proof, fetchImpl = (...args) => globalThis.fetch(...args), now = Date.now, origin: baseOrigin, hardware }) {
    this.origin = deviceHttpOrigin(baseOrigin)
    Object.assign(this, { channel, proof, fetchImpl, now })
    this.guestIdentity = new GuestIdentity({ channel, origin: this.origin, fetchImpl, hardware })
    this.onState = () => {
      const scope = this.identity()
      if (scope !== this.#scope) { this.clear(); this.#scope = scope }
    }
    this.onRevoked = () => this.clear()
    channel.on('state', this.onState)
    channel.on('revoked', this.onRevoked)
    this.onState()
    this.fetch = this.fetch.bind(this)
  }
  identity() {
    const { state, tenantId, controllerUserId } = this.channel
    return state.connection === 'connected' && state.binding === 'bound' && tenantId && controllerUserId
      ? JSON.stringify([state.deviceId, tenantId, controllerUserId]) : ''
  }
  clear() {
    this.#token = null
    this.#job?.abort.abort()
    this.#job = null
  }
  async ready(signal, scope) {
    if (this.channel.state.accountAuthReady) return
    await new Promise((resolve, reject) => {
      const finish = error => {
        signal.removeEventListener('abort', cancel); this.channel.off('state', changed)
        error ? reject(error) : resolve()
      }
      const cancel = () => finish(failure())
      const changed = () => {
        if (scope !== this.identity() || this.disposed) finish(failure())
        else if (this.channel.state.accountAuthReady) finish()
      }
      signal.addEventListener('abort', cancel, { once: true })
      this.channel.on('state', changed)
      if (signal.aborted) cancel(); else changed()
    })
  }
  async credentials() {
    const scope = this.identity()
    if (!scope || this.disposed) throw failure()
    if (this.#token?.scope === scope && this.#token.expiresAt > this.now() + 30000) return this.#token.value
    if (this.#job?.scope === scope) return this.#job.promise
    const abort = new AbortController()
    const job = this.#job = { scope, abort }
    job.promise = (async () => {
      const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(10000)])
      try {
        await this.ready(signal, scope)
        const deviceProof = this.proof()
        if (!/^[a-f0-9]{64}$/.test(deviceProof || '')) throw failure()
        const { state, tenantId, controllerUserId } = this.channel
        const deviceId = state.deviceId
        const response = await this.fetchImpl(`${this.origin}${this.origin === origin ? '/jwt' : ''}/client/desktop-auth/token`, {
          method: 'POST', redirect: 'error', credentials: 'omit', signal,
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ deviceId, deviceProof }),
        })
        if (!response.ok || !response.body) throw failure()
        let bytes = 0; const chunks = []
        for await (const chunk of response.body) {
          signal.throwIfAborted(); bytes += chunk.byteLength
          if (bytes > 16384) throw failure()
          chunks.push(Buffer.from(chunk))
        }
        const result = JSON.parse(Buffer.concat(chunks).toString('utf8')), data = result?.data
        signal.throwIfAborted()
        if (scope !== this.identity() || this.#job !== job || ![0, 200].includes(result.code) ||
            !data || data.deviceId !== deviceId || data.tenantId !== tenantId || data.controllerUserId !== controllerUserId ||
            typeof data.accessToken !== 'string' || !/^[A-Za-z0-9._~-]{1,8192}$/.test(data.accessToken) ||
            !Number.isFinite(data.expiresAt) || data.expiresAt <= this.now() + 30000 || data.expiresAt > this.now() + 600000) throw failure()
        this.#token = { scope, value: data.accessToken, expiresAt: data.expiresAt }
        return data.accessToken
      } catch { throw failure() }
      finally { if (this.#job === job) this.#job = null }
    })()
    return job.promise
  }
  async fetch(target, options = {}) {
    // Earlier binding listeners may start a request before our state callback.
    this.onState()
    let url
    try { url = new URL(target) } catch { throw failure() }
    const headers = new Headers(options.headers)
    const route = routes.get(url.pathname)
    if (this.disposed || url.origin !== origin || url.username || url.password || url.hash ||
        !route || (options.method || 'GET') !== route[0] || headers.has('Authorization') || headers.has('Cookie')) throw failure()
    options.signal?.throwIfAborted()
    const scope = this.identity()
    const guest = route[1].startsWith('guest/')
    const guestDevice = this.channel.state.deviceId
    if (route[1] === 'public-roles') {
      url.search = ''
    } else if (guest) {
      if (!isGuestDevice(this.channel)) throw failure()
      await this.guestIdentity.ensure(options.signal)
      options.signal?.throwIfAborted()
      if (!isGuestDevice(this.channel) || guestDevice !== this.channel.state.deviceId) throw failure()
      url.search = ''
    } else if (this.channel.state.binding === 'bound') {
      const pending = this.credentials()
      const token = options.signal ? await new Promise((resolve, reject) => {
        const cancelled = () => reject(failure())
        options.signal.addEventListener('abort', cancelled, { once: true })
        const finish = (settle, value) => { options.signal.removeEventListener('abort', cancelled); settle(value) }
        pending.then(value => finish(resolve, value), error => finish(reject, error))
        if (options.signal.aborted) cancelled()
      }) : await pending
      options.signal?.throwIfAborted()
      if (!scope || scope !== this.identity()) throw failure()
      url.pathname = `/jwt/client/desktop/${route[1]}`
      headers.set('Authorization', `Bearer ${token}`)
    } else throw failure()
    // The production gateway strips /jwt before forwarding to the Java app.
    const pathname = this.origin === origin ? url.pathname : url.pathname.slice('/jwt'.length)
    const targetUrl = new URL(pathname + url.search, this.origin)
    const response = await this.fetchImpl(targetUrl.href, { ...options, headers: Object.fromEntries(headers), redirect: 'error', credentials: 'omit' })
    if (guest && (!isGuestDevice(this.channel) || guestDevice !== this.channel.state.deviceId)) throw failure()
    if (response.status === 401) this.#token = null
    return response
  }
  dispose() {
    this.disposed = true; this.clear()
    this.channel.off('state', this.onState); this.channel.off('revoked', this.onRevoked)
  }
}
