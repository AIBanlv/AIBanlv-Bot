import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import path from 'node:path'
import { apply } from '../harness-client-plugin/plugin.mjs'

async function waitForValue(read, accept) {
  const deadline = Date.now() + 10000
  while (Date.now() < deadline) {
    const value = await read()
    if (accept(value)) return value
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  assert.fail('Harness state did not settle within 10 seconds')
}
export async function verifyHarnessClient({ app, page, pet, profile, say, errors, artifacts, AxeBuilder, realtimeFixture }) {
  const events = new EventEmitter(), cleanup = [], tasks = []
  let signedIn = true
  const ctx = {
    on: (name, work) => { events.on(name, work); return () => events.off(name, work) },
    effect: work => cleanup.push(work()),
    get: name => ({
      deepseekAccount: { getState: async () => ({ status: signedIn ? 'credential-stored' : 'signed-out' }) },
      llm: { stream: async function* ({ messages }) {
        const text = messages[0].content[0].text
        const output = text.includes('只读任务路由器') ? JSON.stringify(text.includes('最新用户消息') && text.includes('"latestUserMessage":"打开 D 盘"')
          ? { decision: 'task', task: '打开 D 盘', provider: 'desktop', operation: 'create' } : { decision: 'chat' }) : 'Harness 客户端回复'
        yield { type: 'text-delta', text: output }; yield { type: 'finish', reason: { kind: 'stop' } }
      } },
      agents: { create: async options => ({ agent: { cancel() {}, whenIdle: async () => {}, followup(message) {
        tasks.push(message.content[0].text)
        const agent = { session: { id: options.sessionId } }
        events.emit('agent/assistant-stream', { agent, frame: { type: 'start' } })
        events.emit('agent/assistant-stream', { agent, frame: { type: 'chunk', chunk: { type: 'text-delta', text: '客户端已完成 D 盘任务' } } })
        events.emit('agent/assistant-stream', { agent, frame: { type: 'end', outcome: { kind: 'committed', eventType: 'assistant/message' } } })
        events.emit('session/event', agent.session, { type: 'turn/end', data: { reason: { kind: 'completed' } } })
      } }, dispose: async () => {} }) },
    })[name],
  }
  apply(ctx, { connectionFile: path.join(profile, 'harness-connection.json') })
  try {
    const assistantState = () => page.evaluate(() => window.controlDevice.assistantState())
    const state = () => pet.evaluate(() => window.controlDevice.state())
    await waitForValue(assistantState, value => value.source === 'harness-client')
    await page.locator('.settings-nav[data-section="plugins-heading"]').click()
    await page.locator('.plugin-shortcut[data-plugin="assistant-heading"]').click()
    assert.equal(await page.locator('#assistant-form input[type="password"]').count(), 0)
    assert.match(await page.locator('#assistant-source').textContent(), /客户端账号/)
    await page.locator('#assistant-model-settings').click()
    assert.equal(await page.locator('#model-form').isVisible(), true)
    await page.locator('#deepseek-test').click()
    await page.waitForFunction(() => document.querySelector('#model-feedback').textContent.includes('Harness 客户端账号'))
    await say('没有 Key 也能聊天')
    await waitForValue(state, value => value.history.messages === 2)
    await page.locator('#model-deepseek').fill('fixture-own-deepseek')
    await page.locator('#model-form button[type="submit"]').click()
    await page.waitForFunction(() => !document.querySelector('#model-form button[type="submit"]').disabled)
    await say('已有 Key 仍使用客户端')
    await waitForValue(state, value => value.history.messages === 4)
    assert.equal((await app.evaluate(() => globalThis.fixtureRequests)).filter(row => row.url === 'https://api.deepseek.com/chat/completions').length, 0)
    await say('打开 D 盘')
    assert.equal(tasks.length, 1)
    assert.match(tasks[0], /打开 D 盘/)
    await page.locator('.settings-nav[data-section="plugins-heading"]').click()
    await page.locator('.plugin-shortcut[data-plugin="assistant-heading"]').click()
    for (const width of [320, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    }
    assert.deepEqual((await new AxeBuilder({ page }).setLegacyMode().analyze()).violations, [])
    await page.screenshot({ path: path.join(artifacts, 'harness-client.png') })
    signedIn = false; events.emit('deepseek-account/signed-out')
    await waitForValue(assistantState, value => !value.client.signedIn)
    const ownResult = await pet.evaluate(() => window.controlDevice.chat('退出客户端后使用自己的 Key'))
    assert.equal(ownResult.ok, true, JSON.stringify(ownResult))
    assert.equal((await app.evaluate(() => globalThis.fixtureRequests)).filter(row => row.url === 'https://api.deepseek.com/chat/completions').length, 1)
    // Keep a real provider response in flight while the independent Harness
    // account changes. Both explicit Realtime and auto-selected Realtime must
    // retain the same request, connection and reply.
    await pet.evaluate(() => {
      window.fixtureVoiceEvents = []
      window.fixtureVoiceUnsubscribe = window.controlDevice.onConversation(event => {
        window.fixtureVoiceEvents.push({ type: event.type, requestId: event.requestId, text: event.text })
      })
    })
    for (const source of ['realtime', 'auto']) {
      const configured = await page.evaluate(source => window.controlDevice.configureModels({
        source, apiKey: 'fixture-own-realtime', workspaceId: 'fixture-space',
      }), source)
      assert.equal(configured.ok, true, JSON.stringify(configured))
      await waitForValue(state, value => value.models.route === 'realtime' && value.conversationState === 'ready')
      for (const nextSignedIn of [true, false]) {
        await pet.evaluate(() => { window.fixtureVoiceEvents = [] })
        const before = { connections: realtimeFixture.connections, cancellations: realtimeFixture.cancellations,
          messages: (await state()).history.messages }
        realtimeFixture.hold = true
        const submitted = await pet.evaluate(() => window.controlDevice.chat('请继续这轮独立语音回复'))
        assert.equal(submitted.ok, true, JSON.stringify(submitted))
        await waitForValue(() => realtimeFixture.pending.length, value => value === 1)
        const pending = realtimeFixture.pending.shift()
        await pet.waitForFunction(requestId => window.fixtureVoiceEvents.some(event =>
          event.type === 'responding' && event.requestId === requestId), submitted.requestId)
        signedIn = nextSignedIn
        if (!signedIn) events.emit('deepseek-account/signed-out')
        await waitForValue(assistantState, value => value.client.signedIn === nextSignedIn)
        const interrupted = await pet.evaluate(() => window.fixtureVoiceEvents.filter(event =>
          ['reset', 'stopped', 'interrupted', 'error'].includes(event.type)))
        assert.deepEqual(interrupted, [], `${source}: Harness ${signedIn ? 'login' : 'logout'} must preserve the voice turn`)
        assert.equal(realtimeFixture.connections, before.connections, 'Harness state must not reconnect Realtime')
        assert.equal(realtimeFixture.cancellations, before.cancellations, 'Harness state must not cancel the provider response')
        assert.equal(pending.socket.readyState, 1)
        pending.finish(); realtimeFixture.hold = false
        await pet.waitForFunction(requestId => window.fixtureVoiceEvents.some(event =>
          event.type === 'complete' && event.requestId === requestId), submitted.requestId)
        await waitForValue(state, value => value.history.messages === before.messages + 2)
        assert.equal(await pet.evaluate(requestId => window.fixtureVoiceEvents.some(event =>
          event.type === 'assistant' && event.requestId === requestId && event.text === '自有语音回复'), submitted.requestId), true)
        assert.equal(realtimeFixture.connections, before.connections)
      }
    }
    await pet.evaluate(() => { window.fixtureVoiceUnsubscribe(); delete window.fixtureVoiceEvents })
    await page.locator('#assistant-enabled').uncheck()
    await waitForValue(assistantState, value => !value.enabled)
    assert.deepEqual(errors, [])
    console.log('Harness Electron: one Key entry, account chat/test/task, priority over saved Key, logout to new own-Key chat, Realtime/auto voice preserved across Harness login/logout, pause, four widths and axe passed; Host model/agent fixtures only')
  } finally { cleanup.forEach(work => work()) }
}
