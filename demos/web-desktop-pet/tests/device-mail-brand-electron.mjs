import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'

const require = createRequire(import.meta.url)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

if (process.versions.electron) {
  const { BrowserWindow } = await import('electron')
  const setAppDetails = BrowserWindow.prototype.setAppDetails
  globalThis.fixtureWindowAppDetails = []
  BrowserWindow.prototype.setAppDetails = function(details) {
    globalThis.fixtureWindowAppDetails.push(details)
    return setAppDetails.call(this, details)
  }
  const originalFetch = globalThis.fetch
  const Socket = globalThis.WebSocket
  globalThis.fixtureMailRequests = []
  globalThis.fixtureCodeMode = 'denied'
  globalThis.fixtureRegisterMode = 'denied'
  globalThis.WebSocket = class extends Socket {
    constructor(url, options) {
      if (String(url) !== process.env.PET_CONTROL_WS_URL) throw new Error('Non-fixture socket blocked')
      super(url, options)
    }
  }
  globalThis.fetch = (url, options = {}) => {
    const parsed = new URL(String(url))
    if (parsed.origin === 'https://scrm.ieasysell.com' &&
        ['/jwt/client/website-auth/send-email-code', '/jwt/client/website-auth/register', '/new/oauth/token'].includes(parsed.pathname)) {
      globalThis.fixtureMailRequests.push({ path: parsed.pathname, method: options.method,
        mailBrand: parsed.searchParams.get('mailBrand'), redirect: options.redirect,
        credentials: options.credentials,
        code: parsed.pathname.endsWith('/register') ? parsed.searchParams.get('code') : null })
      if (parsed.pathname === '/new/oauth/token') {
        return Promise.resolve(Response.json({ error: 'invalid_grant' }, { status: 401 }))
      }
      if (options.headers.Authorization !== 'Basic YWRtaW46YWRtaW4=') throw new Error('Invalid fixture authorization')
      const sendingCode = parsed.pathname.endsWith('send-email-code')
      const succeeds = (sendingCode ? globalThis.fixtureCodeMode : globalThis.fixtureRegisterMode) === 'success'
      return Promise.resolve(Response.json(succeeds ? { code: 200, data: sendingCode ? 'sent' : {
        tokenData: { access_token: 'private-fixture-token' }, loginTicket: 'private-fixture-ticket',
      } } : { code: 400, msg: 'private-fixture-denial' }))
    }
    if (parsed.origin === 'https://scrm.ieasysell.com' &&
        parsed.pathname === '/jwt/client/digital-human/anonymous/status') {
      return Promise.resolve(Response.json({ code: 200, data: { score: 0 } }))
    }
    if (parsed.origin === 'https://scrm.ieasysell.com' &&
        parsed.pathname === '/jwt/client/aliBot/getBotListTWithPublic') {
      return Promise.resolve(Response.json({ code: 200, data: [] }))
    }
    return parsed.protocol === 'http:' && parsed.hostname === '127.0.0.1'
      ? originalFetch(url, options) : Promise.reject(new Error('Non-fixture request blocked'))
  }
  await import(pathToFileURL(path.join(root, 'electron/device-main.mjs')).href)
} else {
  const { _electron } = require(process.env.PLAYWRIGHT_MODULE ||
    path.resolve(root, '../../../.codex_tmp/web-pet-qa/node_modules/playwright'))
  const { default: AxeBuilder } = require(process.env.AXE_MODULE ||
    path.resolve(root, '../../../.codex_tmp/web-pet-qa/node_modules/@axe-core/playwright'))
  const { Server: WebSocketServer } = require('ws')
  const artifacts = path.join(root, 'artifacts/aibanlv-mail')
  await mkdir(artifacts, { recursive: true })
  const http = createServer()
  const ws = new WebSocketServer({ server: http })
  await new Promise(resolve => http.listen(0, '127.0.0.1', resolve))
  ws.on('connection', client => client.on('message', raw => {
    const message = JSON.parse(raw)
    if (message.type === 'device_online') client.send(JSON.stringify({ type: 'bind_offer',
      deviceId: message.deviceId, bindToken: 'fixture-binding-token', bound: false,
      expireAt: Date.now() + 900000 }))
    if (message.type === 'ping') client.send(JSON.stringify({ type: 'pong' }))
  }))
  const env = { ...process.env, PET_DEVICE_USER_DATA: path.join(artifacts, `profile-${Date.now()}`),
    PET_CONTROL_WS_URL: `ws://127.0.0.1:${http.address().port}/ws/control` }
  delete env.ELECTRON_RUN_AS_NODE
  let app
  const errors = [], warnings = [], external = []
  try {
    app = await _electron.launch({ executablePath: require('electron'),
      args: [fileURLToPath(import.meta.url)], env, timeout: 60000 })
    await app.firstWindow()
    if (process.platform === 'win32') {
      const details = await app.evaluate(() => globalThis.fixtureWindowAppDetails)
      assert.equal(details.length, 2)
      for (const value of details) {
        assert.equal(value.appId, 'com.zhanlv.aibanlv.desktop.source')
        assert.equal(value.appIconPath, path.resolve(root, '../../static/aibanlv.ico'))
        assert.equal(value.appIconIndex, 0)
        assert.equal(value.relaunchDisplayName, 'AIBanlv')
        const executable = await app.evaluate(() => process.execPath)
        assert.equal(value.relaunchCommand, `"${executable}" "${path.join(root, 'electron/device-main.mjs')}"`)
      }
    }
    const deadline = Date.now() + 10000
    while (!app.windows().some(page => page.url().endsWith('/device/device.html')) && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    const page = app.windows().find(page => page.url().endsWith('/device/device.html'))
    assert.ok(page)
    if (process.platform === 'win32') {
      const handles = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(win =>
        win.getNativeWindowHandle().readBigUInt64LE().toString()))
      const actual = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-File',
        path.join(root, 'tests/windows-taskbar-properties.ps1'), '-Handles', handles.join(',')],
      { encoding: 'utf8', windowsHide: true }))
      for (const value of actual) {
        assert.equal(value.appId, 'com.zhanlv.aibanlv.desktop.source')
        assert.equal(value.icon, `${path.resolve(root, '../../static/aibanlv.ico')},0`)
        assert.equal(value.displayName, 'AIBanlv')
        assert.ok(value.command.endsWith(`"${path.join(root, 'electron/device-main.mjs')}"`))
      }
    }
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => {
      if (message.type() === 'error') errors.push(message.text())
      if (message.type() === 'warning') warnings.push(message.text())
    })
    page.on('request', request => {
      if (/^https?:/.test(request.url()) && new URL(request.url()).hostname !== '127.0.0.1') external.push(request.url())
    })
    await page.waitForFunction(() => !document.querySelector('#qr').hidden)
    await page.locator('#mode-login').check()
    await page.locator('#register-open').click()
    await page.locator('#register-email').fill('fixture+brand@example.com')
    await page.locator('#register-send-code').click()
    await page.waitForFunction(() => document.querySelector('#login-status').textContent.includes('发送失败'))
    assert.equal(await page.locator('#register-send-code').isEnabled(), true)
    await app.evaluate(() => { globalThis.fixtureCodeMode = 'success' })
    await page.locator('#register-send-code').click()
    await page.waitForFunction(() => /(?:60|59)s/.test(document.querySelector('#register-send-code').textContent))
    assert.equal(await page.locator('#register-send-code').isDisabled(), true)
    for (const width of [320, 768, 1024, 1440]) {
      await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()
        .find(win => win.webContents.getURL().endsWith('/device/device.html')).setContentSize(width, 800), width)
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
      assert.equal(await page.locator('#registration-fields').evaluate(form => {
        const bounds = form.getBoundingClientRect()
        return [...form.querySelectorAll('input, button')].every(node => {
          const rect = node.getBoundingClientRect()
          return rect.left >= bounds.left && rect.right <= bounds.right + 1 && node.scrollWidth <= node.clientWidth + 1
        })
      }), true)
      await page.screenshot({ path: path.join(artifacts, `registration-${width}.png`) })
    }
    assert.deepEqual((await new AxeBuilder({ page }).setLegacyMode().withTags(['wcag2a', 'wcag2aa']).analyze()).violations, [])
    const fill = async () => {
      await page.locator('#register-code').fill('0123')
      await page.locator('#register-password').fill('fixture-password')
      await page.locator('#register-confirm').fill('fixture-password')
    }
    assert.equal(await page.locator('#register-code').getAttribute('maxlength'), '4')
    assert.equal(await page.locator('#register-code').getAttribute('pattern'), '[0-9]{4}')
    await fill()
    await page.locator('#register-confirm').press('Enter')
    await page.waitForFunction(() => document.querySelector('#login-status').textContent.includes('注册未完成'))
    await app.evaluate(() => { globalThis.fixtureRegisterMode = 'success' })
    await fill()
    await page.locator('#login-submit').click()
    await page.waitForFunction(() => document.querySelector('#login-status').textContent.includes('注册成功'))
    await page.waitForFunction(() => document.querySelector('#registration-fields').hidden)
    assert.equal(await page.locator('#login-user').inputValue(), 'fixture+brand@example.com')
    assert.equal(await page.locator('#login-password').inputValue(), '')
    const requests = await app.evaluate(() => globalThis.fixtureMailRequests)
    assert.equal(requests.length, 5)
    for (const request of requests.slice(0, 4)) {
      assert.equal(request.mailBrand, 'aibanlv')
      assert.equal(request.method, 'GET')
      assert.equal(request.redirect, 'error')
      assert.equal(request.credentials, 'omit')
    }
    assert.equal(requests[2].code, '0123')
    assert.equal(requests[3].code, '0123')
    assert.equal(requests[4].mailBrand, null)
    assert.equal(requests[4].method, 'POST')
    assert.doesNotMatch(JSON.stringify(await page.evaluate(() => window.controlDevice.state())),
      /fixture-password|private-fixture-token|private-fixture-ticket|0123/)
    assert.deepEqual(errors, [])
    assert.deepEqual(warnings, [])
    assert.deepEqual(external, [])
    await writeFile(path.join(artifacts, 'results.json'), JSON.stringify({
      localFixturesOnly: true, requests, viewports: [320, 768, 1024, 1440],
      axe: true, cooldown: true, credentialIsolation: true,
    }, null, 2))
    console.log('PASS: real Electron AIBanlv code/registration requests, unchanged login, cooldown, responsive layout and accessibility')
  } finally {
    await app?.close()
    for (const client of ws.clients) client.terminate()
    await new Promise(resolve => ws.close(resolve))
    await new Promise(resolve => http.close(resolve))
  }
}
