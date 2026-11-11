const methods = new Set(['item/commandExecution/requestApproval', 'item/fileChange/requestApproval',
  'item/permissions/requestApproval', 'item/tool/requestUserInput'])

// Only an explicit response from the local UI grants additional authority.
// Model plan review is separate and cannot answer this callback.
export async function reviewTaskRequest({ confirm, task, method, params, signal }) {
  const deny = method === 'item/tool/requestUserInput' ? { answers: {} }
    : method === 'item/permissions/requestApproval' ? { permissions: {}, scope: 'turn' } : { decision: 'decline' }
  if (!methods.has(method) || typeof confirm !== 'function' || !task ||
    task.external && (!params?.turnId || task.managedTurnId !== params.turnId) || !task.instruction || !task.cwd
    || task.status && task.status !== 'inProgress' || signal?.aborted) return deny
  try {
    const request = structuredClone(params)
    const context = { task: task.instruction, workspace: task.cwd, method, request }
    // Never approve a request whose full scope cannot be displayed.
    if (!request || JSON.stringify(context).length > 24000) return deny
    if (Array.isArray(request.availableDecisions) && !request.availableDecisions.includes('accept')) return deny
    const result = await confirm(context, signal)
    if (signal?.aborted || !result || result.decision !== 'allow') return deny
    if (method === 'item/tool/requestUserInput') {
      const answers={}
      for(const question of request.questions || []) {
        const selected=result.answers?.[question.id]
        if(!question.options?.some(option=>option.label===selected))return deny
        answers[question.id]={ answers:[selected] }
      }
      return { answers }
    }
    if (method === 'item/permissions/requestApproval') return { permissions:request.permissions || {},scope:'turn' }
    return { decision:'accept' }
  } catch { return deny }
}

export async function confirmTaskRequest(context, signal, showMessageBox) {
  const abort = AbortSignal.any([AbortSignal.timeout(120000), ...(signal ? [signal] : [])])
  const base = { type: 'question', title: 'Codex 任务确认', defaultId: 0, cancelId: 0, noLink: true, signal: abort }
  const detail = `任务：${context.task}\n工作目录：${context.workspace}\n\n请求详情：\n${JSON.stringify(context.request, null, 2)}`
  const ask = async options => {
    abort.throwIfAborted()
    const result = await showMessageBox({ ...base, ...options })
    abort.throwIfAborted()
    return result.response
  }
  if (context.method === 'item/tool/requestUserInput') {
    const questions = context.request.questions
    if (!Array.isArray(questions) || !questions.length || questions.length > 8) return { decision: 'deny' }
    const answers = Object.create(null)
    for (const question of questions) {
      if (typeof question.id !== 'string' || typeof question.question !== 'string' || !Array.isArray(question.options)
        || !question.options.length || question.options.length > 8 || question.options.some(option => typeof option.label !== 'string' || !option.label || option.label.length > 200)) return { decision: 'deny' }
      const response = await ask({ message: question.question, detail, buttons: ['取消', ...question.options.map(option => option.label)] })
      if (!question.options[response - 1]) return { decision: 'deny' }
      answers[question.id] = question.options[response - 1].label
    }
    return { decision: 'allow', answers }
  }
  const message = context.method === 'item/permissions/requestApproval'
    ? '是否授予详情中列出的额外权限？权限持续到本轮任务结束。'
    : '是否允许详情中的操作？请核对命令、路径和网络访问范围。'
  return { decision: await ask({ message, detail, buttons: ['拒绝', '允许此次请求'] }) === 1 ? 'allow' : 'deny' }
}
