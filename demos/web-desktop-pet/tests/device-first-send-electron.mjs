import assert from 'node:assert/strict'
import path from 'node:path'

export async function verifyFirstSend({ page, pet, artifacts, providerTexts, billingEvents, send, setBound }) {
  const state = () => pet.evaluate(() => window.controlDevice.state())
  const waitReady = async () => {
    const deadline = Date.now() + 60000
    for (;;) {
      const value = await state()
      if (value.speechReady && value.conversationState === 'ready') return
      assert.ok(Date.now() < deadline, 'Local engine and realtime must warm automatically')
      await new Promise(resolve => setTimeout(resolve, 25))
    }
  }
  const warmStarted = performance.now()
  await waitReady()
  const backgroundWaitMs = performance.now() - warmStarted
  assert.equal(providerTexts.length, 0)
  assert.equal(billingEvents.some(e => e.eventType === 'usage'), false)
  assert.equal(await page.locator('#voice').count(), 0)
  assert.equal(await page.locator('#catalog-status').isHidden(), true)
  assert.equal(await pet.locator('#chat-microphone').getAttribute('aria-pressed'), 'false')
  await page.screenshot({ path: path.join(artifacts, 'first-send-settings.png') })
  await pet.locator('#chat-text').fill('第一条消息')
  const started = performance.now()
  await pet.locator('#chat-text').press('Enter')
  const deadline = Date.now() + 1500
  while (!providerTexts.length) {
    assert.ok(Date.now() < deadline, 'The warm first message must not reload the model')
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  const sendMs = performance.now() - started
  assert.ok(sendMs < 1500)
  await pet.waitForFunction(() => window.fixtureAudioSources.some(source => source.buffer?.length > 0), null, { timeout: 10000 })
  const firstAudioMs = performance.now() - started
  await pet.waitForFunction(() => !document.querySelector('#chat-text').disabled, null, { timeout: 20000 })
  assert.equal((await state()).speechReady, true)
  await page.locator('#visible').uncheck()
  assert.equal((await state()).speechReady, false)
  await page.locator('#visible').check()
  await waitReady()
  setBound(false); send({ type: 'bind_lost' })
  await page.waitForFunction(() => !document.querySelector('#qr').hidden)
  assert.equal((await state()).speechReady, false)
  return { backgroundWaitMs, sendMs, firstAudioMs, noAutomaticGeneration: true,
    originalLamAudio: true, hiddenReleasesEngine: true, showWarmsAgain: true,
    unbindCancelsWarmup: true, routineHintsRemoved: true }
}
