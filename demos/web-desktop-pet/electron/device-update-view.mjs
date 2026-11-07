const $ = id => document.getElementById(id)
const bridge = window.controlDevice
const dialog = $('desktop-update-dialog')
let state = {}, invoking = false
const formatBytes = bytes => bytes < 1024 ? `${bytes} B`
  : bytes < 1024 ** 2 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 ** 2).toFixed(1)} MB`

function render(next) {
  if (!next) return
  state = next
  const source = state.runMode === 'source', manual = ['portable', 'unsupported'].includes(state.runMode)
  $('account-update').textContent = manual ? '更新说明' : '检查更新'
  $('desktop-update-title').textContent = source ? '源码更新' : '软件更新'
  $('desktop-update-source').hidden = !source
  const revision = state.source
  $('desktop-update-revision').textContent = revision
    ? `当前分支：${revision.detached ? '分离 HEAD' : revision.branch} · 提交：${revision.commit.slice(0, 12)}${state.targetCommit ? ` → ${state.targetCommit.slice(0, 12)}` : ''}` : ''
  $('desktop-update-source-status').textContent = !revision ? '未读取到 Git 信息。请确认已安装 Git 且当前目录是代码仓库；源码压缩包请重新获取最新版。'
    : revision.detached ? '当前处于分离 HEAD 状态，请先切换到需要更新的分支。'
      : state.targetCommit ? state.dependenciesChanged ? '本次更新包含依赖变化，将自动安装所需依赖。' : '本次仅更新源码，无需重新安装依赖。'
        : '更新当前分支的上游代码，完成后自动重新启动。'
  $('desktop-update-close').textContent = manual ? '关闭' : '稍后'
  const downloading = state.status === 'downloading'
  const busy = ['checking', 'downloading', 'preparing', 'installing'].includes(state.status)
  $('desktop-update-version').textContent = state.version ? `当前版本 ${state.version}${state.latestVersion ? ` · 最新版本 ${state.latestVersion}` : ''}` : ''
  $('desktop-update-status').textContent = state.message || '请选择检查更新'
  $('account-feedback').textContent = state.message || ''
  $('desktop-update-notes').textContent = state.notes || ''
  $('desktop-update-notes').hidden = !state.notes
  $('desktop-update-progress').hidden = !downloading
  $('desktop-update-progress').value = state.bytes ? Math.min(100, (state.received || 0) / state.bytes * 100) : 0
  $('desktop-update-size').hidden = !state.bytes
  $('desktop-update-size').textContent = Number.isFinite(state.networkBytes)
    ? `${state.mode === 'differential' ? '增量下载' : '完整下载'} · 实际下载 ${formatBytes(state.networkBytes)} · 本地复用 ${formatBytes(state.reusedBytes || 0)} · 安装包 ${formatBytes(state.bytes)}`
    : `安装包 ${formatBytes(state.bytes)}`
  $('desktop-update-check').disabled = busy || invoking
  $('desktop-update-check').hidden = state.canCheck !== true
  $('desktop-update-download').hidden = !state.canDownload || state.status === 'ready'
  $('desktop-update-download').disabled = busy || invoking
  $('desktop-update-cancel').hidden = !downloading && !(source && state.status === 'checking')
  $('desktop-update-cancel').textContent = source ? '取消检查' : '取消下载'
  $('desktop-update-install').hidden = !state.canInstall
  $('desktop-update-install').textContent = source ? '更新并重启' : '退出并安装'
  $('desktop-update-install').disabled = busy || invoking
  $('desktop-update-close').disabled = ['preparing', 'installing'].includes(state.status)
}
async function action(method) {
  if (invoking) return
  invoking = true; render(state)
  try { render(await bridge[method]()) }
  catch { render({ ...state, message: '更新服务暂不可用，请稍后重试' }) }
  finally { invoking = false; render(state) }
}
$('account-update').onclick = async () => {
  if (!dialog.open) dialog.showModal()
  $('account-menu').open = false
  try { render(await bridge.updateState?.()) } catch {}
  if (state.canCheck && !['checking', 'downloading', 'ready', 'preparing', 'installing'].includes(state.status)) void action('checkUpdate')
}
$('desktop-update-check').onclick = () => action('checkUpdate')
$('desktop-update-download').onclick = () => action('downloadUpdate')
$('desktop-update-install').onclick = () => action('installUpdate')
// Cancellation must remain usable while the download invoke is pending.
$('desktop-update-cancel').onclick = () => { void bridge.cancelUpdate().catch(() => {}) }
$('desktop-update-close').onclick = () => dialog.close()
dialog.addEventListener('cancel', event => { if (['preparing', 'installing'].includes(state.status)) event.preventDefault() })
dialog.addEventListener('close', () => {
  $('account-menu').open = false
  $('account-menu').querySelector('summary').focus()
})
bridge.onUpdate?.(render)
bridge.updateState?.().then(render).catch(() => {})
