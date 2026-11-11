import assert from 'node:assert/strict'

export async function verifyTaskPermissions({ app, root }) {
  const result = await app.evaluate(async ({ dialog }, root) => {
    const codex = globalThis.permissionCodex, client = globalThis.permissionHarness
    if (!codex || !client) throw new Error('permission adapters were not captured')
    const originalMessage = dialog.showMessageBox, originalOpen = dialog.showOpenDialog
    const task = { id: 'security-fixture', instruction: '检查夹具项目', cwd: root, status: 'inProgress' }
    codex.tasks.set(task.id, task)
    const calls = [], approve = (method, request, signal = new AbortController().signal) =>
      codex.approve({ method, params: { threadId: task.id, ...request } }, signal)
    try {
      dialog.showMessageBox = async (_window, options) => { calls.push(options); return { response: 1 } }
      const command = await approve('item/commandExecution/requestApproval', { command: 'fixture command; never executed' })
      const permissions = await approve('item/permissions/requestApproval', { permissions: { network: { enabled: true } } })
      const answers = await approve('item/tool/requestUserInput', { questions: [{ id: 'q', question: '继续？', options: [{ label: '继续' }] }] })
      task.external = true; task.managedTurnId = 'continued-turn'
      const continued = await approve('item/commandExecution/requestApproval', { turnId: 'continued-turn', command: 'continued fixture; never executed' })
      const external = await approve('item/commandExecution/requestApproval', { turnId: 'old-turn', command: 'must not prompt' })
      task.external = false
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] })
      const workspace = await client.authorizeTask('检查夹具目录', new AbortController().signal)
      dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] })
      const cancelledWorkspace = await client.authorizeTask('不应执行', new AbortController().signal)
      // Exercise an actual native Electron dialog: abort must close it and deny.
      dialog.showMessageBox = originalMessage
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 500)
      let cancelled
      try { cancelled = await approve('item/commandExecution/requestApproval', { command: 'cancel-only fixture' }, controller.signal) }
      finally { clearTimeout(timer) }
      return { command, permissions, answers, continued, external, workspace, cancelledWorkspace, cancelled,
        dialogs: calls.map(({ defaultId, cancelId, detail, buttons }) => ({ defaultId, cancelId, detail, buttons })) }
    } finally {
      dialog.showMessageBox = originalMessage; dialog.showOpenDialog = originalOpen
      codex.tasks.delete(task.id)
    }
  }, root)
  assert.deepEqual(result.command, { decision: 'accept' })
  assert.deepEqual(result.permissions, { permissions: { network: { enabled: true } }, scope: 'turn' })
  assert.deepEqual(result.answers, { answers: { q: { answers: ['继续'] } } })
  assert.deepEqual(result.continued, { decision: 'accept' })
  assert.deepEqual(result.external, { decision: 'decline' })
  assert.equal(result.workspace, root); assert.equal(result.cancelledWorkspace, '')
  assert.deepEqual(result.cancelled, { decision: 'decline' })
  assert.equal(result.dialogs.length, 5)
  assert.ok(result.dialogs.every(value => value.defaultId === 0 && value.cancelId === 0 && value.detail.includes(root)))
  assert.match(result.dialogs[0].detail, /fixture command; never executed/)
  return { localApproval: true, exactTurnPermissions: true, explicitWorkspace: true, nativeCancellation: true }
}
