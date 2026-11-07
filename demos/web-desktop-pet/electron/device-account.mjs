// Account metadata comes only from the current server-confirmed binding. The
// desktop has no mobile JWT and must not query a tenant ledger by impersonation.
export class DeviceAccount {
  constructor({ channel, timeoutMs = 8000 }) {
    Object.assign(this, { channel, timeoutMs })
    this.pending = null
    channel.on('account', value => {
      if (this.pending && value?.requestId === this.pending.requestId) {
        const snapshot = this.snapshot()
        this.pending.resolve({ ...snapshot, ok: Number.isFinite(snapshot.points), message: snapshot.message || '积分已刷新' }); this.pending = null
      }
    })
    channel.on('revoked', () => {
      this.pending?.resolve({ ok: true, ...this.snapshot() }); this.pending = null
    })
    channel.on('state', state => {
      const key = state.binding === 'bound' && state.connection === 'connected' && state.accountSupported && (!state.proofRequired || state.accountAuthReady)
        ? `${state.deviceId}|${channel.tenantId}|${state.owner}` : ''
      if (key === this.bindingKey) return
      this.bindingKey = key
      if (key) void this.request('get_device_account')
    })
    channel.on('request-error', value => {
      if (value.requestId !== this.pending?.requestId) return
      this.pending.resolve({ ok: false, message: '账号信息查询失败，请稍后刷新；未显示虚构余额' }); this.pending = null
    })
  }
  snapshot() {
    const state = this.channel.state, bound = state.binding === 'bound'
    const metadata = bound ? state.account || {} : {}
    return { bound, name: bound ? metadata.name || '已绑定账号（昵称待同步）' : '未登录',
      points: bound && Number.isFinite(metadata.points) ? metadata.points : null,
      message: bound && state.proofRequired && !state.accountAuthReady ? '旧绑定缺少安全凭据，请在手机解绑后重新扫码，以启用账户信息与文件直连；旧对话功能不受影响'
        : bound && !Number.isFinite(metadata.points) ? state.accountSupported ? '账号积分尚未取得，请刷新账号信息' : '控制服务尚未提供账号昵称与积分，请在手机端查看' : '',
      supported: bound && state.accountSupported === true }
  }
  request(type) {
    if (type !== 'get_device_account') return this.performRequest(type)
    const key = `${this.channel.state.deviceId}|${this.channel.tenantId}|${this.channel.state.owner}|${this.channel.state.binding}`
    if (this.refreshJob?.key === key) return this.refreshJob.promise
    const job = { key }
    job.promise = this.performRequest(type).finally(() => { if (this.refreshJob === job) this.refreshJob = null })
    this.refreshJob = job
    return job.promise
  }
  async performRequest(type) {
    const snapshot = this.snapshot()
    if (!snapshot.bound) return { ok: false, message: '请先扫码绑定账号' }
    if (this.channel.state.proofRequired && !this.channel.state.accountAuthReady) return { ok: false, ...snapshot, message: snapshot.message }
    if (!snapshot.supported) return { ok: false, ...snapshot, message: type === 'device_logout'
      ? '当前控制服务不支持电脑端退出绑定，请在手机端设备管理中解绑。不会用“退出应用”冒充退出登录。'
      : snapshot.message }
    if (this.pending) return { ok: false, message: '账号请求正在处理中，请稍后' }
    const requestId = `account-${Date.now()}`
    let timer
    try {
      return await new Promise(resolve => {
        this.pending = { requestId, resolve }
        timer = setTimeout(() => { if (this.pending?.requestId === requestId) { this.pending = null; resolve({ ok: false, message: '账号服务未响应，请稍后重试' }) } }, this.timeoutMs)
        if (!this.channel.send({ type, requestId, deviceId: this.channel.state.deviceId })) {
          this.pending = null; resolve({ ok: false, message: '控制服务未连接，请稍后重试' })
        }
      })
    } finally { clearTimeout(timer) }
  }
}

export { checkDesktopUpdate } from './device-update.mjs'
