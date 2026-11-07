import { DeviceChat } from './device-chat.mjs'
import { conversationInputResult } from './device-pet-policy.mjs'
import { installTranslations, setLanguage } from './device-i18n.mjs'
import { neutralExpression } from '../src/lam-track.mjs'
import { createDeviceParticles } from '../src/device-particles.mjs'
import { installVoiceInput } from './device-voice.mjs'
import { installTouchInteraction } from './device-touch.mjs'
import { installMoodDirector } from './device-mood.mjs'
import { createFaceBank } from './device-face-bank.mjs'

const $ = id => document.getElementById(id)
const device = window.controlDevice, desktop = window.desktopPet
const channel = 'control-desktop-pet-v1'
let state, frame, frameId = '', pointer, visible = true, context = ''
let touch, mood, clickThrough = false
let particlesEnabled = false, avatarReady = false, particleEdge = null
let qualityMode = 'auto'
const particles = createDeviceParticles({ canvas: $('device-particles'), getFootprint: () => {
  if (!particleEdge || !frame) return null
  const figure = frame.getBoundingClientRect(), canvas = $('device-particles').getBoundingClientRect()
  return { ...particleEdge, top: figure.top - canvas.top, height: figure.height }
} })
const syncParticles = () => {
  $('device-particles').parentElement.dataset.particles = String(particlesEnabled && avatarReady)
  particles.update({ enabled: particlesEnabled, visible, ready: avatarReady })
  tellAvatar({ type: 'particle-sampling', enabled: particlesEnabled && avatarReady && visible })
}
const tellAvatar = value => frame?.contentWindow?.postMessage({ channel, ...value }, location.origin)
const stop = () => {
  touch?.cancel(); mood?.cancel()
  tellAvatar({ type: 'expression', ...neutralExpression() })
}
const chat = new DeviceChat({ device, onStart: stop, onExpression: value => tellAvatar({
  type: 'expression', ...value,
}) })
const voice = installVoiceInput(chat, device)
// Gestures drive the idle mood as well as the conversation reply.
const moodKind = gesture => ({ TAP: 'tap', DOUBLE_TAP: 'double-tap', LONG_PRESS: 'long-press',
  GENTLE_STROKE: 'stroke' })[gesture] || (typeof gesture === 'string' && gesture.startsWith('SWIPE_') ? 'swipe' : '')
touch = installTouchInteraction({ surface: $('drag-surface'),
  // A hand on the pet is allowed while it is answering: it stops the reply
  // instead of being ignored, exactly like talking over it.
  canInteract: () => visible && avatarReady && !clickThrough,
  onExpression: value => tellAvatar({ type: 'expression', ...value }),
  onGesture: event => mood?.observe(moodKind(event.gesture_type)),
  onEngage: () => chat.interrupt(),
  onTouch: event => chat.submitTouch(event),
})
mood = installMoodDirector({ surface: $('drag-surface'),
  canPlay: () => visible && avatarReady && !chat.busy && !touch.active() && pointer == null,
  onExpression: value => tellAvatar({ type: 'expression', ...value }),
})
// The expression library is served by the local session server, so it arrives a
// moment after the window: until then the pet plays its synthesised face.
async function loadFaceBank() {
  try {
    const response = await fetch('/device/face-bank.json', { cache: 'no-store' })
    if (response.ok) mood?.use(createFaceBank(await response.json()))
  } catch { /* No bank is a supported state: the synthesised face stays. */ }
}
loadFaceBank()
// Screen-wide cursor samples: gaze following, proximity reactions and the
// system idle time that lets the pet doze off.
desktop.onPointer(value => mood?.point(value))
function update(next) {
  if(next?.language)setLanguage(next.language)
  if (!next) return
  const local = next.current?.source === 'local' || next.desired?.source === 'local'
  const bound = local || next.current?.publicAvatar || next.desired?.publicAvatar || next.binding === 'bound' && next.connection === 'connected'
  const renderContext = next.current?.source === 'local' && next.current.hasAvatar === false ? '' : next.renderId
  const nextContext = `${local ? 'local' : next.binding}:${next.current?.agentId || ''}:${renderContext}`
  const changed = nextContext !== context
  if (changed) {
    stop(); context = nextContext; particleEdge = null
    mood.reset()
    delete $('device-particles').dataset.edge
    $('device-particles').dataset.anchored = 'false'
  }
  state = next
  chat.textOnly = next.textOnly === true
  const access = conversationInputResult(next)
  voice.setAvailable(next.models?.voiceAvailable === true, access.ok ? undefined : access.message)
  avatarReady = bound && next.phase === 'ready' && Boolean(next.current)
  syncParticles()
  chat.update(bound && next.phase === 'ready' && Boolean(next.current) && access.ok, changed,
    access.message || (bound ? '等待形象加载' : '等待设备绑定'))
  chat.connectionChanged(next.conversationState || 'idle')
  if (!bound || !next.renderAsset) {
    frame?.remove(); frame = null; frameId = ''
  } else if (next.renderId !== frameId) {
    frame?.remove()
    frame = document.createElement('iframe')
    frame.title = '透明数字人画面'; frame.tabIndex = -1
    frameId = next.renderId
    frame.src = `/avatar.html?asset=${encodeURIComponent(next.renderAsset)}&quality=${encodeURIComponent(qualityMode === 'auto' ? next.renderQuality?.tier || 'balanced' : qualityMode)}`
    $('avatar-host').replaceChildren(frame)
  }
  $('loading').hidden = bound && (next.phase === 'ready' || next.phase === 'error' && Boolean(next.current))
  $('loading-text').textContent = next.error || (next.phase === 'syncing' ? '正在加载上官婉儿，无需扫码' : !bound ? '正在准备形象' : next.phase === 'downloading'
    ? `正在下载形象${next.progress === null ? '' : ` ${next.progress}%`}`
    : next.phase === 'rendering' ? '正在加载形象' : '等待形象')
}
window.addEventListener('message', event => {
  if (!frame || event.source !== frame.contentWindow || event.origin !== location.origin || event.data?.channel !== channel) return
  if (['ready', 'error'].includes(event.data.type)) {
    if (event.data.type === 'ready') {
      tellAvatar({ type: 'quality', tier: qualityMode === 'auto' ? state?.renderQuality?.tier || 'balanced' : qualityMode })
      tellAvatar({ type: 'pause', paused: !visible })
      tellAvatar({ type: 'particle-sampling', enabled: particlesEnabled && visible })
    }
    device.rendered(frameId, event.data.type)
  } else if (event.data.type === 'avatar-edge') {
    const edge = event.data.edge
    if (!edge || !Number.isFinite(edge.left) || !Number.isFinite(edge.right) || edge.left < 0 || edge.right > 1 ||
      edge.left >= edge.right || !Array.isArray(edge.bottoms) || edge.bottoms.length !== 96 ||
      edge.bottoms.some(value => value !== null && (!Number.isFinite(value) || value < 0 || value > 1))) return
    particleEdge = edge
    $('device-particles').dataset.edge = JSON.stringify(edge)
    particles.refresh()
  } else if (event.data.type === 'loading' && typeof event.data.text === 'string') $('loading-text').textContent = event.data.text.slice(0, 100)
})
function updateDesktop(next) {
  if (!next) return
  qualityMode = ['low', 'balanced', 'high'].includes(next.quality) ? next.quality : 'auto'
  tellAvatar({ type: 'quality', tier: qualityMode === 'auto' ? state?.renderQuality?.tier || 'balanced' : qualityMode })
  visible = next.visible
  clickThrough = next.clickThrough === true
  if (Number.isInteger(next.size)) $('pet-size').value = String(next.size)
  if (Number.isInteger(next.volume)) $('pet-volume').value = String(next.volume)
  // The speaker is both the label and the switch: pressed means the sound is off.
  $('pet-audio').setAttribute('aria-pressed', String(next.volume === 0))
  $('pet-audio').setAttribute('aria-label', next.volume === 0 ? '恢复音频' : '关闭音频')
  if (!visible || clickThrough) touch.cancel()
  if (!visible) mood?.cancel()
  if (!visible) voice.stop()
  particlesEnabled = next.particles === true
  syncParticles()
  chat.volume(next.volume)
  // Mouse passthrough only changes hit testing, never animation or speech playback.
  tellAvatar({ type: 'pause', paused: !visible })
}
desktop.onState(updateDesktop)
device.onState(update)
installTranslations()
device.onStopSpeech(() => { voice.stop(); stop() })
const surface = $('pet-drag'), point = event => ({ x: event.screenX, y: event.screenY })
surface.addEventListener('pointerdown', event => {
  if (event.button !== 0 || !event.isPrimary) return
  pointer = event.pointerId; surface.setPointerCapture(pointer); surface.focus()
  desktop.drag('start', point(event)); event.preventDefault()
})
surface.addEventListener('pointermove', event => { if (pointer === event.pointerId) desktop.drag('move', point(event)) })
for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) {
  surface.addEventListener(name, () => { pointer = null; desktop.drag('end') })
}
const moveWithKeyboard = event => {
  const delta = { ArrowLeft: [-10, 0], ArrowRight: [10, 0], ArrowUp: [0, -10], ArrowDown: [0, 10] }[event.key]
  if (!delta) return
  event.preventDefault()
  desktop.drag('start', { x: 0, y: 0 }); desktop.drag('move', { x: delta[0], y: delta[1] }); desktop.drag('end')
}
surface.addEventListener('keydown', moveWithKeyboard)
$('drag-surface').addEventListener('keydown', moveWithKeyboard)
for (const command of ['controller', 'hide']) $(command).addEventListener('click', () => desktop.command(command))
$('pet-size').addEventListener('input', () => desktop.command('size', Number($('pet-size').value)))
$('pet-volume').addEventListener('input', () => desktop.command('volume', Number($('pet-volume').value)))
$('pet-audio').addEventListener('click', () => desktop.command('muted', $('pet-audio').getAttribute('aria-pressed') !== 'true'))
window.addEventListener('pagehide', () => { touch.dispose(); mood.dispose(); voice.dispose(); particles.dispose(); chat.dispose(); device.stopChat(); desktop.drag('end') })
updateDesktop(await desktop.status())
update(await device.state())
