import assert from 'node:assert/strict'
import path from 'node:path'
import { readFile } from 'node:fs/promises'
import { showSettings } from './settings-navigation-fixture.mjs'

export async function verifyMail({ app, page, pet, model, artifacts, AxeBuilder }) {
  const password = 'fixture-mail-code'
  const waitState = async predicate => {
    const deadline = Date.now() + 15000
    let state
    while (Date.now() < deadline) {
      state = await page.evaluate(() => window.controlDevice.mailState())
      if (predicate(state) && await page.locator('#mail-save').isEnabled()) return state
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    assert.fail(`Mailbox state did not settle: ${JSON.stringify(state)}`)
  }
  try {
    assert.equal(await pet.evaluate(() => window.controlDevice.mailState()), null)
    assert.equal((await pet.evaluate(() => window.controlDevice.configureMail({ enabled: true }))).code, 'FORBIDDEN')
    assert.equal((await pet.evaluate(() => window.controlDevice.checkMail())).code, 'FORBIDDEN')
    await app.evaluate(() => {
      globalThis.fixtureMailReads = 0
      globalThis.fixtureMailHighest = 1
      globalThis.fixtureMailNotices = []
      const mail = globalThis.fixtureAssistant.mail
      mail.notify = count => { globalThis.fixtureMailNotices.push(count) }
      mail.withInbox = async (_account, { signal }, work) => {
        signal.throwIfAborted()
        const source = Buffer.from('From: fixture-sender@example.com\r\nTo: fixture@qq.com\r\nSubject: Fixture weekly report\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nFixture mail content: 今天下午三点提交周报。\r\n')
        const client = {
          mailbox: { uidValidity: 77n, uidNext: globalThis.fixtureMailHighest + 1, exists: globalThis.fixtureMailHighest },
          search: async query => query.uid ? [globalThis.fixtureMailHighest] : [1],
          fetchAll: async uids => uids.map(uid => ({ uid,
            envelope: { subject: 'Fixture weekly report', from: [{ address: 'fixture-sender@example.com' }] },
            internalDate: new Date('2026-10-22T01:00:00Z') })),
          fetchOne: async (_uid, query) => {
            globalThis.fixtureMailReads++
            return query.source ? { source } : { size: source.length }
          },
        }
        const result = await work(client)
        signal.throwIfAborted()
        return result
      }
    })

    await showSettings(page, 'mail-heading')
    await page.locator('#mail-provider').selectOption('qq')
    await page.locator('#mail-user').fill('fixture@qq.com')
    assert.equal(await page.locator('#mail-password').getAttribute('type'), 'password')
    await page.locator('#mail-password').fill(password)
    assert.equal(await page.locator('#mail-remember').isChecked(), false)
    assert.equal(await page.locator('#mail-notifications').isChecked(), false)
    await page.locator('#mail-save').click()
    await waitState(state => state.enabled)
    assert.equal(await page.locator('#mail-password').inputValue(), '')
    const settingsFile = await app.evaluate(() => globalThis.fixtureAssistant.mail.settings.file)
    assert.deepEqual(JSON.parse(await readFile(settingsFile, 'utf8')), {})
    const snapshot = await page.evaluate(() => window.controlDevice.mailState())
    assert.doesNotMatch(JSON.stringify(snapshot), /fixture-mail-code|encrypted|password/i)
    assert.equal(await app.evaluate(() => globalThis.fixtureAssistant.mail.settings.credentials().password), password)
    assert.equal(await app.evaluate(() => globalThis.fixtureMailReads), 0)

    await page.locator('#mail-password').focus()
    await page.keyboard.press('Tab')
    assert.equal(await page.locator('#mail-remember').evaluate(element => element === document.activeElement), true)
    await page.locator('#mail-remember').check()
    await page.locator('#mail-save').click()
    await waitState(state => state.remember)
    const stored = await readFile(settingsFile, 'utf8')
    assert.ok(JSON.parse(stored).encrypted)
    assert.doesNotMatch(stored, /fixture-mail-code|fixture@qq\.com/)
    await page.locator('#mail-pause').click()
    await waitState(state => !state.enabled)
    assert.equal((await page.evaluate(() => window.controlDevice.mailState())).configured, true)
    await page.locator('#mail-save').click()
    await waitState(state => state.enabled)

    const submit = async (tool, target, text) => {
      model.tool = tool; model.target = target
      const before = model.requests.length
      await pet.locator('#chat-text').fill(text)
      await pet.locator('#chat-text').press('Enter')
      await pet.waitForFunction(() => !document.querySelector('#chat-text').disabled, null, { timeout: 45000 })
      assert.ok(model.requests.length > before, 'Mail request did not reach the local model fixture')
    }
    await submit('control_mail_list', 'recent', '列出最近的邮件')
    assert.match(JSON.stringify(model.requests.at(-1)), /listed/)
    assert.match(JSON.stringify(model.requests.at(-1)), /Fixture weekly report/)
    const token = await app.evaluate(() => [...globalThis.fixtureAssistant.mail.tokens]
      .find(([, entry]) => entry.kind === 'read')?.[0])
    assert.match(token, /^mail:[a-f0-9]{32}$/)
    assert.equal(await app.evaluate(() => globalThis.fixtureMailReads), 0)

    await app.evaluate(() => { globalThis.fixtureAllow = false })
    await submit('control_mail_read', token, '查看刚才那封邮件')
    assert.match(JSON.stringify(model.requests.at(-1)), /ACTION_DENIED/)
    assert.equal(await app.evaluate(() => globalThis.fixtureMailReads), 0)
    await app.evaluate(() => { globalThis.fixtureAllow = true })
    await submit('control_mail_read', token, '允许后读取这封邮件并总结')
    assert.match(JSON.stringify(model.requests.at(-1)), /Fixture mail content/)
    assert.match(JSON.stringify(model.requests.at(-1)), /今天下午三点提交周报/)
    assert.doesNotMatch(JSON.stringify(model.requests), /fixture-mail-code/)

    // Notification opt-in allows local count checks, without additional model requests.
    const modelRequests = model.requests.length
    await page.locator('#mail-notifications').check()
    await page.locator('#mail-save').click()
    await waitState(state => state.notifications && Boolean(state.lastCheck))
    assert.deepEqual(await app.evaluate(() => globalThis.fixtureMailNotices), [])
    await app.evaluate(() => { globalThis.fixtureMailHighest = 2 })
    const firstCheck = (await page.evaluate(() => window.controlDevice.mailState())).lastCheck
    await page.locator('#mail-check').click()
    await waitState(state => state.lastCheck !== firstCheck)
    assert.deepEqual(await app.evaluate(() => globalThis.fixtureMailNotices), [1])
    const secondCheck = (await page.evaluate(() => window.controlDevice.mailState())).lastCheck
    await page.locator('#mail-check').click()
    await waitState(state => state.lastCheck !== secondCheck)
    assert.deepEqual(await app.evaluate(() => globalThis.fixtureMailNotices), [1])
    assert.equal(model.requests.length, modelRequests)

    for (const width of [320, 768, 1024, 1440]) {
      await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows().find(window =>
        window.webContents.getURL().endsWith('/device/device.html')).setContentSize(width, 800), width)
      await page.locator('#mail-provider').scrollIntoViewIfNeeded()
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
      await page.screenshot({ path: path.join(artifacts, `mail-${width}.png`) })
    }
    const axe = await new AxeBuilder({ page }).setLegacyMode().withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
    assert.deepEqual(axe.violations.map(item => item.id), [])
    await page.locator('#mail-forget').click()
    await waitState(state => !state.configured)
    assert.deepEqual(JSON.parse(await readFile(settingsFile, 'utf8')), {})
    assert.equal(await app.evaluate(() => globalThis.fixtureAssistant.mail.tokens.size), 0)
    return { trustedControllerOnly: true, memoryOnlyDefault: true, encryptedCredentials: true,
      noCredentialDisclosure: true, pauseAndReactivate: true, approvedReadAndSummary: true,
      denial: true, localCountNotifications: true, responsive: true, accessible: true, forget: true }
  } finally {
    model.tool = 'control_open_url'; model.target = 'https://example.com/'
    await app.evaluate(() => { globalThis.fixtureAllow = true })
  }
}
