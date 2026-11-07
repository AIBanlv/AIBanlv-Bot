const $ = id => document.getElementById(id)
const bridge = window.controlDevice
const time = value => value ? new Date(value).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : ''

const line = (tag, text, className) => {
  const element = document.createElement(tag)
  if (className) element.className = className
  element.textContent = text
  return element
}
// The card is what the user acts on, so a question is rendered as buttons rather
// than as another paragraph: answering out loud is optional, clicking is not.
function question(item, pending) {
  const box = line('div', '', 'workbuddy-question')
  box.append(line('p', pending.question || 'WorkBuddy 正在等你确认', 'workbuddy-ask'))
  const choices = document.createElement('div')
  choices.className = 'workbuddy-choices'
  for (const option of pending.options || []) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'plain-button'
    button.textContent = option
    button.addEventListener('click', () => answer(pending.callId, option, button))
    choices.append(button)
  }
  const form = document.createElement('form')
  form.className = 'workbuddy-answer'
  const field = document.createElement('input')
  field.type = 'text'
  field.maxLength = 200
  field.placeholder = '或者说一句你的回答'
  field.setAttribute('aria-label', '回答 WorkBuddy 的确认')
  const submit = document.createElement('button')
  submit.type = 'submit'
  submit.className = 'plain-button'
  submit.textContent = '回答'
  form.append(field, submit)
  form.addEventListener('submit', event => {
    event.preventDefault()
    if (field.value.trim()) answer(pending.callId, field.value, submit)
  })
  const ignore = document.createElement('button')
  ignore.type = 'button'
  ignore.className = 'plain-button'
  ignore.textContent = '忽略'
  ignore.addEventListener('click', () => ignore_(pending.callId, ignore))
  choices.append(ignore)
  box.append(choices, form)
  return box
}
async function answer(callId, choice, button) {
  button.disabled = true
  const result = await bridge.workbuddyAnswer(callId, choice)
  $('workbuddy-state').textContent = result?.message || '没有记录下这个回答'
  button.disabled = false
}
async function ignore_(callId, button) {
  button.disabled = true
  const result = await bridge.workbuddyIgnore(callId)
  $('workbuddy-state').textContent = result?.message || '无法忽略'
  button.disabled = false
}
function card(item) {
  const box = line('div', '', 'workbuddy-item')
  const head = line('div', '', 'workbuddy-item-head')
  head.append(line('span', item.title || item.workspace || '未命名任务', 'workbuddy-title'))
  if (item.updatedAt) head.append(line('span', time(item.updatedAt), 'secondary'))
  box.append(head)
  if (item.cwd) {
    const open = document.createElement('button')
    open.type = 'button'
    open.className = 'plain-button'
    open.textContent = '打开任务目录'
    open.addEventListener('click', () => bridge.workbuddyOpen(item.id))
    box.append(open)
  }
  if (item.reply) box.append(line('p', item.reply, 'workbuddy-reply'))
  if (item.pending) box.append(question(item, item.pending))
  return box
}
function render(value) {
  if (!value) return
  const statuses = { inProgress: '进行中', completed: '已完成', failed: '失败', interrupted: '已中断' }
  $('workbuddy-managed').replaceChildren(...(value.worker?.tasks || []).slice().reverse().map(task => {
    const article = line('article', '', 'workbuddy-item')
    article.append(line('p', `${task.title} · ${statuses[task.status] || task.status}`, 'workbuddy-title'))
    article.append(line('p', task.result || task.records?.at(-1)?.text || '等待进度', 'workbuddy-reply'))
    if (task.status === 'inProgress') {
      const stop = line('button', '停止任务', 'plain-button'); stop.type = 'button'
      stop.onclick = async () => {
        stop.disabled = true
        try { const result = await bridge.workbuddyInterrupt(task.id); if (!result.ok) $('workbuddy-state').textContent = result.message }
        catch { $('workbuddy-state').textContent = '停止请求失败，请检查任务状态' }
      }
      article.append(stop)
    }
    return article
  }))
  $('workbuddy-state').textContent = value.online
    ? (value.count ? `监控中 · ${value.count} 个任务` : '监控中 · 暂无任务')
    : '未监控'
  const list = $('workbuddy-list')
  if (!value.sessions.length) {
    list.replaceChildren(line('p', '本机还没有 WorkBuddy 任务记录。', 'secondary'))
    return
  }
  list.replaceChildren(...value.sessions.slice(0, 8).map(card))
}
$('workbuddy-announce').addEventListener('change', () => bridge.workbuddyAnnounce($('workbuddy-announce').checked))
bridge.onWorkbuddy(render)
render(await bridge.workbuddyState())
