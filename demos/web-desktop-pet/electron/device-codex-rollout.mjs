import { open, realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'

const text = (value, limit = 4000) => typeof value === 'string' ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(-limit) : ''
const messageText = content => (Array.isArray(content) ? content : []).filter(part => ['input_text','output_text','text'].includes(part.type)).map(part => text(part.text)).join('\n')
const inside = (root, file) => { const relative = path.relative(root, file); return relative && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative) }

// Another app-server can normalize an unfinished *external* rollout to
// interrupted. Only the original writer's explicit lifecycle records establish
// that status. Read bounded local tails, never resume/interrupt the foreign run.
export class CodexRolloutReader {
  constructor({ home = process.env.CODEX_HOME || path.join(homedir(), '.codex'), maxBytes = 2 * 1024 * 1024 } = {}) {
    this.home = home; this.maxBytes = maxBytes; this.cache = new Map()
  }
  async read({ id, file }) {
    let handle
    try {
      if (typeof file !== 'string' || !path.isAbsolute(file) || !/^[\w-]+$/.test(id) ||
          !path.basename(file).endsWith(`-${id}.jsonl`)) return null
      const root = await realpath(path.join(this.home, 'sessions')), resolved = await realpath(file)
      if (!inside(root, resolved)) return null
      handle = await open(resolved, 'r')
      const info = await handle.stat()
      if (!info.isFile()) return null
      let cached = this.cache.get(resolved)
      if (!cached || info.size < cached.offset || info.ino !== cached.ino) cached = { offset: 0, ino: info.ino, state: null }
      const start = Math.max(cached.offset, info.size - this.maxBytes), bytes = Buffer.alloc(info.size - start)
      const { bytesRead } = await handle.read(bytes, 0, bytes.length, start)
      const source = bytes.subarray(0, bytesRead), end = source.lastIndexOf(10)
      if (start > cached.offset) cached.state = null
      if (end >= 0) {
        const lines = source.subarray(0, end).toString('utf8').split('\n')
        if (start > cached.offset) lines.shift()
        for (const line of lines) {
          let row; try { row = JSON.parse(line) } catch { continue }
          const p = row.payload || {}, at = Date.parse(row.timestamp)
          if (row.type === 'event_msg' && p.type === 'task_started' && typeof p.turn_id === 'string') {
            cached.state = { turnId: p.turn_id, status: 'inProgress', items: [], startedAt: at }
          } else if (row.type === 'event_msg' && ['task_complete','turn_aborted'].includes(p.type) && typeof p.turn_id === 'string') {
            if (cached.state?.turnId !== p.turn_id) cached.state = { turnId: p.turn_id, items: [] }
            cached.state.status = p.type === 'turn_aborted' ? 'interrupted' : 'completed'
            cached.state.finishedAt = at
            if (p.type === 'task_complete' && typeof p.last_agent_message === 'string' && p.last_agent_message.trim())
              cached.state.items.push({ id: `final:${p.turn_id}`, type: 'agentMessage', phase: 'final_answer', text: text(p.last_agent_message) })
          } else if (cached.state?.status === 'inProgress' && row.type === 'response_item' && p.type === 'message') {
            // Only visible user text and explicitly public assistant phases.
            // Raw reasoning, tool arguments/output and compaction are ignored.
            const content = messageText(p.content)
            if (content && p.role === 'user') cached.state.items.push({ id: p.id || `user:${at}`, type: 'userMessage', content: [{ type: 'text', text: text(content, 1200) }] })
            else if (content && p.role === 'assistant' && ['commentary','partial_answer','final_answer'].includes(p.phase))
              cached.state.items.push({ id: p.id || `message:${at}`, type: 'agentMessage', phase: p.phase, text: content })
          }
          if (cached.state) {
            const request = cached.state.items.findLast(item => item.type === 'userMessage')
            cached.state.items = cached.state.items.filter(item => item.type !== 'userMessage').slice(-24)
            if (request) cached.state.items.unshift(request)
          }
        }
        cached.offset = start + end + 1
      }
      this.cache.delete(resolved); this.cache.set(resolved, cached)
      while (this.cache.size > 128) this.cache.delete(this.cache.keys().next().value)
      return cached.state ? { ...cached.state, items: cached.state.items.map(item => ({ ...item })), modifiedAt: info.mtimeMs } : null
    } catch { return null }
    finally { await handle?.close() }
  }
}
