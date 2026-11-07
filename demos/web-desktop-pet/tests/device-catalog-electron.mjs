import assert from 'node:assert/strict'
import path from 'node:path'
import { showSettings } from './settings-navigation-fixture.mjs'

export async function verifyCatalog({ app, page, pet, artifacts, send, waitApplied, AxeBuilder,
  providerTexts, billingEvents, setBound }) {
  const ready = () => page.waitForFunction(() => document.querySelector('#roles option[value="catalog-private-a"]') &&
    !document.querySelector('#catalog-refresh').disabled)
  const options = () => page.locator('#roles option').evaluateAll(nodes => nodes.map(node => node.value))
  await ready()
  for (const id of ['catalog-private-a', 'catalog-shared', 'catalog-public']) assert.ok((await options()).includes(id))
  for (const id of ['catalog-other-user', 'catalog-other-tenant']) assert.equal((await options()).includes(id), false)
  assert.deepEqual(await app.evaluate(() => globalThis.catalogRequests), [{ tenantId: 'test-tenant', method: 'GET' }])
  await showSettings(page, 'role-controls')
  await page.locator('#roles').selectOption('catalog-private-a')
  await waitApplied('catalog-private-a')
  assert.equal((await pet.evaluate(() => window.controlDevice.state())).current.voiceId, 'longanqian')
  assert.equal(await page.locator('#voice').count(), 0)
  assert.equal(await page.locator('#catalog-status').isHidden(), true)
  assert.equal((await pet.evaluate(() => window.controlDevice.state())).current.agentName, 'catalog-private-a')
  await page.locator('#roles').focus()
  await page.keyboard.press('Home')
  await page.keyboard.press('c')
  // Use the native select change path for a public role never sent by a phone.
  await page.locator('#roles').selectOption('catalog-public')
  await waitApplied('catalog-public')
  assert.equal((await pet.evaluate(() => window.controlDevice.state())).current.agentId, 'catalog-public')
  const before = (await pet.evaluate(() => window.controlDevice.state())).current.agentId
  await pet.evaluate(() => window.controlDevice.select('catalog-private-a'))
  await page.waitForTimeout(100)
  assert.equal((await pet.evaluate(() => window.controlDevice.state())).current.agentId, before,
    'The pet renderer cannot select a role')
  await page.evaluate(() => window.controlDevice.select('catalog-other-user'))
  await page.waitForTimeout(100)
  assert.equal((await pet.evaluate(() => window.controlDevice.state())).current.agentId, before)
  await app.evaluate(() => { globalThis.catalogMode = 'error' })
  await page.locator('#catalog-refresh').focus()
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => document.querySelector('#catalog-status').textContent.includes('查询失败'))
  assert.equal(await page.locator('#roles option[value="catalog-private-a"]').count(), 0)
  assert.equal(await page.locator('#roles option[value="catalog-public"]').isDisabled(), true)
  assert.equal(await page.locator('#role-name').textContent(), 'catalog-public')
  await app.evaluate(() => { globalThis.catalogMode = 'empty' })
  await page.locator('#catalog-refresh').click()
  await page.waitForFunction(() => document.querySelector('#catalog-status').textContent.includes('暂无可用线上形象'))
  await app.evaluate(() => { globalThis.catalogMode = 'normal' })
  await page.locator('#catalog-refresh').click(); await ready()
  for (const width of [320, 768, 1024, 1440]) {
    await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()
      .find(win => win.webContents.getURL().endsWith('/device/device.html')).setContentSize(width, 800), width)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    await page.screenshot({ path: path.join(artifacts, `catalog-${width}.png`) })
  }
  const axe = await new AxeBuilder({ page }).setLegacyMode().withTags(['wcag2a', 'wcag2aa']).analyze()
  assert.deepEqual(axe.violations, [])
  send({ type: 'bind_success', controllerUserId: 'second-user', tenantId: 'second-tenant' })
  await page.waitForFunction(() => Array.from(document.querySelector('#roles').options).some(o => o.value === 'catalog-private-b'))
  assert.equal((await options()).includes('catalog-private-a'), false)
  assert.equal((await options()).includes('catalog-public'), false)
  assert.equal((await options()).includes('catalog-leaked-a'), false)
  await page.locator('#roles').selectOption('catalog-private-b'); await waitApplied('catalog-private-b')
  setBound(false)
  send({ type: 'bind_lost' })
  await page.waitForFunction(() => !document.querySelector('#qr').hidden)
  await page.waitForFunction(() => [...document.querySelector('#roles').options].some(row => row.value === 'waner'))
  assert.deepEqual(await options(), ['waner'])
  const requests = await app.evaluate(() => globalThis.catalogRequests.length)
  await pet.evaluate(() => window.controlDevice.refreshCatalog())
  await page.evaluate(() => window.controlDevice.refreshCatalog())
  await page.waitForTimeout(100)
  assert.equal(await app.evaluate(() => globalThis.catalogRequests.length), requests)
  assert.equal(providerTexts.length, 0)
  assert.equal(billingEvents.some(item => item.eventType === 'usage'), false)
  return { ownPrivate: true, publicAndShared: true, noPhoneDistribution: true, voiceCommit: true,
    refreshError: true, keyboardRefresh: true, crossUserAndTenantIsolation: true, unbindClearsCatalog: true,
    rendererSelectionRejected: true, noAutomaticGeneration: true, responsive: true, accessible: true }
}
