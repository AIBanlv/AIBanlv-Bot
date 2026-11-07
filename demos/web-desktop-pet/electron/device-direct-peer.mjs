// Explicit desktop/mobile snapshot. TURN is opt-in per authorized fallback attempt.
export const MAX_FILE_BYTES = 8 * 1024 * 1024
export const CHUNK_BYTES = 16 * 1024
export const digest = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), value => value.toString(16).padStart(2, '0')).join('')
export function validMeta(value) {
  return value && /^[a-f0-9-]{36}$/.test(value.transferId) && typeof value.name === 'string' &&
    value.name.length > 0 && value.name.length <= 180 && !/[\\/:\x00-\x1f]/.test(value.name) &&
    !['.', '..'].includes(value.name) && Number.isSafeInteger(value.size) && value.size > 0 &&
    value.size <= MAX_FILE_BYTES && /^[a-f0-9]{64}$/.test(value.sha256)
}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const peerError = (code, message) => Object.assign(new Error(message), { code })
export function cloudflareIceServers(value) {
  if (!Array.isArray(value) || !value.length || value.length > 4) throw new Error('Cloudflare 临时凭证无效')
  return value.map(server => {
    const urls = typeof server?.urls === 'string' ? [server.urls] : server?.urls
    if (!Array.isArray(urls) || !urls.length || urls.length > 8 || urls.some(url => typeof url !== 'string' ||
      !/^turns?:turn\.cloudflare\.com:(3478|443|5349|80)\?transport=(udp|tcp)$/.test(url)) ||
      typeof server.username !== 'string' || !server.username || server.username.length > 512 ||
      typeof server.credential !== 'string' || !server.credential || server.credential.length > 512) throw new Error('Cloudflare 临时凭证无效')
    return { urls: urls.slice(), username: server.username, credential: server.credential }
  })
}
const candidateTypes = sdp => {
  const counts = { host: 0, srflx: 0, prflx: 0, relay: 0 }
  for (const match of (sdp || '').matchAll(/^a=candidate:.*\styp\s+(host|srflx|prflx|relay)\b/gm)) counts[match[1]]++
  return counts
}
export class DirectPeer {
  constructor({ signal, onState = () => {}, onFile = async () => {}, createPeer = config => new RTCPeerConnection(config),
    iceServers = [{ urls: 'stun:stun.cloudflare.com:3478' }, { urls: 'stun:stun.l.google.com:19302' }], timeoutMs = 120000,
    gatherMs = 8000, settleMs = 250, relay = false }) {
    if (relay) iceServers = cloudflareIceServers(iceServers)
    else if (iceServers.some(server => typeof server.urls !== 'string' || !/^stun:[a-z0-9.-]+(?::\d+)?$/i.test(server.urls))) throw new Error('Only STUN is allowed before authorized fallback')
    Object.assign(this, { signal, onState, onFile, createPeer, iceServers, timeoutMs, gatherMs, settleMs, relay })
  }
  diagnostic(stage, extra = {}) {
    this.stage = stage
    this.onState({ status: 'diagnostic', transferId: this.meta?.transferId, stage,
      gathering: this.pc?.iceGatheringState, connection: this.pc?.connectionState, ice: this.pc?.iceConnectionState,
      candidates: candidateTypes(this.pc?.localDescription?.sdp), ...extra })
  }
  setup(meta) {
    if (this.pc || !validMeta(meta)) throw new Error('Invalid or busy transfer')
    if (!globalThis.crypto?.subtle) throw new Error('当前环境不支持安全文件校验')
    this.meta = { transferId: meta.transferId, name: meta.name, size: meta.size, sha256: meta.sha256 }
    this.pc = this.createPeer({ iceServers: this.iceServers, iceTransportPolicy: this.relay ? 'relay' : 'all' })
    this.pc.onicecandidate = () => { this.lastCandidateAt = Date.now() }
    this.pc.onicecandidateerror = value => this.diagnostic('stun-error', { errorCode: Number(value.errorCode) || 0 })
    this.pc.oniceconnectionstatechange = () => this.diagnostic('ice-state')
    this.pc.onconnectionstatechange = () => {
      this.diagnostic('connection-state')
      if (['failed', 'closed'].includes(this.pc?.connectionState) && !this.done) this.fail(this.relay ? 'Cloudflare 中转连接失败' : '两端网络无法建立直连', 'ICE_CONNECT_FAILED')
    }
    this.timer = setTimeout(() => this.fail(this.sender && !this.answered ? '手机未返回连接应答，请保持接收页在线后重试'
      : !this.opened ? '已交换连接地址，但两端网络未能直连；请尝试同一 Wi-Fi'
        : '文件传输或手机校验回执超时，文件未确认送达', this.sender && !this.answered ? 'PHONE_NO_ANSWER'
          : !this.opened ? 'ICE_CONNECT_TIMEOUT' : 'TRANSFER_ACK_TIMEOUT'), this.timeoutMs)
    this.onState({ status: 'connecting', ...this.meta })
  }
  async description(type) {
    await this.pc.setLocalDescription(await (type === 'offer' ? this.pc.createOffer() : this.pc.createAnswer()))
    const started = Date.now(), end = started + this.gatherMs
    this.diagnostic('gather-start')
    while (this.pc?.iceGatheringState !== 'complete') {
      if (this.done || !this.pc) throw peerError('TRANSFER_CANCELLED', '文件连接已取消')
      const counts = candidateTypes(this.pc.localDescription?.sdp)
      // A slow/unreachable STUN server or unused network adapter can keep ICE
      // gathering for tens of seconds even after usable addresses are ready.
      // The protocol carries one bounded SDP: use a settled public candidate,
      // or the available LAN candidates at the deadline, never an empty offer.
      if ((this.relay ? counts.relay : counts.srflx + counts.prflx) > 0 && Date.now() - (this.lastCandidateAt || started) >= this.settleMs) break
      if (Date.now() >= end) break
      await delay(20)
    }
    const sdp = this.pc.localDescription.sdp
    if (sdp.length > 24576 || !this.relay && sdp.includes('typ relay')) throw new Error('拒绝未授权中转连接')
    const counts = candidateTypes(sdp)
    if (!(this.relay ? counts.relay : counts.host + counts.srflx + counts.prflx)) throw peerError('ICE_NO_CANDIDATE', this.relay ? '未获得 Cloudflare 中转地址' : '未获得任何直连地址，请检查系统网络、VPN 或防火墙后重试')
    this.diagnostic('gather-ready', { partial: this.pc.iceGatheringState !== 'complete', elapsedMs: Date.now() - started })
    return sdp
  }
  send(meta, readChunk) {
    this.setup(meta); this.sender = true
    this.completion = new Promise((resolve, reject) => { this.resolve = resolve; this.reject = reject })
    this.dc = this.pc.createDataChannel('control-file-v1', { ordered: true })
    this.dc.binaryType = 'arraybuffer'
    this.dc.onmessage = event => {
      try {
        if (typeof event.data !== 'string' || event.data.length > 512) throw new Error()
        const ack = JSON.parse(event.data)
        if (ack.type !== 'received' || ack.transferId !== meta.transferId || ack.sha256 !== meta.sha256 || ack.size !== meta.size) throw new Error()
        if (this.done) return
        this.done = true; clearTimeout(this.timer)
        this.onState({ status: 'received', ...this.meta })
        this.resolve({ status: 'received', ...this.meta }); this.close()
      } catch { this.fail('手机未返回有效的完整接收回执') }
    }
    this.dc.onclose = () => { if (!this.done) this.fail('文件连接断开，尚未确认送达') }
    this.dc.onopen = () => { this.opened = true; this.diagnostic('channel-open'); void (async () => {
      for (let offset = 0; offset < meta.size; offset += CHUNK_BYTES) {
        while (!this.done && this.dc.bufferedAmount > 256 * 1024) await delay(10)
        if (this.done) return
        const chunk = new Uint8Array(await readChunk(offset, Math.min(CHUNK_BYTES, meta.size - offset)))
        if (chunk.byteLength !== Math.min(CHUNK_BYTES, meta.size - offset)) throw new Error('文件分片长度不符')
        this.dc.send(chunk)
        this.onState({ status: 'sending', bytes: offset + chunk.byteLength, ...this.meta })
      }
      this.dc.send(JSON.stringify({ type: 'end' }))
    })().catch(error => this.fail(error.message)) }
    void this.description('offer').then(sdp => this.signal({ kind: 'offer', sdp, ...this.meta })).catch(error => this.fail(error.message, error.code))
    return this.completion
  }
  async accept(offer) {
    if (typeof offer?.sdp !== 'string' || offer.sdp.length > 24576 || !offer.sdp.startsWith('v=0') || !this.relay && offer.sdp.includes('typ relay')) throw new Error('Invalid direct offer')
    this.setup(offer); this.chunks = []; this.bytes = 0
    this.pc.ondatachannel = event => {
      if (this.dc || event.channel.label !== 'control-file-v1') { event.channel.close(); return }
      this.dc = event.channel; this.dc.binaryType = 'arraybuffer'
      this.dc.onopen = () => { this.opened = true; this.diagnostic('channel-open') }
      this.dc.onclose = () => { if (!this.done) this.fail('文件连接断开，接收未完成') }
      this.dc.onmessage = event => { void this.consume(event.data).catch(error => this.fail(error.message)) }
    }
    try {
      await this.pc.setRemoteDescription({ type: 'offer', sdp: offer.sdp })
      const sdp = await this.description('answer')
      await this.signal({ kind: 'answer', transferId: offer.transferId, sdp })
    } catch (error) { this.fail(error.message, error.code); throw error }
  }
  async consume(data) {
    if (this.done || this.ending) return
    if (typeof data === 'string') {
      if (data.length > 100 || JSON.parse(data).type !== 'end' || this.bytes !== this.meta.size) throw new Error('文件不完整')
      this.ending = true
      const bytes = new Uint8Array(this.bytes); let offset = 0
      for (const chunk of this.chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
      if (await digest(bytes) !== this.meta.sha256) throw new Error('文件校验失败')
      if (this.done) return
      await this.onFile({ ...this.meta, bytes })
      if (this.done) return
      this.dc.send(JSON.stringify({ type: 'received', ...this.meta }))
      this.done = true; clearTimeout(this.timer); this.chunks = []
      this.onState({ status: 'received', ...this.meta })
      setTimeout(() => this.close(), 300)
      return
    }
    if (!(data instanceof ArrayBuffer) || data.byteLength < 1 || data.byteLength > CHUNK_BYTES || this.bytes + data.byteLength > this.meta.size) throw new Error('文件分片无效或超出限制')
    const chunk = new Uint8Array(data); this.chunks.push(chunk); this.bytes += chunk.byteLength
    this.onState({ status: 'receiving', bytes: this.bytes, ...this.meta })
  }
  async handle(message) {
    if (message.transferId !== this.meta?.transferId || this.done) return
    if (message.kind === 'cancel') { this.fail('对端连接失败或取消接收', ['ICE_NO_CANDIDATE', 'ICE_CONNECT_FAILED', 'ICE_CONNECT_TIMEOUT'].includes(message.reason) ? message.reason : 'PEER_CANCELLED'); return }
    if (this.sender && message.kind === 'answer') {
      if (this.answered || typeof message.sdp !== 'string' || message.sdp.length > 24576 || !this.relay && message.sdp.includes('typ relay')) return
      this.answered = true
      try { await this.pc.setRemoteDescription({ type: 'answer', sdp: message.sdp }); this.diagnostic('answer-applied') }
      catch { this.fail('手机返回的连接应答无效', 'ANSWER_INVALID') }
    }
  }
  fail(message = '文件直连已取消，未使用服务器中转', code = 'DIRECT_FAILED') {
    if (this.done) return
    this.done = true; clearTimeout(this.timer)
    this.onState({ status: 'failed', message, code, opened: this.opened === true, ...this.meta })
    this.reject?.(peerError(code, message)); this.close()
  }
  close() { clearTimeout(this.timer); this.dc?.close(); this.pc?.close(); this.pc = null; this.chunks = [] }
}

