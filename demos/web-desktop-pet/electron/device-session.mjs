import { createHash } from 'node:crypto'
import { resolvePairedVoice } from '../../../utils/voicePairs.js'
import { platformCreditsMessage, guestCreditsMessage, guestLoginMessage } from './device-pet-policy.mjs'
import { deviceHttpOrigin } from './device-http-auth.mjs'

export const SESSION_URL = 'https://scrm.ieasysell.com/jwt/client/desktop/metered-realtime/sessions'
export const GUEST_SESSION_URL = 'https://scrm.ieasysell.com/jwt/client/desktop-public/guest/sessions'
export const BILLING_URL = 'wss://scrm.ieasysell.com/ws/digital-human-session/'
const model = 'qwen-audio-3.0-realtime-flash'
const voices = new Set(['longanqian', 'longanlingxin', 'longanlingxi', 'longanxiaoxin', 'longanlufeng'])
const nativeVoice = id => voices.has(id) || typeof id === 'string' && id.startsWith(`${model}-`)
const text = (value, limit = 8192) => typeof value === 'string' && value.length > 0 && value.length <= limit
export const sessionError = (code, message) => Object.assign(new Error(message), { code })
export const desktopUsageMessages = Object.freeze({
  DESKTOP_USAGE_UNRESOLVED: '服务端正在恢复对话用量，请稍后重试',
  DESKTOP_SESSION_BUSY: '此账号仍有对话等待用量返回，请稍后重试',
  DESKTOP_USAGE_UNAVAILABLE: '对话用量服务暂不可用，请稍后重试',
})
const publicTenants = ['1508290699769155584', '24', '1']
const hasAlias = (row, id) => ['id', 'voice', 'elevenId', 'voiceId'].some(key => String(row[key] || '') === id)

async function readJson(response, limit) {
  const reader = response.body.getReader()
  const chunks = []
  let bytes = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.length
      if (bytes > limit) throw sessionError('INVALID_SESSION', '服务响应过大')
      chunks.push(value)
    }
  } finally { await reader.cancel().catch(() => {}) }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

async function resolveVoice(voiceId, tenantId, signal, fetchImpl) {
  if (nativeVoice(voiceId)) return { voiceId, providerVoice: voiceId }
  if (!text(tenantId, 256)) throw sessionError('INVALID_SESSION', '设备绑定信息缺少租户，请重新连接')
  const incompatible = () => sessionError('VOICE_INCOMPATIBLE',
    '未找到该音色唯一对应的 Realtime 音色，请在 Control App 检查双模型音色配置')
  const rows = []
  // Scope comes from the binding server, never from a renderer or role payload.
  for (const owner of new Set([tenantId, ...publicTenants])) {
    signal.throwIfAborted()
    try {
      // Main routes signed-in device requests to the protected desktop list,
      // whose server allowlist also includes the three public voice tenants.
      const url = new URL('/jwt/client/Voice/aliyun/listClientVoices', SESSION_URL)
      let count = 0
      for (let pageIndex = 0; ; pageIndex++) {
        signal.throwIfAborted()
        const response = await fetchImpl(url.href, { method: 'POST', redirect: 'error', signal,
          headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify({tenantId:owner,pageIndex,pageSize:100}) })
        if (!response.ok) throw new Error('Voice metadata unavailable')
        const result = await readJson(response, 4 * 1024 * 1024)
        const page = result.data?.localVoices
        if (![0, 200].includes(result.code) || !Array.isArray(page) || page.length > 100 || count + page.length > 4096) {
          throw new Error('Invalid voice metadata')
        }
        count += page.length
        rows.push(...page.filter(row => row && typeof row === 'object' &&
          String(row.tenantId || row.tenant_id || '') === owner))
        if (page.length < 100) break
      }
    } catch {
      throw sessionError('SESSION_UNAVAILABLE', '无法查询音色配对，请检查网络或服务权限后重试')
    }
    signal.throwIfAborted()
  }
  if (rows.filter(row => hasAlias(row, voiceId)).length !== 1) throw incompatible()
  const paired = resolvePairedVoice(rows, voiceId, 'qwen-realtime')
  const variants = paired ? rows.filter(row => hasAlias(row, paired)) : []
  if (variants.length !== 1) throw incompatible()
  const row = variants[0]
  const providerVoice = String(row.voice || row.elevenId || row.voiceId || row.id || '').trim()
  const targetModel = String(row.targetModel || row.target_model || row.azureLanguage || '').trim()
  if (!text(paired, 256) || !nativeVoice(providerVoice) || targetModel && targetModel !== model) throw incompatible()
  return { voiceId: paired, providerVoice }
}

export function validateSession(data, profile, anonymous = false, baseOrigin) {
  const invalid = () => { throw sessionError('INVALID_SESSION', '会话配置无效，请重试或联系服务管理员') }
  if (!data || data.provider !== 'control-realtime' || data.modelId !== model ||
      data.speechFilterEnabled === true || data.anonymous !== anonymous ||
      'apiKey' in data || 'billingTicket' in data || !text(data.relayTicket, 64) || !/^[a-f0-9]{64}$/.test(data.relayTicket) ||
      !text(data.sessionId, 256) || !/^[\w-]+$/.test(data.sessionId) ||
      !nativeVoice(data.voiceId) || (!anonymous && nativeVoice(profile.voiceId) && data.voiceId !== profile.voiceId) ||
      !Number.isFinite(data.expiresAt) || data.expiresAt <= Date.now() + 5000 ||
      data.outputSampleRate !== 24000 || typeof data.instructions !== 'string' || data.instructions.length > 32768) invalid()
  let url
  if (data.wsUrl !== (anonymous ? '/ws/control/desktop/guest-realtime' : '/ws/desktop-metered-realtime')) invalid()
  try { url = new URL(data.wsUrl, deviceHttpOrigin(baseOrigin)) } catch { invalid() }
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return { sessionId: data.sessionId, relayTicket: data.relayTicket, authoritativeUsage: true,
    voiceId: data.voiceId, providerUrl: url.href, instructions: data.instructions,
    expiresAt: data.expiresAt, sampleRate: 24000 }
}

export async function createDeviceSession({ deviceId, profile, tenantId, anonymous = false, requestId, signal, baseOrigin, fetchImpl = globalThis.fetch }) {
  if (!anonymous && !profile?.voiceId) {
    throw sessionError('VOICE_INCOMPATIBLE', '请在 Control App 为该形象选择音色')
  }
  if (!/^zhanlv:desktop-[a-f0-9-]{36}$/.test(deviceId) || !text(profile?.agentId, 256) ||
      (anonymous ? profile.publicAvatar !== true || Boolean(tenantId) : !text(profile.voiceId, 256)) || !text(requestId, 128)) throw sessionError('INVALID_SESSION', '设备或形象配置无效')
  const subject = createHash('sha256').update(deviceId.trim()).digest('hex')
  const timeout = AbortSignal.timeout(15000)
  const abort = signal ? AbortSignal.any([signal, timeout]) : timeout
  try {
    abort.throwIfAborted()
    // Guest voices are resolved from the public role by the server; no private metadata request.
    const resolved = anonymous ? {} : await resolveVoice(profile.voiceId, tenantId, abort, fetchImpl)
    abort.throwIfAborted()
    // Memory belongs to a role inside its tenant: without the tenant the
    // server has no way to join the history this device already shares with
    // the app, and every restart would start a brand new conversation.
    const body = { agentId: profile.agentId, ...(!anonymous ? { voiceId: resolved.voiceId } : {}),
      languageCode: profile.language || 'zh', uiLocale: 'zh-CN', provider: 'qwen-realtime', outputMode: 'audio',
      speechFilterEnabled: false, clientRequestId: requestId, deviceId: subject }
    if (!anonymous && text(tenantId, 256)) body.tenantId = tenantId
    const response = await fetchImpl(anonymous ? GUEST_SESSION_URL : SESSION_URL, { method: 'POST', redirect: 'error', credentials: 'omit', signal: abort,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body) })
    if (!response.ok && ![402, 403, 409, 429, 503].includes(response.status)) throw sessionError('SESSION_UNAVAILABLE', '无法创建会话，请检查绑定、音色和账号额度')
    const result = await readJson(response, 65536)
    abort.throwIfAborted()
    const usageCode = String(result.message || result.msg || '')
    if (anonymous && result.code === 403 && usageCode === 'GUEST_LOGIN_REQUIRED') throw sessionError('GUEST_LOGIN_REQUIRED', guestLoginMessage)
    if ([409, 503].includes(result.code) && Object.hasOwn(desktopUsageMessages, usageCode)) {
      throw sessionError(usageCode, desktopUsageMessages[usageCode])
    }
    if ([402, 429].includes(result.code) && /SCORE_DEPLETED|ANONYMOUS_SCORE_LIMIT_REACHED/.test(String(result.message || result.msg || ''))) {
      throw sessionError('SCORE_DEPLETED', anonymous ? guestCreditsMessage : platformCreditsMessage)
    }
    if (!response.ok) throw sessionError('SESSION_UNAVAILABLE', '无法创建会话，请检查绑定、音色和账号额度')
    if (![0, 200].includes(result.code)) throw sessionError('SESSION_UNAVAILABLE', '无法创建会话，请检查绑定、音色和账号额度')
    if (anonymous && Number.isFinite(result.data?.anonymousRemainingScore) && result.data.anonymousRemainingScore <= 0) {
      throw sessionError('SCORE_DEPLETED', guestCreditsMessage)
    }
    return { ...validateSession(result.data, { voiceId: resolved.providerVoice }, anonymous, baseOrigin), deviceId: subject,
      agentId: profile.agentId, anonymous }
  } catch (error) {
    if (abort.aborted) throw sessionError('SESSION_CANCELLED', '连接已取消或超时，请重试')
    if (Object.hasOwn(desktopUsageMessages, error.code) || ['INVALID_SESSION', 'SESSION_UNAVAILABLE', 'VOICE_INCOMPATIBLE', 'SCORE_DEPLETED', 'GUEST_LOGIN_REQUIRED'].includes(error.code)) throw error
    throw sessionError('SESSION_UNAVAILABLE', '无法连接对话服务，请检查网络后重试')
  }
}
