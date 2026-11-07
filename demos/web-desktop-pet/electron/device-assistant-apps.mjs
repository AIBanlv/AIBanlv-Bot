import { randomBytes } from 'node:crypto'
import path from 'node:path'

const failure = code => Object.assign(new Error(code), { code })
const unsafeText = /[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/
const excludedName = /uninstall|uninstaller|卸载|安装程序/i
const commandHost = /^(?:cmd|powershell|pwsh|wscript|cscript|mshta|rundll32|regsvr32|msiexec|unins\d*|uninstall|setup)\.exe$/i
const normalize = value => value.normalize('NFKC').toLowerCase().replace(/\s+/g, '')
const identity = app => JSON.stringify(app)

export function applicationCatalog(value) {
  if (!Array.isArray(value) || value.length > 10000) throw failure('APP_DISCOVERY_FAILED')
  const apps = new Map()
  for (const app of value) {
    if (!app || typeof app.name !== 'string' || typeof app.id !== 'string' ||
        !app.name || app.name.length > 256 || !app.id || app.id.length > 2048 ||
        unsafeText.test(app.name + app.id) || excludedName.test(app.name)) continue
    const executable = path.win32.isAbsolute(app.id) && path.win32.extname(app.id).toLowerCase() === '.exe'
    const registered = !path.win32.isAbsolute(app.id) && !/[\/:"]/.test(app.id) && !app.id.includes('..')
    if ((!executable && !registered) || /^(?:\\\\|\/\/)/.test(app.id) ||
        commandHost.test(path.win32.basename(app.id)) || /["\r\n]/.test(app.id)) continue
    const target = app.target ?? (executable ? app.id : '')
    const args = app.arguments ?? ''
    const packaged = /^[a-z0-9_.-]+_[a-z0-9]+![a-z0-9_.-]+$/i.test(app.id)
    if (typeof target !== 'string' || typeof args !== 'string' || target.length > 2048 || args.length > 2048 ||
        unsafeText.test(target + args) || target && (!path.win32.isAbsolute(target) ||
          /^(?:\\\\|\/\/)/.test(target) || path.win32.extname(target).toLowerCase() !== '.exe' ||
          commandHost.test(path.win32.basename(target))) || !target && !packaged) continue
    apps.set(app.id.toLowerCase(), { name: app.name, id: app.id, target, arguments: args })
  }
  return [...apps.values()]
}

export class ApplicationLauncher {
  constructor({ listApps, launchApp, approve }) {
    Object.assign(this, { listApps, launchApp, approve })
    this.issued = new Map()
  }
  reset() { this.issued.clear() }
  async run(target, { signal }) {
    const token = typeof target === 'string' && /^app:[a-f0-9]{24}$/.test(target)
    if (typeof target !== 'string' || !target.trim() || target.length > 120 ||
        unsafeText.test(target) || !token && /[\\/:]/.test(target)) throw failure('INVALID_ACTION')
    signal.throwIfAborted()
    const apps = applicationCatalog(await this.listApps({ signal }))
    const query = normalize(target)
    const exact = apps.filter(app => token ? this.issued.get(target) === identity(app) : normalize(app.name) === query)
    const matches = exact.length ? exact : token ? [] : apps.filter(app =>
      normalize(app.name).includes(query) ||
      normalize(path.win32.basename(app.id, '.exe')) === query)
    if (!matches.length) return { status: 'not_found', query: target }
    if (matches.length > 1) {
      this.issued.clear()
      return { status: 'needs_selection', candidates: matches.slice(0, 20).map(app => {
        const selection = `app:${randomBytes(12).toString('hex')}`
        this.issued.set(selection, identity(app))
        return { name: app.name, selection }
      }), more: matches.length > 20 }
    }
    const app = matches[0]
    signal.throwIfAborted()
    if (!await this.approve({ name: 'open_app', target: `${app.name}\n${app.id}${app.target ? `\n${app.target}` : ''}${app.arguments ? `\n${app.arguments}` : ''}` }, signal)) throw failure('ACTION_DENIED')
    signal.throwIfAborted()
    const refreshed = applicationCatalog(await this.listApps({ signal }))
    if (!refreshed.some(value => identity(value) === identity(app))) throw failure('TARGET_CHANGED')
    signal.throwIfAborted()
    await this.launchApp(app, { signal })
    return { status: 'launch_requested', app: app.name, windowVerified: false }
  }
}
