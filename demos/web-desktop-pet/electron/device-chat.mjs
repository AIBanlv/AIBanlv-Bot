import { DeviceAudio } from './device-audio.mjs'

const $ = id => document.getElementById(id)

export class DeviceChat {
  constructor({ device, onExpression, onStart }) {
    this.device = device
    this.onStart = onStart
    this.audio = new DeviceAudio({ onExpression })
    this.audioWork = Promise.resolve()
    this.revision = 0
    this.link(false)
    const field = $('chat-text')
    field.addEventListener('compositionstart', () => { this.composing = true })
    field.addEventListener('compositionend', () => { this.composing = false })
    field.addEventListener('input', () => { this.status(''); this.inputs() })
    field.addEventListener('keydown', event => {
      if (event.key !== 'Enter' || event.shiftKey || event.isComposing || this.composing || event.keyCode === 229) return
      event.preventDefault()
      if (!this.busy) $('chat-form').requestSubmit()
    })
    $('chat-form').addEventListener('submit', event => {
      event.preventDefault()
      if (this.busy) { this.onReset?.(); this.device.stopChat() }
      else this.submit()
    })
    device.onConversation(data => this.accept(data))
    device.onStopSpeech(() => this.accept({ type: 'stopped' }))
  }
  status(text, error = false) {
    this.connectionNotice = false
    $('chat-status').textContent = text
    $('chat-status').title = text
    $('chat-status').dataset.state = error ? 'error' : 'idle'
  }
  connectionChanged(state) {
    this.connected = state === 'ready'
    this.link(this.connected && this.ready)
    if (!this.ready || this.busy || $('chat-status').dataset.state === 'error' && !this.connectionNotice) return
    this.status(state === 'error' ? '对话连接失败，发送时将重试' : '', state === 'error')
    this.connectionNotice = state === 'error'
  }
  // Online means one thing only: a conversation is open and the device is ready
  // to use it. Binding, connecting, retrying, a dropped session and a device
  // that is not ready yet are all off, and say so in words next to the dot.
  link(online = false) {
    this.online = Boolean(online)
    const dot = $('chat-link')
    dot.dataset.state = this.online ? 'online' : 'offline'
    dot.title = this.online ? '在线' : '离线'
    dot.setAttribute('aria-label', this.online ? '对话在线' : '对话离线')
  }
  inputs() {
    $('chat-text').disabled = !this.ready || Boolean(this.busy)
    $('chat-send').disabled = !this.busy && (!this.ready || !$('chat-text').value.trim())
    const label = this.busy ? '停止回复' : '发送消息'
    $('chat-send').setAttribute('aria-label', label)
    $('chat-send').title = label
    $('chat-send').dataset.busy = String(Boolean(this.busy))
    $('chat-send-icon').hidden = Boolean(this.busy)
    $('chat-stop-icon').hidden = !this.busy
    this.onInputs?.({ ready: this.ready, busy: this.busy })
  }
  update(ready, reset = false, waiting = '等待形象加载', clearDraft = true) {
    const wasReady = this.ready
    this.ready = ready
    $('chat-text').placeholder = ready ? '说点什么…' : waiting
    if (reset) {
      this.onReset?.()
      this.revision++
      this.active = ''; this.busy = false; this.draft = null
      this.audio.stop()
      if (clearDraft) $('chat-text').value = ''
      // A reset drops the session, so the dot goes off however ready the
      // device itself is; it only comes back when a session reports ready.
      this.link(false)
      this.connected = false
      this.status(ready ? '' : waiting)
    } else if (!ready) { this.connected = false; this.link(false); this.status(waiting) }
    else if (!wasReady && ready) this.status('')
    this.inputs()
  }
  submitTouch(event) { return this.submit(null, 'touch', event) }
  // Full duplex: a spoken interruption replaces the reply instead of being
  // refused. The send button keeps its explicit stop action for typed input.
  async interrupt() {
    if (!this.busy) return { ok: false, code: 'NOT_BUSY', message: '当前没有正在播放的回复' }
    this.revision++
    this.audio.stop()
    this.active = ''
    this.busy = false
    this.status('')
    this.inputs()
    return this.device.interrupt()
  }
  async submit(pcm = null, input = pcm ? 'voice' : 'text', touch = null) {
    const field = $('chat-text')
    if (!this.ready || this.composing || input === 'text' && !field.value.trim()) return
    // Talking over a reply or touching the pet is the interruption; anything
    // else while busy means "stop", which the send button already handles.
    if (this.busy) {
      if (!['voice', 'touch'].includes(input)) return
      await this.interrupt()
      if (!this.ready) return
    }
    const revision = ++this.revision
    // Every reply is played back aloud; the input channel only decides how the
    // message was produced, never whether the role speaks.
    this.spoken = !this.textOnly
    this.draft = input === 'text' ? field.value : null
    this.busy = true; this.inputs(); this.status(this.textOnly ? '正在生成文字回复' : '正在发送')
    try {
      if (this.spoken) await this.audio.prepare()
      if (revision !== this.revision) return
      const result = input === 'touch' ? await this.device.touch(touch) : pcm ? await this.device.voice(pcm) : await this.device.chat(this.draft)
      if (revision !== this.revision) return
      if (!result.ok) {
        this.busy = false
        this.status(result.message || '消息未发送，请重试', true)
      }
      return result
    } catch {
      if (revision === this.revision) {
        this.busy = false
        this.status('无法播放语音，请检查声音设备后重试', true)
      }
    } finally {
      if (revision === this.revision) {
        this.inputs()
        if (!this.busy && $('chat-form').dataset.mode !== 'voice') field.focus()
      }
    }
  }
  accept(data) {
    if (data.type === 'connection') { this.connectionChanged(data.state); return }
    if (data.type === 'preparing') {
      this.active = data.requestId; this.busy = true
      // Every reply is spoken, including ones started elsewhere: text from the
      // Control app and backend reminders never pass through the local submit.
      this.spoken = data.textOnly ? false : true
      this.audio.stop()
      if (this.spoken) this.onStart()
      this.audioWork = this.spoken ? this.audio.prepare().catch(() => {
        if (this.active === data.requestId) this.audioFailure()
      }) : Promise.resolve()
      this.status(data.textOnly ? '正在生成文字回复' : '正在发送')
    } else if (data.type === 'reset') {
      this.update(this.ready, true, '等待形象加载', false)
      return
    } else if (data.type === 'interrupted') {
      // A barge-in clears its own reply before submitting the next one, so this
      // only cleans up an interrupt that landed on a reply still on screen.
      if (data.requestId !== this.active) return
      if (!data.recoverable) this.onReset?.()
      this.revision++
      this.audio.stop(); this.active = ''; this.busy = false
      this.status('')
    } else if (data.type === 'stopped' || data.type === 'error') {
      if (!data.recoverable) this.onReset?.()
      this.revision++
      this.audio.stop(); this.active = ''; this.busy = false
      this.status(data.type === 'error' ? data.message : '已停止', data.type === 'error')
    } else if (data.requestId !== this.active) return
    else if (data.type === 'user') {
      if (!['voice', 'touch'].includes(data.input) && this.draft !== null && $('chat-text').value === this.draft) $('chat-text').value = ''
      this.draft = null
      this.status('正在思考')
    } else if (data.type === 'responding') this.status('正在回复')
    else if (data.type === 'computer') this.status(data.message)
    else if (data.type === 'audio') {
      if (!this.spoken) return
      this.audioWork = this.audioWork.then(() => {
        if (this.active === data.requestId) this.audio.push(data.pcm, data.sampleRate, data.expression)
      }).catch(() => { if (this.active === data.requestId) this.audioFailure() })
    } else if (data.type === 'done') {
      if (data.textOnly || !this.spoken) return
      this.audioWork.then(async () => {
        if (this.active === data.requestId && await this.audio.finish(data.closing) && this.active === data.requestId) {
          this.device.played(data.requestId)
        }
      }).catch(() => this.audioFailure())
    } else if (data.type === 'complete') {
      this.busy = false; this.active = ''
      this.status('')
    }
    this.inputs()
    if (['stopped', 'error', 'complete'].includes(data.type) && $('chat-form').dataset.mode !== 'voice') {
      $('chat-text').focus()
    }
  }
  audioFailure() {
    this.audio.stop()
    this.device.audioFailed()
    this.status('语音播放失败，请检查声音设备', true)
  }
  volume(value) { this.audio.volume(value / 100) }
  dispose() { this.revision++; this.audio.dispose().catch(() => {}) }
}
