import assert from 'node:assert/strict'

export async function verifyRemoteCodex({ app }) {
  const result = await app.evaluate(async () => {
    const channel = globalThis.permissionChannel
    // Unbound submit captures the real main-owned reply bridge without starting work.
    channel.emit('text', 'fixture capture', 'capture-only', {})
    const replies = globalThis.permissionReplies, conversation = globalThis.permissionConversation
    const dispatcher = globalThis.permissionDispatcher
    if (!replies || !conversation || !dispatcher) throw new Error('remote adapters were not captured')
    const original = dispatcher.sendRemote, calls = []
    dispatcher.sendRemote = async (text, options) => {
      calls.push({ text, authorized: options.allowComputer, session: options.sessionId, ...(options.target ? { target: options.target } : {}) })
      return { ok: true, status: 'queued', message: 'fixture queued acknowledgement' }
    }
    try {
      const accepted = await replies.chat('先解释方案，暂时不要修改代码', {
        computerAuthorized: true, originSessionId: 'fixture-phone',
      })
      const denied = await replies.chat('打开微信', { computerAuthorized: false })
      const selected = []
      for (const remoteTarget of ['codex', 'deepseek', 'harness', 'workbuddy']) {
        selected.push((await replies.chat('截屏也要交给我选中的工具', {
          computerAuthorized: true, originSessionId: 'fixture-phone', remoteTarget,
        })).ok)
      }
      const deniedSelection = await replies.chat('普通问题', { remoteTarget: 'harness', computerAuthorized: false })
      const local = await conversation.send('本地普通消息')
      return { accepted: accepted.ok, selected, deniedSelection: deniedSelection.code, denied: denied.code, local: local.ok, calls }
    } finally {
      dispatcher.sendRemote = original
    }
  })
  assert.equal(result.accepted, true)
  assert.equal(result.denied, 'REMOTE_AUTH_REQUIRED')
  assert.equal(result.deniedSelection, 'REMOTE_AUTH_REQUIRED')
  assert.deepEqual(result.selected, [true, true, true, true])
  assert.equal(result.local, false, 'unconfigured companion chat must not acquire the remote route')
  assert.deepEqual(result.calls, [{
    text: '先解释方案，暂时不要修改代码', authorized: true, session: 'fixture-phone',
  }, ...['codex', 'deepseek', 'harness', 'workbuddy'].map(target => ({
    text: '截屏也要交给我选中的工具', authorized: true, session: 'fixture-phone', target,
  }))])
  return { authenticatedPhoneRoute: true, companionQuotaNotRequired: true, localChatIsolated: true }
}
