import { parseTextAction, sampleTextAction, textCaption } from '/src/text-motion.mjs'
const $ = id => document.getElementById(id)
const bridge = window.desktopPet
let ready = false, action = null, elapsed = 0, started = 0, active = false, animation
const neutral = () => bridge.relay({ type: 'expression', pipeline: 'raw', speaking: false, weights: { jawOpen: 0 }, pose: null })
function status(value, message) {
  $('action-status').dataset.state = value
  $('action-status').textContent = message
  $('action-play').textContent = value === 'playing' ? '暂停动作' : value === 'paused' ? '继续动作' : '显示文字并执行'
  $('action-play').setAttribute('aria-pressed', String(active))
}
const time = () => elapsed + (active ? (performance.now() - started) / 1000 : 0)
function showText() {
  bridge.relay({ type: 'caption', text: action && $('captions').checked ? textCaption(action, time()) : '', label: '文字动作' })
}
function tick() {
  if (!active) return
  const seconds = time()
  if (seconds >= action.duration) {
    active = false; elapsed = action.duration
    neutral(); showText(); status('ended', '动作结束，可再次执行'); return
  }
  bridge.relay(sampleTextAction(action, seconds))
  showText()
  $('action-time').textContent = `${seconds.toFixed(1)} / ${action.duration.toFixed(1)} s`
  animation = requestAnimationFrame(tick)
}
function pause() {
  if (!active) return
  elapsed = time(); active = false
  cancelAnimationFrame(animation); neutral(); status('paused', '动作已暂停')
}
function stop() {
  active = false; action = null; elapsed = 0
  cancelAnimationFrame(animation); neutral(); showText()
  $('action-time').textContent = '0.0 s'; status('idle', ready ? '待执行' : '等待形象加载')
}
$('action-play').addEventListener('click', () => {
  if (active) { pause(); return }
  if (!ready) return
  try {
    if (!action || elapsed >= action.duration) { action = parseTextAction($('preview-text').value); elapsed = 0 }
    bridge.command('show'); active = true; started = performance.now()
    status('playing', '正在显示文字与动作'); tick()
  } catch (error) { stop(); status('error', error.message) }
})
$('action-stop').addEventListener('click', stop)
$('preview-text').addEventListener('input', stop)
$('action-tag').addEventListener('change', () => {
  const value = $('action-tag').value
  if (!value) return
  const field = $('preview-text')
  if ([...field.value, ...value].length > 160) { status('error', '文字和标签最多 160 字'); $('action-tag').value = ''; return }
  stop(); field.setRangeText(value, field.selectionStart, field.selectionEnd, 'end')
  $('action-tag').value = ''; field.focus()
})
function update(state) {
  if (!state) return
  if (ready && !state.ready) stop()
  ready = state.ready
  $('model-status').textContent = ready ? '就绪' : state.status === 'error' ? '加载失败' : '加载中'
  $('action-play').disabled = !ready
  if (!action) status('idle', ready ? '待执行' : '等待形象加载')
  $('retry').hidden = state.status !== 'error'
  $('visible').checked = state.visible
  $('pinned').checked = state.pinned
  $('click-through').checked = state.clickThrough
  $('size').value = state.size; $('size-value').textContent = `${state.size} px`
}
bridge.onState(update); bridge.onPause(pause); update(await bridge.status())
for (const [id, command] of [['visible', 'show'], ['pinned', 'pin'], ['click-through', 'clickThrough']]) {
  $(id).addEventListener('change', () => bridge.command(id === 'visible' ? ($(id).checked ? 'show' : 'hide') : command, $(id).checked))
}
$('size').addEventListener('input', () => bridge.command('size', Number($('size').value)))
$('captions').addEventListener('change', showText)
for (const command of ['reset', 'retry', 'quit']) $(command).addEventListener('click', () => bridge.command(command))
window.addEventListener('pagehide', stop)
