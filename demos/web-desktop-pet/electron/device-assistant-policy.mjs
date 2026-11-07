import { readFile, writeFile, rename, realpath, stat, open } from 'node:fs/promises'
import path from 'node:path'
import { isIP, BlockList } from 'node:net'
import { lookup } from 'node:dns/promises'

const failure = code => Object.assign(new Error(code), { code })
const record = value => value && typeof value === 'object' && !Array.isArray(value)
// A Key is always copied by hand, and the slips are predictable: the quotes of a
// JSON string, the `DEEPSEEK_API_KEY=` prefix of a .env line, a `Bearer ` prefix
// from a request example, or line breaks from copying a wrapped value. All of
// them are printable ASCII, so validation alone let them through and the server
// then rejected the Key — which read as "the Key is wrong" even though only the
// pasting was. They are repaired here instead of being stored.
const normalizeKey = value => {
  if (typeof value !== 'string') return ''
  let key = value
  // The wrappers nest (`DEEPSEEK_API_KEY="sk-…"`), and stripping the quotes first
  // would leave the leading one behind, so peel until nothing changes. Curly quotes
  // are included because copying from a chat window or a document produces them.
  for (let pass = 0; pass < 4; pass += 1) {
    const before = key
    key = key.trim()
      .replace(/^["'`\u2018\u2019\u201c\u201d]+|["'`\u2018\u2019\u201c\u201d]+$/g, '').trim()
      .replace(/^(?:bearer\s*|(?:deepseek_)?api[_-]?key\s*[=:]\s*)/i, '').trim()
      .replace(/[\s\u200b-\u200d\ufeff]+/g, '')
    if (key === before) break
  }
  return key
}

export class AssistantSettings {
  #key = ''
  constructor({ file, encryption }) {
    Object.assign(this, { file, encryption })
    this.state = { enabled: false, configured: false, remember: false }
  }
  key() { return this.#key }
  snapshot() {
    // Enough for the user to recognise what is stored — a wrong length is the
    // only visible trace of a bad paste — and useless to anyone else.
    const keyHint = this.#key ? `${this.#key.slice(0, 3)}… 共 ${this.#key.length} 个字符` : ''
    return { ...this.state, keyHint }
  }
  async load() {
    try {
      const raw = await readFile(this.file, 'utf8')
      if (raw.length > 16384) throw failure('KEY_STORAGE_UNAVAILABLE')
      const data = JSON.parse(raw)
      if (!record(data)) throw failure('KEY_STORAGE_UNAVAILABLE')
      if (typeof data.encryptedKey === 'string') {
        if (!this.encryption.isEncryptionAvailable()) throw failure('KEY_STORAGE_UNAVAILABLE')
        // Repair keys stored before this rule existed, in memory only.
        this.#key = normalizeKey(this.encryption.decryptString(Buffer.from(data.encryptedKey, 'base64')))
        this.validateKey(this.#key)
      }
      const remember = Boolean(this.#key)
      // Restarting used to switch the assistant off every single time. It now
      // comes back on, but only when the Key itself was stored: ticking "remember
      // the Key" is the one place the user asked for this machine to stay
      // authorised, so that tick is what carries the switch across restarts.
      // A Key kept in memory is gone on restart, and so is the switch.
      this.state = { enabled: remember && data.enabled === true, configured: remember, remember }
    } catch (error) {
      if (error.code !== 'ENOENT') throw failure('KEY_STORAGE_UNAVAILABLE')
    }
  }
  validateKey(key) {
    if (typeof key !== 'string' || !/^[\x21-\x7e]{8,512}$/.test(key)) throw failure('INVALID_KEY')
  }
  preview(value = {}) {
    if (!record(value) || Object.keys(value).some(key => key !== 'apiKey') ||
        ('apiKey' in value && typeof value.apiKey !== 'string')) throw failure('INVALID_SETTINGS')
    const key = normalizeKey(value.apiKey) || this.#key
    if (key) this.validateKey(key)
    return { key: () => key }
  }
  async configure(value) {
    if (!record(value) || Object.keys(value).some(key => !['apiKey', 'enabled', 'remember'].includes(key)) ||
        ['enabled', 'remember'].some(key => key in value && typeof value[key] !== 'boolean')) throw failure('INVALID_SETTINGS')
    const supplied = normalizeKey(value.apiKey)
    const key = supplied || this.#key
    if (key) this.validateKey(key)
    const next = { ...this.state, enabled: true, ...value, configured: Boolean(key) }
    delete next.apiKey
    if (next.enabled && !key) throw failure('KEY_REQUIRED')
    const stored = {}
    if (next.remember && key) {
      if (!this.encryption.isEncryptionAvailable()) throw failure('KEY_STORAGE_UNAVAILABLE')
      stored.encryptedKey = this.encryption.encryptString(key).toString('base64')
      stored.enabled = next.enabled
    }
    await writeFile(`${this.file}.tmp`, JSON.stringify(stored), { mode: 0o600 })
    await rename(`${this.file}.tmp`, this.file)
    this.#key = key
    this.state = next
    return this.snapshot()
  }
  async forget() {
    await this.configure({ enabled: false, remember: false })
    this.#key = ''
    this.state.configured = false
    return this.snapshot()
  }
}

const names = new Set(['open_folder', 'open_url', 'read_text'])
const textExtensions = new Set(['.txt', '.md', '.csv', '.log'])
const privatePart = /^(?:\.ssh|\.aws|\.azure|\.config|\.codex|\.dsh|\.deepseek|\.git|appdata|windows|programdata|\.env(?:\..*)?|credentials?(?:\..*)?|id_rsa|id_ed25519)$/i
const privateV4 = new BlockList(), publicV6 = new BlockList(), privateV6 = new BlockList()
for (const [address, bits] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]]) privateV4.addSubnet(address, bits)
publicV6.addSubnet('2000::', 3, 'ipv6')
privateV6.addSubnet('2001:db8::', 32, 'ipv6'); privateV6.addSubnet('2002::', 16, 'ipv6')
async function publicHost(host, resolveHost) {
  let timer
  try {
    const addresses = await Promise.race([resolveHost(host, { all: true }), new Promise((_, reject) => {
      timer = setTimeout(() => reject(failure('TARGET_UNAVAILABLE')), 3000)
    })])
    if (!addresses.length || addresses.some(({ address }) => isIP(address) === 4 ? privateV4.check(address)
      : isIP(address) !== 6 || !publicV6.check(address, 'ipv6') || privateV6.check(address, 'ipv6'))) throw failure('TARGET_DENIED')
  } finally { clearTimeout(timer) }
}

export async function validateLocalAction(value, { blockedRoots = [], resolveHost = lookup } = {}) {
  if (!record(value) || Object.keys(value).some(key => !['name', 'target'].includes(key)) ||
      !names.has(value.name) || typeof value.target !== 'string' || !value.target ||
      value.target.length > 4096 || /[\x00-\x1f]/.test(value.target)) throw failure('INVALID_ACTION')
  if (value.name === 'open_url') {
    let url
    try { url = new URL(value.target) } catch { throw failure('TARGET_DENIED') }
    const host = url.hostname.toLowerCase()
    if (url.protocol !== 'https:' || url.username || url.password || url.port ||
        isIP(host.replace(/^\[|\]$/g, '')) || !host.includes('.') ||
        /(?:^|\.)(?:localhost|local|internal|lan|home|test|invalid)$/.test(host) ||
        host.endsWith('.') || url.href.length > 4096) throw failure('TARGET_DENIED')
    await publicHost(host, resolveHost)
    return { name: value.name, target: url.href }
  }
  if (!path.isAbsolute(value.target) || /^(?:\\\\|\/\/)/.test(value.target) ||
      value.target.slice(2).includes(':')) throw failure('TARGET_DENIED')
  let target
  try { target = await realpath(value.target) } catch { throw failure('TARGET_UNAVAILABLE') }
  if (/^(?:\\\\|\/\/)/.test(target) || target.split(/[\\/]/).some(part => privatePart.test(part)) ||
      blockedRoots.some(root => {
        const relative = path.relative(root, target)
        return !relative || !relative.startsWith('..') && !path.isAbsolute(relative)
      })) throw failure('TARGET_DENIED')
  const info = await stat(target)
  if (value.name === 'open_folder' ? !info.isDirectory() : !info.isFile()) throw failure('TARGET_DENIED')
  if (value.name === 'read_text' && !textExtensions.has(path.extname(target).toLowerCase())) throw failure('FILE_UNSUPPORTED')
  return { name: value.name, target }
}

export async function executeLocalAction(spec, { signal, approve, openPath, openExternal, resolveHost }) {
  signal.throwIfAborted()
  if (!await approve({ ...spec }, signal)) throw failure('ACTION_DENIED')
  signal.throwIfAborted()
  if (spec.name === 'open_folder') {
    const error = await openPath(spec.target)
    if (error) throw failure('OPEN_FAILED')
    return { opened: true, target: spec.target }
  }
  if (spec.name === 'open_url') {
    await validateLocalAction(spec, { resolveHost })
    signal.throwIfAborted()
    await openExternal(spec.target)
    return { opened: true, target: spec.target }
  }
  if (spec.name !== 'read_text') throw failure('INVALID_ACTION')
  // Resolve again after the user decision; never follow a changed symbolic target.
  if (await realpath(spec.target) !== spec.target) throw failure('TARGET_DENIED')
  const file = await open(spec.target, 'r')
  try {
    const info = await file.stat()
    if (!info.isFile()) throw failure('FILE_UNSUPPORTED')
    if (info.size > 65536) throw failure('FILE_TOO_LARGE')
    const buffer = Buffer.alloc(65537)
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0)
    signal.throwIfAborted()
    if (bytesRead > 65536) throw failure('FILE_TOO_LARGE')
    const bytes = buffer.subarray(0, bytesRead)
    if (bytes.includes(0)) throw failure('FILE_UNSUPPORTED')
    let text
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
    catch { throw failure('FILE_UNSUPPORTED') }
    return { target: spec.target, text }
  } finally { await file.close() }
}
