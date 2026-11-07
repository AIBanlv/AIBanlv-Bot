import { normalizeProfile } from './device-channel.mjs'
import { assetUrl } from './device-assets.mjs'

// Same public catalog and ZIP layout used by control/api/home.js.
export async function loadDefaultProfile(signal, fetcher = fetch) {
  const response = await fetcher('https://scrm.ieasysell.com/jwt/client/desktop-public/roles', {
    signal: AbortSignal.any([AbortSignal.timeout(15000), ...(signal ? [signal] : [])]),
    redirect: 'error', credentials: 'omit',
  })
  if (!response.ok || !response.body) throw new Error('Public avatar catalog unavailable')
  const chunks = []
  let bytes = 0
  for await (const chunk of response.body) {
    bytes += chunk.byteLength
    if (bytes > 1024 * 1024) throw new Error('Public avatar catalog too large')
    chunks.push(Buffer.from(chunk))
  }
  const result = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if (result?.ok === false || !Array.isArray(result) && result?.code !== undefined && ![0, 200].includes(result.code)) throw new Error('Public avatar catalog denied')
  const roles = Array.isArray(result) ? result : result.data
  const matches = (Array.isArray(roles) ? roles : []).filter(role => {
    const name = String(role.name || '').toLowerCase().replace(/[\s_'’\-]/g, '')
    return !String(role.userId ?? '').trim() && String(role.tenantId) === '1' && ['waner', 'shangguanwaner', '上官婉儿', '上官婉兒'].includes(name)
  })
  if (matches.length !== 1) throw new Error('Public waner avatar missing or ambiguous')
  const role = matches[0]
  const model = role.digitalHumanId || role.humanModelId
  if (!role.id || !model) throw new Error('Public waner avatar incomplete')
  const zipUrl = role.zipUrl || role.zip_url || role.zipPath || role.zip_path ||
    `https://zhanlvgpt.ieasysell.com/1/${encodeURIComponent(model)}/${encodeURIComponent(model)}.zip`
  assetUrl(zipUrl)
  return { ...normalizeProfile({ agentId: role.id, agentName: '上官婉儿', zipUrl,
    voiceId: role.voiceId || role.voiceTypeId, language: role.languageCode || 'zh',
    characterSetting: role.characterSetting || role.description,
    welcomeMessage: role.welcomeMessage || role.promptInfo, agentPhotoUrl: role.picture,
  }), publicAvatar: true }
}
