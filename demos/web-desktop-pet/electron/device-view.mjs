import { installTranslations, setLanguage, t, language } from './device-i18n.mjs'
import { SettingsNavigation, settingsPages } from './device-settings-navigation.mjs'
import { platformCreditsMessage, guestCreditsMessage } from './device-pet-policy.mjs'
import './device-services-view.mjs'
import './device-invite-view.mjs'
import './device-update-view.mjs'
import './device-points-view.mjs'
import './device-moments-view.mjs'
import './device-model-view.mjs'
import './device-roles-view.mjs'
import './device-plugins-view.mjs'

const $ = id => document.getElementById(id)
const bridge = window.controlDevice
$('download-app')?.addEventListener('click', event => { event.preventDefault(); void bridge.openAppDownload?.() })
let state, rolesKey = ''
let aiToolsKey = '', aiGuideScope = '', aiAccountScope = ''
const seenAiGuides = new Set()
const aiToolPages = { harness: 'assistant-heading', codex: 'codex-heading', workbuddy: 'workbuddy-heading' }
const navigation = new SettingsNavigation({ document, translate: t,
  onNavigate: ({ to, tab }) => {
    window.dispatchEvent(new CustomEvent('settings-page', { detail: to }))
    if (to === 'binding' && tab === 'scan') void connectForBinding()
  } })
window.addEventListener('open-model-settings', () => navigation.navigate('model-settings'))

async function connectForBinding(refresh = false) {
  try {
    const current = await bridge.state()
    if (!current.models?.platformEnabled) {
      const result = await bridge.configureModels({ platformEnabled: true })
      if (!result.ok) { $('qr-status').textContent = '连接失败，请点击刷新登录二维码重试'; return }
    } else if (refresh || current.connection === 'offline') bridge.refresh()
  } catch { $('qr-status').textContent = '连接失败，请点击刷新登录二维码重试' }
}
window.addEventListener('navigate-settings', event => navigation.navigate(event.detail))

function update(next) {
  if (!next) return
  state = next
  setLanguage(state.language)
  $('desktop-language').value=state.language || 'zh-Hans'
  const bound = state.binding === 'bound' && state.connection === 'connected'
  if (state.binding === 'bound' || state.binding === 'unbound') navigation.setBound(state.binding === 'bound')
  const paired = navigation.bound === true
  $('score-status').textContent = state.current?.source === 'local' ? '本地模式 · 使用自己的模型 Key，不消耗 AIBanlv 积分'
    : !bound && !state.guest ? '扫码绑定后查看账号积分' : state.scoreSync?.state === 'error' ? state.scoreSync.message
    : state.score === null || state.score === undefined ? '正在核实积分…'
    : state.score <= 0 ? state.guest ? guestCreditsMessage : platformCreditsMessage
      : state.guest ? `游客试用剩余积分：${state.score}` : `账号剩余积分：${state.score}`
  $('score-status').dataset.mode = state.current?.source === 'local' ? 'local' : 'platform'
  const available = bound || state.current?.publicAvatar || state.desired?.publicAvatar || state.roles.some(role => role.available !== false)
  $('connection').textContent = !state.models?.platformEnabled ? '本机模式' : state.connection === 'connected'
    ? bound ? '已绑定' : '待绑定' : state.connection === 'connecting' ? '连接中' : '离线'
  $('binding').hidden = paired
  $('refresh').disabled = state.connection === 'connecting' || state.refreshing === true
  $('binding-summary').hidden = !paired
  updateAiTools(state, bound)
  $('qr').hidden = bound || !state.qr
  if (state.qr) $('qr').src = state.qr
  else $('qr').removeAttribute('src')
  $('qr-status').hidden = Boolean(state.qr)
  $('qr-status').textContent = !state.models?.platformEnabled ? '已暂停连接，点击“刷新登录二维码”即可重新获取'
    : state.connection === 'connected' ? '等待绑定二维码' : '正在连接控制服务'
  $('device-id').textContent = state.deviceId
  $('feedback').textContent = state.error || ''
  $('role-controls').hidden = !available
  $('role-unavailable').hidden = available
  $('role-name').textContent = state.current?.agentName || state.current?.agentId || '等待形象'
  const nextRolesKey = JSON.stringify([state.roles, state.current?.agentId])
  if (nextRolesKey !== rolesKey) {
    rolesKey = nextRolesKey
    $('roles').replaceChildren(...state.roles.map(role => {
      const option = new Option((role.agentName || role.agentId) + (role.available === false ? '（当前形象，暂不可选）' : ''), role.agentId)
      option.disabled = role.available === false
      return option
    }))
  }
  $('roles').value = (['downloading', 'rendering'].includes(state.phase)
    ? state.desired?.agentId : state.current?.agentId) || ''
  $('roles').disabled = !available || ['downloading', 'rendering'].includes(state.phase) || !state.roles.some(role => role.available !== false)
  const catalog = state.catalog || { status: 'idle' }
  $('catalog-refresh').disabled = catalog.status === 'loading'
  $('roles').setAttribute('aria-busy', String(catalog.status === 'loading'))
  $('catalog-status').textContent = catalog.status === 'loading' ? '正在查询线上形象…'
    : catalog.status === 'error' ? catalog.error : catalog.status === 'ready'
      ? catalog.count ? '' : bound ? '当前账号暂无可用线上形象' : '暂无可用公共形象，请稍后刷新'
      : '可以刷新公共形象；扫码后还可查看自己的角色'
  $('catalog-status').hidden = !$('catalog-status').textContent
  updateExpiry()
  updateAccount(state.account)
}

function updateAiTools(next, bound) {
  const items = (next.aiTools?.items || []).filter(item => Object.hasOwn(aiToolPages, item.id))
  const key = JSON.stringify([language, items])
  if (key !== aiToolsKey) {
    aiToolsKey = key
    $('connected-ai-tools').replaceChildren(...items.map(item => {
      const row = document.createElement('button')
      row.type = 'button'; row.className = 'ai-tool-row'; row.dataset.tool = item.id; row.dataset.state = item.state
      const dot = document.createElement('span'); dot.className = 'ai-tool-dot'; dot.setAttribute('aria-hidden', 'true')
      const description = document.createElement('span'), name = document.createElement('strong'), detail = document.createElement('small')
      name.textContent = item.name; detail.textContent = t(item.detail); description.append(name, detail)
      const label = document.createElement('span'); label.className = 'ai-tool-label'; label.textContent = t(item.label)
      row.append(dot, description, label); row.onclick = () => navigation.navigate(aiToolPages[item.id])
      return row
    }))
  }
  if (aiAccountScope !== next.accountScope || !bound) aiGuideScope = ''
  aiAccountScope = next.accountScope || ''
  const guide = next.aiTools?.guide
  if (bound && next.accountScope && guide?.id === next.accountScope && !seenAiGuides.has(guide.id) && !items.some(item => item.available)) {
    seenAiGuides.add(guide.id); aiGuideScope = guide.id
    navigation.navigate('model-settings')
    $('model-deepseek').focus()
    void bridge.acknowledgeAiToolsGuide().catch(() => {})
  }
  if (items.some(item => item.available)) aiGuideScope = ''
  $('assistant-onboarding').hidden = !aiGuideScope
}

function updateAccount(value) {
  if (!value) return
  const guest = state?.guest === true, points = guest ? state.score : value.points
  $('account-name').textContent = guest ? '游客试用' : value.name || '未登录'
  $('account-menu-name').textContent = guest ? '游客试用' : value.name || '未登录'
  $('account-points').textContent = Number.isFinite(points) ? points.toLocaleString('zh-CN') : '—'
  $('account-points-status').textContent = guest ? state.scoreSync?.message || (points === 0 ? guestCreditsMessage : '')
    : value.message || (!value.bound ? '扫码绑定后查看账号积分' : '')
}
const accountMenu = $('account-menu')
async function accountAction(button, action) {
  if (button.disabled) return
  button.disabled = true
  $('account-feedback').textContent = '正在处理…'
  try {
    const result = await action()
    if (result?.name) updateAccount({ ...result, message: result.ok ? '' : result.message })
    $('account-feedback').textContent = result?.message || (result?.ok ? '已更新' : '服务暂不可用，请稍后重试')
  } catch { $('account-feedback').textContent = '服务暂不可用，请稍后重试' }
  finally { button.disabled = false }
}
$('account-refresh').onclick = () => accountAction($('account-refresh'), () => bridge.refreshAccount())
$('account-details').onclick = () => { accountMenu.open = false; navigation.navigate('points-details') }
$('account-logout').onclick = () => {
  $('account-feedback').textContent = '正在关闭软件…'
  bridge.logout()
}
document.addEventListener('pointerdown', event => { if (!accountMenu.contains(event.target)) accountMenu.open = false })
document.addEventListener('keydown', event => { if (event.key === 'Escape' && accountMenu.open && !$('desktop-update-dialog').open) { accountMenu.open = false; accountMenu.querySelector('summary').focus() } })
bridge.accountState().then(updateAccount).catch(() => {})

function updateExpiry() {
  if (!state) return
  const seconds = Math.max(0, Math.ceil((state.expiresAt - Date.now()) / 1000))
  $('expiry').textContent = state.qr && seconds ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')} 后失效` : ''
  if (!seconds) $('qr').hidden = true
}
bridge.onState(update)
$('refresh').addEventListener('click', () => { void connectForBinding(true) })
$('binding-refresh').addEventListener('click', () => { void connectForBinding(true) })
$('catalog-refresh').addEventListener('click', () => bridge.refreshCatalog())
$('roles').addEventListener('change', () => bridge.select($('roles').value))
$('voice-stop').addEventListener('click', () => bridge.stopChat())
$('voice-volume').addEventListener('input', () => window.desktopPet.command('volume', Number($('voice-volume').value)))
function updateDesktop(next) {
  if (!next) return
  $('model-status').textContent = next.ready ? '就绪' : next.status === 'error' ? '加载失败' : '加载中'
  $('retry').hidden = next.status !== 'error'
  $('visible').checked = next.visible
  $('pinned').checked = next.pinned
  $('click-through').checked = next.clickThrough
  $('size').value = next.size
  $('size-value').textContent = `${next.size} px`
  $('particles').checked = next.particles === true
  $('startup').checked = next.startup?.enabled === true
  $('startup').disabled = next.startup?.supported !== true
  $('startup-status').textContent = next.startup?.message || ''
  $('startup').title = next.startup?.message || ''
  $('startup-label').textContent = next.startup?.supported === false ? '开机自动启动（仅安装版）' : '开机自动启动'
  $('avatar-quality').value = next.quality || 'auto'
  $('render-quality').textContent = next.quality && next.quality !== 'auto'
    ? `当前清晰度：${{ low: '性能优先', balanced: '均衡', high: '细节优先（2 倍采样）' }[next.quality]}`
    : `自动清晰度：${{ low: '省电', balanced: '标准', high: '高清' }[state?.renderQuality?.tier] || '标准'}`
  $('particles-status').textContent = next.preferencesError || ''
  $('voice-volume').value = next.volume
  $('voice-volume-value').textContent = `${next.volume}%`
}
window.desktopPet.onState(updateDesktop)
for (const [id, command] of [['visible', 'show'], ['pinned', 'pin'], ['click-through', 'clickThrough']]) {
  $(id).addEventListener('change', () => window.desktopPet.command(
    id === 'visible' ? ($(id).checked ? 'show' : 'hide') : command, $(id).checked))
}
$('size').addEventListener('input', () => window.desktopPet.command('size', Number($('size').value)))
for (const command of ['reset', 'retry']) $(command).addEventListener('click', () => window.desktopPet.command(command))
$('particles').addEventListener('change', () => window.desktopPet.command('particles', $('particles').checked))
$('startup').addEventListener('change', () => window.desktopPet.command('startup', $('startup').checked))
$('avatar-quality').addEventListener('change', () => window.desktopPet.command('quality', $('avatar-quality').value))
window.desktopPet.status().then(updateDesktop).catch(() => { $('feedback').textContent = '窗口设置暂不可用，请重新打开设置。' })
const timer = setInterval(updateExpiry, 1000)
installTranslations()
$('desktop-language').onchange=()=>bridge.language($('desktop-language').value)
window.addEventListener('pagehide', () => clearInterval(timer))
bridge.state().then(update).catch(() => { $('feedback').textContent = '设备状态读取失败，请刷新连接。' })
// Keep binding available even when an optional plugin fails to initialize.
for (const name of ['device-assistant-view.mjs', 'device-mail-view.mjs', 'device-workbuddy-view.mjs', 'device-codex-view.mjs', 'device-transfer-view.mjs']) {
  import(`./${name}`).catch(() => { $('feedback').textContent = '部分插件加载失败，请重新打开设置或检查应用资源。' })
}
window.addEventListener('desktop-language', () => {
  if (state) updateAiTools(state, state.binding === 'bound' && state.connection === 'connected')
  if (navigation.current === 'search') navigation.search($('settings-search').value)
  else $('settings-page-title').textContent = t(settingsPages.find(page => page.id === navigation.current)?.title || '设备绑定')
})
