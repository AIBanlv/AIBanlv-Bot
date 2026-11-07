import { randomUUID, createHash } from 'node:crypto'
import { open, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { resolveRequestedFile } from './device-file-request.mjs'
import { cloudflareIceServers } from './device-direct-peer.mjs'

const MAX = 8 * 1024 * 1024
const errors = { PHONE_NOT_READY: '请保持发起指令手机的远程对话页或“接收电脑文件”页打开，保持两端在线后重试',
  PHONE_OFFLINE: '绑定手机已离线，文件未发送', DEVICE_NOT_BOUND: '设备绑定已失效，文件未发送',
  PHONE_AMBIGUOUS: '多台手机正在接收，请只在目标手机保留接收页面后重试；未发送文件',
  TRANSFER_RATE_LIMIT: '发送请求过于频繁，请稍后重试', TURN_DISABLED: '后端尚未配置 Cloudflare TURN，跨网直连失败，文件未送达',
  TURN_UNAVAILABLE: 'Cloudflare 临时连接凭证申请失败，文件未送达', TURN_FORBIDDEN: '中转连接授权无效，请更新三端并重试',
  TURN_AUTH_FAILED: 'Cloudflare TURN 令牌无效或权限不足，请管理员检查后端配置；截图或文件未送达',
  TURN_REQUEST_BLOCKED: 'Cloudflare 拦截了后端凭证请求，请管理员检查请求标识与服务器出网；截图或文件未送达',
  TURN_KEY_NOT_FOUND: 'Cloudflare TURN 令牌 ID 不存在，请管理员检查后端配置；文件未送达',
  TURN_RATE_LIMIT: 'Cloudflare TURN 凭证申请被限流，请稍后重试；文件未送达',
  TURN_TIMEOUT: '后端连接 Cloudflare TURN 超时，请检查服务器出网；文件未送达',
  TURN_NETWORK_ERROR: '后端无法连接 Cloudflare TURN，请检查服务器 DNS、TLS 与出网；文件未送达',
  TURN_INVALID_RESPONSE: 'Cloudflare TURN 返回了无效连接凭证，请管理员检查后端；文件未送达',
  TURN_PROVIDER_UNAVAILABLE: 'Cloudflare TURN 服务暂不可用，请稍后重试；文件未送达' }
const peerErrors = {
  ICE_NO_CANDIDATE: '电脑未获得直连地址，请检查网络、VPN 或防火墙后重试；文件未发送',
  ICE_CONNECT_FAILED: '两端网络无法建立直连，请尝试同一 Wi-Fi；未使用服务器中转',
  ICE_CONNECT_TIMEOUT: '已交换连接地址，但两端网络未能直连；请尝试同一 Wi-Fi',
  PHONE_NO_ANSWER: '手机未返回连接应答，请保持接收页在线后重试',
  TRANSFER_ACK_TIMEOUT: '文件传输或手机校验回执超时，文件未确认送达',
  PEER_CANCELLED: '手机取消或拒绝了接收，请检查接收页面后重试',
  ANSWER_INVALID: '手机返回的连接应答无效，请更新手机端后重试',
  SIGNAL_REJECTED: '电脑无法发送连接邀请，请检查控制连接后重试',
}
export class DeviceFileTransfer {
  constructor({ channel, directory, chooseFile, captureScreen, sendWorker, onActivity = () => {},
    selectionMs = 30000, transferMs = 40000, workerMs = 10000, log, fileRoots = [] }) {
    Object.assign(this, { channel, directory, chooseFile, captureScreen, sendWorker, onActivity,
      selectionMs, transferMs, workerMs, log, fileRoots })
    channel.on('transfer-signal', value => {
      if (value.transferId !== this.pending?.meta.transferId) return
      if (value.kind === 'answer') { this.pending.answered = true; this.log?.event('transfer.answer', { transferId: value.transferId }) }
      this.sendWorker('signal', value)
    })
    channel.on('transfer-ice', value => this.relayCredentials(value))
    channel.on('request-error', value => {
      if (value.requestId === this.pending?.meta.transferId) {
        this.log?.event('transfer.rejected', { transferId: value.requestId, code: value.code })
        this.reset(errors[value.code] || '文件连接请求被拒绝，文件未确认送达')
      }
    })
    channel.on('revoked', () => { this.lastCapture = null; this.reset('绑定已变化，文件传输已停止') })
    channel.on('state', value => { if (value.connection !== 'connected') this.reset('控制连接已断开，文件未确认送达') })
  }
  identity() { const s = this.channel.state; return s.binding === 'bound' && s.connection === 'connected' ? `${s.deviceId}|${this.channel.tenantId}|${s.owner}` : '' }
  async select(signal) {
    if (this.pickerOpen) throw new Error('电脑的文件选择窗口仍然打开，请先选择文件或取消')
    this.pickerOpen = true
    this.selectionAbort = new AbortController()
    signal = AbortSignal.any([signal, this.selectionAbort.signal])
    this.onActivity({ kind: 'status', text: '等待在电脑弹出的窗口中选择文件；选择前尚未向手机发送。截图请使用“发送刚才的截图”', key: 'file-picker' })
    this.log?.event('transfer.selecting')
    let timer, abort
    const selected = Promise.resolve().then(() => { signal.throwIfAborted(); return this.chooseFile({ signal }) }).finally(() => { this.pickerOpen = false })
    try {
      return await Promise.race([selected, new Promise((_, reject) => {
        abort = () => reject(new Error('已停止等待选择文件，文件未发送；请关闭仍打开的文件选择窗口'))
        signal.addEventListener('abort', abort, { once: true })
        if (signal.aborted) abort()
        timer = setTimeout(() => reject(new Error('等待电脑选择文件超时，文件未发送；请关闭选择窗口后重试')), this.selectionMs)
      })])
    } catch (error) {
      this.onActivity({ kind: 'error', text: error.message, key: 'file-picker' })
      this.log?.event('transfer.selection-ended', { message: error.message })
      throw error
    } finally { clearTimeout(timer); signal.removeEventListener('abort', abort); this.selectionAbort = null }
  }
  async capture({ signal, persist = true }) {
    signal.throwIfAborted()
    const identity = this.identity(); if (!identity) throw new Error('请先连接并绑定设备')
    const png = await this.captureScreen(); signal.throwIfAborted()
    if (!Buffer.isBuffer(png) || png.length < 8 || png.length > MAX || !png.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw new Error('截图失败或图片超过 8 MiB')
    if (identity !== this.identity()) throw new Error('绑定已变化，已取消截图')
    const name = `screenshot-${randomUUID()}.png`, file = persist ? path.join(this.directory, name) : ''
    if (persist) {
      await mkdir(this.directory, { recursive: true })
      await writeFile(file, png, { flag: 'wx', mode: 0o600 })
    }
    signal.throwIfAborted()
    if (identity !== this.identity()) throw new Error('绑定已变化，已取消截图')
    this.lastCapture = { bytes: png, name, file, identity }
    this.onActivity({ kind: 'status', text: persist ? `截图已保存：${file}；尚未发送到手机` : '任务截图已生成，正在尝试直连回传，尚未确认送达', key: 'capture' })
    return { status: 'captured', path: file, bytes: png.length, message: persist
      ? '主屏截图已保存到本机，尚未发送到手机；需要发送时使用 latest_capture'
      : '主屏截图已生成，仅临时驻留内存，尚未确认送达手机' }
  }
  async receipt({ signal, targetSession }) {
    if (!targetSession) return { status: 'failed', message: '原手机会话不可用，未发送截图凭证' }
    try {
      await this.capture({ signal, persist: false })
      return await this.send('latest_capture', { signal, targetSession, purpose: 'task_receipt' })
    } catch (error) {
      if (signal.aborted) throw error
      const message = `任务截图未送达：${error.message}`
      this.onActivity({ kind: 'error', text: message, key: 'remote-receipt' })
      return { status: 'failed', message }
    }
  }
  async send(target, { signal, targetSession = '', purpose = 'file', request = '' }) {
    signal.throwIfAborted()
    const identity = this.identity()
    if (!identity) throw new Error('请先连接并绑定设备')
    if (!this.channel.state.directTransferSupported) throw new Error('当前控制服务尚未启用手机文件直连，请更新后端与手机端；未上传文件')
    if (this.channel.state.proofRequired && !this.channel.state.accountAuthReady) throw new Error('旧绑定缺少安全凭据，请在手机解绑后重新扫码绑定；未发送文件')
    if (this.pending) throw new Error('已有文件正在发送，请等待或停止当前任务')
    let bytes, name
    if (target === 'latest_capture') {
      if (!this.lastCapture || this.lastCapture.identity !== identity) throw new Error('当前绑定下没有可发送的截图，请先截图')
      ;({ bytes, name } = this.lastCapture)
    } else if (target === 'choose' || target === 'request') {
      const file = target === 'request' ? await resolveRequestedFile(request, this.fileRoots, signal) : await this.select(signal)
      signal.throwIfAborted()
      if (!file) throw new Error('已取消选择文件，未发送')
      const handle = await open(file, 'r')
      try {
        const info = await handle.stat()
        if (!info.isFile() || info.size < 1 || info.size > MAX) throw new Error('请选择 1 字节至 8 MiB 的单个文件')
        const buffer = Buffer.alloc(info.size + 1)
        let offset = 0
        while (offset < buffer.length) {
          signal.throwIfAborted()
          const part = await handle.read(buffer, offset, buffer.length - offset, offset)
          if (!part.bytesRead) break
          offset += part.bytesRead
        }
        if (offset !== info.size) throw new Error('文件大小已变化，未发送')
        bytes = buffer.subarray(0, offset); name = path.basename(file)
      } finally { await handle.close() }
    } else throw new Error('只支持 request、choose 或 latest_capture，不接受模型提供的文件路径')
    signal.throwIfAborted()
    if (identity !== this.identity()) throw new Error('绑定已变化，未发送文件')
    if (this.pending) throw new Error('已有文件正在发送，请等待或停止当前任务')
    const meta = { transferId: randomUUID(), name, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }
    return new Promise((resolve, reject) => {
      const abort = () => this.reset('任务已取消，文件未确认送达')
      const timer = setTimeout(() => {
        const p = this.pending
        if (p?.offered && p.answered && this.retryRelay(p, 'ICE_CONNECT_TIMEOUT')) return
        this.reset(!p?.offered ? '电脑尚未发出直连邀请，请检查网络或诊断日志' : !p.answered ? peerErrors.PHONE_NO_ANSWER
          : !p.opened && !p.sending ? peerErrors.ICE_CONNECT_TIMEOUT : peerErrors.TRANSFER_ACK_TIMEOUT)
      }, this.channel.state.turnFallbackSupported ? Math.min(this.transferMs, 20000) : this.transferMs)
      this.pending = { meta, bytes, identity, resolve, reject, timer, signal, abort, targetSession, purpose }
      signal.addEventListener('abort', abort, { once: true })
      this.sendWorker('start', meta)
      if (this.pending) this.pending.workerTimer = setTimeout(() => this.reset('电脑文件发送组件未响应，请重新打开设置后重试；文件未发送'), this.workerMs)
      this.log?.event('transfer.started', { transferId: meta.transferId, bytes: meta.size })
      this.onActivity({ kind: 'status', text: `正在直连绑定手机：${name}${this.channel.state.turnFallbackSupported ? '；连接失败时尝试 Cloudflare 兜底' : '；未启用中转'}`, key: meta.transferId })
    })
  }
  chunk(id, offset, length) {
    const p = this.pending
    if (!p || p.identity !== this.identity() || p.signal.aborted || p.meta.transferId !== id || !Number.isInteger(offset) || !Number.isInteger(length) ||
        offset < 0 || length < 1 || length > 16384 || offset + length > p.bytes.length) throw new Error('文件分片请求无效')
    return p.bytes.subarray(offset, offset + length)
  }
  signal(value) {
    const p = this.pending
    if (!p || p.identity !== this.identity() || value?.transferId !== p.meta.transferId || !['offer', 'cancel'].includes(value.kind)) return false
    const message = { type: 'transfer_signal', deviceId: this.channel.state.deviceId, requestId: p.meta.transferId,
      transferId: p.meta.transferId, kind: value.kind }
    if (value.kind === 'offer') {
      if (typeof value.sdp !== 'string' || value.sdp.length > 24576 || !p.relay && value.sdp.includes('typ relay') || p.offered || p.waitingIce) return false
      Object.assign(message, p.meta, { sdp: value.sdp, purpose: p.purpose })
      if (p.relay) message.transport = 'cloudflare'
      if (p.targetSession) message.targetSession = p.targetSession
      p.offered = true
      this.log?.event('transfer.offered', { transferId: p.meta.transferId })
    }
    return this.channel.send(message)
  }
  state(value) {
    const p = this.pending
    if (!p || p.identity !== this.identity() || p.meta.transferId !== value?.transferId) return
    clearTimeout(p.workerTimer)
    if (value.status === 'diagnostic') {
      const stages = ['gather-start', 'gather-ready', 'stun-error', 'ice-state', 'connection-state', 'answer-applied', 'channel-open']
      if (!stages.includes(value.stage)) return
      p.stage = value.stage
      if (value.stage === 'channel-open') p.opened = true
      this.log?.event('transfer.peer', { transferId: p.meta.transferId, stage: value.stage,
        gathering: ['new', 'gathering', 'complete'].includes(value.gathering) ? value.gathering : '',
        connection: ['new', 'connecting', 'connected', 'disconnected', 'failed', 'closed'].includes(value.connection) ? value.connection : '',
        errorCode: Number.isInteger(value.errorCode) ? value.errorCode : undefined,
        partial: value.partial === true, elapsedMs: Number.isInteger(value.elapsedMs) ? value.elapsedMs : undefined,
        host: Number(value.candidates?.host) || 0, srflx: Number(value.candidates?.srflx) || 0,
        relay: Number(value.candidates?.relay) || 0 })
      return
    }
    if (['connecting', 'sending'].includes(value.status)) {
      if (value.status === 'sending') p.sending = true
      this.onActivity({ kind: 'status', text: value.status === 'sending'
        ? `正在向手机发送文件：${Math.min(p.meta.size, Math.max(0, Number(value.bytes) || 0))}/${p.meta.size} 字节`
        : p.relay ? '正在通过 Cloudflare 建立手机文件连接…' : '文件已准备，正在建立与手机的直连…', key: p.meta.transferId })
    }
    if (value.status === 'received') {
      this.log?.event('transfer.received', { transferId: p.meta.transferId, bytes: p.meta.size })
      this.cleanup(); p.resolve({ status: 'received', name: p.meta.name, size: p.meta.size, message: `绑定手机已完整接收并通过 SHA-256 校验；${p.relay ? 'Cloudflare 加密中转' : '端到端直连'}` })
      this.onActivity({ kind: 'status', text: `手机已接收并校验：${p.meta.name}`, key: p.meta.transferId })
    } else if (value.status === 'failed') {
      if (p.waitingIce) return
      if (value.opened) p.opened = true
      if (this.retryRelay(p, value.code)) return
      this.log?.event('transfer.peer-failed', { transferId: p.meta.transferId, message: String(value.message || '').slice(0, 300) })
      this.reset(p.relay ? 'Cloudflare 兜底传输失败，文件未确认送达；请检查网络后重试' : peerErrors[value.code] || '文件直连失败或被取消；请查看诊断日志中的具体阶段，文件未确认送达')
    }
  }
  retryRelay(p, code) {
    if (!this.channel.state.turnFallbackSupported || p.relay || p.opened || p.sending || p.signal.aborted ||
        !['ICE_NO_CANDIDATE', 'ICE_CONNECT_FAILED', 'ICE_CONNECT_TIMEOUT'].includes(code)) return false
    this.signal({ kind: 'cancel', transferId: p.meta.transferId })
    this.sendWorker('reset', {})
    p.meta = { ...p.meta, transferId: randomUUID() }; p.relay = true; p.waitingIce = true; p.offered = false; p.answered = false; p.stage = ''
    clearTimeout(p.timer); clearTimeout(p.workerTimer)
    p.timer = setTimeout(() => this.reset('Cloudflare 传输或手机校验回执超时，文件未确认送达'), this.transferMs)
    p.workerTimer = setTimeout(() => this.reset('Cloudflare 临时连接凭证申请超时，文件未送达'), 16000)
    this.onActivity({ kind: 'status', text: '纯直连未建立，正在申请 Cloudflare 加密中转；业务服务器不承载文件', key: p.meta.transferId })
    this.log?.event('transfer.relay-requested', { transferId: p.meta.transferId, cause: code })
    if (!this.channel.send({ type: 'get_transfer_ice', deviceId: this.channel.state.deviceId, requestId: p.meta.transferId,
      transferId: p.meta.transferId, ...(p.targetSession ? { targetSession: p.targetSession } : {}) })) this.reset('控制连接已断开，未申请中转')
    return true
  }
  relayCredentials(value) {
    const p = this.pending
    if (!p?.waitingIce || p.identity !== this.identity() || p.signal.aborted || value.transferId !== p.meta.transferId || value.requestId !== p.meta.transferId) return
    try {
      if (value.provider !== 'cloudflare' || !Number.isInteger(value.expiresIn) || value.expiresIn < 30 || value.expiresIn > 600) throw new Error()
      const iceServers = cloudflareIceServers(value.iceServers)
      clearTimeout(p.workerTimer); p.waitingIce = false
      p.workerTimer = setTimeout(() => this.reset('电脑中转发送组件未响应，文件未送达'), this.workerMs)
      this.sendWorker('start', { ...p.meta, relay: true, iceServers })
    } catch { this.reset('Cloudflare 临时连接凭证无效，文件未送达') }
  }
  cleanup() { const p = this.pending; if (!p) return; clearTimeout(p.timer); clearTimeout(p.workerTimer); p.signal.removeEventListener('abort', p.abort); this.pending = null }
  reset(message = '应用退出，文件传输已停止') {
    this.selectionAbort?.abort()
    const p = this.pending; if (!p) return
    this.log?.event('transfer.failed', { transferId: p.meta.transferId, message })
    this.signal({ kind: 'cancel', transferId: p.meta.transferId }); this.cleanup(); this.sendWorker('reset', {})
    p.reject(new Error(message)); this.onActivity({ kind: 'error', text: message, key: p.meta.transferId })
  }
}
