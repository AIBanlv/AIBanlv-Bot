const bridge = window.controlDevice
const panel = document.getElementById('chat-bubbles-panel')
const summary = document.getElementById('task-summary')
const records = document.getElementById('task-records')
const labels = { user: '对话', reply: '对话', status: '状态', summary: '进度摘要', plan: '任务计划', tool: '操作', output: '执行输出', message: '回复', approval: '等待确认', error: '异常' }
function timestamp(value) {
  if (!Number.isFinite(value) || value <= 0) return ''
  const date = new Date(value), pad = n => String(n).padStart(2, '0')
  if (!Number.isFinite(date.getTime())) return ''
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}
for (const event of ['pointerenter', 'pointerleave', 'focusin', 'focusout']) panel.addEventListener(event, () => {
  queueMicrotask(() => {
    const expanded = panel.dataset.tasks === 'true' && (panel.matches(':hover') || panel.contains(document.activeElement))
    if (expanded && summary.getAttribute('aria-expanded') !== 'true') records.scrollTop = records.scrollHeight
    summary.setAttribute('aria-expanded', String(expanded))
    bridge.activityExpanded(expanded)
  })
})
let sequence = -1
function update(value) {
  if (value?.sequence < sequence) return
  sequence = value?.sequence ?? sequence
  const rows = value?.rows || []
  summary.hidden = !rows.length
  records.hidden = !rows.length
  panel.dataset.tasks = String(Boolean(rows.length))
  if (!rows.length) { records.replaceChildren(); summary.setAttribute('aria-expanded', 'false'); bridge.activityExpanded(false); return }
  const last = rows.reduce((latest, row) => (row.revision || row.at) >= (latest.revision || latest.at) ? row : latest)
  summary.textContent = `实时信息 · ${last.source}：${last.text.replace(/\s+/g, ' ').slice(-100)}`
  const follow = records.scrollHeight - records.scrollTop - records.clientHeight < 30
  const visible = rows.slice(-40), ids = new Set(visible.map(row => row.id))
  const existing = new Map([...records.children].map(element => [element.dataset.id, element]))
  for (const [id, article] of existing) if (!ids.has(id)) article.remove()
  for (const row of visible) {
    let article = existing.get(row.id)
    if (!article) {
      article = document.createElement('article'); article.className = 'task-record'; article.dataset.id = row.id
      article.append(document.createElement('small'), document.createElement('p'))
      records.append(article)
      existing.set(row.id, article)
    }
    article.dataset.kind = row.kind
    const time = ['user', 'reply'].includes(row.kind) ? timestamp(row.at) : ''
    article.firstChild.textContent = `${row.source}${time ? ` · ${time}` : ''} / ${labels[row.kind] || '进展'}`
    if (article.lastChild.textContent !== row.text) article.lastChild.textContent = row.text
  }
  // Snapshot updates may reintroduce an earlier row after the visible window slides.
  for (const [index, row] of visible.entries()) {
    const article = existing.get(row.id)
    if (records.children[index] !== article) records.insertBefore(article, records.children[index] || null)
  }
  if (follow) records.scrollTop = records.scrollHeight
}
bridge.onActivity(update)
update(await bridge.activityState())
