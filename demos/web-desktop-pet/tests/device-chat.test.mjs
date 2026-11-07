import test from 'node:test'
import assert from 'node:assert/strict'
import { DeviceChat } from '../electron/device-chat.mjs'
import { DeviceActivity } from '../electron/device-activity.mjs'

test('unavailable conversation disables typing and sending, retaining draft until credits recover', t => {
  const f=setup(t);f.field.value='保留尚未发送的内容'
  f.chat.update(false,false,'平台积分不足，请充值后继续对话')
  assert.equal(f.field.disabled,true);assert.match(f.field.placeholder,/积分不足/)
  assert.equal(document.getElementById('chat-send').disabled,true)
  f.chat.update(true)
  assert.equal(f.field.disabled,false);assert.equal(document.getElementById('chat-send').disabled,false)
  assert.equal(f.field.value,'保留尚未发送的内容')
  f.chat.busy=true;f.chat.update(false,false,'平台积分不足')
  assert.equal(document.getElementById('chat-send').disabled,false,'Stopping an existing reply never requires credits')
})

test('text-only fallback skips audio preparation and finishes without a playback receipt', async t => {
  const f = setup(t)
  f.chat.textOnly = true
  f.chat.audio = { prepare() { throw new Error('must not prepare') }, stop() {} }
  f.field.value = '文字继续'
  await f.chat.submit()
  assert.equal(f.sends, 1)
  const activity = new DeviceActivity()
  t.after(() => activity.clear())
  const accept = event => { activity.conversation(event, '当前角色'); f.chat.accept(event) }
  accept({ type: 'preparing', requestId: 'free', textOnly: true, spoken: false })
  accept({ type: 'user', requestId: 'free', input: 'text', text: '文字继续' })
  accept({ type: 'assistant', requestId: 'free', text: '继续陪你' })
  accept({ type: 'done', requestId: 'free', textOnly: true })
  accept({ type: 'complete', requestId: 'free' })
  assert.equal(f.chat.busy, false)
  assert.deepEqual(activity.snapshot().rows.map(row => [row.source, row.text]), [['我', '文字继续'], ['当前角色', '继续陪你']])
  assert.equal(document.getElementById('conversation').children.length, 0, 'Text fallback uses the same activity feed, not removed speech bubbles')
})

function setup(t) {
  const elements = new Map()
  class Element extends EventTarget {
    constructor(tag = 'div') { super(); this.tag = tag }
    value = ''
    dataset = {}
    textContent = ''
    attributes = {}
    children = []
    setAttribute(key, value) { this.attributes[key] = value }
    append(...children) { for (const child of children) { child.parent = this; this.children.push(child) } }
    replaceChildren() { for (const child of [...this.children]) child.remove() }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this) }
    querySelector(tag) { return this.children.find(child => child.tag === tag) }
    focus() { if (!this.disabled) document.activeElement = this }
  }
  const previous = globalThis.document
  globalThis.document = { createElement: tag => new Element(tag), getElementById: id => {
    if (!elements.has(id)) elements.set(id, new Element())
    return elements.get(id)
  } }
  t.after(() => { globalThis.document = previous })
  let sends = 0, voices = 0, touches = 0, release, pause = () => {}
  const chat = new DeviceChat({ device: {
    onStopSpeech(callback) { pause = callback },
    onConversation() {}, chat: async () => { sends++; return { ok: true } },
    voice: async () => { voices++; return { ok: true } },
    touch: async () => { touches++; return { ok: true } },
  }, onStart() {}, onLevel() {} })
  chat.audio = { prepare: () => new Promise(resolve => { release = resolve }), stop() {} }
  chat.update(true)
  return { chat, field: document.getElementById('chat-text'), get sends() { return sends }, get voices() { return voices }, get touches() { return touches }, release: () => release(), pause: () => pause() }
}

test('background connection stays interactive and a warm first send never shows connecting', async t => {
  const f = setup(t)
  f.chat.update(true, true)
  f.chat.accept({ type: 'connection', state: 'connecting' })
  assert.equal(f.chat.busy, false)
  assert.equal(f.field.disabled, false)
  f.chat.accept({ type: 'connection', state: 'ready' })
  f.field.value = 'first message'
  const pending = f.chat.submit()
  assert.equal(document.getElementById('chat-status').textContent, '正在发送')
  f.release(); await pending
  f.chat.accept({ type: 'preparing', requestId: 'first' })
  assert.equal(f.chat.active, 'first')
  assert.equal(document.getElementById('chat-status').textContent, '正在发送')
  f.release()
})

test('background connection failures preserve the draft and never replace a turn error', t => {
  const f = setup(t)
  f.chat.update(true, true)
  f.field.value = 'draft'
  f.chat.accept({ type: 'connection', state: 'error' })
  assert.equal(f.field.disabled, false)
  assert.equal(f.field.value, 'draft')
  f.chat.accept({ type: 'error', message: 'real turn error' })
  f.chat.accept({ type: 'connection', state: 'ready' })
  assert.equal(document.getElementById('chat-status').textContent, 'real turn error')
})

test('touch requests spoken replies without consuming the text draft or using the microphone', async t => {
  const f = setup(t)
  f.chat.update(true, true)
  f.field.value = '保留文本草稿'
  const pending = f.chat.submitTouch()
  f.release(); await pending
  assert.equal(f.touches, 1)
  assert.equal(f.sends, 0)
  assert.equal(f.voices, 0)
  f.chat.active = 'touch-turn'
  f.chat.accept({ type: 'user', requestId: 'touch-turn', input: 'touch', text: '轻轻抚摸了数字人' })
  assert.equal(f.field.value, '保留文本草稿')
  assert.equal(document.getElementById('conversation').children.length, 0)
  f.chat.accept({ type: 'assistant', requestId: 'touch-turn', text: '[微笑]谢谢你陪着我。' })
  assert.equal(document.getElementById('conversation').children.length, 0, 'The audio/input controller must not create a second transcript')
})

test('voice uses the audio bridge and the user transcription preserves an unfinished text draft', async t => {
  const f = setup(t)
  f.field.value = '文字草稿'
  const pending = f.chat.submit(new Uint8Array(16000))
  f.release(); await pending
  assert.equal(f.voices, 1)
  assert.equal(f.sends, 0)
  f.chat.active = 'voice-turn'
  f.chat.accept({ type: 'user', requestId: 'voice-turn', text: '识别出的语音', input: 'voice' })
  assert.equal(f.field.value, '文字草稿')
})

test('typed messages also play the spoken reply and prepare playback first', async t => {
  const f = setup(t)
  f.field.value = '只发文字'
  let prepares = 0
  const pushed = []
  f.chat.audio = { prepare: async () => { prepares++ }, stop() {}, finish: async () => true,
    push: (...args) => pushed.push(args) }
  await f.chat.submit()
  assert.equal(f.sends, 1)
  assert.equal(prepares, 1, 'A typed reply is spoken, so playback is prepared')
  f.chat.active = 'text-turn'
  f.chat.accept({ type: 'audio', requestId: 'text-turn', pcm: 'AAAA', sampleRate: 24000 })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(pushed.length, 1, 'A typed turn plays the provider audio')
})

test('stop while audio is preparing prevents the deferred voice submission from reaching the service', async t => {
  const f = setup(t)
  f.field.value = 'keep my draft'
  const pending = f.chat.submit(new Uint8Array(16000))
  f.chat.accept({ type: 'stopped' })
  f.release()
  await pending
  assert.equal(f.voices, 0)
  assert.equal(f.field.value, 'keep my draft')
  assert.equal(f.chat.busy, false)
})

test('native pause invalidates a pending text submission before a turn exists and preserves its draft', async t => {
  const f = setup(t)
  f.field.value = 'do not submit after hiding'
  const pending = f.chat.submit()
  f.pause()
  f.release()
  await pending
  assert.equal(f.sends, 0)
  assert.equal(f.chat.busy, false)
  assert.equal(f.field.value, 'do not submit after hiding')
  f.chat.update(true)
  assert.equal(f.sends, 0, 'Showing the window must not replay a cancelled draft')
})

test('idle session reset clears private conversation but retains an unsent draft', t => {
  const f = setup(t)
  f.field.value = 'still typing'
  f.chat.accept({ type: 'reset' })
  assert.equal(f.field.value, 'still typing')
  f.chat.update(false, true)
  assert.equal(f.field.value, '', 'A role/binding context change must clear its private draft')
})

test('completion and errors enable the field before restoring its focus', t => {
  const f = setup(t)
  f.chat.active = 'turn'; f.chat.busy = true; f.chat.inputs()
  f.chat.accept({ type: 'error', requestId: 'turn', message: 'offline' })
  assert.equal(f.field.disabled, false)
  assert.equal(document.activeElement, f.field)
})

test('recoverable ASR and connection errors keep microphone capture while explicit reset still stops it', t => {
  const { chat } = setup(t)
  let resets = 0
  chat.onReset = () => resets++
  chat.active = 'voice'; chat.busy = true
  chat.accept({ type: 'interrupted', requestId: 'voice', recoverable: true })
  chat.accept({ type: 'error', requestId: 'voice', recoverable: true, message: '请直接再说一次' })
  assert.equal(resets, 0)
  assert.equal(chat.busy, false)
  assert.equal(document.getElementById('chat-status').textContent, '请直接再说一次')
  chat.accept({ type: 'reset' })
  assert.equal(resets, 1)
})

test('one dot answers whether the conversation is online, leaving the line for words', t => {
  const { chat } = setup(t)
  const dot = document.getElementById('chat-link'), line = document.getElementById('chat-status')
  assert.equal(chat.online, false)
  assert.equal(dot.dataset.state, 'offline')
  assert.equal(dot.attributes['aria-label'], '对话离线')
  // Connecting is not online yet.
  chat.accept({ type: 'connection', state: 'connecting' })
  assert.equal(dot.dataset.state, 'offline')
  assert.equal(line.textContent, '')
  // A session only counts once the device is ready to use it.
  chat.accept({ type: 'connection', state: 'ready' })
  assert.equal(dot.dataset.state, 'online')
  assert.equal(dot.title, '在线')
  assert.equal(dot.attributes['aria-label'], '对话在线')
  assert.equal(line.textContent, '', 'the dot replaces the old 对话已连接 line')
  // A dropped session switches it straight back off.
  chat.accept({ type: 'connection', state: 'error' })
  assert.equal(dot.dataset.state, 'offline')
  assert.equal(line.textContent, '对话连接失败，发送时将重试')
  // Neither losing the avatar nor getting it back opens a session by itself.
  chat.accept({ type: 'connection', state: 'ready' })
  chat.update(false)
  assert.equal(dot.dataset.state, 'offline')
  chat.update(true)
  assert.equal(dot.dataset.state, 'offline')
  // A reset drops the session, so the dot goes off even while ready.
  chat.accept({ type: 'connection', state: 'ready' })
  assert.equal(dot.dataset.state, 'online')
  chat.update(true, true)
  assert.equal(dot.dataset.state, 'offline')
})

test('speaking over a reply interrupts it and sends the interruption instead of refusing it', async t => {
  const f = setup(t)
  let interrupts = 0
  f.chat.device.interrupt = async () => { interrupts++; return { ok: true } }
  f.chat.accept({ type: 'connection', state: 'ready' })
  f.chat.accept({ type: 'preparing', requestId: 'first-reply' })
  assert.equal(f.chat.busy, true)
  const pending = f.chat.submit(new Uint8Array(16000))
  await new Promise(resolve => setImmediate(resolve))
  f.release(); await pending
  assert.equal(interrupts, 1)
  assert.equal(f.voices, 1)
  assert.equal(f.sends, 0)
  assert.equal(f.chat.busy, true)
  // The interruption is what the send button would have stopped; it must not
  // also be reported as a finished reply.
  assert.equal(document.getElementById('chat-status').textContent, '正在发送')
})

test('typed input keeps the explicit stop action instead of interrupting', async t => {
  const f = setup(t)
  let interrupts = 0
  f.chat.device.interrupt = async () => { interrupts++; return { ok: true } }
  f.chat.accept({ type: 'preparing', requestId: 'first-reply' })
  f.field.value = '打断一下'
  await f.chat.submit()
  assert.equal(interrupts, 0)
  assert.equal(f.sends, 0)
  assert.equal(f.voices, 0)
  assert.equal(f.chat.busy, true)
})

test('an interrupt that lands on another reply leaves the screen alone', async t => {
  const f = setup(t)
  f.chat.accept({ type: 'preparing', requestId: 'first-reply' })
  f.chat.accept({ type: 'interrupted', requestId: 'someone-else' })
  assert.equal(f.chat.busy, true)
  assert.equal(f.chat.active, 'first-reply')
  f.chat.accept({ type: 'interrupted', requestId: 'first-reply' })
  assert.equal(f.chat.busy, false)
  assert.equal(f.chat.active, '')
})

test('touching the pet interrupts the reply it was talking over', async t => {
  const f = setup(t)
  let interrupts = 0
  f.chat.device.interrupt = async () => { interrupts++; return { ok: true } }
  f.chat.accept({ type: 'preparing', requestId: 'first-reply' })
  const pending = f.chat.submitTouch({ gesture_type: 'GENTLE_STROKE' })
  await new Promise(resolve => setImmediate(resolve))
  f.release(); await pending
  assert.equal(interrupts, 1)
  assert.equal(f.touches, 1)
})

test('a reply started elsewhere is spoken and shown even though nothing was typed here', async t => {
  const f = setup(t)
  const pushed = []
  let prepares = 0
  f.chat.audio = { prepare: async () => { prepares++ }, stop() {}, finish: async () => true,
    push: (...args) => pushed.push(args) }
  assert.equal(f.chat.spoken, undefined)
  f.chat.accept({ type: 'preparing', requestId: 'remote', spoken: true })
  assert.equal(f.chat.spoken, true, 'A turn started by the app or a reminder is still spoken aloud')
  assert.equal(f.chat.busy, true)
  f.chat.accept({ type: 'user', requestId: 'remote', text: '手机端发的提问', input: 'text' })
  f.chat.accept({ type: 'assistant', requestId: 'remote', text: '我在听' })
  assert.equal(document.getElementById('conversation').children.length, 0, 'Remote replies use the shared task log too')
  f.chat.accept({ type: 'audio', requestId: 'remote', pcm: 'AAAA', sampleRate: 24000 })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(pushed.length, 1)
  assert.equal(prepares, 1)
})

test('connection changes update the online dot during replies without replacing turn status', t => {
  const { chat } = setup(t)
  chat.active = 'turn'; chat.busy = true
  chat.status('正在回复')
  chat.accept({ type: 'connection', state: 'ready' })
  assert.equal(document.getElementById('chat-link').dataset.state, 'online')
  chat.accept({ type: 'connection', state: 'idle' })
  assert.equal(document.getElementById('chat-link').dataset.state, 'offline')
  assert.equal(document.getElementById('chat-status').textContent, '正在回复')
})
