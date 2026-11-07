import { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage, powerMonitor, screen } from 'electron'
import path from 'node:path'
import { constrainBounds, trustedSender } from './policy.mjs'
import { devicePetSize, hitDevicePet } from './device-pet-policy.mjs'
import { aibanlvAppId } from './device-branding.mjs'

const alive = win => win && !win.isDestroyed() && !win.webContents.isDestroyed()
const send = (win, name, value) => { if (alive(win)) win.webContents.send(name, value) }
export const deviceAppId = aibanlvAppId(app.isPackaged)

export class DeviceWindows {
  constructor({ origin, directory, session, iconPath, retry, stopConversation, onVisibilityChange, preferences = {}, savePreferences, startup }) {
    this.origin = origin
    this.stopConversation = stopConversation
    this.onVisibilityChange = onVisibilityChange
    this.startup = startup
    // `muted` and `volume` are separate on purpose: muting has to remember the
    // level it muted, or turning the sound back on would come back at zero.
    this.state = { ready: false, status: 'loading', visible: true, pinned: true, clickThrough: true,
      size: 360, volume: 80, muted: false }
    this.lastVolume = this.state.volume
    this.state.startup = startup?.snapshot()
    this.state.particles = preferences.particles === true
    this.state.quality = ['auto', 'low', 'balanced', 'high'].includes(preferences.quality) ? preferences.quality : 'auto'
    this.controllerUrl = `${origin}/device/device.html`
    this.petUrl = `${origin}/device/device-pet.html`
    const icon = nativeImage.createFromPath(iconPath.replace(/\.ico$/i, '-logo.png'))
    if (icon.isEmpty()) throw new Error('应用图标加载失败，请检查安装文件是否完整')
    const webPreferences = { preload: `${directory}/device-preload.cjs`, contextIsolation: true,
      sandbox: true, nodeIntegration: false, webSecurity: true, backgroundThrottling: false, session }
    this.controller = new BrowserWindow({ width: 960, height: 780, minWidth: 320, minHeight: 560,
      show: false, title: 'AIBanlv - 桌面伴侣设置', backgroundColor: '#0b1420', icon, webPreferences })
    this.pet = new BrowserWindow({ ...devicePetSize(this.state.size), frame: false, transparent: true,
      // showInactive() leaves the pet unfocused. On macOS the first click must
      // reach the face too, rather than only activating the native window.
      acceptFirstMouse: true,
      backgroundColor: '#00000000', alwaysOnTop: true, skipTaskbar: false, resizable: false,
      maximizable: false, fullscreenable: false, hasShadow: false, show: false,
      title: 'AIBanlv - 桌面伴侣', icon, webPreferences })
    for (const [win, page] of [[this.controller, '/device/device.html'], [this.pet, '/device/device-pet.html']]) {
      if (process.platform === 'win32') win.setAppDetails({
        appId: deviceAppId, appIconPath: app.isPackaged ? process.execPath : iconPath, appIconIndex: 0,
        relaunchDisplayName: 'AIBanlv',
        relaunchCommand: app.isPackaged ? `"${process.execPath}"`
          : `"${process.execPath}" "${path.join(directory, 'device-main.mjs')}"`,
      })
      win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      for (const name of ['will-navigate', 'will-redirect', 'will-attach-webview']) {
        win.webContents.on(name, event => event.preventDefault())
      }
      win.webContents.on('will-frame-navigate', event => {
        const url = new URL(event.url)
        if (url.origin !== origin || ![page, '/avatar.html'].includes(url.pathname)) event.preventDefault()
      })
      win.webContents.on('render-process-gone', () => app.quit())
    }
    this.controller.on('close', event => {
      if (!this.closing) { event.preventDefault(); this.pause(); this.controller.hide() }
    })
    this.controller.on('minimize', () => this.pause())
    this.controller.on('hide', () => this.pause())
    this.pet.on('close', event => {
      if (!this.closing) { event.preventDefault(); this.showPet(false) }
    })
    this.pet.on('blur', () => { this.drag = null })
    ipcMain.handle('pet:status', event => this.trusted(event) ? { ...this.state } : null)
    ipcMain.on('pet:command', (event, name, value) => {
      if (!this.trusted(event)) return
      const control = this.fromController(event)
      if (name === 'controller') this.showController()
      else if (name === 'hide') this.showPet(false)
      else if (name === 'show') this.showPet(true)
      else if (name === 'reset') { this.reset(); this.showPet(true) }
      else if (name === 'quit' && control) app.quit()
      else if (name === 'retry' && control) retry()
      else if (name === 'startup' && control && typeof value === 'boolean') { this.state.startup = startup?.set(value); this.publish() }
      else if (name === 'particles' && control && typeof value === 'boolean') {
        this.state.particles = value
        try {
          savePreferences?.({ particles: value, quality: this.state.quality })
          this.state.preferencesError = ''
        } catch {
          this.state.preferencesError = '粒子效果已切换，但设置保存失败，重启后可能恢复原设置。'
        }
        this.publish()
      }
      else if (name === 'quality' && control && ['auto', 'low', 'balanced', 'high'].includes(value)) {
        this.state.quality = value
        try {
          savePreferences?.({ particles: this.state.particles, quality: value })
          this.state.preferencesError = ''
        } catch { this.state.preferencesError = '清晰度已切换，但设置保存失败，重启后可能恢复原设置。' }
        this.publish()
      }
      else if (name === 'volume' && (control || this.fromPet(event)) && Number.isInteger(value) && value >= 0 && value <= 100) {
        this.setVolume(value)
      }
      else if (name === 'muted' && (control || this.fromPet(event)) && typeof value === 'boolean') {
        this.setVolume(value ? 0 : this.lastVolume || 80)
      }
      else if (name === 'pin' && control && typeof value === 'boolean') {
        this.state.pinned = value; this.pet.setAlwaysOnTop(value); this.publish()
      } else if (name === 'clickThrough' && control && typeof value === 'boolean') {
        this.state.clickThrough = value; this.updateMouse(); this.publish()
      } else if (name === 'size' && (control || this.fromPet(event)) && Number.isInteger(value) && value >= 240 && value <= 440) {
        this.state.size = value
        const bounds = this.pet.getBounds()
        this.pet.setBounds(constrainBounds({ ...bounds, ...devicePetSize(value) }, screen.getDisplayMatching(bounds).workArea))
        this.publish()
      }
    })
    ipcMain.on('pet:drag', (event, phase, point) => {
      if (!this.fromPet(event)) return
      if (phase === 'end') { this.drag = null; return }
      if (!this.state.visible || !point ||
          ![point.x, point.y].every(v => Number.isFinite(v) && Math.abs(v) < 100000)) return
      if (phase === 'start') this.drag = { point, bounds: this.pet.getBounds() }
      else if (phase === 'move' && this.drag) {
        const bounds = { ...this.drag.bounds, x: this.drag.bounds.x + point.x - this.drag.point.x,
          y: this.drag.bounds.y + point.y - this.drag.point.y }
        this.pet.setBounds(constrainBounds(bounds, screen.getDisplayMatching(bounds).workArea))
      }
    })
    Menu.setApplicationMenu(null)
    this.tray = new Tray(icon.resize({ width: 24, height: 24 }))
    this.tray.setToolTip('AIBanlv · 桌面伴侣')
    this.tray.setContextMenu(Menu.buildFromTemplate([
      { label: '打开设置', click: () => this.showController() },
      { label: '显示桌面伴侣', click: () => this.showPet(true) },
      { label: '隐藏桌面伴侣', click: () => this.showPet(false) },
      { label: '关闭鼠标穿透', click: () => { this.state.clickThrough = false; this.updateMouse(); this.publish() } },
      { type: 'separator' }, { label: '退出', click: () => app.quit() },
    ]))
    this.tray.on('double-click', () => this.showController())
    this.onDisplay = () => this.reset()
    screen.on('display-removed', this.onDisplay)
    screen.on('display-metrics-changed', this.onDisplay)
    this.reset()
    this.mouseTimer = setInterval(() => this.updateMouse(), 50)
  }

  fromController(event) { return trustedSender(event, this.controller, this.controllerUrl) }
  fromPet(event) { return trustedSender(event, this.pet, this.petUrl) }
  trusted(event) { return this.fromController(event) || this.fromPet(event) }
  // One place owns the level, so the pet's slider, the controller's slider and
  // the mute button can never disagree about whether sound is actually on.
  setVolume(value) {
    this.state.volume = value
    this.state.muted = value === 0
    if (value > 0) this.lastVolume = value
    this.publish()
  }
  publish() {
    send(this.controller, 'pet:state', this.state)
    send(this.pet, 'pet:state', this.state)
  }
  update(state) {
    this.conversationContext = { agentId: state.current?.agentId || '', accountScope: state.accountScope || '' }
    const ready = (state.current?.source === 'local' || state.current?.publicAvatar || state.binding === 'bound' && state.connection === 'connected') && state.phase === 'ready' && Boolean(state.current)
    const wasReady = this.state.ready
    this.state.ready = ready
    this.state.status = ready ? 'ready' : state.phase === 'error' ? 'error' : 'loading'
    if (!ready && wasReady) this.pause()
    this.publish()
    send(this.controller, 'device:state', state)
    send(this.pet, 'device:state', state)
  }
  pause() {
    this.stopConversation?.()
    send(this.controller, 'pet:pause')
    send(this.pet, 'device:stop-speech')
  }
  conversation(data) {
    if (data.type === 'preparing') send(this.controller, 'pet:pause')
    // The settings chat needs the same live text as the pet, not audio/face
    // buffers or a second polling loop. Bind it to the main-owned identity.
    if (['preparing', 'user', 'assistant', 'responding', 'computer', 'done', 'complete', 'reset', 'error', 'stopped', 'interrupted'].includes(data.type)) {
      const visible = Object.fromEntries(['type', 'requestId', 'text', 'message', 'code', 'textOnly', 'spoken', 'input']
        .filter(key => data[key] !== undefined).map(key => [key, data[key]]))
      send(this.controller, 'device:conversation', { ...visible, ...this.conversationContext })
    }
    send(this.pet, 'device:conversation', data)
  }
  showController() {
    if (!alive(this.controller)) return
    this.state.startup = this.startup?.snapshot(); this.publish()
    if (this.controller.isMinimized()) this.controller.restore()
    this.controller.show(); this.controller.focus()
  }
  showPet(visible) {
    this.state.visible = visible
    this.onVisibilityChange?.()
    if (visible) {
      if (this.pet.isMinimized()) this.pet.restore()
      this.pet.showInactive()
      this.pet.setSkipTaskbar(false)
    }
    else { this.pause(); this.pet.hide(); this.drag = null }
    this.publish()
  }
  reset() {
    const area = screen.getPrimaryDisplay().workArea, size = devicePetSize(this.state.size)
    this.pet.setBounds(constrainBounds({ ...size, x: area.x + area.width - size.width - 32,
      y: area.y + area.height - size.height - 24 }, area))
  }
  updateMouse() {
    if (!alive(this.pet) || !this.state.visible) return
    const cursor = screen.getCursorScreenPoint(), bounds = this.pet.getBounds()
    const ignored = !this.drag && !hitDevicePet(cursor.x - bounds.x, cursor.y - bounds.y, bounds.width, this.state.clickThrough, bounds.height,
      this.taskActivityVisible, this.taskActivityExpanded ? 260 : 120)
    if (ignored !== this.ignored) {
      this.pet.setIgnoreMouseEvents(ignored, { forward: true }); this.ignored = ignored
    }
    this.publishPointer(cursor, bounds)
  }
  // The pet must react to a cursor that is nowhere near its own window, so the
  // main process samples the desktop cursor and sends only a direction, a
  // distance and the system idle time - never an absolute screen position.
  publishPointer(cursor, bounds) {
    const stamp = Date.now()
    if (stamp - (this.idleAt || 0) >= 1000) { this.idleAt = stamp; this.systemIdle = powerMonitor.getSystemIdleTime() }
    const reach = Math.max(360, bounds.width * 1.4)
    const dx = cursor.x - (bounds.x + bounds.width / 2), dy = cursor.y - (bounds.y + bounds.height / 2)
    this.pet.webContents.send('pet:pointer', {
      x: Math.max(-1, Math.min(1, dx / reach)),
      y: Math.max(-1, Math.min(1, dy / reach)),
      distance: Math.round(Math.hypot(dx, dy)),
      inside: cursor.x >= bounds.x && cursor.x < bounds.x + bounds.width &&
        cursor.y >= bounds.y && cursor.y < bounds.y + bounds.height,
      idle: this.systemIdle || 0,
    })
  }
  async load() {
    await Promise.all([this.controller.loadURL(this.controllerUrl), this.pet.loadURL(this.petUrl)])
    this.showController(); this.showPet(true)
  }
  dispose() {
    this.closing = true
    clearInterval(this.mouseTimer)
    screen.removeListener('display-removed', this.onDisplay)
    screen.removeListener('display-metrics-changed', this.onDisplay)
    this.tray.destroy()
    for (const win of [this.pet, this.controller]) if (alive(win)) win.destroy()
  }
}
