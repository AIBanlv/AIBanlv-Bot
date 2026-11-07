import { createHmac } from 'node:crypto'
import { hardwareFingerprint } from './device-hardware-id.mjs'

export const guestIdentityMessages = Object.freeze({
  HARDWARE_ID_UNAVAILABLE: '无法读取硬件身份，请扫码使用账号积分',
  GUEST_HARDWARE_REQUIRED: '请更新桌面客户端以启用硬件游客试用，或扫码使用账号积分',
  GUEST_HARDWARE_CONFLICT: '本机试用身份与登记记录不一致，请扫码使用账号积分',
  GUEST_HARDWARE_PROOF_REQUIRED: '设备试用登记未通过，请刷新设备连接后重试',
})
const failure = (code = 'GUEST_HARDWARE_REQUIRED') => Object.assign(new Error(guestIdentityMessages[code]), { code })
export class GuestIdentity {
  constructor({ channel, origin, fetchImpl, hardware = hardwareFingerprint }) { Object.assign(this, { channel, origin, fetchImpl, hardware }) }
  scope() { const offer = this.channel.bindingOffer?.(); return offer?.bindToken ? `${this.channel.state.deviceId}\n${offer.bindToken}` : '' }
  async ensure(signal) {
    signal?.throwIfAborted()
    const scope = this.scope()
    if (!scope) throw failure('GUEST_HARDWARE_PROOF_REQUIRED')
    if (this.ready === scope) return
    if (this.job?.scope === scope) return this.job.promise
    const job = { scope }; this.job = job
    job.promise = (async () => {
      const hardwareId = this.fingerprint || await this.hardware()
      if (!/^[a-f0-9]{64}$/.test(hardwareId || '')) throw failure('HARDWARE_ID_UNAVAILABLE')
      this.fingerprint = hardwareId
      if (scope !== this.scope()) throw failure('GUEST_HARDWARE_PROOF_REQUIRED')
      const deviceId = this.channel.state.deviceId, token = this.channel.bindingOffer().bindToken
      const deviceProof = createHmac('sha256', token).update(`desktop-guest-hardware-v1\n${deviceId}\n${hardwareId}`).digest('hex')
      const abort = AbortSignal.any([AbortSignal.timeout(10000), ...(signal ? [signal] : [])])
      const prefix = this.origin === 'https://scrm.ieasysell.com' ? '/jwt' : ''
      const response = await this.fetchImpl(`${this.origin}${prefix}/client/desktop-public/guest/identity`, {
        method: 'POST', credentials: 'omit', redirect: 'error', signal: abort,
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ deviceId, hardwareId, deviceProof }),
      })
      const chunks = []; let bytes = 0
      if (!response.body) throw failure()
      for await (const chunk of response.body) { bytes += chunk.length; if (bytes > 16384) throw failure(); chunks.push(Buffer.from(chunk)) }
      const result = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      if (Object.hasOwn(guestIdentityMessages, result.msg)) throw failure(result.msg)
      if (!response.ok || ![0, 200].includes(result.code) || result.data?.registered !== true) throw failure()
      if (scope !== this.scope()) throw failure('GUEST_HARDWARE_PROOF_REQUIRED')
      this.ready = scope
    })()
    try { return await job.promise } finally { if (this.job === job) this.job = null }
  }
}
