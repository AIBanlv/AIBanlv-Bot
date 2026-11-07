import { randomUUID } from 'node:crypto'

const failure = message => Object.assign(new Error(message), { code: 'REMINDER_FAILED' })
const messages = { SERVER_UPDATE_REQUIRED: '后端尚未接入桌面提醒，请更新控制服务', BIND_REQUIRED: '请先绑定账号',
  PAIRING_PROOF_REQUIRED: '请重新扫码验证设备授权', TIMEOUT: '保存结果未确认，请刷新任务列表核对，不要重复创建',
  REMINDERS_DISABLED: '服务端提醒调度未启用，请联系管理员', INVALID_ACTION: '提醒内容或时间无效，请明确日期、时间和重复规则',
  FORBIDDEN: '当前账号无权访问该提醒' }
export class DeviceReminders {
  constructor({ services, context }) { Object.assign(this, { services, context }); this.issued = new Map() }
  async execute(args, { signal, requests = new Map() } = {}) {
    signal?.throwIfAborted()
    const scope = this.context()
    if (!scope?.bound || !scope.owner || !scope.tenantId || !scope.agentId) throw failure('请先绑定账号并加载角色')
    if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).some(key =>
      !['operation', 'content', 'date', 'time', 'repeat', 'page', 'id'].includes(key))) throw failure('提醒参数无效，不允许指定其他账号或角色')
    const operation = { create: 'memo_create', list: 'memo_list', delete: 'memo_delete' }[args.operation]
    if (!operation) throw failure('提醒操作无效')
    let payload
    if (args.operation === 'create') {
      if (typeof args.content !== 'string' || !args.content.trim() || args.content.length > 1000 ||
        !/^\d{2}:\d{2}$/.test(args.time || '') || !['none', 'daily'].includes(args.repeat) ||
        args.repeat === 'none' && !/^\d{4}-\d{2}-\d{2}$/.test(args.date || '')) throw failure('请明确提醒内容、日期、时间和重复规则，不猜测模糊时间')
      payload = { content: args.content.trim(), date: args.date || '', time: args.time, repeat: args.repeat,
        agentId: scope.agentId, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai', language: 'zh-CN' }
    } else if (args.operation === 'list') {
      if (args.page !== undefined && (!Number.isInteger(args.page) || args.page < 1 || args.page > 10000)) throw failure('提醒页码无效')
      payload = { page: args.page || 1 }
    } else {
      if (typeof args.id !== 'string' || !args.id || args.id.length > 64) throw failure('请先查询提醒，使用返回的真实编号删除')
      if (this.issued.get(args.id) !== JSON.stringify([scope.owner, scope.tenantId])) throw failure('请先查询提醒，再使用返回的真实编号删除')
      payload = { id: args.id }
    }
    const key = JSON.stringify([scope.owner, scope.tenantId, scope.agentId, operation, payload])
    if (!requests.has(key)) requests.set(key, randomUUID())
    const requestId = requests.get(key)
    if (operation !== 'memo_list') payload.requestId = requestId
    const result = await this.services.request(operation, payload, requestId)
    signal?.throwIfAborted()
    const current = this.context()
    if (!current.bound || current.owner !== scope.owner || current.tenantId !== scope.tenantId || current.agentId !== scope.agentId)
      throw failure('绑定或角色已变化，请在任务列表核对原请求结果')
    if (!result?.ok) throw failure(messages[result?.code] || '提醒请求失败，尚未确认保存，请查看任务列表')
    if (operation === 'memo_create' && (!result.data?.id || !result.data?.status)) throw failure('服务端未返回已保存提醒，结果未确认')
    if (operation === 'memo_list') {
      if (!Array.isArray(result.data?.records) || !Number.isFinite(Number(result.data.total))) throw failure('提醒列表结果无效，请刷新核对')
      for (const row of result.data?.records || []) if (typeof row?.id === 'string') this.issued.set(row.id, JSON.stringify([scope.owner, scope.tenantId]))
      while (this.issued.size > 100) this.issued.delete(this.issued.keys().next().value)
    }
    return result
  }
}
