import { constrain, dragged, splitCaptions, captionAt } from './state.mjs'
import { createSpeech } from './speech.mjs'
import { createPreview } from './preview.mjs'

const $ = (id) => document.getElementById(id)
const pet = $('pet')
const frame = $('avatar')
const surface = $('drag-surface')
const channel = 'control-desktop-pet-v1'
let position = { x: innerWidth, y: innerHeight }
let gesture = null
let collapsed = false
let playing = false
let elapsed = 0
let startedAt = 0
let timer = null
let lines = splitCaptions($('script').value)
let index = 0
let preview = null
for (const id of ['speech-stop', 'expression', 'postprocess']) {
  $(id).addEventListener(id === 'speech-stop' ? 'click' : 'change', () => preview?.stop())
}
const speech = createSpeech({
  send: (detail) => frame.contentWindow?.postMessage({ channel, ...detail }, location.origin),
  showCaption,
  beforePlay: () => {
    preview?.stop()
    pausePlayback()
    if (collapsed) setCollapsed(false)
  },
})
preview = createPreview({
  send: (detail) => frame.contentWindow?.postMessage({ channel, ...detail }, location.origin),
  showCaption,
  beforePlay: () => {
    speech.deselect()
    pausePlayback()
    if (collapsed) setCollapsed(false)
  },
})

function place(next = position) {
  position = constrain(next, pet.getBoundingClientRect(), { width: innerWidth, height: innerHeight })
  pet.style.transform = `translate(${position.x}px, ${position.y}px)`
}

function reset() {
  const margin = innerWidth <= 600 ? 12 : 48
  place({ x: innerWidth - pet.offsetWidth - margin, y: innerHeight - pet.offsetHeight - 28 })
}

function showCaption(text, label = '演示字幕') {
  if ($('caption').textContent !== text) $('caption').textContent = text
  $('caption-label').textContent = label
  $('caption-bubble').hidden = !$('captions').checked || !text
}

function pausePlayback() {
  if (playing) elapsed += performance.now() - startedAt
  playing = false
  clearInterval(timer)
  timer = null
  $('play-label').textContent = '播放台词'
  $('play').setAttribute('aria-pressed', 'false')
}

function tick() {
  const state = captionAt(lines, elapsed + performance.now() - startedAt, $('loop').checked)
  index = state.index
  showCaption(state.text)
  $('playback-status').textContent = `${index + 1} / ${lines.length}`
  if (state.ended) {
    pausePlayback()
    elapsed = 0
    $('playback-status').textContent = '播放结束'
  }
}

function setCollapsed(value) {
  collapsed = value
  if (value) speech.pause()
  if (value) preview.pause()
  if (value && playing) { pausePlayback(); $('playback-status').textContent = '已暂停' }
  // Preserve the iframe's layout while its asynchronous renderer is initializing.
  pet.style.visibility = value ? 'hidden' : 'visible'
  pet.inert = value
  $('restore').hidden = !value
  $('visibility-label').textContent = value ? '恢复数字人' : '收起数字人'
  frame.contentWindow?.postMessage({ channel, type: 'pause', paused: value }, location.origin)
  if (!value) place()
  const focusTarget = value ? $('restore') : surface
  focusTarget.focus({ preventScroll: true })
}

function nextCaption() {
  if (!lines.length) return
  speech.deselect()
  preview.stop()
  pausePlayback()
  index = (index + 1) % lines.length
  elapsed = index * 4500
  showCaption(lines[index])
  $('playback-status').textContent = `${index + 1} / ${lines.length}`
}

$('play').addEventListener('click', () => {
  speech.deselect()
  preview.stop()
  if (playing) { pausePlayback(); $('playback-status').textContent = '已暂停'; return }
  if (!lines.length) { $('playback-status').textContent = '请输入台词'; $('script').focus(); return }
  if (collapsed) setCollapsed(false)
  playing = true
  startedAt = performance.now()
  $('play-label').textContent = '暂停台词'
  $('play').setAttribute('aria-pressed', 'true')
  tick()
  timer = setInterval(tick, 100)
})
$('script').addEventListener('input', () => {
  speech.deselect()
  preview.stop()
  pausePlayback()
  elapsed = 0
  index = 0
  lines = splitCaptions($('script').value)
  showCaption(lines[0] || '')
  $('playback-status').textContent = lines.length ? '待播放' : '请输入台词'
})
$('captions').addEventListener('change', () => {
  if (preview.selected) preview.updateCaption()
  else if (speech.selected) speech.updateCaption()
  else showCaption(lines[index] || '')
})
$('size').addEventListener('input', () => {
  pet.style.setProperty('--pet-width', `${$('size').value}px`)
  $('size-value').textContent = `${$('size').value} px`
  place()
})
for (const id of ['reset', 'pet-reset']) $(id).addEventListener('click', reset)
$('next-caption').addEventListener('click', nextCaption)
$('collapse').addEventListener('click', () => setCollapsed(true))
$('restore').addEventListener('click', () => setCollapsed(false))
$('visibility').addEventListener('click', () => setCollapsed(!collapsed))
$('retry').addEventListener('click', () => {
  speech.setReady(false)
  preview.setReady(false)
  $('retry').hidden = true
  $('loading-text').textContent = '正在重新加载…'
  $('model-status').textContent = '加载中'
  frame.src = `/avatar.html?reload=${Date.now()}`
})
window.addEventListener('message', (event) => {
  if (event.origin !== location.origin || event.source !== frame.contentWindow || event.data?.channel !== channel) return
  const { type, text } = event.data
  if (type === 'ready') {
    speech.setReady(true)
    preview.setReady(true)
    $('loading').hidden = true
    $('model-status').textContent = '就绪'
    frame.contentWindow.postMessage({ channel, type: 'pause', paused: collapsed }, location.origin)
  } else if (['loading', 'error'].includes(type) && typeof text === 'string') {
    if (type === 'error') { speech.setReady(false); preview.setReady(false) }
    $('loading').hidden = false
    $('loading-text').textContent = text.slice(0, 120)
    $('retry').hidden = type !== 'error'
    $('model-status').textContent = type === 'error' ? '加载失败' : '加载中'
  }
})

surface.addEventListener('pointerdown', (event) => {
  if (!event.isPrimary || event.button !== 0) return
  gesture = { id: event.pointerId, start: { x: event.clientX, y: event.clientY }, origin: { ...position }, moved: false }
  surface.setPointerCapture(event.pointerId)
  event.preventDefault()
  surface.focus({ preventScroll: true })
})
surface.addEventListener('pointermove', (event) => {
  if (!gesture || gesture.id !== event.pointerId) return
  const current = { x: event.clientX, y: event.clientY }
  gesture.moved ||= dragged(gesture.start, current)
  if (!gesture.moved) return
  pet.classList.add('dragging')
  place({ x: gesture.origin.x + current.x - gesture.start.x, y: gesture.origin.y + current.y - gesture.start.y })
})
function finishDrag(event) {
  if (!gesture || gesture.id !== event.pointerId) return
  const click = !gesture.moved && event.type === 'pointerup'
  gesture = null
  pet.classList.remove('dragging')
  if (surface.hasPointerCapture(event.pointerId)) surface.releasePointerCapture(event.pointerId)
  if (click) nextCaption()
}
for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) surface.addEventListener(event, finishDrag)
surface.addEventListener('keydown', (event) => {
  const offsets = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }
  if (!offsets[event.key]) return
  event.preventDefault()
  const [x, y] = offsets[event.key]
  place({ x: position.x + x * (event.shiftKey ? 30 : 10), y: position.y + y * (event.shiftKey ? 30 : 10) })
})
surface.addEventListener('click', (event) => { if (event.detail === 0) nextCaption() })
window.addEventListener('resize', () => place())
new ResizeObserver(() => {
  $('size-value').textContent = `${Math.round(pet.getBoundingClientRect().width)} px`
  if (!collapsed) place()
}).observe(pet)
document.addEventListener('visibilitychange', () => {
  if (document.hidden && playing) { pausePlayback(); $('playback-status').textContent = '已暂停' }
})
window.addEventListener('pagehide', pausePlayback)
showCaption(lines[0])
reset()
