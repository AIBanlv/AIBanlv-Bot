import { t } from './device-i18n.mjs'
import { conversationInputResult } from './device-pet-policy.mjs'

const $ = id => document.getElementById(id), bridge = window.controlDevice
const navigate = page => window.dispatchEvent(new CustomEvent('navigate-settings', { detail: page }))
const node = (tag, value, className) => { const item = document.createElement(tag); if (value !== undefined) item.textContent = value; if (className) item.className = className; return item }
const clean = value => String(value || '').replace(/\[perform:[^\]]*\]/g, '').replace(/\[msg_end\]/g, '\n').trim()
let state, selected = '', opening = 0, busy = false, messages = [], editing = '', editorMode = 'local', media = {}, saving = false, creationId = '', listKey = '', postKey = ''
const kindNames = { public: '线上公共', private: '线上私有', local: '本地私有' }
const expanded = new Set()
let messageNodes = new Map()
function photo(image, url) { image.src = url || '/device/logo.png'; image.onerror = () => { image.onerror = null; image.src = '/device/logo.png' } }
const roles = () => state?.roles || []
const current = () => roles().find(row => row.agentId === selected)
function controls() {
  const role = current(), access = state ? conversationInputResult(state) : { ok: false, message: '请先选择角色' }
  const ready = role && state.current?.agentId === selected && access.ok
  $('character-chat-funding').hidden = !role
  $('character-chat-funding').textContent = !role ? '' : t(role.source === 'local'
    ? '本地角色 · 使用本地配置，不消耗 AIBanlv 积分；模型费用由自己的服务商账号承担。'
    : '线上角色 · 使用 AIBanlv 在线积分，不使用本地 Key。')
  $('character-chat-send').disabled = busy || !ready
  $('character-message').disabled = busy || !ready
  const reason = role && !access.ok ? access.message : ''
  $('character-message').placeholder = t(reason || '说点什么…')
  $('character-chat-access').textContent = t(reason)
  $('character-chat-access').hidden = !reason
  $('character-chat-stop').hidden = !busy
  $('character-edit').hidden = !role?.local
  $('character-documents').hidden = !role?.local
  $('sidebar-character-new').disabled = !state?.localWorkspace?.configured && state?.binding !== 'bound'
  if (!roles().length) $('characters-status').textContent = t('请先配置本地 Key 或扫码绑定，再添加或选择角色。')
}
function renderList() {
  const query = $('character-search').value.trim().toLocaleLowerCase()
  const key = JSON.stringify([roles(), selected, query])
  if (key === listKey) { controls(); return }
  listKey = key
  const groups = []
  for (const kind of ['public', 'private', 'local']) {
    const entries = roles().filter(role => (role.kind || 'public') === kind && `${role.agentName} ${role.description || ''}`.toLocaleLowerCase().includes(query))
    const section = node('details', undefined, 'character-group'), heading = node('summary', undefined, 'character-group-title')
    section.dataset.kind = kind; section.open = Boolean(query && entries.length) || expanded.has(kind)
    heading.append(node('span', t(kindNames[kind])), node('small', String(entries.length)))
    section.append(heading)
    section.addEventListener('toggle', () => { if (!query) { if (section.open) expanded.add(kind); else expanded.delete(kind) } })
    for (const role of entries) {
      const button = node('button', undefined, 'character-row'), avatar = node('img'), info = node('div')
      button.type = 'button'; button.classList.toggle('selected', selected === role.agentId); button.setAttribute('aria-pressed', String(selected === role.agentId))
      avatar.alt = ''; avatar.loading = 'lazy'; photo(avatar, role.agentPhotoUrl)
      info.append(node('strong', role.agentName || role.agentId))
      button.append(avatar, info); button.onclick = () => { navigate('characters'); void open(role.agentId) }; section.append(button)
    }
    if (!entries.length) section.append(node('p', t('暂无角色'), 'character-empty'))
    groups.push(section)
  }
  $('character-list').replaceChildren(...groups)
  controls()
}
function renderMessages() {
  const role = current(), history = $('character-chat-history'), next = new Map()
  for (const [index, row] of messages.slice(-400).entries()) {
    let view = messageNodes.get(row)
    if (!view) {
      const item = node('article', undefined, `character-message ${row.role}`)
      const avatar = node('img', undefined, 'character-message-avatar'), body = node('div', undefined, 'character-message-body')
      const title = node('small'), content = node('p')
      body.append(title, content); item.append(avatar, body)
      view = { item, avatar, title, content, timestamp: row.timestamp || Date.now() }
    }
    const title = `${row.role === 'user' ? t('我') : role?.agentName || t('角色')} · ${new Date(view.timestamp).toLocaleString()}`
    const text = row.role === 'assistant' ? clean(row.text) : row.text
    if (view.title.textContent !== title) view.title.textContent = title
    if (view.content.textContent !== text) view.content.textContent = text
    const url = (row.role === 'assistant' ? role?.agentPhotoUrl : '') || '/device/logo.png'
    if (view.url !== url) { photo(view.avatar, url); view.url = url }
    view.avatar.alt = row.role === 'assistant' ? role?.agentName || t('角色') : t('我')
    if (history.children[index] !== view.item) history.insertBefore(view.item, history.children[index] || null)
    next.set(row, view)
  }
  for (const [row, view] of messageNodes) if (!next.has(row)) view.item.remove()
  messageNodes = next
  history.scrollTop = history.scrollHeight
}
async function open(id) {
  const ticket = ++opening, role = roles().find(row => row.agentId === id)
  if (!role) return
  selected = id; messages = []; busy = false; renderList(); renderMessages()
  $('character-chat-name').textContent = role.agentName
  $('characters-status').textContent = t('正在加载对话…')
  $('character-message').focus({ preventScroll: true })
  try {
    const result = await bridge.openRole(id)
    if (ticket !== opening) return
    if (!result?.ok) { $('characters-status').textContent = result?.message || t('角色对话加载失败，请重试'); return }
    const history = (result.history || []).filter(row => ['user', 'assistant'].includes(row.role)).slice(-400)
    // Live snapshots can arrive while history is loading. Retain them and remove
    // only an exact overlapping suffix/prefix, not repeated ordinary messages.
    let overlap = Math.min(history.length, messages.length)
    while (overlap && !history.slice(-overlap).every((row, index) => row.role === messages[index].role && row.text === messages[index].text)) overlap--
    messages = [...history, ...messages.slice(overlap)].slice(-400)
    if (result.role) state.roles = roles().map(item => item.agentId === id ? { ...item, ...result.role } : item)
    renderMessages(); $('characters-status').textContent = ''
  } catch { if (ticket === opening) $('characters-status').textContent = t('角色对话加载失败，请重试') }
  finally { if (ticket === opening) controls() }
}
function mode(value) {
  if (saving) return
  const local = state?.localWorkspace?.configured, online = state?.binding === 'bound'
  editorMode = value === 'local' && local ? 'local' : online ? 'online' : 'local'
  $('character-mode-local').hidden = !local; $('character-mode-online').hidden = !online
  $('character-mode-local').setAttribute('aria-pressed', String(editorMode === 'local'))
  $('character-mode-online').setAttribute('aria-pressed', String(editorMode === 'online'))
  $('character-lam-field').hidden = editorMode !== 'local'
  $('character-online-consent-field').hidden = editorMode !== 'online'
  $('character-prompt').maxLength = editorMode === 'local' ? 32000 : 5000
  $('character-editor-help').textContent = t(editorMode === 'local'
    ? 'LAM 资产包可选：不导入则沿用当前数字人形象，不影响对话。声音文件仍需上传；人设和记录仅保存在本机。照片可选，用于列表头像。'
    : '上传照片和声音，创建当前账号的私有角色，可与手机同步。')
}
function editor(role) {
  if (saving) return
  editing = role?.agentId || ''; media = {}; creationId = crypto.randomUUID(); $('character-online-consent').checked = false
  $('character-editor-title').textContent = t(editing ? '编辑角色' : '新增角色')
  $('character-name').value = role?.agentName || ''; $('character-description').value = role?.description || ''
  $('character-prompt').value = role?.characterSetting || ''
  for (const kind of ['lam', 'voice', 'photo']) $(`character-${kind}-name`).textContent = ''
  photo($('character-photo-preview'), role?.agentPhotoUrl)
  $('character-save-status').textContent = ''
  mode(role?.local || state?.localWorkspace?.configured ? 'local' : 'online')
  $('character-mode-tabs').hidden = Boolean(editing)
  navigate('character-editor')
}
function renderLocalMoments() {
  const workspace = state?.localWorkspace, posts = workspace?.moments || []
  $('local-moments-panel').hidden = !workspace?.configured && !posts.length
  $('local-moments-status').textContent = workspace?.error || (!posts.length ? t('今天聊过天的本地角色，会在软件运行时随机分享一条动态。') : '')
  const key = JSON.stringify(posts)
  if (key === postKey) return
  postKey = key
  $('local-moments-feed').replaceChildren(...posts.map(post => {
    const card = node('article', undefined, 'moment-card'), avatar = node('img', undefined, 'moment-avatar'), body = node('div', undefined, 'moment-body')
    photo(avatar, roles().find(row => row.agentId === post.agentId)?.agentPhotoUrl); avatar.alt = ''
    body.append(node('strong', `${post.authorName} · ${t('本地私有')}`), node('p', post.content, 'moment-content'), node('small', new Date(post.timestamp).toLocaleString(), 'secondary'))
    card.append(avatar, body); return card
  }))
}
function update(next) {
  if (!next) return
  const previousScope = state?.accountScope
  state = next
  if (selected && !roles().some(role => role.agentId === selected)) { selected = ''; messages = []; busy = false; opening++; renderMessages() }
  if (previousScope !== undefined && previousScope !== state.accountScope && current()?.kind !== 'local') {
    opening++; messages = []; busy = false; renderMessages()
  }
  if (state.localWorkspace) $('local-auto-moments').checked = state.localWorkspace.momentsEnabled !== false
  renderList(); renderLocalMoments()
  $('characters-jobs').replaceChildren(...(state.onlineRoleJobs || []).filter(job => job.status === 'processing').map(job => node('p', `${job.name} · ${t('线上角色正在创建，可稍后刷新查看结果')}`)))
}
$('character-search').oninput = renderList
$('sidebar-character-new').onclick = () => editor()
$('character-edit').onclick = () => editor(current())
$('character-documents').onclick = () => bridge.openLocalDocuments(selected)
$('character-refresh').onclick = () => bridge.refreshCatalog()
$('character-lam-project').onclick = async event => {
  event.preventDefault()
  try {
    const result = await bridge.openLamProject()
    if (!result?.ok) $('character-save-status').textContent = t('无法打开项目，请稍后重试')
  } catch { $('character-save-status').textContent = t('无法打开项目，请稍后重试') }
}
$('character-mode-local').onclick = () => mode('local')
$('character-mode-online').onclick = () => mode('online')
for (const id of ['character-editor-back', 'character-editor-cancel']) $(id).onclick = () => { if (!saving) navigate('characters') }
for (const kind of ['lam', 'voice', 'photo']) $(`character-${kind}`).onclick = async () => {
  if (saving) return
  try {
    const result = await bridge.chooseRoleMedia(kind)
    if (!result?.ok) { if (result?.code !== 'CANCELLED') $('character-save-status').textContent = result?.message || t('文件选择失败'); return }
    media[kind] = result.id; $(`character-${kind}-name`).textContent = result.name
    if (result.preview) photo($('character-photo-preview'), result.preview)
  } catch { $('character-save-status').textContent = t('文件选择失败') }
}
$('character-editor-form').onsubmit = async event => {
  event.preventDefault(); if (saving) return
  if (!editing && (!media.voice || editorMode === 'online' && !media.photo)) {
    $('character-save-status').textContent = t(editorMode === 'local' ? '请选择声音文件；LAM 资产包可选' : '请选择所需的形象和声音文件'); return
  }
  if (editorMode === 'online' && !$('character-online-consent').checked) { $('character-save-status').textContent = t('请先确认照片与声音的处理说明'); return }
  saving = true; $('character-save').disabled = true; $('character-save-status').textContent = t('正在保存角色与创建音色，请稍候…')
  try {
    const result = await bridge.saveRole({ mode: editorMode, agentId: editing || undefined, name: $('character-name').value,
      description: $('character-description').value, prompt: $('character-prompt').value, media, requestId: creationId, consent: $('character-online-consent').checked })
    if (!result?.ok) { $('character-save-status').textContent = result?.message || t('角色保存失败，请重试'); return }
    $('characters-status').textContent = result.message || t('角色已保存')
    if (result.role?.agentId) update({ ...state, roles: [...roles().filter(role => role.agentId !== result.role.agentId), result.role] })
    navigate('characters'); if (result.role?.agentId) void open(result.role.agentId)
  } catch { $('character-save-status').textContent = t('角色保存失败，请重试') }
  finally { saving = false; $('character-save').disabled = false }
}
$('character-chat-form').onsubmit = async event => {
  event.preventDefault(); if (busy || !selected || $('character-chat-send').disabled) return
  const text = $('character-message').value.trim(); if (!text) return
  const id = selected; busy = true; controls(); $('characters-status').textContent = ''
  try {
    const result = await bridge.roleChat({ agentId: id, text })
    if (id !== selected) return
    if (!result?.ok) { busy = false; $('characters-status').textContent = result?.message || t('发送失败，请重试') }
    else $('character-message').value = ''
  } catch { busy = false; $('characters-status').textContent = t('发送失败，请重试') }
  finally { controls() }
}
$('character-chat-stop').onclick = () => bridge.interrupt()
$('character-message').addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) {
    event.preventDefault()
    if (!$('character-chat-send').disabled) $('character-chat-form').requestSubmit()
  }
})
bridge.onConversation(event => {
  if (!selected || state?.current?.agentId !== selected || event.agentId !== undefined && event.agentId !== selected ||
      event.accountScope !== undefined && current()?.kind !== 'local' && event.accountScope !== (state?.accountScope || '')) return
  if (event.type === 'reset') { messages = []; busy = false; renderMessages(); controls(); return }
  if (!event.requestId) return
  if (event.type === 'preparing') { busy = true; controls() }
  if (['user', 'assistant'].includes(event.type)) {
    const key = `${event.requestId}:${event.type}`, row = messages.find(item => item.key === key)
    if (row) row.text = event.text
    else messages.push({ key, role: event.type, text: event.text, timestamp: Date.now() })
    messages = messages.slice(-400)
    renderMessages()
  }
  if (['done', 'complete', 'error', 'stopped', 'interrupted'].includes(event.type)) { busy = false; if (event.message) $('characters-status').textContent = event.message; controls() }
})
$('local-auto-moments').onchange = async () => {
  const result = await bridge.configureLocal({ momentsEnabled: $('local-auto-moments').checked })
  if (!result?.ok) $('model-feedback').textContent = result?.message || t('本地配置保存失败')
}
$('local-open-documents').onclick = () => bridge.openLocalDocuments()
for (const button of document.querySelectorAll('[data-provider-console]')) button.onclick = async () => {
  const status = $('model-feedback')
  try {
    const result = await bridge.openProviderConsole(button.dataset.providerConsole)
    if (!result?.ok) status.textContent = t('无法打开平台，请稍后重试')
  } catch { status.textContent = t('无法打开平台，请稍后重试') }
}
bridge.onState(update)
bridge.state().then(update).catch(() => {})
window.addEventListener('desktop-language', () => { listKey = postKey = ''; if (state) update(state) })
