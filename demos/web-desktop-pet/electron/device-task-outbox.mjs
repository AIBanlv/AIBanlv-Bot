import { readFile, writeFile, rename } from 'node:fs/promises'
import { createHash } from 'node:crypto'

// Encrypted, account-scoped completion outbox. A server acknowledgement means
// stored/accepted; it never means a phone has displayed the notification.
export class TaskReportOutbox {
  constructor({ file, encryption, context, deliver, now = Date.now }) {
    Object.assign(this, { file, encryption, context, deliver, now }); this.rows = []; this.writes = Promise.resolve()
  }
  async load() {
    try {
      const raw = await readFile(this.file, 'utf8')
      if (raw.length > 512000 || !this.encryption.isEncryptionAvailable()) return
      const rows = JSON.parse(this.encryption.decryptString(Buffer.from(raw, 'base64')))
      this.rows = Array.isArray(rows) ? rows.filter(row => row?.scope && row?.payload?.eventId && row.expiresAt > this.now()).slice(-64).map(row=>({...row,reviewing:false})) : []
    } catch { this.rows = [] }
  }
  save() {
    const rows = JSON.stringify(this.rows)
    this.writes = this.writes.catch(() => {}).then(async () => {
      if (!this.encryption.isEncryptionAvailable()) return
      await writeFile(`${this.file}.tmp`, this.encryption.encryptString(rows).toString('base64'), { mode: 0o600 })
      await rename(`${this.file}.tmp`, this.file)
    })
    return this.writes
  }
  add(provider, value, scope = this.context(), {defer=false} = {}) {
    if (!scope?.bound || !scope.owner || !scope.tenantId || !scope.agentId || value.progress || !value.text?.trim() || !value.id) return
    const current=this.context()
    if(current?.owner!==scope.owner || current?.tenantId!==scope.tenantId || current?.deviceId!==scope.deviceId)return
    const eventId = createHash('sha256').update(JSON.stringify([scope.tenantId, scope.owner, scope.deviceId, provider, value.id, value.eventId || 'completed'])).digest('hex')
    if (this.rows.some(row => row.payload.eventId === eventId)) return eventId
    this.rows.push({ scope: { ...scope }, reviewing:defer, expiresAt: this.now() + 7 * 86400000,
      payload: { provider, taskId: String(value.id).slice(0, 256), eventId, agentId: scope.agentId, content: value.text.slice(0, 1000) } })
    this.rows = this.rows.slice(-64); void this.save().catch(()=>{}); void this.flush().catch(()=>{})
    return eventId
  }
  finalize(eventId,content) {
    const row=this.rows.find(item=>item.payload.eventId===eventId)
    if(!row)return
    if(typeof content==='string'&&content.trim())row.payload.content=content.slice(0,1000)
    row.reviewing=false;void this.save().catch(()=>{});void this.flush().catch(()=>{})
  }
  discard(eventId) { this.rows = this.rows.filter(row => row.payload.eventId !== eventId); void this.save().catch(()=>{}) }
  async flush() {
    if (this.flushing) return
    this.flushing = true
    try {
      for (const row of [...this.rows]) {
        if(row.reviewing)continue
        const context = this.context()
        if (!context?.bound || row.scope.owner !== context.owner || row.scope.tenantId !== context.tenantId || row.scope.deviceId !== context.deviceId) continue
        if (row.expiresAt <= this.now()) { this.rows = this.rows.filter(item => item !== row); continue }
        let result
        try { result = await this.deliver(row.payload) } catch { continue }
        const status=result?.data?.deliveryStatus
        if (result?.ok && (!status || ['websocket_delivered','push_accepted','cancelled'].includes(status)))
          this.rows = this.rows.filter(item => item !== row)
      }
      await this.save()
    } finally { this.flushing = false }
  }
  clear() { this.rows = []; return this.save() }
}
