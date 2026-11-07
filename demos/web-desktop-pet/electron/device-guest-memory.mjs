import { readFile, writeFile, rename } from 'node:fs/promises'

const unavailable = () => ({ ok: false, code: 'GUEST_MEMORY_UNAVAILABLE' })
const record = value => value && typeof value === 'object' && !Array.isArray(value)
const string = (value, limit) => typeof value === 'string' && value.length > 0 && value.length <= limit
const role = value => value === 'user' || value === 'assistant'
const textLimit = value => value === 'user' ? 4000 : 16000

// Copy only the existing transcript schema, never arbitrary IPC object fields.
function validate(value) {
  if (!record(value) || !Array.isArray(value.historyRows) || value.historyRows.length > 80 ||
      !Array.isArray(value.memories) || value.memories.length > 20) throw new Error('invalid')
  const historyRows = value.historyRows.map(row => {
    if (!record(row) || row.type !== 'assistant_reply' || row.finished !== true || row.source !== 'device' ||
        !role(row.messageRole) || !string(row.text, textLimit(row.messageRole)) ||
        !['deviceId', 'agentId', 'requestId', 'responseId', 'messageId'].every(key => string(row[key], 512))) throw new Error('invalid')
    return Object.fromEntries(['type', 'deviceId', 'agentId', 'requestId', 'responseId', 'messageId',
      'messageRole', 'source', 'text', 'finished'].map(key => [key, row[key]]))
  })
  const ids = new Set()
  const memories = value.memories.map(entry => {
    if (!Array.isArray(entry) || entry.length !== 2 || !string(entry[0], 512) || ids.has(entry[0]) ||
        !Array.isArray(entry[1]) || entry[1].length > 40) throw new Error('invalid')
    ids.add(entry[0])
    return [entry[0], entry[1].map(row => {
      if (!record(row) || !role(row.role) || !string(row.text, textLimit(row.role))) throw new Error('invalid')
      return { role: row.role, text: row.text }
    })]
  })
  const snapshot = { historyRows, memories }
  if (Object.hasOwn(value, 'claimOwner')) {
    const claim = value.claimOwner
    if (!record(claim) || Object.keys(claim).length !== 2 ||
        !string(claim.owner, 512) || !string(claim.tenantId, 512)) throw new Error('invalid')
    snapshot.claimOwner = { owner: claim.owner, tenantId: claim.tenantId }
  }
  return snapshot
}

export class DeviceGuestMemory {
  constructor({ file, encryption, fs = { readFile, writeFile, rename } }) {
    Object.assign(this, { file, encryption, fs })
    this.queue = Promise.resolve()
  }
  async load() {
    await this.queue
    try {
      const raw = await this.fs.readFile(this.file, 'utf8')
      if (raw.length > 96 * 1024 * 1024 || !this.encryption.isEncryptionAvailable()) return unavailable()
      const envelope = JSON.parse(raw)
      if (!record(envelope) || envelope.version !== 1 || typeof envelope.encrypted !== 'string' ||
          !/^[A-Za-z0-9+/]+={0,2}$/.test(envelope.encrypted)) return unavailable()
      const value = JSON.parse(this.encryption.decryptString(Buffer.from(envelope.encrypted, 'base64')))
      return { ok: true, ...validate(value) }
    } catch (error) {
      if (error.code === 'ENOENT') return { ok: true, historyRows: [], memories: [] }
      return unavailable()
    }
  }
  save(value) {
    let snapshot
    try { snapshot = JSON.stringify(validate(value)) } catch { return Promise.resolve(unavailable()) }
    const work = async () => {
      try {
        if (!this.encryption.isEncryptionAvailable()) return unavailable()
        const bytes = this.encryption.encryptString(snapshot)
        const envelope = JSON.stringify({ version: 1, encrypted: bytes.toString('base64') })
        await this.fs.writeFile(`${this.file}.tmp`, envelope, { mode: 0o600 })
        await this.fs.rename(`${this.file}.tmp`, this.file)
        return { ok: true }
      } catch { return unavailable() }
    }
    this.queue = this.queue.then(work, work)
    return this.queue
  }
  clear() { return this.save({ historyRows: [], memories: [] }) }
}
