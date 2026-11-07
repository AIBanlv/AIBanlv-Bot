const $ = (id) => document.getElementById(id)
const bridge = window.desktopPet
const frame = $('avatar')
const channel = 'control-desktop-pet-v1'
let pointer = null
const tellAvatar = (value) => frame.contentWindow?.postMessage({ channel, ...value }, location.origin)
bridge.onPresentation((data) => {
  if (data.type === 'caption') {
    $('caption').textContent = data.text
    $('caption-label').textContent = data.label
    $('caption-bubble').hidden = !data.text
  } else tellAvatar(data)
})
bridge.onState((state) => tellAvatar({ type: 'pause', paused: !state.visible }))
window.addEventListener('message', (event) => {
  if (event.source !== frame.contentWindow || event.origin !== location.origin || event.data?.channel !== channel) return
  const { type, text } = event.data
  if (!['ready', 'loading', 'error'].includes(type)) return
  bridge.avatarStatus(type)
  $('loading').hidden = type === 'ready'
  if (typeof text === 'string') $('loading-text').textContent = text.slice(0, 120)
})
const surface = $('drag-surface')
const point = (event) => ({ x: event.screenX, y: event.screenY })
surface.addEventListener('pointerdown', (event) => {
  if (event.button !== 0 || !event.isPrimary) return
  pointer = event.pointerId
  surface.setPointerCapture(pointer)
  surface.focus()
  bridge.drag('start', point(event))
  event.preventDefault()
})
surface.addEventListener('pointermove', (event) => {
  if (pointer === event.pointerId) bridge.drag('move', point(event))
})
for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) {
  surface.addEventListener(name, () => { pointer = null; bridge.drag('end') })
}
surface.addEventListener('keydown', (event) => {
  const delta = { ArrowLeft: [-10, 0], ArrowRight: [10, 0], ArrowUp: [0, -10], ArrowDown: [0, 10] }[event.key]
  if (!delta) return
  event.preventDefault()
  bridge.drag('start', { x: 0, y: 0 })
  bridge.drag('move', { x: delta[0], y: delta[1] })
  bridge.drag('end')
})
for (const command of ['controller', 'reset', 'hide']) {
  $(command).addEventListener('click', () => bridge.command(command))
}
window.addEventListener('pagehide', () => bridge.drag('end'))
