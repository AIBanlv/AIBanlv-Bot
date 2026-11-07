import { createHash } from 'node:crypto'
import { guestLoginMessage } from './device-pet-policy.mjs'
import { guestIdentityMessages } from './device-guest-identity.mjs'

const base = 'https://scrm.ieasysell.com/jwt/client'
const failure = () => Object.assign(new Error('无法核实积分，请检查网络后重试'), { code: 'SCORE_UNAVAILABLE' })
export function billingDeviceId(deviceId) {
  if (typeof deviceId !== 'string' || !/^zhanlv:desktop-[a-f0-9-]{36}$/.test(deviceId)) throw failure()
  return createHash('sha256').update(deviceId.trim()).digest('hex')
}
async function request(url, { signal, fetchImpl = globalThis.fetch, guest = false, body }) {
  const abort = AbortSignal.any([AbortSignal.timeout(15000), ...(signal ? [signal] : [])])
  try {
    abort.throwIfAborted()
    const response = await fetchImpl(url, { method: body ? 'POST' : 'GET', redirect: 'error', credentials: 'omit', signal: abort,
      headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) })
    if (guest && response.status === 403) throw Object.assign(new Error(guestLoginMessage), { code: 'GUEST_LOGIN_REQUIRED' })
    if (!response.ok || !response.body) throw failure()
    const chunks = []; let bytes = 0
    for await (const chunk of response.body) {
      abort.throwIfAborted()
      bytes += chunk.byteLength
      if (bytes > 65536) throw failure()
      chunks.push(Buffer.from(chunk))
    }
    abort.throwIfAborted()
    const result = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (![0, 200].includes(result?.code) || !result.data || typeof result.data !== 'object') throw failure()
    return result.data
  } catch (error) { if (guest && (error.code === 'GUEST_LOGIN_REQUIRED' || Object.hasOwn(guestIdentityMessages, error.code))) throw error; throw failure() }
}
export async function getGuestScore({ deviceId, signal, fetchImpl }) {
  const data = await request(`${base}/desktop-public/guest/status`, { signal, fetchImpl, guest: true, body: { deviceId: billingDeviceId(deviceId) } })
  if (data.anonymous !== true || !Number.isSafeInteger(data.score) || data.score < 0) throw failure()
  return { score: data.score, anonymous: true }
}
export async function getDeviceScore({ tenantId = '', signal, fetchImpl, readAccount }) {
  if (typeof tenantId !== 'string' || !tenantId.trim() || tenantId.length > 256 || /[\u0000-\u001f]/.test(tenantId)) throw failure()
  // Bound desktops have no mobile JWT. Prefer the proven device channel over
  // repeatedly hitting a protected tenant HTTP endpoint without credentials.
  if (tenantId && readAccount) {
    const result = await readAccount()
    if (!result?.ok || !Number.isFinite(result.points)) throw failure()
    return { score: result.points, anonymous: false }
  }
  const data = await request(`${base}/reception/getReception?tenantId=${encodeURIComponent(tenantId)}`, { signal, fetchImpl })
  const keys = ['score', 'remainingScore', 'remaining_score', 'accountScore', 'account_score', 'balance']
  for (const key of keys) {
    if (!['string', 'number'].includes(typeof data[key]) || String(data[key]).trim() === '') continue
    const score = Number(data[key])
    if (Number.isFinite(score)) return { score, anonymous: false }
  }
  throw failure()
}
