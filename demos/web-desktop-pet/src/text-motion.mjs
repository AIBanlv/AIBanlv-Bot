import { pipeline } from './control.mjs'

const heads = ['none', 'nod', 'slow_nod', 'shake', 'tilt', 'lean', 'look_up', 'look_down', 'look_left', 'look_right']
const emotions = ['neutral', 'happy', 'warm', 'caring', 'thinking', 'surprised', 'excited', 'sad', 'angry', 'fearful', 'disgusted', 'curious', 'playful']
const gazes = ['none', 'contact', 'gentle', 'soft', 'thinking', 'lower', 'up', 'left', 'right']
const aliases = {
  '摇头': ['head', 'shake'], '摇摇头': ['head', 'shake'], '点头': ['head', 'nod'], '点点头': ['head', 'nod'],
  '抬头': ['head', 'look_up'], '低头': ['head', 'look_down'], '向左看': ['head', 'look_left'], '向右看': ['head', 'look_right'],
  '微笑': ['emotion', 'happy'], '开心': ['emotion', 'happy'], '惊讶': ['emotion', 'surprised'],
  '难过': ['emotion', 'sad'], '思考': ['emotion', 'thinking'], '自然': ['emotion', 'neutral'],
}
const depths = ['none', 'forward', 'back', 'cycle']
const allowed = { head: heads, emotion: emotions, gaze: gazes, depth: depths }

// Published so idle behaviour can pick actions out of the very same tag library
// instead of hard-coding blendshapes of its own.
export const motionTags = { head: [...heads], emotion: [...emotions], gaze: [...gazes], depth: [...depths] }

export function parseTextAction(input) {
  if (typeof input !== 'string' || [...input].length > 160 || /[\x00-\x08\x0b-\x1f]/.test(input)) throw new Error('请输入 1–160 字的文字和标签')
  const directives = {}
  const normalized = input.replaceAll('【', '[').replaceAll('】', ']').replaceAll('：', ':')
  const text = normalized.replace(/\[([^\[\]]+)\]/g, (_tag, token) => {
    let directive = aliases[token.trim()]
    if (!directive) {
      const match = token.trim().toLowerCase().match(/^(h|head|e|emotion|g|gaze|eye|depth)[:-]([a-z_]+)$/)
      if (match) {
        const key = ({ h: 'head', e: 'emotion', g: 'gaze', eye: 'gaze' })[match[1]] || match[1]
        let value = match[2]
        if (key === 'emotion') value = ({ natural: 'neutral', thoughtful: 'thinking', surprise: 'surprised' })[value] || value
        directive = [key, value]
      }
    }
    if (!directive || !allowed[directive[0]]?.includes(directive[1])) throw new Error(`不支持的动作标签：${token}`)
    const [key, value] = directive
    if (Object.hasOwn(directives, key)) throw new Error('同类动作标签只能出现一次')
    directives[key] = value
    return ''
  }).trim()
  if (!text || /[\[\]]/.test(text)) throw new Error('请输入正文，并检查标签是否闭合')
  const noHeadNegation = !/(不要|别|不用|不必).{0,3}(摇|点|抬|低|向左看|向右看)/.test(text)
  const inferredHead = noHeadNegation ? (/(摇摇头|摇头)/.test(text) ? 'shake' : /(点点头|点头)/.test(text) ? 'nod' : 'none') : 'none'
  const inferredEmotion = /(很高兴|开心|谢谢|感谢|微笑)/.test(text) ? 'happy' : 'neutral'
  const chars = [...text], pages = []
  for (let i = 0; i < chars.length; i += 32) pages.push(chars.slice(i, i + 32).join(''))
  return { text, pages, duration: Math.max(4, chars.length / 5, pages.length * 3),
    head: inferredHead, emotion: inferredEmotion, gaze: 'contact', depth: 'none', ...directives }
}

export function textCaption(action, seconds) {
  if (!Number.isFinite(seconds) || seconds < 0 || seconds >= action.duration) return ''
  return action.pages[Math.min(action.pages.length - 1, Math.floor(seconds / (action.duration / action.pages.length)))]
}

export function sampleTextAction(action, seconds) {
  const t = Math.max(0, Math.min(action.duration, seconds))
  const fade = Math.min(1, t / 0.3, (action.duration - t) / 0.5)
  const pose = { version: 1, owned: true, pitch: 0, yaw: 0, roll: 0, gazeX: 0, gazeY: 0, depth: 0 }
  const weights = { jawOpen: 0, mouthFunnel: 0, mouthPucker: 0 }
  const gesture = t < 2.4 ? Math.sin(Math.PI * t / 2.4) ** 2 : 0
  const oscillation = Math.sin(t * Math.PI * 2 / 1.2) * gesture
  if (action.head === 'shake') pose.yaw = oscillation * 0.25
  if (action.head === 'nod' || action.head === 'slow_nod') pose.pitch = oscillation * (action.head === 'nod' ? 0.17 : 0.1)
  if (action.head === 'tilt') pose.roll = fade * 0.12
  if (action.head === 'lean') pose.pitch = fade * 0.1
  if (action.head === 'look_up') pose.pitch = -fade * 0.18
  if (action.head === 'look_down') pose.pitch = fade * 0.18
  if (action.head === 'look_left') pose.yaw = fade * 0.22
  if (action.head === 'look_right') pose.yaw = -fade * 0.22
  pose.gazeX = ({ left: 0.5, right: -0.5, thinking: 0.2 })[action.gaze] * fade || 0
  pose.gazeY = ({ up: 0.4, lower: -0.4, thinking: 0.25 })[action.gaze] * fade || 0
  pose.depth = ({ forward: 0.25, back: -0.25, cycle: Math.sin(t * Math.PI / 2) * 0.15 })[action.depth] * fade || 0
  const both = (name, value) => { weights[`${name}Left`] = value * fade; weights[`${name}Right`] = value * fade }
  if (['happy', 'warm', 'caring', 'excited', 'playful'].includes(action.emotion)) { both('mouthSmile', 0.65); both('cheekSquint', 0.22); both('eyeSquint', 0.12) }
  if (['surprised', 'curious', 'fearful'].includes(action.emotion)) { both('eyeWide', 0.45); both('browOuterUp', 0.4); weights.browInnerUp = 0.4 * fade }
  if (action.emotion === 'sad') { both('mouthFrown', 0.3); weights.browInnerUp = 0.45 * fade }
  if (['angry', 'disgusted', 'thinking'].includes(action.emotion)) both('browDown', action.emotion === 'thinking' ? 0.18 : 0.45)
  if (action.emotion === 'disgusted') both('noseSneer', 0.3)
  const blinkTime = t % 4.8
  const blink = blinkTime > 4.4 && blinkTime < 4.58 ? Math.sin((blinkTime - 4.4) / 0.18 * Math.PI) : 0
  weights.eyeBlinkLeft = weights.eyeBlinkRight = Math.max(0, blink)
  return { type: 'expression', pipeline, speaking: false, weights, pose }
}
