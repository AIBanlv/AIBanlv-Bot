import { petSize } from './policy.mjs'
export const platformCreditsMessage = '平台可用积分不足 30 分，请到 AIBanlv 手机端充值后继续对话'
export const guestCreditsMessage = '游客试用可用积分不足 30 分，请扫码绑定账号后继续对话'
export const guestLoginMessage = '本机试用已关联账号，请扫码绑定后继续使用'

// The device pet replaces the original floating toolbar with a permanent composer.
export const CAPTION_HEIGHT = 120
export const COMPOSER_HEIGHT = 92
const ORIGINAL_TOOLBAR_HEIGHT = 56

export function devicePetSize(width) {
  const size = petSize(width)
  return { ...size, height: size.height - ORIGINAL_TOOLBAR_HEIGHT + COMPOSER_HEIGHT }
}

export function hitDevicePet(x, y, width, clickThrough, height = devicePetSize(width).height, bubbleVisible = false, captionHeight = CAPTION_HEIGHT) {
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 ||
      height <= CAPTION_HEIGHT + COMPOSER_HEIGHT) return false
  const base = height - COMPOSER_HEIGHT
  // The caption floats above the composer; the portrait keeps the full area behind it.
  const bubbleTop = base - captionHeight
  const composer = x >= 6 && x <= width - 6 && y >= base && y <= base + COMPOSER_HEIGHT - 6
  const bubble = bubbleVisible && x >= 6 && x <= width - 6 &&
    y >= bubbleTop && y <= bubbleTop + captionHeight - 12
  const figure = ((x - width / 2) / (width * 0.43)) ** 2 +
    ((y - base / 2) / (base * 0.49)) ** 2 <= 1
  return composer || bubble || !clickThrough && figure
}

export function chatInputResult(value, state) {
  if (typeof value !== 'string' || !value.trim() || value.length > 1000 ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) {
    return { ok: false, code: 'INVALID_TEXT', message: '请输入 1-1000 字的文字' }
  }
  return conversationInputResult(state)
}

// Rendering an avatar and permission to spend on a conversation are independent.
// Use the main process's resolved route for both text composers; never substitute
// an own Key for an online role when platform credits run out.
export function conversationInputResult(state) {
  const ready = deviceInputResult(state)
  if (!ready.ok) return ready
  if (state.models && Object.hasOwn(state.models, 'route') && !state.models.route) {
    return { ok: false, code: state.models.code || 'MODEL_UNAVAILABLE', message: state.models.code === 'SCORE_DEPLETED' ? state.guest ? guestCreditsMessage : platformCreditsMessage : state.models.message || '当前对话暂不可用，请检查连接和模型配置' }
  }
  if (state.current?.source !== 'local' && Number.isFinite(state.score) && state.score <= 0) {
    return { ok: false, code: 'SCORE_DEPLETED', message: state.guest ? guestCreditsMessage : platformCreditsMessage }
  }
  return ready
}

export function deviceInputResult(state) {
  if (state.current?.source !== 'local' && !state.current?.publicAvatar && (state.binding !== 'bound' || state.connection !== 'connected')) {
    return { ok: false, code: 'BIND_REQUIRED', message: '请先连接并绑定设备' }
  }
  if (!state.current || state.phase !== 'ready') {
    return { ok: false, code: 'AVATAR_NOT_READY', message: '请等待形象加载完成' }
  }
  return { ok: true }
}
