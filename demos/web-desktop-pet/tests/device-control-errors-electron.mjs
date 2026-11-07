import assert from 'node:assert/strict'
import path from 'node:path'
import { showSettings } from './settings-navigation-fixture.mjs'

export async function verifyControlErrors({ app, page, artifacts, send }) {
  await showSettings(page, 'binding')
  send({ type: 'error', code: 'INVALID_MESSAGE', message: 'unsupported message type', requestId: 'req-control-ui' })
  const expected = '控制服务拒绝了请求 [INVALID_MESSAGE]：unsupported message type（requestId: req-control-ui）'
  await page.waitForFunction(value => document.querySelector('#feedback').textContent === value, expected)
  assert.equal((await page.evaluate(() => window.controlDevice.state())).error, expected)
  await page.screenshot({ path: path.join(artifacts, 'control-error.png'), fullPage: true })

  const reason = '<img src=x onerror=alert(1)>' + 'LongError'.repeat(40)
  send({ type: 'error', code: 'C'.repeat(100), message: reason, requestId: 'R'.repeat(200) })
  const longExpected = `控制服务拒绝了请求 [${'C'.repeat(64)}]：${reason.slice(0, 300)}（requestId: ${'R'.repeat(128)}）`
  await page.waitForFunction(value => document.querySelector('#feedback').textContent === value, longExpected)
  assert.equal(await page.locator('#feedback img').count(), 0)
  const sizes = []
  for (const width of [320, 464]) {
    await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()
      .find(win => win.webContents.getURL().endsWith('/device/device.html')).setContentSize(width, 800), width)
    await page.waitForFunction(width => innerWidth === width, width)
    const layout = await page.evaluate(() => {
      const feedback = document.querySelector('#feedback')
      const rect = feedback.getBoundingClientRect()
      return { width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
        left: rect.left, right: rect.right, contentFits: feedback.scrollWidth <= feedback.clientWidth }
    })
    assert.ok(layout.contentFits && layout.scrollWidth <= width && layout.left >= 0 && layout.right <= width,
      JSON.stringify(layout))
    sizes.push(layout)
    await page.screenshot({ path: path.join(artifacts, `control-error-${width}.png`), fullPage: true })
  }
  await page.locator('#refresh').click()
  await page.waitForFunction(() => document.querySelector('#feedback').textContent === '' &&
    !document.querySelector('#qr').hidden)
  return { serverDiagnostics: true, literalText: true, refreshClearsError: true, sizes }
}
