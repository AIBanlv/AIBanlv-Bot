import { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage, screen, session, dialog } from 'electron'
import { randomBytes } from 'node:crypto'
import { readFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { constrainBounds, hitPet, petSize, trustedSender, validRelay } from './policy.mjs'

const directory = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(directory, '..')
const textOnly = process.env.PET_TEXT_ONLY === '1' ||
  JSON.parse(await readFile(path.join(app.getAppPath(), 'package.json'), 'utf8')).petMode === 'text'
let controller, pet, tray, server, mouseTimer
let quitting = false, ignored = false, drag = null
let origin = ''
const state = { ready: false, status: 'loading', visible: true, pinned: true, clickThrough: false, size: 300 }
const shutdown = new AbortController()
const jobs = new Set()
const controllerUrl = () => `${origin}/desktop/controller.html`
const petUrl = () => `${origin}/desktop/pet.html`
const fromController = (event) => trustedSender(event, controller, controllerUrl())
const fromPet = (event) => trustedSender(event, pet, petUrl())
const alive = (win) => win && !win.isDestroyed()
const send = (win, channel, value) => { if (alive(win)) win.webContents.send(channel, value) }
const publish = () => { send(controller, 'pet:state', state); send(pet, 'pet:state', state) }
const pause = () => send(controller, 'pet:pause')

function showController() {
  if (!alive(controller)) return
  if (controller.isMinimized()) controller.restore()
  controller.show()
  controller.focus()
}

function showPet(value) {
  if (!alive(pet)) return
  state.visible = value
  if (value) pet.showInactive()
  else { pause(); pet.hide(); drag = null }
  publish()
}

function resetPet() {
  const area = screen.getPrimaryDisplay().workArea
  const size = petSize(state.size)
  pet.setBounds(constrainBounds({ ...size, x: area.x + area.width - size.width - 32,
    y: area.y + area.height - size.height - 24 }, area))
}

function updateMouse() {
  if (!alive(pet) || !state.visible) return
  const cursor = screen.getCursorScreenPoint()
  const bounds = pet.getBounds()
  const next = state.clickThrough || (!drag && !hitPet(cursor.x - bounds.x, cursor.y - bounds.y, bounds.width))
  if (next !== ignored) {
    pet.setIgnoreMouseEvents(next, { forward: true })
    ignored = next
  }
}

function secure(win, url) {
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event) => event.preventDefault())
  win.webContents.on('will-redirect', (event) => event.preventDefault())
  win.webContents.on('will-attach-webview', (event) => event.preventDefault())
  win.webContents.on('will-frame-navigate', (event) => {
    if (event.url !== url && event.url !== `${origin}/avatar.html`) event.preventDefault()
  })
}

function installBridge() {
  ipcMain.handle('pet:status', (event) => (fromController(event) || fromPet(event)) ? { ...state } : null)
  ipcMain.on('pet:relay', (event, data) => {
    if (fromController(event) && validRelay(data)) send(pet, 'pet:presentation', data)
  })
  ipcMain.on('pet:avatar-status', (event, value) => {
    if (!fromPet(event) || !['ready', 'loading', 'error'].includes(value)) return
    state.ready = value === 'ready'
    state.status = value
    if (!state.ready) pause()
    publish()
  })
  ipcMain.on('pet:command', (event, command, value) => {
    const control = fromController(event), avatar = fromPet(event)
    if (!control && !avatar) return
    if (command === 'controller') showController()
    else if (command === 'hide') showPet(false)
    else if (command === 'show') showPet(true)
    else if (command === 'reset') { resetPet(); showPet(true) }
    else if (command === 'quit' && control) app.quit()
    else if (command === 'pin' && control && typeof value === 'boolean') {
      state.pinned = value
      pet.setAlwaysOnTop(value)
      publish()
    } else if (command === 'clickThrough' && control && typeof value === 'boolean') {
      state.clickThrough = value
      updateMouse()
      publish()
    } else if (command === 'size' && control && Number.isInteger(value) && value >= 240 && value <= 380) {
      state.size = value
      const bounds = pet.getBounds()
      pet.setBounds(constrainBounds({ ...bounds, ...petSize(value) }, screen.getDisplayMatching(bounds).workArea))
      publish()
    } else if (command === 'retry' && control) {
      pause()
      state.ready = false
      state.status = 'loading'
      publish()
      pet.webContents.reload()
    }
  })
  ipcMain.on('pet:drag', (event, phase, point) => {
    if (!fromPet(event)) return
    if (phase === 'end') { drag = null; return }
    if (state.clickThrough || !state.visible || !point ||
        ![point.x, point.y].every((v) => Number.isFinite(v) && Math.abs(v) < 100000)) return
    if (phase === 'start') drag = { point, bounds: pet.getBounds() }
    else if (phase === 'move' && drag) {
      const next = { ...drag.bounds, x: drag.bounds.x + point.x - drag.point.x,
        y: drag.bounds.y + point.y - drag.point.y }
      pet.setBounds(constrainBounds(next, screen.getDisplayMatching(next).workArea))
    }
  })
}

async function start() {
  app.setName(textOnly ? 'Control Text Pet' : 'Control Desktop Pet')
  app.setAppUserModelId(textOnly ? 'com.zhanlv.control.text-pet' : 'com.zhanlv.control.desktop-pet.demo')
  if (process.env.PET_DESKTOP_USER_DATA) app.setPath('userData', path.resolve(process.env.PET_DESKTOP_USER_DATA))
  if (!app.requestSingleInstanceLock()) { app.quit(); return }
  app.on('second-instance', showController)
  await app.whenReady()
  process.env.PET_ARTIFACTS = path.join(app.getPath('userData'), 'artifacts')
  await mkdir(process.env.PET_ARTIFACTS, { recursive: true })
  if (!textOnly) try {
    const config = JSON.parse(await readFile(path.join(app.getAppPath(), 'runtime.local.json'), 'utf8'))
    for (const key of ['PET_PYTHON', 'PET_TTS_PYTHON', 'PET_LAM_SOURCE', 'JAVA', 'JAVAC', 'GSON_JAR']) {
      if (!process.env[key] && typeof config[key] === 'string') {
        process.env[key] = config[key].startsWith('./') ? path.resolve(app.getAppPath(), config[key]) : config[key]
      }
    }
  } catch (error) { if (error.code !== 'ENOENT') throw new Error('Invalid runtime.local.json') }
  let createServer, files, generate
  if (textOnly) {
    const text = await import('./text-server.mjs')
    createServer = text.createTextServer
    files = text.resolveTextFiles()
  } else {
    const web = await import('../server.mjs')
    const { createPreviewGenerator } = await import('../scripts/preview-service.mjs')
    createServer = web.createDemoServer
    generate = createPreviewGenerator()
    files = web.resolveDemoFiles()
    for (const file of ['controller.html', 'pet.html', 'controller.mjs', 'pet.mjs', 'desktop.css']) {
      files.set(`/desktop/${file}`, path.join(directory, file))
    }
  }
  const token = randomBytes(32).toString('hex')
  server = createServer(files, {
    accessToken: token,
    generatePreview: (text, signal) => {
      const job = generate(text, AbortSignal.any([signal, shutdown.signal]))
      jobs.add(job)
      job.finally(() => jobs.delete(job)).catch(() => {})
      return job
    },
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  origin = `http://127.0.0.1:${server.address().port}`
  const isolated = session.fromPartition('control-desktop-pet')
  isolated.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  isolated.setPermissionCheckHandler(() => false)
  isolated.on('will-download', (event) => event.preventDefault())
  isolated.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !details.url.startsWith(`${origin}/`) && !details.url.startsWith(`blob:${origin}/`) &&
      !details.url.startsWith('data:') })
  })
  isolated.webRequest.onBeforeSendHeaders((details, callback) => {
    const requestHeaders = { ...details.requestHeaders }
    if (details.url.startsWith(`${origin}/`)) requestHeaders['X-Pet-Token'] = token
    callback({ requestHeaders })
  })
  const webPreferences = {
    preload: path.join(directory, 'preload.cjs'), contextIsolation: true, sandbox: true,
    nodeIntegration: false, webSecurity: true, backgroundThrottling: false, session: isolated,
  }
  const icon = nativeImage.createFromPath(path.resolve(root, '../../static/logo.png'))
  controller = new BrowserWindow({ width: 480, height: 820, minWidth: 360, minHeight: 540,
    title: 'Control - 数字人控制台', backgroundColor: '#f5f7f5', show: false, icon, webPreferences })
  pet = new BrowserWindow({ ...petSize(state.size), frame: false, transparent: true, backgroundColor: '#00000000',
    alwaysOnTop: true, skipTaskbar: true, resizable: false, maximizable: false, fullscreenable: false,
    hasShadow: false, show: false, title: 'Control - 桌面数字人', icon, webPreferences })
  Menu.setApplicationMenu(null)
  installBridge()
  secure(controller, controllerUrl())
  secure(pet, petUrl())
  controller.on('close', (event) => { if (!quitting) { event.preventDefault(); pause(); controller.hide() } })
  controller.on('minimize', pause)
  controller.on('hide', pause)
  controller.webContents.on('render-process-gone', () => app.quit())
  pet.on('close', (event) => { if (!quitting) { event.preventDefault(); showPet(false) } })
  pet.on('blur', () => { drag = null })
  pet.webContents.on('render-process-gone', () => {
    state.ready = false; state.status = 'error'; pause(); publish()
  })
  resetPet()
  tray = new Tray(icon.resize({ width: 24, height: 24 }))
  tray.setToolTip('Control 桌面数字人')
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开控制台', click: showController },
    { label: '显示数字人', click: () => showPet(true) },
    { label: '隐藏数字人', click: () => showPet(false) },
    { label: '关闭鼠标穿透', click: () => { state.clickThrough = false; updateMouse(); publish() } },
    { type: 'separator' }, { label: '退出', click: () => app.quit() },
  ]))
  tray.on('double-click', showController)
  screen.on('display-removed', resetPet)
  screen.on('display-metrics-changed', () => {
    const bounds = pet.getBounds()
    pet.setBounds(constrainBounds(bounds, screen.getDisplayMatching(bounds).workArea))
  })
  await Promise.all([controller.loadURL(controllerUrl()), pet.loadURL(petUrl())])
  controller.show()
  pet.showInactive()
  mouseTimer = setInterval(updateMouse, 50)
}

app.on('before-quit', (event) => {
  if (quitting) return
  event.preventDefault()
  quitting = true
  clearInterval(mouseTimer)
  shutdown.abort()
  pause()
  Promise.allSettled([...jobs]).then(() => {
    server?.closeAllConnections()
    server?.close()
    tray?.destroy()
    if (alive(pet)) pet.destroy()
    if (alive(controller)) controller.destroy()
    app.quit()
  })
})
start().catch((error) => {
  console.error('[desktop]', error.message)
  dialog.showErrorBox('Control 启动失败', '无法启动本地数字人，请检查资源和 runtime.local.json 配置。')
  app.quit()
})
