import { DeviceMicrophone } from './device-microphone.mjs'
import { installVoiceWaveform } from './device-waveform.mjs'

export function installVoiceInput(chat, device) {
  let available = true
  const form = document.getElementById('chat-form')
  const button = document.getElementById('chat-microphone')
  const status = document.getElementById('microphone-status')
  const waveform = installVoiceWaveform(document.getElementById('chat-waveform'),
    document.getElementById('chat-waveform-canvas'))
  const labels = { off: '麦克风关闭', requesting: '正在开启麦克风', listening: '正在收音',
    speaking: '正在听你说话', paused: '正在发送，收音暂停', error: '麦克风异常' }
  const microphone = new DeviceMicrophone({
    authorize: enabled => device.microphone(enabled),
    onLevel: value => waveform.level(value),
    // The pet's own voice is in the room while it answers, so an interruption
    // has to sound like a person talking over it, not like the echo of itself.
    guarded: () => Boolean(chat.audio?.speaking),
    onState({ state, message }) {
      const active = !['off', 'error'].includes(state)
      form.dataset.mode = active ? 'voice' : 'text'
      waveform.setActive(active)
      button.dataset.state = state
      button.setAttribute('aria-pressed', String(active))
      button.setAttribute('aria-label', active ? '关闭麦克风' : '开启麦克风')
      button.title = active ? `${labels[state]}，点击关闭` : message || '开启麦克风，直接语音对话'
      status.textContent = message || (state === 'off' ? '' : labels[state])
      status.title = status.textContent
      status.dataset.state = state
      button.disabled = !available || !chat.ready || chat.busy && !active
    },
    onUtterance: pcm => chat.submit(pcm),
  })
  const stop = () => { if (microphone.enabled) microphone.stop() }
  chat.onReset = stop
  chat.onInputs = ({ ready, busy }) => {
    if (!available || !ready) stop()
    button.disabled = !available || !ready || busy && !microphone.enabled
  }
  button.addEventListener('click', () => {
    if (microphone.enabled) stop()
    else if (available && chat.ready && !chat.busy) {
      microphone.start()
      const revision = microphone.revision
      chat.audio.prepare().catch(() => {
        if (microphone.enabled && microphone.revision === revision) microphone.stop('无法准备语音播放，请检查声音设备')
      })
    }
  })
  const visibility = () => { if (document.hidden) stop() }
  document.addEventListener('visibilitychange', visibility)
  return { stop, setAvailable(value, reason) {
    const previous = available
    available = value
    if (!available) stop()
    button.disabled = !available || !chat.ready || chat.busy && !microphone.enabled
    if (!available) button.title = reason || '当前角色不支持语音，请检查模型配置'
    else if (!previous) button.title = '开启麦克风，直接语音对话'
  }, dispose() { stop(); document.removeEventListener('visibilitychange', visibility) } }
}
