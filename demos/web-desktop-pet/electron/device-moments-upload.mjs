import { momentMediaUrl } from './device-moments.mjs'

const failure = code => Object.assign(new Error('Moments upload unavailable'), { code })
export class MomentsUpload {
  constructor({ channel, services, fetchImpl = globalThis.fetch }) {
    Object.assign(this, { channel, services, fetchImpl })
    channel.on('revoked', () => this.cancel())
    channel.on('state', () => { if (this.job && this.scope() !== this.job.scope) this.cancel() })
  }
  scope() { const { state } = this.channel; return state.binding === 'bound' && state.connection === 'connected' && state.accountAuthReady && state.desktopMomentsSupported
    ? JSON.stringify([state.deviceId, this.channel.tenantId, state.owner]) : '' }
  cancel() { this.job?.abort.abort() }
  async upload(value) {
    if (this.job) return { ok: false, code: 'BUSY' }
    const scope = this.scope()
    if (!scope) return { ok: false, code: 'BIND_REQUIRED' }
    const bytes = value?.bytes
    const image = value?.type === 'image', video = value?.type === 'video'
    if (!(bytes instanceof Uint8Array) || !bytes.byteLength || bytes.byteLength > (image ? 5 : video ? 30 : 0) * 1024 * 1024 ||
      !(image ? ['jpg', 'png', 'webp'] : video ? ['mp4', 'mov'] : []).includes(value.extension)) return { ok: false, code: 'MOMENTS_UPLOAD' }
    // Reject renamed executable/text payloads; the storage ticket is additionally key/size-scoped.
    const b = Buffer.from(bytes), ext = value.extension
    const valid = ext === 'jpg' ? b[0] === 255 && b[1] === 216 && b[2] === 255
      : ext === 'png' ? b.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
        : ext === 'webp' ? b.toString('ascii',0,4) === 'RIFF' && b.toString('ascii',8,12) === 'WEBP' : b.toString('ascii',4,8) === 'ftyp'
    if (!valid) return { ok: false, code: 'MOMENTS_UPLOAD' }
    const job = this.job = { scope, abort: new AbortController() }
    const signal = AbortSignal.any([job.abort.signal, AbortSignal.timeout(45000)])
    try {
      const ticket = await this.services.request('moments_upload', { type: value.type, extension: ext, size: b.length })
      if (signal.aborted || scope !== this.scope()) throw failure('BIND_REQUIRED')
      if (!ticket?.ok) throw failure(ticket?.code || 'MOMENTS_UPLOAD')
      const data = ticket.data, url = momentMediaUrl(data?.url)
      if (!url || typeof data.key !== 'string' || url !== `https://zhanlvgpt.ieasysell.com/${data.key}` ||
          typeof data.token !== 'string' || !data.token || data.token.length > 8192) throw failure('MOMENTS_UPLOAD')
      const form = new FormData()
      form.set('key', data.key); form.set('token', data.token)
      form.set('file', new Blob([b], { type: image ? `image/${ext === 'jpg' ? 'jpeg' : ext}` : ext === 'mov' ? 'video/quicktime' : 'video/mp4' }), `upload.${ext}`)
      const response = await this.fetchImpl('https://up-cn-east-2.qiniup.com', { method: 'POST', body: form, signal, redirect: 'error', credentials: 'omit' })
      if (!response.ok || !response.body) throw failure('MOMENTS_UPLOAD')
      const parts = []; let length = 0
      for await (const part of response.body) { length += part.length; if (length > 8192) throw failure('MOMENTS_UPLOAD'); parts.push(Buffer.from(part)) }
      const result = JSON.parse(Buffer.concat(parts).toString('utf8'))
      if (signal.aborted || scope !== this.scope()) throw failure('BIND_REQUIRED')
      if (result?.key !== data.key) throw failure('MOMENTS_UPLOAD')
      return { ok: true, data: { type: value.type, url } }
    } catch (error) { return { ok: false, code: error.code || 'MOMENTS_UPLOAD' } }
    finally { if (this.job === job) this.job = null }
  }
}
