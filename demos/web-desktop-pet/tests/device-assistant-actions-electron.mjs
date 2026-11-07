import assert from 'node:assert/strict'
import path from 'node:path'
import { readFile, readdir } from 'node:fs/promises'

export async function verifyAssistantActions({ app, pet, model, userData, artifacts, root, AxeBuilder }) {
  const desktop = path.join(userData, 'fixture-desktop')
  await app.evaluate(async (_electron, desktop) => {
    const { mkdir, writeFile } = process.getBuiltinModule('node:fs/promises')
    const path = process.getBuiltinModule('node:path')
    await mkdir(desktop, { recursive: true })
    await writeFile(path.join(desktop, 'notes.txt'), 'keep fixture text')
    await writeFile(path.join(desktop, 'image.png'), 'fixture image bytes')
    const service = globalThis.fixtureAssistant
    service.organizer.desktop = desktop
    service.apps.listApps = async () => [{ name: 'Fixture Player', id: path.join(desktop, 'player.exe') }]
    service.apps.launchApp = async value => { globalThis.fixtureLaunched = value }
  }, desktop)
  const submit = async text => {
    await pet.locator('#chat-text').fill(text)
    await pet.locator('#chat-text').press('Enter')
  }
  const settled = () => pet.waitForFunction(() => !document.querySelector('#chat-text').disabled,
    null, { timeout: 45000 })
  model.tool = 'control_open_app'; model.target = 'Fixture Player'
  await submit('打开 Fixture Player')
  await settled()
  assert.equal((await app.evaluate(() => globalThis.fixtureLaunched)).id, path.join(desktop, 'player.exe'))
  assert.match(JSON.stringify(model.requests.at(-1)), /launch_requested/)
  model.tool = 'control_plan_desktop'; model.target = 'desktop'
  await submit('预览桌面整理')
  await settled()
  assert.deepEqual((await readdir(desktop)).sort(), ['image.png', 'notes.txt'])
  const planId = await app.evaluate(() => [...globalThis.fixtureAssistant.organizer.pending.keys()][0])
  const confirm = async (tool, target, allowed) => {
    model.tool = tool; model.target = target
    const opening = app.waitForEvent('window')
    opening.catch(() => {})
    await submit(tool === 'control_undo_desktop' ? '恢复上次桌面整理' : '执行刚才的桌面整理')
    const modal = await opening
    await modal.getByRole('heading').waitFor()
    assert.equal(await modal.locator('tbody tr').count(), 2)
    assert.ok((await modal.locator('tbody').innerText()).includes(desktop))
    await modal.waitForFunction(() => document.activeElement?.textContent === '拒绝')
    await modal.getByRole('button', { name: allowed ? '允许一次' : '拒绝', exact: true }).click()
    await settled()
  }
  await confirm('control_organize_desktop', planId, false)
  assert.deepEqual((await readdir(desktop)).sort(), ['image.png', 'notes.txt'])
  await confirm('control_organize_desktop', planId, true)
  assert.match(JSON.stringify(model.requests.at(-1)), /organized/)
  assert.equal((await readdir(desktop)).length, 1)
  await app.evaluate(async () => { await globalThis.fixtureAssistant.reset() })
  await confirm('control_undo_desktop', 'latest', true)
  assert.equal(await readFile(path.join(desktop, 'notes.txt'), 'utf8'), 'keep fixture text')
  assert.equal(await readFile(path.join(desktop, 'image.png'), 'utf8'), 'fixture image bytes')
  // Exercise the same real modal with a full-size, long-path plan without
  // exposing or moving any real user files.
  const opening = app.waitForEvent('window')
  opening.catch(() => {})
  await app.evaluate(async ({ BrowserWindow }, root) => {
    const path = process.getBuiltinModule('node:path')
    const require = process.getBuiltinModule('node:module').createRequire(path.join(root, 'electron/device-main.mjs'))
    const { showMoveApproval } = require(path.join(root, 'electron/device-assistant-approval.mjs'))
    globalThis.fixtureApprovalAbort = new AbortController()
    globalThis.fixtureApprovalPromise = showMoveApproval(BrowserWindow.getAllWindows().find(window =>
      window.webContents.getURL().endsWith('/device/device.html')), {
      name: 'organize_desktop', entries: Array.from({ length: 100 }, (_, index) => ({
        from: `Desktop/${'long-name-'.repeat(12)}${index}.pdf`,
        to: `Desktop/Organized/Documents/${'long-name-'.repeat(12)}${index}.pdf`,
      })),
    }, globalThis.fixtureApprovalAbort.signal)
  }, root)
  const modal = await opening
  await modal.getByRole('heading').waitFor()
  for (const width of [320, 768, 1024, 1440]) {
    await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows().find(window =>
      window.webContents.getURL().startsWith('data:text/html')).setContentSize(width, 600), width)
    assert.equal(await modal.locator('tbody tr').count(), 100)
    assert.equal(await modal.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    assert.equal(await modal.locator('main').evaluate(element => element.scrollHeight > element.clientHeight), true)
    await modal.screenshot({ path: path.join(artifacts, `assistant-moves-${width}.png`) })
  }
  const axe = await new AxeBuilder({ page: modal }).setLegacyMode().withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
  assert.deepEqual(axe.violations.map(value => value.id), [])
  await app.evaluate(() => globalThis.fixtureApprovalAbort.abort())
  assert.equal(await app.evaluate(() => globalThis.fixtureApprovalPromise), false)
  model.tool = 'control_open_url'; model.target = 'https://example.com/'
  return { appLaunch: true, previewOnly: true, nativeMoves: true, deny: true,
    restartRecovery: true, scrollableApproval: true, responsive: true, cancellation: true }
}
