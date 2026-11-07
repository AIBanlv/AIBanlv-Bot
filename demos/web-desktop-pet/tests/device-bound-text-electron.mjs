import assert from 'node:assert/strict'
import { showSettings } from './settings-navigation-fixture.mjs'

// Runs against the isolated Electron process; this fixture never contacts DeepSeek.
export async function verifyBoundText({ app, page, pet, billingEvents, providerTexts, send, setBound, waitApplied }) {
  await app.evaluate(() => {
    globalThis.guestTextOriginalFetch = globalThis.fetch
    globalThis.guestTextRequests = []
    globalThis.fetch = (url, options) => {
      if (String(url) === 'https://api.deepseek.com/chat/completions') {
        if (options.headers.Authorization !== 'Bearer guest-text-fixture-key') throw new Error('Unexpected text key')
        globalThis.guestTextRequests.push(JSON.parse(options.body))
        return Promise.resolve(Response.json({ choices: [{ message: { content: `游客文字回复${globalThis.guestTextRequests.length}` } }] }))
      }
      return globalThis.guestTextOriginalFetch(url, options)
    }
    globalThis.fixtureScore = 0
  })
  try {
    setBound(true)
    send({ type: 'bind_success', controllerUserId: 'test-user', tenantId: 'test-tenant' })
    await waitApplied('waner')
    await pet.waitForFunction(async () => (await window.controlDevice.state()).textOnly === true, null, { timeout: 15000 })
    assert.equal(await pet.locator('#chat-microphone').isDisabled(), true)
    const baseline = await app.evaluate(() => globalThis.bootstrapRequests.length)
    const billingCount = billingEvents.length, providerCount = providerTexts.length
    await showSettings(page, 'assistant-heading')
    await page.locator('#assistant-key').fill('guest-text-fixture-key')
    await page.locator('#assistant-save').click()
    await page.waitForFunction(async () => (await window.controlDevice.assistantState())?.configured)
    await page.evaluate(async () => {
      await window.controlDevice.configureAssistant({ enabled: false })
      await window.controlDevice.configureModels({ source: 'deepseek' })
    })
    for (let i = 1; i <= 2; i++) {
      await pet.locator('#chat-text').fill(`游客文字问题${i}`)
      await pet.locator('#chat-send').click()
      await pet.waitForFunction(i => [...document.querySelectorAll('.task-record[data-kind="reply"] p')]
        .some(row => row.textContent === `游客文字回复${i}`), i)
      await pet.waitForFunction(() => document.querySelector('#chat-send').dataset.busy === 'false')
    }
    const requests = await app.evaluate(() => globalThis.guestTextRequests)
    assert.equal(requests.length, 2)
    assert.equal(requests[0].messages[0].role, 'system')
    assert.ok(requests[0].messages[0].content.trim(), 'Persona must precede the bound account message')
    assert.equal(requests[1].messages[0].content, requests[0].messages[0].content)
    assert.ok(requests[1].messages.some(row => row.role === 'user' && row.content === '游客文字问题1'))
    assert.ok(requests[1].messages.some(row => row.role === 'assistant' && row.content === '游客文字回复1'))
    assert.equal(await app.evaluate(() => globalThis.bootstrapRequests.length), baseline)
    assert.equal(billingEvents.length, billingCount)
    assert.equal(providerTexts.length, providerCount)
    assert.equal((await pet.evaluate(() => window.controlDevice.state())).score, 0)
    return { turns: 2, personaFirst: true, historyPreserved: true, realtimeSessions: 0, billingEvents: 0, microphoneDisabled: true }
  } finally {
    await page.locator('#assistant-forget').click()
    await app.evaluate(() => {
      globalThis.fetch = globalThis.guestTextOriginalFetch
      delete globalThis.guestTextOriginalFetch
      delete globalThis.fixtureScore
    })
    setBound(false)
    await page.evaluate(() => window.controlDevice.configureModels({ source: 'platform' }))
    send({ type: 'bind_lost' })
    await page.waitForFunction(() => !document.querySelector('#qr').hidden)
    await pet.waitForFunction(async () => (await window.controlDevice.state()).current?.local === true)
  }
}
