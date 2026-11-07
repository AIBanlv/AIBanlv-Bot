import { createPreview } from '/src/preview.mjs'
import { createSpeech } from '/src/speech.mjs'

const $ = (id) => document.getElementById(id)
const bridge = window.desktopPet
let preview, speech, ready = false, caption = '', captionLabel = ''
const send = (data) => bridge.relay(data)
function showCaption(text, label = '字幕') {
  caption = text
  captionLabel = label
  send({ type: 'caption', text: $('captions').checked ? text : '', label })
}
for (const id of ['speech-stop', 'expression', 'postprocess']) {
  $(id).addEventListener(id === 'speech-stop' ? 'click' : 'change', () => preview?.stop())
}
speech = createSpeech({ send, showCaption,
  beforePlay: () => { preview.stop(); bridge.command('show') } })
preview = createPreview({ send, showCaption,
  beforePlay: () => { speech.deselect(); bridge.command('show') } })
function pause() { speech.pause(); preview.pause() }
function update(state) {
  if (!state) return
  if (ready !== state.ready) {
    ready = state.ready
    speech.setReady(ready)
    preview.setReady(ready)
  }
  $('model-status').textContent = state.ready ? '就绪' : state.status === 'error' ? '加载失败' : '加载中'
  $('retry').hidden = state.status !== 'error'
  $('visible').checked = state.visible
  $('pinned').checked = state.pinned
  $('click-through').checked = state.clickThrough
  $('size').value = state.size
  $('size-value').textContent = `${state.size} px`
}
bridge.onState(update)
bridge.onPause(pause)
update(await bridge.status())
$('visible').addEventListener('change', () => bridge.command($('visible').checked ? 'show' : 'hide'))
$('pinned').addEventListener('change', () => bridge.command('pin', $('pinned').checked))
$('click-through').addEventListener('change', () => bridge.command('clickThrough', $('click-through').checked))
$('size').addEventListener('input', () => bridge.command('size', Number($('size').value)))
$('reset').addEventListener('click', () => bridge.command('reset'))
$('retry').addEventListener('click', () => bridge.command('retry'))
$('quit').addEventListener('click', () => bridge.command('quit'))
$('captions').addEventListener('change', () => showCaption(caption, captionLabel))
window.addEventListener('pagehide', pause)
