import { DeviceRealtime } from './device-realtime.mjs'
import { ownRealtimeSession } from './device-model-settings.mjs'
import { DeviceTextConversation } from './device-text-conversation.mjs'

const settingsErrors = {
  REALTIME_KEY_REQUIRED: '请填写自己的 Realtime Key；留空时使用此前已配置的 Key',
  WORKSPACE_REQUIRED: '请填写业务空间 ID（Workspace ID）',
  INVALID_KEY: 'Key 格式无效，请填写完整 Key，检查是否包含空格或换行',
  INVALID_MODEL_SETTINGS: '配置格式无效，请检查地域、业务空间 ID、模型名称和音色',
}

export function registerModelControls({ ipcMain, windows, settings, deepseek, harnessClient, channel, runtime, changed }) {
  let queue = Promise.resolve()
  const handle = (name, work) => ipcMain.handle(`device:${name}`, (event, value) => {
    if (!windows.fromController(event)) return { ok: false, code: 'FORBIDDEN' }
    const job = queue.then(async () => {
      try { return { ok: true, ...await work(value) } }
      catch (error) { return { ok: false, code: error.code || 'MODEL_FAILED', message: settingsErrors[error.code] || '操作未完成，请检查 Key、业务空间、模型配置和本机存储后重试' } }
    })
    queue = job.catch(() => {}); return job
  })
  handle('models-state', () => settings.snapshot())
  handle('models-configure', async value => {
    const next = await settings.configure(value)
    if (Object.keys(value).some(key => key !== 'platformEnabled')) await changed()
    if (value.platformEnabled === true) channel.start()
    else if (value.platformEnabled === false && channel.started) {
      channel.stop(); channel.publish({ connection: 'offline', accountAuthReady: false, qr: '', expiresAt: 0, error: '' })
    }
    if (value.platformEnabled === false && runtime.state.current?.source !== 'local' && !runtime.state.current?.publicAvatar) {
      runtime.clear(); await runtime.ensureInitialProfile()
    }
    return next
  })
  handle('models-test', async value => {
    const session = ownRealtimeSession(settings.preview(value),
      { agentId: 'connection-test', characterSetting: '请仅回复连接正常。' })
    const client = new DeviceRealtime({ bootstrap: async () => session })
    try {
      const result = await client.preconnect()
      return result.ok ? { message: 'Realtime 连接正常，使用自有额度，不扣平台积分' }
        : { ok: false, code: result.code, message: 'Realtime 连接失败，请核对 Key、地域、业务空间和模型权限' }
    } finally { await client.dispose() }
  })
  handle('models-test-text', async value => {
    const useHarness = !value?.apiKey?.trim() && harnessClient?.ready()
    const client = new DeviceTextConversation({ settings: deepseek.preview(value), client: useHarness ? harnessClient : undefined,
      context: () => ({ agentId: 'connection-test', persona: '请仅回复连接正常。' }),
      onEvent: () => {}, timeoutMs: 15000 })
    try {
      const result = await client.chat('连接测试')
      return result.ok ? { message: useHarness ? 'DeepSeek 连接正常，使用 Harness 客户端账号，不扣平台积分' : 'DeepSeek 连接正常，使用自有额度，不扣平台积分' }
        : { ok: false, code: result.code, message: result.message }
    } finally { client.close() }
  })
}
