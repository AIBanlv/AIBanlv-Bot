// Guest transcripts are memory-only. A confirmed binding claims them once;
// DeviceRemoteReplies owns acknowledgement/retry after that handoff.
export class DeviceGuestHistory {
  constructor() { this.rows = []; this.turn = null }
  accept(event, context) {
    if (context.bound) { this.turn = null; return }
    if (event.type === 'preparing') this.turn = { id: event.requestId, context: { ...context }, user: '', assistant: '' }
    const turn = this.turn
    if (!turn || turn.id !== event.requestId) return
    if (turn.context.agentId !== context.agentId) { this.turn = null; return }
    if (event.type === 'user') turn.user = String(event.text || '').slice(0, 4000)
    if (event.type === 'assistant') turn.assistant = String(event.text || '').slice(0, 16000)
    if (event.type === 'done') {
      for (const role of ['user', 'assistant']) if (turn[role]) this.rows.push({
        type: 'assistant_reply', deviceId: context.deviceId, agentId: context.agentId,
        requestId: turn.id, responseId: turn.id, messageId: `guest-${context.deviceId}-${turn.id}-${role}`,
        messageRole: role, source: 'device', text: turn[role], finished: true,
      })
      this.rows = this.rows.slice(-80)
      this.turn = null
    } else if (['error', 'reset', 'stopped', 'interrupted'].includes(event.type)) this.turn = null
  }
  claim(context, deliver) {
    if (!context.bound || !context.owner || !context.tenantId) return
    const rows = this.rows.splice(0)
    this.turn = null
    for (const row of rows) deliver(row, { ...context, agentId: row.agentId })
  }
}
