import { MomentsTimeline, momentMediaUrl, latestMomentAuthor } from './device-moments.mjs'
import { t, language } from './device-i18n.mjs'
const $ = id => document.getElementById(id), bridge = window.controlDevice
const errors = {
  BIND_REQUIRED: '请先扫码绑定账号', OFFLINE: '网络连接已断开，请连接后重试', FORBIDDEN: '当前账号无权操作该动态或评论',
  SERVER_UPDATE_REQUIRED: '请更新后端以启用桌面AI智囊团', AI_MOMENTS_DISABLED: 'AI智囊团尚未启用，请联系管理员',
  AI_MOMENTS_SCHEMA_MISSING: 'AI智囊团数据库尚未就绪，请联系管理员', AI_MOMENTS_DB_UNAVAILABLE: 'AI智囊团服务繁忙，请稍后重试',
  PAIRING_PROOF_REQUIRED: '请重新扫码以验证设备授权', TIMEOUT: '操作结果未确认，请刷新动态核对后再试',
  INVALID_ACTION: '操作未完成，请检查内容、角色和每日限额', BUSY: '正在处理，请稍候',
  MOMENTS_UPLOAD: '媒体上传失败，请检查文件格式、大小和网络', MOMENTS_VIDEO: '视频须为60秒以内、30MB以内的MP4或MOV文件',
}
const errorText = code => t(errors[code] || 'AI智囊团加载或操作失败，请重试')
const timeline = new MomentsTimeline({ request: (...args) => bridge.desktopAction(...args), changed: render })
let state, active = false, panel = 'feed', media = [], uploadBusy = false, rolesLoading = false, draftId = '', reply, confirmAction, notice = '', renderKey = ''
let previewScope = '', menuAvatar = ''
function renderMenuAvatar() {
  const candidate = latestMomentAuthor(timeline.rows, state?.localWorkspace?.moments, state?.roles)?.avatar || ''
  if (candidate === menuAvatar) return
  menuAvatar = candidate
  const image = $('moments-menu-avatar'), fallback = $('moments-menu-default')
  image.onload = () => { if (menuAvatar === candidate) { image.hidden = false; fallback.toggleAttribute('hidden', true) } }
  image.onerror = () => { if (menuAvatar === candidate) { image.hidden = true; fallback.toggleAttribute('hidden', false) } }
  image.hidden = true; fallback.toggleAttribute('hidden', false)
  if (candidate) image.src = candidate
  else image.removeAttribute('src')
}
const element = (tag, text, className) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node }
const action = (label, callback) => { const node = element('button', t(label), 'plain-button'); node.type = 'button'; node.onclick = callback; node.disabled = timeline.saving || uploadBusy; return node }
function showPanel(next) { panel = next; render(); syncActive() }
function preview(item) {
  const media = element(item.type === 'video' ? 'video' : 'img')
  if (item.type === 'video') { media.controls = true; media.preload = 'metadata'; media.autoplay = false }
  else media.alt = t('动态图片')
  media.referrerPolicy = 'no-referrer'; media.src = item.url
  $('moments-media-preview').replaceChildren(media); $('moments-media-dialog').showModal()
}
function stopMedia() {
  for (const video of $('moments-media-preview').querySelectorAll('video')) { video.pause(); video.removeAttribute('src'); video.load() }
  $('moments-media-preview').replaceChildren()
}
function mediaNode(item) {
  const button = action(item.type === 'video' ? '播放视频' : '预览图片', () => preview(item))
  button.title = t(item.type === 'video' ? '播放视频' : '预览图片')
  if (item.type === 'image') { const image = element('img'); image.src = item.url; image.loading = 'lazy'; image.referrerPolicy = 'no-referrer'; image.alt = t('动态图片'); button.replaceChildren(image) }
  else button.classList.add('moment-video-button')
  return button
}
function beginReply(post, comment, editing = false) {
  notice = ''; $('moments-comment-status').textContent = ''
  reply = { post, comment, editing, requestId: crypto.randomUUID() }
  $('moments-reply-to').textContent = editing ? t('修改评论') : [post.authorName, comment?.authorName].filter(Boolean).join(' → ')
  $('moments-comment-content').value = editing ? comment.content : ''
  $('moments-comment-dialog').showModal(); $('moments-comment-content').focus()
}
function confirmDelete(operation, id) {
  notice = ''; $('moments-confirm-status').textContent = ''
  confirmAction = { operation, id }; $('moments-confirm-dialog').showModal()
}
async function write(operation, payload) {
  const generation = timeline.generation
  const result = await timeline.write(operation, payload)
  if (generation !== timeline.generation) return false
  notice = result?.ok ? '' : errorText(result?.code); render()
  return result?.ok === true
}
function postNode(post) {
  const card = element('article', undefined, 'moment-card'), avatar = element('img')
  avatar.className = 'moment-avatar'; avatar.src = post.avatar || '/device/logo.png'; avatar.alt = ''; avatar.loading = 'lazy'; avatar.referrerPolicy = 'no-referrer'
  const body = element('div', undefined, 'moment-body'), author = element('div', post.authorName || t('我'), 'moment-author')
  const content = element('p', post.content, 'moment-content'), media = element('div', undefined, 'moments-media')
  media.append(...post.media.map(mediaNode))
  const footer = element('div', undefined, 'moment-footer'), tools = element('div', undefined, 'moment-tools')
  const date = new Date(post.createdAt), stamp = element('span', Number.isFinite(date.getTime()) ? date.toLocaleString(language) : '', 'secondary')
  const like = action(post.liked ? '取消点赞' : '点赞', async () => {
    const liked = !post.liked
    if (await write('moments_like', { id: post.id, liked })) {
      const current = timeline.rows.find(row => row.id === post.id)
      if (current) current.liked = liked
      renderKey = ''; render()
    }
  }); like.setAttribute('aria-pressed', String(post.liked))
  tools.append(like, action('评论', () => beginReply(post)), action('删除动态', () => confirmDelete('moments_delete', post.id)))
  footer.append(stamp, tools); body.append(author, content, media, footer)
  if (post.comments.length) {
    const comments = element('div', undefined, 'moment-comments')
    for (const comment of post.comments) {
      const row = element('div', undefined, 'moment-comment'), text = element('p'), name = element('strong', `${comment.authorName || t('我')}${comment.replyToName ? ' → ' + comment.replyToName : ''}：`, 'moment-author')
      text.append(name, document.createTextNode(comment.content))
      const tools = element('div', undefined, 'moment-tools')
      tools.append(action('回复', () => beginReply(post, comment)), action('修改评论', () => beginReply(post, comment, true)), action('删除评论', () => confirmDelete('moments_comment_delete', comment.id)))
      row.append(text, tools); comments.append(row)
    }
    body.append(comments)
  }
  card.append(avatar, body); return card
}
function render() {
  renderMenuAvatar()
  const busy = timeline.saving || uploadBusy, available = Boolean(timeline.scope && timeline.connected && timeline.supported)
  $('moments-feed-panel').hidden = panel !== 'feed'; $('moments-editor').hidden = panel !== 'edit'; $('moments-about-panel').hidden = panel !== 'about'
  $('moments-status').textContent = notice || (timeline.error ? errorText(timeline.error) : uploadBusy ? t('正在上传媒体…') : timeline.loading && !timeline.rows.length ? t('正在加载动态…') : '')
  $('moments-comment-status').textContent = notice; $('moments-confirm-status').textContent = notice
  for (const id of ['moments-new', 'moments-refresh', 'moments-more']) $(id).disabled = busy || !available || timeline.loading
  for (const id of ['moments-publish', 'moments-edit-cancel', 'moments-add-images', 'moments-add-video', 'moments-content', 'moments-mentions', 'moments-comment-content', 'moments-comment-save', 'moments-confirm-delete']) $(id).disabled = busy || !available
  $('moments-mentions').disabled ||= rolesLoading
  $('moments-more').hidden = !timeline.hasMore
  const key = JSON.stringify([timeline.rows, busy, language])
  if (key !== renderKey) {
    renderKey = key
    $('moments-feed').replaceChildren(...timeline.rows.map(postNode))
    if (!timeline.rows.length && !timeline.loading && !timeline.error) $('moments-feed').append(element('p', t('暂无动态，分享你的第一条动态吧'), 'secondary'))
  }
}
function renderDraft() {
  $('moments-media-draft').replaceChildren(...media.map((item, index) => {
    const wrapper = element('div'); wrapper.append(mediaNode(item), action('移除媒体', () => { if (uploadBusy || timeline.saving) return; media.splice(index, 1); draftId = crypto.randomUUID(); renderDraft() })); return wrapper
  }))
}
function syncActive() {
  const wasActive = timeline.active
  timeline.active = active && !document.hidden && panel === 'feed'
  if (timeline.active && !wasActive) void timeline.load()
  if (!timeline.active) { stopMedia(); if ($('moments-media-dialog').open) $('moments-media-dialog').close() }
}
function update(next) {
  if (!next) return
  state = next
  const scope = state.binding === 'bound' ? state.accountScope || '' : ''
  if (scope !== timeline.scope) {
    notice = ''; panel = 'feed'; media = []; uploadBusy = false; rolesLoading = false; draftId = ''; reply = confirmAction = null
    $('moments-content').value = ''; $('moments-comment-content').value = ''; $('moments-mentions').replaceChildren(); renderDraft()
    for (const id of ['moments-comment-dialog', 'moments-confirm-dialog', 'moments-media-dialog']) if ($(id).open) $(id).close()
    stopMedia()
  }
  const previous = timeline.scope, connected = timeline.connected
  timeline.context(scope, state.connection === 'connected', state.desktopMomentsSupported === true)
  syncActive()
  if (timeline.active && (previous !== scope || !connected && timeline.connected)) void timeline.load()
  // One initial authenticated page per account supplies the menu portrait without
  // turning a hidden feed into a background polling loop. Visible refreshes reuse it.
  if (!scope) previewScope = ''
  else if (previewScope !== scope && timeline.connected && timeline.supported && (!state.proofRequired || state.accountAuthReady)) {
    previewScope = scope
    void timeline.load({ menuPreview: true })
  }
}
$('moments-new').onclick = async () => {
  notice = ''; draftId = crypto.randomUUID(); media = []; $('moments-content').value = ''; renderDraft()
  $('moments-mentions').replaceChildren()
  const generation = timeline.generation; rolesLoading = true
  showPanel('edit'); $('moments-content').focus()
  try {
    const result = await bridge.desktopAction('moments_roles', {})
    if (generation !== timeline.generation) return
    if (!result?.ok || !Array.isArray(result.data) || result.data.length > 100) throw new Error(result?.code || 'MOMENTS_RESPONSE')
    $('moments-mentions').replaceChildren(...result.data.filter(role => role && typeof role.id === 'string' && role.id.length <= 128 && typeof role.name === 'string')
      .map(role => new Option(role.name.slice(0, 128) || role.id, role.id)))
  } catch (error) { if (generation === timeline.generation) notice = errorText(error.message) }
  finally { if (generation === timeline.generation) { rolesLoading = false; render() } }
}
$('moments-refresh').onclick = () => { notice = ''; void timeline.load() }
$('moments-more').onclick = () => { void timeline.load({ more: true }) }
$('moments-edit-cancel').onclick = () => { notice = ''; showPanel('feed') }
$('moments-about').onclick = () => showPanel('about')
$('moments-about-back').onclick = () => showPanel('feed')
for (const id of ['moments-content', 'moments-mentions']) $(id).addEventListener('input', () => { draftId = crypto.randomUUID() })
$('moments-editor').onsubmit = async event => {
  event.preventDefault(); if (uploadBusy || timeline.saving) return
  const mentionAgentIds = [...$('moments-mentions').selectedOptions].map(option => option.value)
  if (mentionAgentIds.length > 5 || !$('moments-content').value.trim() && !media.length) { notice = t('请填写动态内容，最多提及5个角色'); render(); return }
  draftId ||= crypto.randomUUID()
  if (await write('moments_publish', { requestId: draftId, content: $('moments-content').value, media, mentionAgentIds, language })) { media = []; renderDraft(); showPanel('feed'); await timeline.load() }
}
$('moments-comment-form').onsubmit = async event => {
  event.preventDefault(); if (!reply || timeline.saving) return
  const content = $('moments-comment-content').value.trim(); if (!content) return
  const target = reply
  const payload = target.editing ? { id: target.comment.id, content } : { id: target.post.id, content, parentId: target.comment?.id || '', requestId: target.requestId, language }
  if (await write(target.editing ? 'moments_comment_edit' : 'moments_comment', payload)) { $('moments-comment-dialog').close(); reply = null; await timeline.load() }
}
$('moments-comment-content').addEventListener('input', () => { if (reply) reply.requestId = crypto.randomUUID() })
$('moments-comment-cancel').onclick = () => { $('moments-comment-dialog').close(); reply = null }
$('moments-confirm-delete').onclick = async () => {
  const target = confirmAction; if (!target || timeline.saving) return
  if (await write(target.operation, { id: target.id })) { $('moments-confirm-dialog').close(); confirmAction = null; await timeline.load() }
}
$('moments-confirm-cancel').onclick = () => { $('moments-confirm-dialog').close(); confirmAction = null }
$('moments-media-close').onclick = () => $('moments-media-dialog').close()
$('moments-media-dialog').addEventListener('close', stopMedia)

async function videoDuration(file) {
  const url = URL.createObjectURL(file), video = document.createElement('video')
  try { return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('MOMENTS_VIDEO')), 10000)
    video.onloadedmetadata = () => { clearTimeout(timer); Number.isFinite(video.duration) && video.duration <= 60 ? resolve(video.duration) : reject(new Error('MOMENTS_VIDEO')) }
    video.onerror = () => { clearTimeout(timer); reject(new Error('MOMENTS_VIDEO')) }; video.preload = 'metadata'; video.src = url
  }) } finally { video.removeAttribute('src'); video.load(); URL.revokeObjectURL(url) }
}
async function imageBytes(file) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 20 * 1024 * 1024) throw new Error('MOMENTS_UPLOAD')
  const image = await createImageBitmap(file)
  try {
    const scale = Math.min(1, 1440 / Math.max(image.width, image.height)), canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.width * scale)); canvas.height = Math.max(1, Math.round(image.height * scale))
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', .78))
    if (!blob || blob.size > 5 * 1024 * 1024) throw new Error('MOMENTS_UPLOAD')
    return new Uint8Array(await blob.arrayBuffer())
  } finally { image.close() }
}
async function addFiles(files, type) {
  if (uploadBusy || timeline.saving || !files.length) return
  if (type === 'video' && (media.length || files.length !== 1) || type === 'image' && (media.some(item => item.type === 'video') || files.length + media.length > 9)) { notice = t('最多9张图片或1个视频'); render(); return }
  const generation = timeline.generation
  uploadBusy = true; notice = ''; render()
  try {
    for (const file of files) {
      let bytes, extension = 'jpg'
      if (type === 'video') {
        extension = /\.mov$/i.test(file.name) ? 'mov' : 'mp4'
        if (!/\.(mp4|mov)$/i.test(file.name) || file.size > 30 * 1024 * 1024) throw new Error('MOMENTS_VIDEO')
        await videoDuration(file); bytes = new Uint8Array(await file.arrayBuffer())
      } else bytes = await imageBytes(file)
      if (generation !== timeline.generation) return
      const result = await bridge.uploadMomentMedia({ type, extension, bytes })
      if (generation !== timeline.generation) return
      if (!result?.ok || !momentMediaUrl(result.data?.url)) throw new Error(result?.code || 'MOMENTS_UPLOAD')
      media.push(result.data); draftId = crypto.randomUUID(); renderDraft()
    }
  } catch (error) { if (generation === timeline.generation) notice = errorText(error.message) }
  finally { if (generation === timeline.generation) { uploadBusy = false; render(); renderDraft() } }
}
for (const [button, input, type] of [['moments-add-images', 'moments-image-files', 'image'], ['moments-add-video', 'moments-video-file', 'video']]) {
  $(button).onclick = () => $(input).click()
  $(input).onchange = () => { const files = [...$(input).files]; $(input).value = ''; void addFiles(files, type) }
}
window.addEventListener('settings-page', event => { active = event.detail === 'ai-moments'; syncActive() })
document.addEventListener('visibilitychange', syncActive)
window.addEventListener('desktop-language', () => { renderKey = ''; render() })
const timer = setInterval(() => { if (!uploadBusy && !$('moments-comment-dialog').open && !$('moments-confirm-dialog').open) void timeline.load({ automatic: true }) }, 5000)
window.addEventListener('pagehide', () => { clearInterval(timer); stopMedia() })
bridge.onState(update); void bridge.state().then(update); render()
