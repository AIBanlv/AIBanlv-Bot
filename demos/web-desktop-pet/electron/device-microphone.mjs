// Mono 16 kHz PCM16; local speech/pause detection only, never speech recognition.
// While the pet is speaking, the microphone keeps listening but the bar is
// higher: the pet's own voice (and whatever echo cancellation leaves of it)
// must not count as an interruption.
const guardedRms = 0.045, guardedVoiced = 8000
export class VoiceActivity {
  constructor() { this.reset() }
  reset() { this.active = false; this.chunks = []; this.pre = []; this.total = 0; this.voiced = 0; this.silence = 0 }
  push(samples, guard = false) {
    if (!(samples instanceof Float32Array) || !samples.length || samples.length > 2048) return {}
    const loud = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length) >= (guard ? guardedRms : 0.015)
    if (!this.active && !loud) {
      this.pre.push(samples.slice())
      while (this.pre.reduce((sum, value) => sum + value.length, 0) > 3200) this.pre.shift()
      return {}
    }
    if (!this.active) {
      this.active = true; this.chunks = this.pre; this.pre = []
      this.total = this.chunks.reduce((sum, value) => sum + value.length, 0)
    }
    this.chunks.push(samples.slice()); this.total += samples.length
    if (loud) { this.voiced += samples.length; this.silence = 0 } else this.silence += samples.length
    if (this.silence < 11200 && this.total < 320000) return { speaking: true }
    let pcm
    if (this.voiced >= (guard ? guardedVoiced : 4000)) {
      pcm = new Uint8Array(Math.min(this.total, 320000) * 2)
      const view = new DataView(pcm.buffer)
      let offset = 0
      for (const chunk of this.chunks) for (const sample of chunk) {
        if (offset >= pcm.length) break
        const value = Number.isFinite(sample) ? Math.max(-1, Math.min(1, sample)) : 0
        view.setInt16(offset, value * (value < 0 ? 32768 : 32767), true); offset += 2
      }
    }
    this.reset()
    return { pcm }
  }
}

export async function captureMicrophone(signal, receive, failed) {
  let stream, context, source, node, gain
  const dispose = () => {
    signal.removeEventListener('abort', dispose)
    if (node) { node.port.onmessage = null; node.disconnect() }
    source?.disconnect(); gain?.disconnect()
    for (const track of stream?.getTracks() || []) { track.onended = null; track.stop() }
    context?.close().catch(() => {})
  }
  signal.addEventListener('abort', dispose, { once: true })
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: {
      channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true,
    }, video: false })
    signal.throwIfAborted()
    context = new AudioContext({ sampleRate: 16000 })
    if (context.sampleRate !== 16000) throw new Error('Unsupported sample rate')
    await context.audioWorklet.addModule('/device/device-microphone-worklet.mjs')
    signal.throwIfAborted()
    source = context.createMediaStreamSource(stream)
    node = new AudioWorkletNode(context, 'control-microphone')
    node.port.onmessage = event => receive(event.data)
    node.onprocessorerror = failed
    gain = context.createGain(); gain.gain.value = 0
    source.connect(node); node.connect(gain); gain.connect(context.destination)
    for (const track of stream.getAudioTracks()) track.onended = failed
    await context.resume()
    signal.throwIfAborted()
    if (context.state !== 'running') throw new Error('Audio capture unavailable')
    context.onstatechange = () => { if (context.state === 'suspended' && !signal.aborted) failed() }
    return { dispose, pause(value) { for (const track of stream.getAudioTracks()) track.enabled = !value } }
  } catch (error) { dispose(); throw error }
}

export class DeviceMicrophone {
  constructor({ authorize, onState, onUtterance, onLevel, capture = captureMicrophone, now = Date.now, guarded = () => false }) {
    Object.assign(this, { authorize, onState, onUtterance, onLevel, capture, now, guarded })
    this.vad = new VoiceActivity(); this.revision = 0; this.enabled = false
  }
  state(state, message = '') {
    if (this.lastState === state && !message) return
    this.lastState = state; this.onState({ state, message })
  }
  touch() {
    clearTimeout(this.idle)
    this.idle = setTimeout(() => this.stop('长时间未说话，麦克风已关闭'), 90000)
    this.idle.unref?.()
  }
  async start() {
    if (this.enabled) return
    const revision = ++this.revision
    this.enabled = true; this.paused = false; this.ignoreUntil = 0
    this.controller = new AbortController()
    this.onLevel?.(0)
    this.state('requesting'); this.touch()
    const timeout = setTimeout(() => { if (revision === this.revision) this.stop('麦克风开启超时，请重试') }, 20000)
    try {
      if (!await this.authorize(true)) throw Object.assign(new Error(), { name: 'NotAllowedError' })
      if (revision !== this.revision) return
      const resource = await this.capture(this.controller.signal, samples => {
        if (!this.enabled || revision !== this.revision || this.paused || this.now() < this.ignoreUntil) return
        this.onLevel?.(samples instanceof Float32Array && samples.length
          ? Math.min(1, Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length) * 8)
          : 0)
        const result = this.vad.push(samples, Boolean(this.guarded?.()))
        if (result.pcm) {
          this.pause(true)
          Promise.resolve(this.onUtterance(result.pcm)).then(result => {
            if (revision !== this.revision) return
            if (!result?.ok) {
              if (['TRANSCRIPTION_FAILED', 'REALTIME_UNAVAILABLE', 'SESSION_UNAVAILABLE', 'CHAT_BUSY'].includes(result?.code)) {
                this.pause(false); this.state('listening', result.message || '这句未发送，请稍后再说一次')
              } else this.stop(result?.message || '语音未发送，请重试')
              return
            }
            // Full duplex: listening resumes at once instead of waiting for the
            // reply to finish, so talking over it can interrupt it.
            this.pause(false)
          }).catch(() => { if (revision === this.revision) this.stop('语音提交失败，请重试') })
        } else {
          if (result.speaking) this.touch()
          this.state(result.speaking ? 'speaking' : 'listening')
        }
      }, () => { if (revision === this.revision) this.stop('麦克风已断开，请检查设备后重试') })
      if (revision !== this.revision) { resource.dispose(); return }
      this.resource = resource; resource.pause(Boolean(this.paused))
      this.state(this.paused ? 'paused' : 'listening')
    } catch (error) {
      if (revision !== this.revision) return
      this.stop(error.name === 'NotAllowedError' ? '无法访问麦克风，请检查 Windows 麦克风权限'
        : error.name === 'NotFoundError' ? '未找到麦克风，请连接录音设备' : '无法开启麦克风，请检查录音设备后重试')
    } finally { clearTimeout(timeout) }
  }
  pause(value) {
    if (!this.enabled || this.paused === value) return
    this.paused = value; this.vad.reset(); this.resource?.pause(value)
    if (value) this.onLevel?.(0)
    else { this.ignoreUntil = this.now() + 400; this.touch() }
    this.state(value ? 'paused' : 'listening')
  }
  stop(message = '') {
    this.enabled = false; this.revision++; this.controller?.abort()
    this.resource?.dispose(); this.resource = null
    this.vad.reset(); clearTimeout(this.idle)
    this.onLevel?.(0)
    Promise.resolve(this.authorize(false)).catch(() => {})
    this.state(message ? 'error' : 'off', message)
  }
}
