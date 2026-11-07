import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import { naturalMessages } from '../src/natural-messages.mjs'

function visibleReply(text) {
  let depth = 0, visible = ''
  for (const character of text) {
    if (character === '[') depth++
    else if (character === ']') depth = Math.max(0, depth - 1)
    else if (!depth) visible += character
  }
  return visible.trim()
}

// Shared, memory-only activity feed. No credentials or raw reasoning enter it.
export class DeviceActivity extends EventEmitter {
  constructor() { super(); this.rows = []; this.sequence = 0 }
  add(source, kind, text, key = randomUUID()) {
    if (typeof text !== 'string' || !text.trim()) return
    const id = `${source}:${key}`, previous = this.rows.find(row => row.id === id)
    const limit = ['user', 'reply'].includes(kind) ? 16000 : 4000
    if (previous?.text === text.slice(0, limit) && previous.kind === kind) return
     const row = { id, source, kind, text: text.slice(0, limit), at: previous?.at ?? Date.now(), revision: this.sequence + 1 }
    // A streaming reply updates in place so it never jumps past a newer event.
    if (previous) this.rows[this.rows.indexOf(previous)] = row
    else this.rows.push(row)
    this.rows = this.rows.slice(-100)
    this.sequence++
    this.publish()
  }
  publish() { this.timer ||= setTimeout(() => { this.timer = null; this.emit('state', this.snapshot()) }, 40) }
  conversation(data, name = '数字人') {
    if (data.type === 'reset') { this.clearConversation(); return }
    if (data.type === 'preparing') {
      this.turn = { id: data.requestId, name: name || '数字人' }
      return
    }
    const turn = this.turn
    if (!turn || data.requestId && data.requestId !== turn.id) return
    if(data.type==='done' && turn.raw!==undefined) {
      naturalMessages(turn.raw,true).forEach((text,index)=>this.add(turn.name,'reply',text,
        `conversation:${turn.id}:reply${index?`:${index+1}`:''}`))
      return
    }
    if (['stopped', 'error', 'interrupted', 'complete'].includes(data.type)) { this.turn = null; return }
    if (!['user', 'assistant'].includes(data.type) || data.requestId !== turn.id || typeof data.text !== 'string') return
    // Touch wrappers are observations, not words the user actually spoke.
    if (data.type === 'user' && data.input === 'touch') return
    const source = data.type === 'user' ? '我' : turn.name
    const kind = data.type === 'user' ? 'user' : 'reply'
    if (kind === 'reply') {
      turn.raw=data.text
      const parts = naturalMessages(data.text)
      const prefix=`${source}:conversation:${turn.id}:${kind}`
      const retained=this.rows.filter(row=>!row.id.startsWith(prefix) || parts.some((_,index)=>row.id===prefix+(index?`:${index+1}`:'')))
      if(retained.length!==this.rows.length){this.rows=retained;this.sequence++;this.publish()}
      parts.forEach((text, index) => this.add(source, kind, text,
        `conversation:${turn.id}:${kind}${index ? `:${index + 1}` : ''}`))
      return
    }
    const text = data.text
    const key = `conversation:${turn.id}:${kind}`
    if (!text.trim()) {
      const size = this.rows.length
      this.rows = this.rows.filter(row => row.id !== `${source}:${key}`)
      if (this.rows.length !== size) { this.sequence++; this.publish() }
      return
    }
    this.add(source, kind, text, key)
  }
  clearConversation() {
    this.turn = null
    this.rows = this.rows.filter(row => !['user', 'reply'].includes(row.kind))
    this.sequence++; this.publish()
  }
  clear() { clearTimeout(this.timer); this.timer = null; this.turn = null; this.rows = []; this.sequence++; this.emit('state', this.snapshot()) }
  snapshot() { return { sequence: this.sequence, rows: this.rows.map(row => ({ ...row })) } }
}
