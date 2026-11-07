const $ = id => document.getElementById(id)
const bridge = window.controlDevice
const labels = { disconnected: '未连接', connecting: '连接中', ready: '已连接', error: '连接异常' }
const statuses = { idle: '未开始', inProgress: '进行中', completed: '本轮已结束', interrupted: '已中断', failed: '失败', unknown: '状态待确认' }
let creating = false
function update(value) {
  if (!value) return
  $('codex-state').textContent = labels[value.status] || '未连接'
  $('codex-status').textContent = value.monitorError ? 'Codex 已连接，但任务同步失败，请刷新重试或到原窗口核对。' : value.message || ''
  $('codex-connect').disabled = ['ready', 'connecting'].includes(value.status)
  $('codex-disconnect').disabled = value.status === 'disconnected'
  const openTasks = new Set([...$('codex-tasks').children].filter(article => article.querySelector('details')?.open).map(article => article.dataset.id))
  $('codex-tasks').replaceChildren(...value.tasks.slice().reverse().map(task => {
    const article = document.createElement('article'); article.className = 'workbuddy-item'; article.dataset.id = task.id
    const title = document.createElement('p'); title.className = 'workbuddy-title'
    title.textContent = `${task.title} · ${statuses[task.status] || task.status}`
    const details = document.createElement('details'), summary = document.createElement('summary')
    details.open = openTasks.has(task.id)
    summary.textContent = '查看任务记录'
    const records = document.createElement('div'); records.className = 'codex-record'
    records.textContent = [task.currentRequest ? `本轮要求：${task.currentRequest}` : '', task.syncError, ...task.records.map(row => row.text)].filter(Boolean).join('\n\n') || '等待进度'
    details.append(summary, records); article.append(title, details)
    if (task.status === 'inProgress' && !task.external) {
      const stop = document.createElement('button'); stop.type = 'button'; stop.className = 'plain-button'; stop.textContent = '停止任务'
      stop.onclick = async () => { stop.disabled = true; const result = await bridge.codexInterrupt(task.id); if (!result.ok) $('codex-status').textContent = result.message }
      article.append(stop)
    }
    return article
  }))
}
async function action(work) {
  try { const result = await work(); if (result?.ok === false) $('codex-status').textContent = result.message }
  catch { $('codex-status').textContent = '操作失败，请检查 Codex 连接后重试' }
}
$('codex-connect').onclick = () => action(() => bridge.codexConnect())
$('codex-disconnect').onclick = () => action(() => bridge.codexDisconnect())
$('codex-announce').onchange = () => bridge.codexAnnounce($('codex-announce').checked)
bridge.onCodex(update)
update(await bridge.codexState())
