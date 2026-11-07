import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { modelFixture } from './assistant-model-fixture.mjs'
import { verifyAssistantActions } from './device-assistant-actions-electron.mjs'
import { verifyMail } from './device-mail-electron.mjs'
import { showSettings } from './settings-navigation-fixture.mjs'

export async function verifyAssistant({ app, page, pet, root, artifacts, userData, AxeBuilder,
  toolOutputs, providerConfigs, setMode }) {
  const model = await modelFixture()
  try {
    assert.equal(await pet.evaluate(() => window.controlDevice.assistantState()), null)
    assert.equal((await pet.evaluate(() => window.controlDevice.configureAssistant({ enabled: true }))).code, 'FORBIDDEN')
    assert.equal(await page.locator('#assistant-enabled, #assistant-directory, #assistant-browse').count(), 0)
    assert.equal(await page.evaluate(() => typeof window.controlDevice.chooseAssistantDirectory), 'undefined')
    await showSettings(page, 'assistant-heading')
    await page.locator('#assistant-save').click()
    await page.waitForFunction(() => document.querySelector('#assistant-status').textContent.includes('填写'))
    await page.locator('#assistant-key').fill('fixture-deepseek-key')
    await page.locator('#assistant-save').click()
    await page.waitForFunction(() => document.querySelector('#assistant-status').textContent.includes('已开启'))
    assert.deepEqual(JSON.parse(await readFile(path.join(userData, 'assistant-settings.json'), 'utf8')), {})
    assert.equal(await page.locator('#assistant-key').inputValue(), '')
    await page.locator('#assistant-key').focus()
    await page.keyboard.press('Tab')
    assert.equal(await page.locator('#assistant-remember').evaluate(element => element === document.activeElement), true)
    await page.locator('#assistant-remember').check()
    await page.locator('#assistant-save').click()
    await page.waitForFunction(() => document.querySelector('#assistant-status').textContent.includes('已开启'))
    const stored = await readFile(path.join(userData, 'assistant-settings.json'), 'utf8')
    assert.ok(JSON.parse(stored).encryptedKey)
    assert.doesNotMatch(stored, /fixture-deepseek-key/)
    assert.doesNotMatch(JSON.stringify(await page.evaluate(() => window.controlDevice.assistantState())), /fixture-deepseek-key|encryptedKey/)
    // Patch only this isolated Electron test process; production has no model URL/approval bypass.
    await app.evaluate(async ({ app, shell, dialog }, { base, sourceEntry }) => {
      const path = process.getBuiltinModule('node:path')
      const { readFile } = process.getBuiltinModule('node:fs/promises')
      const require = process.getBuiltinModule('node:module').createRequire(path.join(sourceEntry, 'device-main.mjs'))
      const entry = app.isPackaged ? path.dirname(path.join(app.getAppPath(),
        JSON.parse(await readFile(path.join(app.getAppPath(), 'package.json'), 'utf8')).main)) : sourceEntry
      const { AssistantService } = require(path.join(entry, 'device-assistant-service.mjs'))
      const original = AssistantService.prototype.perform
      AssistantService.prototype.perform = function (...args) {
        globalThis.fixtureAssistant = this
        this.resolveHost = async () => [{ address: '8.8.8.8', family: 4 }]
        if (!this.fixturePatched) {
          this.fixturePatched = true
          const prepare = this.launchFactory
          this.launchFactory = async options => {
            const launch = await prepare(options); launch.env.DEEPSEEK_BASE_URL = base; return launch
          }
        }
        return original.apply(this, args)
      }
      globalThis.fixtureApprovals = []; globalThis.fixtureOpened = []; globalThis.fixtureAllow = true
      shell.openExternal = async target => { globalThis.fixtureOpened.push(target) }
      dialog.showMessageBox = async (_window, options) => {
        globalThis.fixtureApprovals.push({ detail: options.detail, defaultId: options.defaultId, cancelId: options.cancelId })
        return { response: globalThis.fixtureAllow ? 1 : 0 }
      }
    }, { base: model.base, sourceEntry: path.join(root, 'electron') })
    setMode(true)
    const submit = async () => {
      await pet.locator('#chat-text').fill('请打开测试网页')
      await pet.locator('#chat-text').press('Enter')
    }
    await submit()
    await pet.waitForFunction(() => !document.querySelector('#chat-text').disabled, null, { timeout: 45000 })
    assert.equal(toolOutputs.at(-1) && JSON.parse(toolOutputs.at(-1).output).ok, true,
      JSON.stringify({ output: toolOutputs.at(-1), modelRequests: model.requests.length,
        state: await page.evaluate(() => window.controlDevice.assistantState()),
        patched: await app.evaluate(() => Boolean(globalThis.fixtureAssistant)) }))
    assert.ok(providerConfigs.some(config => config.tools?.some(tool => tool.function?.name === 'computer_task')))
    assert.deepEqual(providerConfigs.at(-1).tools, [], 'Realtime narrates the Harness result without repeating tools')
    assert.deepEqual(await app.evaluate(() => globalThis.fixtureOpened), ['https://example.com/'])
    const firstSession = await app.evaluate(() => globalThis.fixtureAssistant.process.sessionId)
    assert.equal(await app.evaluate(() => globalThis.fixtureAssistant.process.launch.command === process.execPath), true)
    const approvals = await app.evaluate(() => globalThis.fixtureApprovals)
    assert.match(approvals[0].detail, /https:\/\/example.com\//)
    assert.equal(approvals[0].defaultId, 0)
    const voiceOutputs = toolOutputs.length
    assert.equal(await pet.evaluate(() => window.controlDevice.microphone(true)), true)
    assert.equal((await pet.evaluate(() => window.controlDevice.voice(new Uint8Array(16000)))).ok, true)
    await pet.waitForFunction(() => !document.querySelector('#chat-text').disabled, null, { timeout: 45000 })
    await pet.evaluate(() => window.controlDevice.microphone(false))
    assert.equal(toolOutputs.length, voiceOutputs + 1)
    assert.equal(JSON.parse(toolOutputs.at(-1).output).ok, true)
    assert.equal(await app.evaluate(() => globalThis.fixtureAssistant.process.sessionId), firstSession)
    const actions = await verifyAssistantActions({ app, pet, model, userData, artifacts, root, AxeBuilder })
    const mail = await verifyMail({ app, page, pet, model, userData, artifacts, root, AxeBuilder })
    await submit()
    await pet.waitForFunction(() => !document.querySelector('#chat-text').disabled, null, { timeout: 45000 })
    const currentSession = await app.evaluate(() => globalThis.fixtureAssistant.process.sessionId)
    const opened = (await app.evaluate(() => globalThis.fixtureOpened)).length
    await app.evaluate(() => { globalThis.fixtureAllow = false })
    await submit()
    await pet.waitForFunction(() => !document.querySelector('#chat-text').disabled, null, { timeout: 30000 })
    assert.match(JSON.stringify(model.requests.at(-1)), /ACTION_DENIED|你已拒绝此操作/)
    assert.equal(await app.evaluate(() => globalThis.fixtureAssistant.process.sessionId), currentSession)
    assert.equal((await app.evaluate(() => globalThis.fixtureOpened)).length, opened)
    model.hold = true
    const before = model.requests.length
    await submit()
    const deadline = Date.now() + 15000
    while (model.requests.length === before) {
      assert.ok(Date.now() < deadline, 'Harness did not reach loopback model')
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    await pet.locator('#chat-send').click()
    await pet.waitForFunction(() => !document.querySelector('#chat-text').disabled)
    await app.evaluate(async () => { await globalThis.fixtureAssistant.reset() })
    assert.deepEqual(await readdir(path.join(userData, 'assistant')), ['routing'])
    assert.deepEqual(await readdir(path.join(userData, 'assistant', 'routing')), [])
    setMode(false)
    await showSettings(page, 'assistant-heading')
    await page.locator('#assistant-forget').click()
    await page.waitForFunction(() => document.querySelector('#assistant-status').textContent === '未开启')
    assert.equal((await page.evaluate(() => window.controlDevice.assistantState())).configured, false)
    assert.deepEqual(JSON.parse(await readFile(path.join(userData, 'assistant-settings.json'), 'utf8')), {})
    // Re-save with explicit encryption to cover restart in the full suite.
    await page.locator('#assistant-key').fill('fixture-deepseek-key')
    await page.locator('#assistant-remember').check()
    await page.locator('#assistant-save').click()
    await page.waitForFunction(() => document.querySelector('#assistant-status').textContent.includes('已开启'))
    for (const width of [320, 768, 1024, 1440]) {
      await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows().find(win => win.webContents.getURL().endsWith('/device/device.html')).setContentSize(width, 800), width)
      await page.locator('#assistant-heading').scrollIntoViewIfNeeded()
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
      await page.screenshot({ path: path.join(artifacts, `assistant-${width}.png`) })
    }
    const axe = await new AxeBuilder({ page }).setLegacyMode().withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
    assert.deepEqual(axe.violations.map(item => item.id), [])
    assert.deepEqual(model.unexpected, [])
    return { encryptedKey: true, memoryOnlyDefault: true, trustedControllerOnly: true, embeddedHarness: true, loopbackModel: true,
      exactTargetApproval: true, textAndVoice: true, denial: true, sessionReuse: true, cancelAndCleanup: true, responsive: true, actions, mail }
  } finally { setMode(false); await model.close() }
}
