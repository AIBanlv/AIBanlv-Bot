import { readFileSync, writeFileSync, renameSync } from 'node:fs'

// Match the installer/uninstaller's owned Run value. Never register Electron,
// the source checkout or a test fixture as an operating-system login item.
export class DeviceStartup {
  constructor({ app, file, platform = process.platform, executable = process.execPath, allowRegistration = true }) {
    Object.assign(this, { app, file, platform, executable })
    this.supported = allowRegistration && app.isPackaged && ['win32', 'darwin'].includes(platform)
    this.message = ''; this.failed = false
  }
  options() { return this.platform === 'win32' ? { path: this.executable, args: [] } : {} }
  loginSettings() {
    // Electron's Windows openAtLogin only checks the AppUserModelID value,
    // whereas our installer owns ControlDeviceTest. Query paths as command
    // lines (quoted for spaces), then inspect that exact current-user item.
    const settings = this.app.getLoginItemSettings(this.platform === 'win32'
      ? { path: `"${this.executable}"`, args: [] } : this.options())
    if (this.platform !== 'win32') return settings
    const item = settings.launchItems.find(item => item.name === 'ControlDeviceTest' && item.scope === 'user')
    return { ...settings, openAtLogin: Boolean(item), executableWillLaunchAtLogin: item?.enabled === true }
  }
  snapshot() {
    if (!this.supported) return { supported: false, enabled: false, reason: 'INSTALL_REQUIRED', message: `当前为开发或隔离测试版，不能开启自启动。请安装 ${this.platform === 'win32' ? 'EXE' : '应用安装包'} 后设置；不会将开发用的 Electron 加入开机启动。` }
    try {
      const settings = this.loginSettings()
      const enabled = this.platform === 'win32' ? settings.openAtLogin && settings.executableWillLaunchAtLogin !== false
        : settings.openAtLogin && settings.status !== 'requires-approval'
      return { supported: true, enabled: Boolean(enabled), message: this.message || (settings.status === 'requires-approval'
        ? '请在系统登录项设置中批准 AIBanlv 自动启动。' : settings.openAtLogin && !enabled ? '启动项已被系统禁用，可重新开启或在系统启动应用中检查。' : ''), error: this.failed }
    } catch { return { supported: true, enabled: false, error: true, message: '无法读取系统启动项，请检查系统权限后重试。' } }
  }
  initialize() {
    if (!this.supported) return this.snapshot()
    let preference
    try { preference = JSON.parse(readFileSync(this.file, 'utf8')).enabled } catch (error) {
      if (error.code !== 'ENOENT') { this.message = '启动偏好无法读取，未修改系统启动项；请重新选择开关。'; this.failed = true; return this.snapshot() }
    }
    // Missing preference is a fresh install: enable by default, but do not
    // override an existing OS-disabled item. A saved opt-out always wins.
    let current
    try { current = this.loginSettings() }
    catch { return this.snapshot() }
    if (preference !== undefined && typeof preference !== 'boolean') {
      this.message = '启动偏好格式无效，未修改系统启动项；请重新选择开关。'; this.failed = true; return this.snapshot()
    }
    if (preference !== false && !current.openAtLogin) return this.set(true)
    if (preference === false && current.openAtLogin) return this.set(false)
    return this.snapshot()
  }
  set(enabled) {
    if (!this.supported || typeof enabled !== 'boolean') return this.snapshot()
    this.message = ''; this.failed = false
    try {
      this.app.setLoginItemSettings({ ...this.options(), openAtLogin: enabled,
        ...(this.platform === 'win32' ? { name: 'ControlDeviceTest', enabled } : {}) })
      const value = this.snapshot()
      if (value.error || value.enabled !== enabled) {
        this.message = value.message || '系统未接受启动项变更，请检查系统启动应用设置。'; this.failed = true
      } else {
        writeFileSync(`${this.file}.tmp`, JSON.stringify({ enabled }), { mode: 0o600 })
        renameSync(`${this.file}.tmp`, this.file)
      }
    } catch { this.message = '启动项或偏好保存失败，请检查系统权限后重试。'; this.failed = true }
    return this.snapshot()
  }
}
