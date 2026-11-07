import { createInterface } from 'node:readline'
const send = value => process.stdout.write(JSON.stringify(value) + '\n')
const notify = (method, params) => send({ method, params })
const tasks = new Map()
let next = 0
createInterface({ input: process.stdin }).on('line', line => {
  const { id, method, params = {}, result } = JSON.parse(line)
  if (!method) {
    if (id === 'approval' && result?.decision === 'accept') {
      const task = [...tasks.values()].at(-1)
      task.status = 'completed'
      notify('item/completed', { threadId: task.id, turnId: task.turnId, item: { id: 'answer', type: 'agentMessage', text: '任务完成 <img src=x onerror=alert(1)>' } })
      notify('turn/completed', { threadId: task.id, turn: { id: task.turnId, status: 'completed' } })
    }
    return
  }
  const reply = value => send({ id, result: value })
  if (method === 'initialize') reply({ userAgent: 'fixture' })
  else if (method === 'account/read') reply({ account: { type: 'chatgpt' }, requiresOpenaiAuth: true })
  else if (method === 'thread/start') {
    const thread = { id: `fixture-${++next}`, status: 'idle', cwd: params.cwd }
    tasks.set(thread.id, thread); reply({ thread })
  } else if (method === 'turn/start') {
    const task = tasks.get(params.threadId)
    task.turnId = `turn-${next}`; task.status = 'inProgress'
    reply({ turn: { id: task.turnId, status: task.status } })
    const scope = { threadId: task.id, turnId: task.turnId }
    notify('turn/started', { ...scope, turn: { id: task.turnId } })
    notify('turn/plan/updated', { ...scope, plan: [{ step: '检查代码和测试', status: 'in_progress' }] })
    notify('item/reasoning/textDelta', { ...scope, itemId: 'private', delta: 'PRIVATE_RAW_REASONING' })
    notify('item/reasoning/summaryTextDelta', { ...scope, itemId: 'summary', summaryIndex: 0, delta: '正在检查测试依赖。' })
    notify('item/started', { ...scope, item: { id: 'tool', type: 'commandExecution', command: 'node --test', cwd: task.cwd } })
    if (!params.input[0].text.includes('hold')) setTimeout(() => send({ id: 'approval', method: 'item/commandExecution/requestApproval', params: { ...scope, itemId: 'tool', command: 'node --test', reason: '需要运行测试' } }), 50)
  } else if (method === 'turn/interrupt') {
    const task = tasks.get(params.threadId); task.status = 'interrupted'
    reply({}); notify('turn/completed', { threadId: task.id, turn: { id: task.turnId, status: 'interrupted' } })
  } else if (method === 'thread/read') {
    const task = tasks.get(params.threadId)
    reply({ thread: { ...task, turns: [{ id: task.turnId, status: task.status }] } })
  } else if (method === 'thread/list') reply({ data: [...tasks.values()].filter(task => !params.cwd || task.cwd === params.cwd) })
  else if (method === 'thread/turns/list') {
    const task = tasks.get(params.threadId)
    reply({ data: task?.turnId ? [{ id: task.turnId, status: task.status }] : [] })
  } else if (method === 'thread/items/list') reply({ data: [] })
})
