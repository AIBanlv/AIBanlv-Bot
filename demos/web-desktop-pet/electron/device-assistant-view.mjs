const $ = id => document.getElementById(id), bridge = window.controlDevice
let busy = false, pendingEnabled = null
const labels = { disabled: '未开启', ready: '已开启，下次对话可用', starting: '正在启动电脑助手',
  working: '正在处理电脑任务', approval: '等待你确认具体操作', error: '电脑助手暂时不可用' }
function update(value) {
  if (!value) return
  $('assistant-enabled').checked = pendingEnabled ?? value.enabled
  $('assistant-status').textContent = value.message || labels[value.state] || '未开启'
  $('assistant-indicator').textContent = value.enabled ? '已启用' : '未启用'
  $('assistant-source').textContent = value.source === 'harness-client' ? '当前使用 Harness 客户端账号，不使用自有 Key，不扣平台积分'
    : value.source === 'api-key' ? '当前使用模型配置中的 DeepSeek Key，消耗自己的供应商额度'
      : value.client?.online ? 'Harness 客户端已连接，请在客户端登录；也可以在模型配置中填写自有 Key'
        : '未连接 Harness 客户端：请打开已安装连接插件的客户端，或前往模型配置填写自有 Key'
}
$('assistant-enabled').onchange = async () => {
  if (busy) return
  busy = true; pendingEnabled = $('assistant-enabled').checked; $('assistant-enabled').disabled = true
  try {
    const result = await bridge.configureAssistant({ enabled: $('assistant-enabled').checked })
    pendingEnabled = null
    update(await bridge.assistantState())
    if (!result.ok) $('assistant-status').textContent = result.message || '未能切换电脑助手状态'
  } catch {
    pendingEnabled = null
    try { update(await bridge.assistantState()) } catch {}
    $('assistant-status').textContent = '未能切换电脑助手状态，请重试'
  }
  finally { pendingEnabled = null; busy = false; $('assistant-enabled').disabled = false }
}
$('assistant-model-settings').onclick = () => window.dispatchEvent(new Event('open-model-settings'))
$('assistant-test').onclick = async () => {
  if (busy) return
  busy = true; $('assistant-test').disabled = true; $('assistant-status').textContent = '正在测试当前 Harness 连接'
  try { const result = await bridge.testAssistant(); $('assistant-status').textContent = result?.message || '测试没有返回结果，请重试' }
  catch { $('assistant-status').textContent = '测试失败，请检查客户端连接或模型配置' }
  finally { busy = false; $('assistant-test').disabled = false }
}
let logOpen = false
$('assistant-log').onclick = async () => {
  logOpen = !logOpen; $('assistant-log-panel').hidden = !logOpen
  if (!logOpen) return
  $('assistant-log-view').textContent = '正在读取日志…'
  try {
    const result = await bridge.assistantLog(), lines = result?.lines || []
    $('assistant-log-view').textContent = lines.length ? lines.join('\n') : '暂无日志记录。先测试当前连接再查看。'
    $('assistant-log-path').textContent = result?.path ? ` ${result.path}` : ''
  } catch { $('assistant-log-view').textContent = '无法读取日志，请重启程序后重试' }
}
$('assistant-log-open').onclick = () => bridge.openAssistantLog()
bridge.onAssistant(update)
update(await bridge.assistantState())
