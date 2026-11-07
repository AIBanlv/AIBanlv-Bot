import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { devicePetSize, hitDevicePet, chatInputResult, conversationInputResult, CAPTION_HEIGHT, COMPOSER_HEIGHT } from '../electron/device-pet-policy.mjs'
import { petSize } from '../electron/policy.mjs'

test('both composers follow resolved billing access without hiding the avatar or substituting local keys', () => {
  const ready={binding:'bound',connection:'connected',phase:'ready',current:{agentId:'online',source:'online'},score:0}
  assert.equal(conversationInputResult(ready).code,'SCORE_DEPLETED')
  assert.equal(chatInputResult('你好',ready).code,'SCORE_DEPLETED')
  const denied={...ready,models:{route:'',code:'SCORE_DEPLETED',message:'积分不足'}}
  assert.equal(conversationInputResult(denied).ok,false)
  assert.match(conversationInputResult(denied).message,/AIBanlv 手机端充值/)
  assert.match(conversationInputResult(ready).message,/AIBanlv 手机端充值/)
  assert.equal(conversationInputResult({...ready,score:10,models:{route:'platform'}}).ok,true)
  assert.equal(conversationInputResult({...ready,current:{agentId:'local',source:'local'},models:{route:'deepseek'}}).ok,true)
  assert.equal(conversationInputResult({...ready,score:null,models:{route:'',code:'SCORE_PENDING'}}).code,'SCORE_PENDING')
})

test('an old guest avatar cannot permit text input without scan binding', () => {
  assert.equal(chatInputResult('你好', { binding: 'unbound', connection: 'connected', guest: true,
    current: { agentId: 'public' }, phase: 'ready' }).code, 'BIND_REQUIRED')
})
test('a validated public avatar permits guest input without account connection', () => {
  assert.equal(chatInputResult('你好', { binding: 'unbound', connection: 'offline',
    current: { agentId: 'waner', publicAvatar: true }, phase: 'ready' }).ok, true)
})
test('the removed local flag no longer enables guest input', () => {
  assert.equal(chatInputResult('你好', { binding: 'unbound', connection: 'offline',
    current: { agentId: 'local-companion', local: true }, phase: 'ready' }).code, 'BIND_REQUIRED')
})

test('local characters do not require online binding, and mouse passthrough never pauses animation', async () => {
  assert.deepEqual(chatInputResult('你好',{binding:'unbound',connection:'offline',phase:'ready',current:{agentId:'local-fixture',source:'local'}}),{ok:true})
  const pet = await readFile(new URL('../electron/device-pet.mjs',import.meta.url),'utf8')
  assert.match(pet,/next.current\?\.source === 'local'/)
  assert.doesNotMatch(pet,/paused: !visible \|\| clickThrough/)
  const windows = await readFile(new URL('../electron/device-windows.mjs',import.meta.url),'utf8')
  assert.match(windows,/pinned: true, clickThrough: true/)
  assert.doesNotMatch(windows,/if \(this.state.clickThrough \|\| !this.state.visible \|\| !point/)
  for(const width of [300,360,440]) {
    const height=devicePetSize(width).height
    assert.equal(hitDevicePet(width/2,80,width,true,height),false)
    assert.equal(hitDevicePet(width/2,height-30,width,true,height),true)
  }
})

test('the composer replaces the original toolbar without shrinking the avatar', () => {
  for (const width of [300, 360, 440]) {
    const size = devicePetSize(width)
    assert.equal(size.width, width)
    assert.equal(size.height, petSize(width).height - 56 + COMPOSER_HEIGHT)
    assert.equal(size.height - CAPTION_HEIGHT - COMPOSER_HEIGHT, Math.round(width * 1.05))
  }
  assert.throws(() => devicePetSize(460))
})

test('composer, bubbles and figure stay interactive without a toolbar row', () => {
  const width = 300, height = devicePetSize(width).height, avatarHeight = height - CAPTION_HEIGHT - COMPOSER_HEIGHT
  assert.equal(hitDevicePet(150, 280, width, false), true)
  assert.equal(hitDevicePet(150, 280, width, true), false)
  assert.equal(hitDevicePet(150, height - 60, width, true), true)
  assert.equal(hitDevicePet(0, height - 60, width, true), false)
  assert.equal(hitDevicePet(150, 0, width, false), false)
  assert.equal(hitDevicePet(150, avatarHeight + 28, width, true), false, 'The removed toolbar is not a hit target')
  assert.equal(hitDevicePet(150, avatarHeight + 28, width, true, height, true), true)
  assert.equal(hitDevicePet(150, avatarHeight + 76, width, true, height, true), true)
  assert.equal(hitDevicePet(150, avatarHeight + 76, width, true, height, false), false)
  assert.equal(hitDevicePet(150, avatarHeight + 76, width, false, height, false), true,
    'The portrait now extends behind the caption when no bubble is visible')
  assert.equal(hitDevicePet(150, 100, width, false, CAPTION_HEIGHT + COMPOSER_HEIGHT), false)
  assert.equal(hitDevicePet(NaN, height, width, false), false)
})

test('height-clamped windows keep the actual composer and bubbles clickable', () => {
  const width = 380, height = 600
  assert.equal(hitDevicePet(350, 530, width, true, height), true)
  assert.equal(hitDevicePet(130, 400, width, true, height, true), true)
  assert.equal(hitDevicePet(100, 520, width, true, height), true)
  assert.equal(hitDevicePet(190, 270, width, true, height), false)
  assert.equal(hitDevicePet(190, 270, width, false, height), true)
})

test('chat boundary rejects invalid, unbound and unready input without inventing a reply', () => {
  const ready = { binding: 'bound', connection: 'connected', phase: 'ready', current: { agentId: 'a' } }
  for (const value of ['', '  ', {}, 'x'.repeat(1001), 'hello\u0000']) {
    assert.equal(chatInputResult(value, ready).code, 'INVALID_TEXT')
  }
  assert.equal(chatInputResult('hello', { ...ready, binding: 'unbound' }).code, 'BIND_REQUIRED')
  assert.equal(chatInputResult('hello', { ...ready, connection: 'offline' }).code, 'BIND_REQUIRED')
  assert.equal(chatInputResult('hello', { ...ready, phase: 'rendering' }).code, 'AVATAR_NOT_READY')
  assert.equal(chatInputResult('你好\n世界', ready).ok, true)
  assert.equal(chatInputResult('你好', ready).ok, true)
  assert.equal(Object.hasOwn(chatInputResult('你好', ready), 'reply'), false)
})
