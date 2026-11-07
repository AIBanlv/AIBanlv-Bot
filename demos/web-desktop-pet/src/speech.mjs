import { validateClip, sampleExpression, speechCaption, blendPreset } from './expression.mjs'
import { validateControl, sampleControl, pipeline } from './control.mjs'

export function createSpeech({ send, showCaption, beforePlay }) {
  const $ = (id) => document.getElementById(id)
  const audio = $('speech-audio')
  let clip = null
  let objectUrl = null
  let active = false
  let selected = false
  let generation = 0
  let animation = null
  let ready = false
  let loading = null
  let buffering = false
  let control = null
  let controlLoading = null
  let sourceSha256 = ''
  let closingAt = null

  function publish(speaking = false) {
    if (speaking && $('postprocess').checked && control) {
      const sample = sampleControl(control, $('expression').value, audio.currentTime)
      if (sample) { send({ type: 'expression', ...sample, pipeline, speaking }); return }
    }
    const weights = blendPreset(speaking ? sampleExpression(clip, audio.currentTime) : {}, $('expression').value)
    send({ type: 'expression', weights, pose: null, pipeline: 'raw', speaking })
  }
  function label(text, status) {
    $('speech-label').textContent = text
    $('speech-status').textContent = status
    $('speech-play').setAttribute('aria-pressed', String(active))
  }
  function updateCaption() {
    if (selected && clip) showCaption(speechCaption(clip, audio.currentTime), '语音字幕 · 中文翻译')
  }
  function tick() {
    if (audio.paused || audio.ended || !active) return
    publish(!buffering)
    updateCaption()
    const seconds = Math.floor(audio.currentTime)
    $('speech-time').textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
    animation = requestAnimationFrame(tick)
  }
  function pause() {
    generation++
    active = false
    audio.pause()
    cancelAnimationFrame(animation)
    closingAt = null
    publish()
    label(audio.currentTime ? '继续说话' : '开口说话', clip ? '已暂停' : '待播放')
  }
  function stop() {
    pause()
    audio.currentTime = 0
    selected = false
    $('speech-time').textContent = '0:00'
    label('开口说话', '已停止')
    showCaption('', '语音字幕 · 中文翻译')
  }
  async function loadClip() {
    const signal = AbortSignal.timeout(15000)
    const responses = await Promise.all([
      fetch('/assets/speech.json', { signal }), fetch('/assets/speech.wav', { signal }),
    ])
    if (responses.some((response) => !response.ok)) throw new Error('缺少语音资源，请运行准备脚本后重试')
    const source = await responses[0].text()
    const next = validateClip(JSON.parse(source))
    sourceSha256 = await digest(new TextEncoder().encode(source))
    const bytes = await responses[1].arrayBuffer()
    const hash = await digest(bytes)
    if (hash !== next.provenance?.audioSha256) throw new Error('语音与表情不匹配，请重新生成')
    if (objectUrl) URL.revokeObjectURL(objectUrl)
    objectUrl = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }))
    audio.src = objectUrl
    clip = next
    control = null
  }
  async function digest(bytes) {
    const hash = await crypto.subtle.digest('SHA-256', bytes)
    return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('')
  }
  async function loadControl() {
    const response = await fetch('/assets/speech-control.json', { signal: AbortSignal.timeout(15000) })
    if (!response.ok) throw new Error('缺少 Control 后处理，请运行准备脚本后重试')
    control = validateControl(await response.json(), sourceSha256, clip.duration)
  }
  async function ensureControl() {
    if (!$('postprocess').checked || control) return
    controlLoading ||= loadControl().finally(() => { controlLoading = null })
    await controlLoading
  }
  function closeTick() {
    if (closingAt === null || document.hidden) return
    const sample = sampleControl(control, $('expression').value, (performance.now() - closingAt) / 1000, true)
    if (!sample || !$('postprocess').checked) { closingAt = null; publish(); return }
    send({ type: 'expression', ...sample, pipeline, speaking: false, closing: true })
    animation = requestAnimationFrame(closeTick)
  }
  async function play() {
    if (active) { pause(); return }
    if (!ready) return
    beforePlay()
    cancelAnimationFrame(animation)
    closingAt = null
    active = true
    selected = true
    const token = ++generation
    label('暂停说话', '正在准备')
    try {
      if (!clip) {
        loading ||= loadClip().finally(() => { loading = null })
        await loading
      }
      if (generation !== token) return
      await ensureControl()
      if (generation !== token) return
      if (audio.ended || audio.currentTime >= clip.duration) audio.currentTime = 0
      await audio.play()
      if (generation !== token) return
      label('暂停说话', '正在说话')
      cancelAnimationFrame(animation)
      tick()
    } catch (error) {
      if (generation !== token) return
      pause()
      label('重试语音', error.name === 'NotAllowedError' ? '浏览器未允许播放，请再次点击' : error.message)
    }
  }
  audio.addEventListener('ended', () => {
    pause()
    showCaption('', '语音字幕 · 中文翻译')
    label('再说一次', '播放结束')
    if ($('postprocess').checked && control) { closingAt = performance.now(); closeTick() }
  })
  audio.addEventListener('waiting', () => { buffering = true; publish() })
  audio.addEventListener('playing', () => { buffering = false })
  audio.addEventListener('pause', () => { if (active && audio.paused) pause() })
  audio.addEventListener('error', () => {
    pause()
    clip = null
    label('重试语音', '音频读取失败，请重试')
  })
  $('speech-play').addEventListener('click', play)
  $('speech-stop').addEventListener('click', stop)
  $('expression').addEventListener('change', () => publish(active && !audio.paused && Boolean(clip)))
  $('postprocess').addEventListener('change', async () => {
    // Already prepared tracks can switch without touching the audio clock.
    if (!$('postprocess').checked || control) {
      publish(active && !audio.paused && Boolean(clip))
      return
    }
    if (!clip) return
    const resume = active
    pause()
    const token = generation
    try {
      await ensureControl()
      if (generation === token && resume) await play()
    } catch (error) {
      if (generation === token) label('重试语音', error.message)
    }
  })
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause() })
  window.addEventListener('pagehide', () => {
    pause()
    if (objectUrl) URL.revokeObjectURL(objectUrl)
  })
  return {
    pause, stop, updateCaption,
    get selected() { return selected },
    deselect() { pause(); selected = false },
    setReady(value) {
      ready = value
      $('speech-play').disabled = !value
      if (!value) pause()
      else { publish(); if (!selected) label('开口说话', '待播放') }
    },
  }
}
