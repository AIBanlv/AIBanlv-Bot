import { isCodexStatusCommand } from './device-task-intent.mjs'

const scopeKey = value => JSON.stringify([value?.bound, value?.owner, value?.tenantId, value?.deviceId, value?.agentId])
const label = value => String(value || '').replace(/[\r\n\t]/g, ' ').slice(0, 180)
const updated = task => Number(task.updatedAt) || 0
const statuses = { inProgress: '执行中', completed: '本轮已结束', interrupted: '已中断', failed: '失败', unknown: '状态未确认', idle: '尚未读取' }

export class RemoteCodexChat {
  constructor({ codex, context, projects = async () => [], project = () => '' }) {
    Object.assign(this, { codex, context, projects, project })
    this.sessions = new Map()
  }
  clear() { this.sessions.clear(); this.generation = (this.generation || 0) + 1 }
  async send(text, { allowComputer, sessionId = '', signal = new AbortController().signal } = {}) {
    if (allowComputer !== true) throw new Error('手机远程操作尚未授权，消息未发送到 Codex。')
    if (typeof text !== 'string' || !text.trim() || text.length > 2000 || /[\0]/.test(text)) throw new Error('请输入 1-2000 字的任务内容。')
    if (typeof sessionId !== 'string' || sessionId.length > 128) throw new Error('手机对话标识无效。')
    const scope = this.context(), expected = scopeKey(scope)
    if (!scope?.bound || !scope.owner || !scope.deviceId || !scope.agentId) throw new Error('设备绑定已失效，请重新进入远程对话。')
    if (this.scope !== expected) { this.clear(); this.scope = expected }
    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, {})
      if (this.sessions.size > 16) this.sessions.delete(this.sessions.keys().next().value)
    }
    const state = this.sessions.get(sessionId), generation = this.generation
    const isCurrent = () => this.generation === generation && scopeKey(this.context()) === expected && this.sessions.get(sessionId) === state
    const check = () => {
      signal.throwIfAborted()
      if (!isCurrent()) throw new Error('远程任务上下文已变化，请核对原会话；本次未自动重发。')
    }
    check()
    if (state.busy) throw new Error('正在提交消息，请等待发送结果。')
    state.busy = true
    try {
      await this.codex.connect(); check()
      await this.codex.monitorProject?.(); check()
      await this.codex.refresh(); check()
      const input = text.trim()
      const create = input.match(/^(?:请\s*)?(?:新建|创建)\s*(?:Codex\s*)?(?:任务|会话)(?:\s*[：:]\s*|\s+|$)([\s\S]*)$/i)
      const projectSelection = input.match(/^选择项目\s*(\d{1,2})$/)
      if (projectSelection) {
        const pending = state.pendingCreate, selected = pending?.projects[Number(projectSelection[1]) - 1]
        if (!selected) throw new Error('项目选项已失效，请重新发送新建任务要求。')
        const available = await this.projects(); check()
        if (!available.some(row => row.path === selected.path)) throw new Error('项目选项已失效，请重新选择项目。')
        state.pendingCreate = null
        return await this.create(state, pending.text, selected.path, { signal, scope, isCurrent, check })
      }
      if (create) {
        if (!create[1].trim()) return { ok: true, status: 'input-required', message: '请输入任务内容，例如“新建任务：检查项目测试”。' }
        return await this.newTask(state, create[1].trim(), { signal, scope, isCurrent, check })
      }
      const selection = input.match(/^选择任务\s*(\d{1,2})$/)
      if (selection) {
        const selected = state.choices?.[Number(selection[1]) - 1]
        if (!selected || !this.codex.tasks.has(selected)) throw new Error('任务选项已失效，请发送“任务列表”重新选择。')
        state.selectedId = selected; state.choices = null
        if (!state.pendingText) return { ok: true, status: 'selected', taskId: selected, message: `已选择 Codex 会话：${label(this.codex.tasks.get(selected).title)}。` }
        text = state.pendingText; state.pendingText = ''
      } else if (/^(?:任务列表|切换任务|切换\s*Codex\s*任务)[。！!]*$/i.test(input) || isCodexStatusCommand(input)) {
        state.pendingText = ''
        return this.choices(state, this.sortedTasks())
      } else if (state.pendingCreate) {
        state.pendingCreate.text = text
        return this.projectChoices(state)
      } else if (state.choices?.length) {
        state.pendingText = text
        return this.choices(state, state.choices.map(id => this.codex.tasks.get(id)).filter(Boolean))
      }
      if (!state.selectedId) {
        const tasks = this.sortedTasks().filter(task => ['inProgress', 'completed', 'failed', 'interrupted'].includes(task.status))
        if (!tasks.length) {
          if (this.codex.tasks.size) throw new Error('Codex 任务状态尚未确认，消息未发送，请稍后查看任务列表。')
          return await this.newTask(state, text, { signal, scope, isCurrent, check })
        }
        const active = tasks.filter(task => task.status === 'inProgress')
        const candidates = active.length ? active : tasks.filter(task => updated(task) === updated(tasks[0]))
        if (candidates.length !== 1) {
          state.pendingText = text
          return this.choices(state, candidates)
        }
        state.selectedId = candidates[0].id
      }
      if (!this.codex.tasks.has(state.selectedId)) throw new Error('已选 Codex 会话不存在，请发送“任务列表”重新选择。')
      check()
      const result = await this.codex.continue(state.selectedId, text, { signal, scope, isCurrent, queueWhileActive: true })
      check()
      return result
    } finally { state.busy = false }
  }
  async newTask(state, text, options) {
    state.pendingText = ''; state.choices = null; state.pendingCreate = null
    if (state.selectedId && !this.codex.tasks.has(state.selectedId)) throw new Error('已选会话失效，请先重新选择任务或项目。')
    const preferred = this.codex.tasks.get(state.selectedId)?.cwd || this.project()
    if (preferred) return this.create(state, text, preferred, options)
    const projects = await this.projects(); options.check()
    if (projects.length === 1) return this.create(state, text, projects[0].path, options)
    if (!projects.length) return { ok: true, status: 'selection-required', message: '尚未配置任务项目，请先在电脑的 Codex 插件中选择项目文件夹。' }
    state.pendingCreate = { text, projects: projects.slice(0, 10).map(row => ({ ...row })) }
    return this.projectChoices(state)
  }
  projectChoices(state) {
    return { ok: true, status: 'selection-required',
      message: `请选择新任务的项目：\n${state.pendingCreate.projects.map((row, i) => `${i + 1}. ${label(row.name)}：${label(row.path)}`).join('\n')}\n回复“选择项目 1”，选定后将创建刚才的任务；当前尚未创建。` }
  }
  async create(state, text, cwd, { signal, scope, isCurrent, check }) {
    check()
    const result = await this.codex.create(text, cwd, { signal, scope, isCurrent })
    check()
    if (!result.ok || !result.taskId) throw new Error('Codex 未返回新任务确认，请核对任务列表；本次未自动重建。')
    state.selectedId = result.taskId; state.pendingText = ''; state.choices = null; state.pendingCreate = null
    return result
  }
  sortedTasks() {
    return [...this.codex.tasks.values()].sort((a, b) => Number(b.status === 'inProgress') - Number(a.status === 'inProgress') ||
      updated(b) - updated(a) || a.id.localeCompare(b.id))
  }
  choices(state, tasks) {
    state.pendingCreate = null
    state.choices = tasks.slice(0, 10).map(task => task.id)
    return { ok: true, status: 'selection-required', message: tasks.length
      ? `请选择 Codex 任务：\n${tasks.slice(0, 10).map((task, i) => `${i + 1}. ${label(task.title)}（${statuses[task.status] || '状态未确认'}）\n项目：${label(task.cwd)}；编号：${label(task.id)}`).join('\n')}\n回复“选择任务 1”。${state.pendingText ? '选定后将发送刚才的要求；当前尚未发送。' : ''}`
      : '暂未发现可发送的 Codex 任务，请明确要新建的任务及项目。' }
  }
}
