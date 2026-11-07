const $ = id => document.getElementById(id)
const bridge = window.controlDevice
let editing = false, busy = false
function update(value, force = false) {
  if (!value) return
  if (force || !editing) {
    $('mail-provider').value = value.provider || 'qq'
    $('mail-user').value = value.user || ''
    $('mail-remember').checked = value.remember || !value.configured && value.storageAvailable === true
    $('mail-notifications').checked = value.notifications
    $('mail-content-announcements').checked = value.contentAnnouncements === true
  }
  $('mail-password').placeholder = value.configured ? '已配置，留空保留授权码' : '填写客户端授权码'
  $('mail-pause').disabled = !value.enabled
  $('mail-forget').disabled = !value.configured
  $('mail-check').disabled = !value.enabled
  const status = value.enabled ? (value.message || '邮箱已启用，可在对话中查看或总结邮件')
    : value.configured ? '邮箱已暂停，点击保存并启用可重新连接' : '未启用邮箱'
  $('mail-status').textContent = status + (value.notificationWarning ? ` · ${value.notificationWarning}` : '') + (value.enabled && value.lastCheck
    ? ` · 上次检查 ${new Date(value.lastCheck).toLocaleTimeString()}` : '')
}
async function configure(value) {
  if (busy) return
  busy = true
  $('mail-password').value = ''
  const controls = [...$('mail-form').querySelectorAll('input, select, button')]
  controls.forEach(control => { control.disabled = true })
  $('mail-status').textContent = '正在保存邮箱设置'
  try {
    const result = await bridge.configureMail(value)
    controls.forEach(control => { control.disabled = false })
    if (!result.ok) $('mail-status').textContent = result.message || '邮箱设置保存失败'
    else { editing = false; update(result, true) }
  } catch {
    controls.forEach(control => { control.disabled = false })
    $('mail-status').textContent = '邮箱设置保存失败，请重试'
  } finally { $('mail-password').value = ''; busy = false }
}
$('mail-form').addEventListener('input', () => { editing = true })
$('mail-form').addEventListener('submit', event => {
  event.preventDefault()
  void configure({ provider: $('mail-provider').value, user: $('mail-user').value.trim(),
    password: $('mail-password').value.trim(), remember: $('mail-remember').checked,
    notifications: $('mail-notifications').checked, contentAnnouncements: $('mail-content-announcements').checked })
})
$('mail-pause').addEventListener('click', () => { void configure({ enabled: false }) })
$('mail-forget').addEventListener('click', () => { void configure({ forget: true }) })
$('mail-check').addEventListener('click', async () => {
  if (busy) return
  busy = true; $('mail-check').disabled = true
  $('mail-status').textContent = '正在连接邮箱'
  try { update(await bridge.checkMail()) }
  catch { $('mail-status').textContent = '邮箱检查失败，请稍后重试' }
  finally { busy = false; $('mail-check').disabled = false }
})
bridge.onMail(value => update(value))
update(await bridge.mailState(), true)
