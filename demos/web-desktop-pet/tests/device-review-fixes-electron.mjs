import assert from 'node:assert/strict'
import { waitForDeviceState } from './device-state-fixture.mjs'

export async function verifyReviewFixes({ app, page, pet, root, bind, rows }) {
  const failures = []
  await page.locator('#binding-tab-keys').click()
  await page.locator('#model-deepseek').fill('fixture-own-deepseek')
  await page.locator('#deepseek-remember').check()
  await page.locator('#model-form button[type="submit"]').click()
  await page.waitForFunction(() => !document.querySelector('#model-form button[type="submit"]').disabled)
  await page.locator('#deepseek-remember').uncheck()
  await page.locator('#model-form button[type="submit"]').click()
  await page.waitForFunction(() => !document.querySelector('#model-form button[type="submit"]').disabled)
  try {
    assert.equal((await page.evaluate(() => window.controlDevice.assistantState())).remember, false)
    assert.equal((await page.evaluate(() => window.controlDevice.assistantState())).configured, true)
    assert.equal(await app.evaluate(async ({ app }) => {
      const fs = process.getBuiltinModule('node:fs/promises'), path = process.getBuiltinModule('node:path')
      const saved = JSON.parse(await fs.readFile(path.join(app.getPath('userData'), 'assistant-settings.json'), 'utf8'))
      return Object.hasOwn(saved, 'encryptedKey')
    }), false, 'unchecking remember must remove the saved credential while keeping the in-process key')
  } catch (error) { failures.push(`remember: ${error.message}`) }

  await page.evaluate(() => window.controlDevice.configureModels({ platformEnabled: true }))
  await page.locator('.settings-nav[data-section="binding"]').click()
  await page.locator('#binding-tab-scan').click()
  await page.waitForFunction(() => !document.querySelector('#qr').hidden)
  bind()
  await waitForDeviceState(pet, value => value.binding === 'bound')
  await app.evaluate(async ({ dialog }, root) => {
    const path = process.getBuiltinModule('node:path')
    const require = process.getBuiltinModule('node:module').createRequire(path.join(root, 'package.json'))
    const { ConversationStore } = require(path.join(root, 'electron/device-conversation-store.mjs'))
    const originalFetch = globalThis.fetch, originalClear = ConversationStore.prototype.clear
    globalThis.fetch = (url, options) => String(url) === 'https://api.deepseek.com/chat/completions'
      ? new Promise(resolve => { globalThis.reviewReleaseReply = () => resolve(Response.json({ choices: [{ message: { content: '清除期间结束的旧回复' } }] })) })
      : originalFetch(url, options)
    dialog.showMessageBox = async () => ({ response: 1 })
    ConversationStore.prototype.clear = async function () {
      const result = await originalClear.call(this)
      globalThis.reviewReleaseReply()
      await new Promise(resolve => setImmediate(resolve))
      await this.queue
      return result
    }
  }, root)
  await pet.locator('#chat-text').fill('清除前已开始的问题')
  await pet.locator('#chat-send').click()
  await app.evaluate(() => new Promise((resolve, reject) => {
    const deadline = Date.now() + 5000
    const check = () => typeof globalThis.reviewReleaseReply === 'function' ? resolve()
      : Date.now() > deadline ? reject(new Error('fixture text request did not start')) : setTimeout(check, 10)
    check()
  }))
  assert.equal((await page.evaluate(() => window.controlDevice.clearHistory())).ok, true)
  await pet.waitForFunction(() => document.querySelector('#chat-send').dataset.busy === 'false')
  try {
    assert.equal((await pet.evaluate(() => window.controlDevice.state())).history.messages, 0)
    assert.equal((await pet.evaluate(() => window.controlDevice.state())).history.pending, 0)
    assert.equal([...rows.values()].some(row => row.text === '清除期间结束的旧回复'), false)
  } catch (error) { failures.push(`clear: ${error.message}`) }
  assert.deepEqual(failures, [])
  console.log('review regressions Electron: blank-key remember removal and clear during an in-flight reply passed')
}
