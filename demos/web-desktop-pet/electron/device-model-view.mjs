const $ = id => document.getElementById(id), bridge = window.controlDevice
let busy = false
const realtimeDefaults = { model: 'qwen-audio-3.0-realtime-flash', voice: 'longanlingxi' }
function update(value) {
  if (!value) return
  $('model-workspaceId').value = value.workspaceId
  $('model-region-status').textContent = value.region === 'cn-beijing' ? '按本机地区自动使用北京服务，请填写北京地区 Key。' : '按本机地区自动使用新加坡服务，请填写新加坡地区 Key。'
  $('realtime-remember').checked = value.remember
  $('realtime-key').placeholder = value.configured ? '已配置，留空保留现有 Key' : '填写自己的阿里云 Realtime Key'
}
async function act(work, saved = true) {
  if (busy) return
  busy = true
  const controls = [...$('model-form').querySelectorAll('input,select,button')]
  controls.forEach(item => { item.disabled = true })
  $('model-feedback').textContent = '正在处理…'
  try {
    const result = await work()
    $('model-feedback').textContent = result.message || (result.ok ? '已保存；对话费用由所选角色决定' : '操作失败')
    if (result.ok && saved) { update(await bridge.modelState()); $('realtime-key').value = ''; $('model-deepseek').value = '' }
  } catch { $('model-feedback').textContent = '操作失败，请重试' }
  finally { busy = false; controls.forEach(item => { item.disabled = false }) }
}
$('model-form').onsubmit = event => {
  event.preventDefault()
  act(async () => {
    const deepseek = $('model-deepseek').value.trim()
    const state = await bridge.assistantState(), remember = $('deepseek-remember').checked
    if (deepseek || state.configured && remember !== state.remember) {
      const result = await bridge.configureAssistant({ apiKey: deepseek, remember, enabled: deepseek ? true : state.enabled })
      if (!result.ok) return result
    }
    return bridge.configureModels({
      apiKey: $('realtime-key').value, remember: $('realtime-remember').checked,
      workspaceId: $('model-workspaceId').value.trim(), ...realtimeDefaults })
  })
}
$('realtime-forget').onclick = () => act(() => bridge.configureModels({ forget: true }))
$('realtime-test').onclick = () => act(() => bridge.testRealtime({
  apiKey: $('realtime-key').value,
  workspaceId: $('model-workspaceId').value.trim(), ...realtimeDefaults,
}), false)
$('deepseek-test').onclick = () => act(() => bridge.testDeepseek({ apiKey: $('model-deepseek').value }), false)
$('model-deepseek-forget').onclick = () => act(() => bridge.configureAssistant({ forget: true }))
bridge.onState(value => {
  const model = value.models || {}
  const source = model.roleSource === 'online' ? '当前为线上角色 · 按平台积分规则计费'
    : model.roleSource === 'local' ? '当前为本地角色 · 使用自有额度，记录不上传平台' : '请选择可用角色'
  const route = ({ deepseek: model.deepseekSource === 'harness-client' ? 'DeepSeek 使用 Harness 客户端账号' : 'DeepSeek 使用自有 Key（纯文字）',
    realtime: 'Realtime 使用自有 Key' })[model.route]
  $('model-current').textContent = [source, route || model.message].filter(Boolean).join('。')
  $('history-sync-status').textContent = `本地 ${value.history?.messages || 0} 条，待同步 ${value.history?.pending || 0} 条。` +
    (model.roleSource === 'local' ? '本地角色记录仅保存在这台电脑。' : '线上角色记录按账号同步。')
})
for (const [id, action] of [['history-export', () => bridge.exportHistory()], ['history-clear', () => bridge.clearHistory()]]) {
  $(id).onclick = async () => { const result = await action(); $('history-feedback').textContent = result.message || '操作未完成' }
}
update(await bridge.modelState())
const assistant = await bridge.assistantState()
$('deepseek-remember').checked = assistant.remember
$('model-deepseek').placeholder = assistant.configured ? '已配置，留空保留现有 Key' : '自己的 DeepSeek Key'
