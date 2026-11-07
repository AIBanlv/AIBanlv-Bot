import { pointsRecord, pointsPage } from './device-points.mjs'
import { t } from './device-i18n.mjs'
const $ = id => document.getElementById(id), bridge = window.controlDevice
let scope = '', generation = 0, active = false, busy = false, page = 1, total = 0, rows = []
const errors = { BIND_REQUIRED: '请先扫码绑定账号', PAIRING_PROOF_REQUIRED: '请重新扫码以验证设备授权',
  INVALID_ACTION: '当前后端尚不支持积分明细，请更新后端', SERVER_UPDATE_REQUIRED: '当前后端尚不支持积分明细，请更新后端',
  TIMEOUT: '积分明细查询超时，请重试', OFFLINE: '服务暂不可用，请稍后重试' }
function render() {
  $('points-records').replaceChildren(...rows.map(row => {
    const value = pointsRecord(row, t), article = document.createElement('article'); article.className = 'points-record'
    const main = document.createElement('div'), title = document.createElement('strong'), at = document.createElement('p'), remark = document.createElement('p')
    title.textContent = value.title; at.textContent = value.at; at.className = remark.className = 'secondary'
    remark.textContent = value.remark; main.append(title, at, remark)
    const numbers = document.createElement('div'), amount = document.createElement('strong'), balance = document.createElement('p')
    numbers.className = 'points-numbers'; amount.className = value.income ? 'points-income' : 'points-expense'
    amount.textContent = value.amount; balance.textContent = `${t('变动后余额')} ${value.balance}`; balance.className = 'secondary'
    numbers.append(amount, balance); article.append(main, numbers); return article
  }))
  $('points-prev').disabled = busy || !scope || page <= 1
  $('points-next').disabled = busy || !scope || page * 20 >= total
  $('points-refresh').disabled = busy || !scope
  $('points-page').textContent = `${page} / ${Math.max(1, Math.ceil(total / 20))}`
  $('points-records').setAttribute('aria-busy', String(busy))
}
async function load(target = 1) {
  if (busy) return
  if (!scope) { $('points-status').textContent = t('请先扫码绑定账号'); return }
  const token = ++generation, key = scope
  busy = true; render(); $('points-status').textContent = t('正在加载积分明细…')
  let result
  try { result = await bridge.desktopAction('points_list', { page: target }) }
  catch { result = { ok: false, code: 'OFFLINE' } }
  if (token !== generation || key !== scope) return
  busy = false
  try {
    if (!result?.ok) throw new Error(errors[result?.code] || '积分明细加载失败，请重试')
    const normalized = pointsPage(result.data)
    page = target; total = normalized.total; rows = normalized.records
    $('points-status').textContent = rows.length ? '' : t('暂无积分记录')
  } catch (error) { $('points-status').textContent = t(error.message === 'Invalid points page' ? '积分明细加载失败，请重试' : error.message) }
  render()
}
function update(state) {
  if (!state) return
  const key = state.binding === 'bound' ? state.accountScope : ''
  $('points-balance').textContent = state.binding === 'bound' && Number.isFinite(state.account?.points) ? state.account.points.toLocaleString() : '—'
  if (scope !== key) {
    scope = key; generation++; busy = false; page = 1; total = 0; rows = []; render()
    $('points-status').textContent = scope ? '' : t('请先扫码绑定账号')
    if (active && scope) void load()
  }
}
$('points-refresh').onclick = () => { void bridge.refreshAccount().catch(() => {}); void load() }
$('points-prev').onclick = () => { if (page > 1) void load(page - 1) }
$('points-next').onclick = () => { if (page * 20 < total) void load(page + 1) }
window.addEventListener('settings-page', event => { active = event.detail === 'points-details'; if (active) void load() })
window.addEventListener('desktop-language', render)
bridge.onState(update); void bridge.state().then(update); render()
