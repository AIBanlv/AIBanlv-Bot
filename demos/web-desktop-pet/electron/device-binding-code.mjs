// Explicit desktop/mobile protocol snapshot. Pairing token stays in the URL
// fragment, not an HTTP query or Referer sent to the public landing page.
const deviceIdPattern = /^zhanlv:[a-zA-Z0-9_-]{1,100}$/
const params = value => Object.fromEntries((value || '').replace(/^[?#]/, '').split('&').filter(Boolean).map(part => {
  const index = part.indexOf('=')
  return [decodeURIComponent(index < 0 ? part : part.slice(0, index)), decodeURIComponent((index < 0 ? '' : part.slice(index + 1)).replace(/\+/g, ' '))]
}))
export function bindingCode({ deviceId, bindToken, expireAt }) {
  if (!deviceIdPattern.test(deviceId) || typeof bindToken !== 'string' || !bindToken || bindToken.length > 1024) throw new Error('Invalid pairing offer')
  const url = new URL('https://aibanlv.ai/')
  url.searchParams.set('deviceCode', deviceId)
  url.hash = new URLSearchParams({ bindToken, expireAt: String(expireAt) }).toString()
  return url.href
}
export function parseBindingCode(value, now = Date.now()) {
  if (typeof value !== 'string' || value.length > 4096) throw new Error('Invalid binding code')
  const raw = value.trim()
  let data
  if (raw.startsWith('https://') || raw.startsWith('http://')) {
    const match = raw.match(/^https:\/\/aibanlv\.ai\/(\?[^#]*)?(#.*)?$/)
    if (!match) throw new Error('Invalid binding link')
    const query = params(match[1]), fragment = params(match[2])
    data = { deviceId: query.deviceCode || query.deviceeCode,
      bindToken: fragment.bindToken, expireAt: fragment.expireAt }
  } else if (raw.startsWith('{')) data = JSON.parse(raw)
  else data = { deviceId: raw }
  const deviceId = data.deviceId || data.deviceid || data.id
  const bindToken = data.bindToken || data.bindtoken || data.token || ''
  if (!/^(?:zhanlv:)?[a-zA-Z0-9_-]{1,100}$/.test(deviceId) || typeof bindToken !== 'string' || bindToken.length > 1024) throw new Error('Invalid binding code')
  if (data.expireAt) {
    let expiry = Number(data.expireAt)
    if (expiry < 1e12) expiry *= 1000
    if (!Number.isSafeInteger(expiry) || expiry <= now) throw new Error('Binding code expired')
  }
  return { deviceId, bindToken }
}
