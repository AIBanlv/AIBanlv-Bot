import { validateClip, speechCaption } from './expression.mjs'
import { validateControl, sampleControl, pipeline } from './control.mjs'

export function createPreview({ send, showCaption, beforePlay }) {
  const $ = (id) => document.getElementById(id)
  let clip = null, bank = null, controller = null, animation = null
  let selected = false, ready = false, active = false
  let generation = 0, elapsed = 0, startedAt = 0

  function state(value, message, label = '静音预览') {
    $('preview-status').dataset.state = value
    $('preview-status').textContent = message
    $('preview-label').textContent = label
    $('preview-play').setAttribute('aria-pressed', String(active))
    $('preview-play').disabled = !ready || value === 'generating'
    $('preview-text').setAttribute('aria-busy', String(value === 'generating'))
  }
  function neutral() { send({ type: 'expression', weights: {}, pose: null, pipeline: 'raw', speaking: false }) }
  function time() { return elapsed + (active ? (performance.now() - startedAt) / 1000 : 0) }
  function updateCaption() {
    if (selected) showCaption(clip ? speechCaption(clip, Math.min(time(), clip.duration)) : '', '静音预览')
  }
  function tick() {
    if (!active) return
    const seconds = time()
    const closing = seconds >= clip.duration
    const sample = sampleControl(bank, 'natural', closing ? seconds - clip.duration : seconds, closing)
    if (!sample) {
      active = false
      elapsed = clip.duration
      neutral()
      showCaption('', '静音预览')
      state('ended', '预览结束', '再看一次')
      return
    }
    send({ type: 'expression', ...sample, pipeline, speaking: !closing, closing })
    updateCaption()
    $('preview-time').textContent = `${Math.min(seconds, clip.duration).toFixed(1)} / ${clip.duration.toFixed(1)} s`
    animation = requestAnimationFrame(tick)
  }
  function stop() {
    generation++
    controller?.abort()
    controller = null
    cancelAnimationFrame(animation)
    active = false
    elapsed = 0
    if (selected) { neutral(); showCaption('', '静音预览') }
    selected = false
    $('preview-time').textContent = '0.0 s'
    state('idle', '已停止')
  }
  function pause() {
    if (controller) { stop(); return }
    if (!active) return
    elapsed = time()
    active = false
    cancelAnimationFrame(animation)
    neutral()
    state('paused', '已暂停', '继续预览')
  }
  async function play() {
    if (active) { pause(); return }
    if (!ready) return
    const text = $('preview-text').value.trim()
    if (!text) { state('error', '请输入台词'); $('preview-text').focus(); return }
    beforePlay()
    selected = true
    const token = ++generation
    try {
      if (!clip) {
        controller = new AbortController()
        state('generating', '正在生成口型与动作…')
        showCaption('', '静音预览')
        const response = await fetch('/api/previews', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }),
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(125000)]),
        })
        const data = await response.json()
        if (!response.ok) throw new Error(data.error?.message || '生成失败，请重试')
        if (token !== generation) return
        if (data.version !== 1 || typeof data.behavior?.text !== 'string') throw new Error('预览数据格式错误')
        const next = validateClip(data.clip)
        bank = validateControl(data.bank, data.bank?.sourceSha256, next.duration, ['natural'])
        clip = next
      }
      if (token !== generation) return
      controller = null
      if (elapsed >= clip.duration) elapsed = 0
      startedAt = performance.now()
      active = true
      state('playing', '静音预览中', '暂停预览')
      tick()
    } catch (error) {
      if (token !== generation) return
      stop()
      state('error', error.name === 'TimeoutError' ? '生成超时，请重试' : error.message, '重试预览')
    }
  }
  $('preview-play').addEventListener('click', play)
  $('preview-stop').addEventListener('click', stop)
  const edited = () => {
    stop()
    clip = bank = null
    state('idle', $('preview-text').value.trim() ? '待预览' : '请输入台词')
  }
  $('preview-text').addEventListener('input', edited)
  $('preview-tag').addEventListener('change', () => {
    const input = $('preview-text')
    const value = $('preview-tag').value
    if (value && input.value.length + value.length <= input.maxLength) {
      input.setRangeText(value, input.selectionStart, input.selectionEnd, 'end')
      edited()
      input.focus()
    }
    $('preview-tag').value = ''
  })
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause() })
  window.addEventListener('pagehide', stop)
  return {
    pause, stop, updateCaption,
    get selected() { return selected },
    setReady(value) {
      ready = value
      if (!value) pause()
      $('preview-play').disabled = !value || Boolean(controller)
    },
  }
}
