import assert from 'node:assert/strict'
import test from 'node:test'
import { installVoiceInput } from '../electron/device-voice.mjs'

test('text only mode keeps microphone disabled across input updates and blocks capture', t => {
  class Element extends EventTarget {
    dataset = {}
    setAttribute() {}
    getContext() { return null }
  }
  const nodes = new Map()
  const oldDocument = globalThis.document
  globalThis.document = Object.assign(new EventTarget(), { getElementById(id) {
    if (!nodes.has(id)) nodes.set(id, new Element())
    return nodes.get(id)
  } })
  let authorizations = 0
  const chat = { ready: true, busy: false }
  const voice = installVoiceInput(chat, { microphone: () => { authorizations++ } })
  t.after(() => { voice.dispose(); globalThis.document = oldDocument })
  const button = nodes.get('chat-microphone')
  voice.setAvailable(false)
  chat.onInputs({ ready: true, busy: false })
  assert.equal(button.disabled, true)
  button.dispatchEvent(new Event('click'))
  assert.equal(authorizations, 0)
  assert.doesNotMatch(button.title,/积分已用尽|继续使用文字/)
  voice.setAvailable(false,'平台积分不足，请到 AIBanlv 手机端充值后继续对话')
  assert.match(button.title,/AIBanlv 手机端充值/)
  voice.setAvailable(true)
  assert.equal(button.disabled, false)
  assert.doesNotMatch(button.title,/充值/)
})
