import { app, ipcMain, session, dialog, safeStorage, shell, Notification, desktopCapturer, screen, clipboard, nativeImage } from 'electron'
import { randomBytes, randomUUID, createHash } from 'node:crypto'
import os from 'node:os'
import { mkdirSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, writeFile, rmdir, stat, realpath } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import QRCode from 'qrcode'
import { DeviceChannel } from './device-channel.mjs'
import { momentOperations, momentResourceAllowed } from './device-moments.mjs'
import { MomentsUpload } from './device-moments-upload.mjs'
import { DeviceRuntime } from './device-runtime.mjs'
import { DeviceAvatarCache } from './device-avatar-cache.mjs'
import { DeviceCatalog, profileKind } from './device-catalog.mjs'
import { createTextServer, resolveTextFiles } from './text-server.mjs'
import { DeviceWindows, deviceAppId } from './device-windows.mjs'
import { repairOwnedShortcuts } from './device-branding.mjs'
import { chatInputResult, deviceInputResult, platformCreditsMessage, guestCreditsMessage } from './device-pet-policy.mjs'
import { microphonePermission } from './device-media-policy.mjs'
import { createDeviceSession } from './device-session.mjs'
import { DeviceRealtime } from './device-realtime.mjs'
import { remoteTaskAccess } from './device-task-intent.mjs'
import { DeviceBilling } from './device-billing.mjs'
import { DeviceLam } from './device-lam.mjs'
import { createLamEngine } from './device-lam-engine.mjs'
import { loadSourceRuntime } from '../scripts/source-runtime.mjs'
import { loadDisplayPreferences, saveDisplayPreferences } from './device-preferences.mjs'
import { AssistantSettings } from './device-assistant-policy.mjs'
import { HarnessClient } from './device-harness-client.mjs'
import { AssistantService, assistantMessage } from './device-assistant-service.mjs'
import { AssistantLog } from './device-assistant-log.mjs'
import { MailSettings } from './device-mail-settings.mjs'
import { MailService, mailMessage, mailAnnouncement } from './device-mail-service.mjs'
import { buildFaceBank } from './device-face-bank.mjs'
import { DeviceRemoteReplies } from './device-remote-replies.mjs'
import { DeviceNotifications } from './device-notifications.mjs'
import { DeviceFirstGreeting } from './device-first-greeting.mjs'
import { DeviceNotificationSync } from './device-notification-sync.mjs'
import { WorkBuddyBridge } from './device-workbuddy.mjs'
import { DeviceActivity } from './device-activity.mjs'
import { DeviceCodex } from './device-codex.mjs'
import { DeviceAiTools } from './device-ai-tools.mjs'
import { WorkBuddyAgent } from './device-workbuddy-agent.mjs'
import { HarnessTaskDispatcher } from './device-task-dispatcher.mjs'
import { DeviceAccount } from './device-account.mjs'
import { desktopVersion } from './device-update.mjs'
import { createDesktopUpdate } from './device-update-mode.mjs'
import { sourceUpdateActive } from './device-source-update.mjs'
import { installedDirectory, prepareUpdateInstall } from './device-update-install.mjs'
import { DeviceFileTransfer } from './device-file-transfer.mjs'
import { DeviceBindingProof } from './device-binding-proof.mjs'
import { DeviceHttpAuth, isGuestDevice } from './device-http-auth.mjs'
import { loadCatalog } from './device-catalog.mjs'
import { loadDefaultProfile } from './device-default-profile.mjs'
import { DesktopServices } from './device-desktop-services.mjs'
import { DeviceReminders } from './device-reminders.mjs'
import { renderingQuality } from './device-quality.mjs'
import { DeviceStartup } from './device-startup.mjs'
import { TaskReportOutbox } from './device-task-outbox.mjs'
import { invitationResult, installationPrompt } from './device-invite.mjs'
import { reviewTaskRequest, confirmTaskRequest } from './device-task-review.mjs'
import { registerDesktop, pauseAutomaticLaunch } from '../harness-client-plugin/desktop-launch.mjs'

import { getDeviceScore, getGuestScore } from './device-score.mjs'
import { RefreshCadence } from './device-refresh-cadence.mjs'
import { DeviceConversation } from './device-conversation.mjs'
import { DeviceTextConversation } from './device-text-conversation.mjs'
import { DeviceGuestMemory } from './device-guest-memory.mjs'
import { DeviceHistory } from './device-history.mjs'
import { ModelSettings, modelRoute, ownRealtimeSession, realtimeRegion } from './device-model-settings.mjs'
import { registerModelControls } from './device-model-control.mjs'
import { ConversationStore } from './device-conversation-store.mjs'
import { registerHistoryControls } from './device-history-control.mjs'
import { LocalWorkspace, localBilling } from './device-local-workspace.mjs'
import { OnlineRoles } from './device-online-roles.mjs'
import { OnlinePluginCatalog } from './device-plugin-catalog.mjs'
import { downloadAvatar } from './device-assets.mjs'

const directory = path.dirname(fileURLToPath(import.meta.url))
let windows, server, channel, runtime, catalog, conversation, lam, assetsDirectory, assistant, assistantSettings, assistantLog, mail, mailSettings, workbuddy
let announceWorkbuddy = true
let codex, announceCodex = true
let workbuddyAgent, taskDispatcher, aiTools
let deviceAccount, fileTransfer, desktopUpdate, notificationSync, httpAuth, harnessClient
let modelSettings, modelRevision = 0, historyClearing = false
let ownsInstance = false
let firstGreeting
const routing = () => historyClearing ? { route: '', textOnly: true, code: 'HISTORY_CLEARING', message: '正在清除本地记录，请稍候' }
  : modelRoute(modelSettings?.snapshot() || { source: 'auto' }, Boolean(assistantSettings?.key() || harnessClient?.ready()), {
  profile: runtime?.state.current,
  bound: channel?.state.binding === 'bound', guest: isGuestDevice(channel),
  connected: channel?.state.connection === 'connected', score, scoreError: scoreErrorCode })
const beforeModelSend = async signal => {
  await conversationStore.queue
  signal?.throwIfAborted()
  if (conversationStore.failed) throw Object.assign(new Error('本地记录保存失败'), { code: 'HISTORY_STORAGE_UNAVAILABLE' })
}
let desktopServices, taskReports, uiLanguage = 'zh-Hans', renderQuality = { tier:'balanced' }
const activity = new DeviceActivity()
activity.on('state', value => {
  for (const win of [windows?.controller, windows?.pet]) {
    if (win && !win.isDestroyed()) win.webContents.send('device:activity', value)
  }
  if (windows) windows.taskActivityVisible = Boolean(value.rows.length)
})
let assistantState = { state: 'disabled' }, settingsWork = Promise.resolve()
const assistantSnapshot = () => ({ ...assistantSettings.snapshot(), ...assistantState, enabled: Boolean(assistant?.enabled()),
  client: harnessClient?.snapshot(), source: harnessClient?.ready() ? 'harness-client' : assistantSettings.key() ? 'api-key' : '',
  storageAvailable: safeStorage.isEncryptionAvailable() })
const publishAssistant = status => {
  assistantState = status
  if (['starting', 'working', 'approval', 'error'].includes(status.state)) activity.add('Harness', status.state === 'approval' ? 'approval' : 'status',
    status.message || { starting: '正在启动电脑助手', working: '正在处理电脑任务', approval: '等待确认具体操作', error: '电脑助手暂不可用' }[status.state], 'status')
  if (windows?.controller && !windows.controller.isDestroyed()) windows.controller.webContents.send('device:assistant', assistantSnapshot())
  aiTools?.observe()
}
const publishMail = value => {
  if (windows?.controller && !windows.controller.isDestroyed()) windows.controller.webContents.send('device:mail', value)
}
const publishWorkbuddy = () => {
  if (windows?.controller && !windows.controller.isDestroyed() && workbuddy) {
    windows.controller.webContents.send('device:workbuddy', { ...workbuddy.snapshot(), worker: workbuddyAgent?.snapshot() })
  }
}
// One sentence per event, written for the ear: the pet says it in its own voice
// and must never sound like it is reading a tool's output.
const workbuddySpeech = event => ({
  'task.created': `WorkBuddy 新建了任务：${event.title}`,
  'task.started': `WorkBuddy 开始处理：${event.subject}`,
  'task.completed': `WorkBuddy 完成了：${event.subject}`,
  'task.reply': `WorkBuddy 说：${event.text}`,
  'task.confirm': `WorkBuddy 在等你确认：${event.question}${event.options?.length ? `，可选：${event.options.join('、')}` : ''}`,
}[event.type] || '')
// The KeyframeFace library ships inside the packaged runtime; in a source
// checkout it is read straight out of the Control sources.
const faceLibrary = () => app.isPackaged
  ? path.join(app.getAppPath(), 'runtime/control/AIBANLVKeyframeFace.json')
  : path.resolve(directory, '../../../android-native/digitalhuman-core/src/main/assets/AIBANLVKeyframeFace.json')
// Rebuilding the bank costs a couple of hundred milliseconds, so a copy is kept
// next to the profile and only rebuilt when the library itself changes.
async function prepareFaceBank(library, output) {
  try {
    const source = await stat(library)
    const cached = await stat(output).catch(() => null)
    if (cached?.size && cached.mtimeMs >= source.mtimeMs) return output
    await writeFile(output, JSON.stringify(buildFaceBank(JSON.parse(await readFile(library, 'utf8')))))
    return output
  } catch { return null }
}
let closing = false
let score = null, scoreJob, scoreScope = '', accessScope = '', scoreTimer
let scoreErrorCode = ''
let scoreError = ''
let momentsUpload
let localWorkspace, onlineRoles
const localMode = () => runtime?.state.current?.source === 'local'
const scoreCadence = new RefreshCadence()
let guestMemory, historyReader, conversationStore, syncTimer, memoryError = ''
const loadedHistory = new Map()
const memoryIdentity = () => JSON.stringify([storageScope(), runtime.state.current?.agentId])
async function restoreHistory(signal) {
  await conversationStore.queue
  if (conversationStore.failed) throw Object.assign(new Error('本地记录存储不可用'), { code: 'HISTORY_STORAGE_UNAVAILABLE' })
  const identity = memoryIdentity(), agentId = runtime.state.current?.agentId
  const local = conversationStore.context(agentId)
  if (runtime.state.current?.source === 'local' || channel.state.binding !== 'bound') return local
  if (loadedHistory.has(identity)) return [...loadedHistory.get(identity), ...local].slice(-40)
  try {
    const rows = await historyReader.load(agentId, signal)
    signal?.throwIfAborted()
    if (identity !== memoryIdentity()) throw Object.assign(new Error('账号或形象已改变，请重试'), { code: 'HISTORY_SCOPE_CHANGED' })
    let overlap = Math.min(local.length, rows.length)
    while (overlap && JSON.stringify(rows.slice(-overlap)) !== JSON.stringify(local.slice(0, overlap))) overlap--
    const merged = [...rows, ...local.slice(overlap)].slice(-40)
    loadedHistory.clear(); loadedHistory.set(identity, rows.slice(0, rows.length - overlap))
    memoryError = ''
    return merged
  } catch (error) {
    if (identity === memoryIdentity() && !signal?.aborted) {
      memoryError = '历史记忆恢复失败，请检查控制服务连接及服务端版本后重试'
      windows?.update(snapshot())
    }
    throw error
  }
}
const storageFailure = () => { memoryError = '本地记录保存失败，已停止新对话。请检查磁盘与加密存储，导出或清理后重启'; conversation?.stop(true); windows?.update(snapshot()) }
const storageScope = () => runtime?.state.current?.source === 'local'
  ? { deviceId: channel.state.deviceId, roleSource: 'local' }
  : ({ deviceId: channel.state.deviceId,
  ...(channel.state.owner && channel.tenantId ? { owner: channel.state.owner, tenantId: channel.tenantId }
    : channel.state.binding === 'unknown' && conversationStore.data.lastScope?.deviceId === channel.state.deviceId
      ? conversationStore.data.lastScope : {}) })
const roleContext = () => ({ ...storageScope(), agentId: runtime?.state.current?.agentId,
  bound: runtime?.state.current?.source !== 'local' && channel.state.binding === 'bound' })
const scoreIdentity = () => JSON.stringify([channel.state.deviceId, channel.state.binding, channel.state.owner, channel.tenantId])
async function refreshScore({ force = false } = {}) {
  if (!runtime?.state.current || runtime.state.current.source === 'local') return score
  const guest = isGuestDevice(channel)
  if (!guest && (channel.state.binding !== 'bound' || channel.state.connection !== 'connected' || !channel.tenantId)) {
    score = null; scoreJob = null; scoreError = ''; scoreErrorCode = ''; return null
  }
  const scope = scoreIdentity()
  if (scoreJob?.scope === scope) return scoreJob.promise
  if (!scoreCadence.begin(scope, { force })) return score
  const job = { scope }
  scoreJob = job
  scoreError = ''
  job.promise = (async () => {
    try {
      const result = guest ? await getGuestScore({ deviceId: channel.state.deviceId, fetchImpl: httpAuth.fetch })
        : await getDeviceScore({ deviceId: channel.state.deviceId,
        tenantId: channel.state.binding === 'bound' ? channel.tenantId : '',
        ...(channel.state.binding === 'bound' && httpAuth ? { fetchImpl: httpAuth.fetch } : {}),
        ...(channel.state.binding === 'bound' && channel.state.accountSupported && deviceAccount
          ? { readAccount: () => deviceAccount.request('get_device_account') } : {}) })
      if (!closing && scoreJob === job && scope === scoreIdentity()) {
        score = Math.max(0, result.score); scoreError = ''; scoreErrorCode = ''; scoreCadence.finish(scope, { ok: true, empty: score === 0 })
      }
    } catch (error) {
      if (!closing && scoreJob === job && scope === scoreIdentity()) {
        if (score !== 0) score = null
        scoreErrorCode = error.code || ''
        scoreError = error.code === 'GUEST_LOGIN_REQUIRED' ? error.message : '积分查询失败，已降低重试频率；可稍后点击积分旁的刷新图标重试'
        scoreCadence.finish(scope, { ok: false })
      }
    } finally {
      if (scoreJob === job) { scoreJob = null; if (!closing && scope === scoreIdentity()) publish() }
    }
    return scope === scoreIdentity() ? score : null
  })()
  return job.promise
}
let microphoneContext = ''
const microphoneKey = () => {
  const state = snapshot()
  return state.models.voiceAvailable && deviceInputResult(state).ok ? `${state.current.agentId}:${state.renderId}:${modelRevision}` : ''
}
const snapshot = () => ({
  ...channel.state, owner: undefined, ...runtime.state,
  mode: localMode() ? 'local' : 'online', localWorkspace: localWorkspace?.snapshot(),
  onlineRoleJobs: onlineRoles?.snapshot() || [],
  account: deviceAccount?.snapshot(),
  error: runtime.state.error || memoryError || (localMode() ? '' : channel.state.error),
  current: publicProfile(runtime.state.current), desired: publicProfile(runtime.state.desired),
  roles: roleChoices(),
  catalog: { status: catalog?.state.status || 'idle', error: catalog?.state.error || '', count: catalog?.state.profiles.length || 0 },
  conversationState: conversation?.connectionState || 'idle',
  speechReady: Boolean(lam?.engine),
  language: uiLanguage, renderQuality,
  accountScope: channel.state.binding === 'bound' ? createHash('sha256').update(JSON.stringify([channel.tenantId,channel.state.owner])).digest('hex') : '',
  inference: lam?.status || { state: 'idle' },
  notificationSync: notificationSync?.snapshot(),
  aiTools: aiTools?.snapshot(),
  score, guest: isGuestDevice(channel), textOnly: routing().textOnly,
  models: { ...modelSettings?.snapshot(), ...routing(), deepseekSource: harnessClient?.ready() ? 'harness-client' : 'api-key', voiceAvailable: ['realtime', 'platform'].includes(routing().route) },
  history: { messages: conversationStore?.data.rows.filter(row => conversationStore.matches(row)).length || 0,
    pending: conversationStore?.data.rows.filter(row => row.roleSource !== 'local' && row.owner && conversationStore.matches(row) && !row.synced).length || 0 },
  scoreSync: { state: scoreError ? 'error' : scoreJob ? 'loading' : Number.isFinite(score) ? 'ready' : 'idle', message: scoreError, nextRetryAt: scoreCadence.nextAt },
})
const publicProfile = profile => profile ? {
  agentId: profile.agentId, source: profile.source ?? 'online', agentName: profile.agentName, voiceId: profile.voiceId, language: profile.language, publicAvatar: profile.publicAvatar === true,
  agentPhotoUrl: profile.agentPhotoUrl, description: profile.description || '',
  kind: profileKind(profile), local: profile.source === 'local',
} : null
const roleChoices = () => {
  const roles = new Map((catalog?.state.profiles || []).map(profile => [profile.agentId, { ...publicProfile(profile), available: true }]))
  for (const profile of runtime.state.roles) {
    if (!profile.fromCatalog && !roles.has(profile.agentId)) roles.set(profile.agentId, { ...publicProfile(profile), available: true })
  }
  const current = runtime.state.current
  if (current && !roles.has(current.agentId)) roles.set(current.agentId, { ...publicProfile(current), available: false })
  const online = [...roles.values()].filter(role => !role.local && (role.publicAvatar || channel.state.binding === 'bound' && (!channel.state.proofRequired || channel.state.accountAuthReady)))
  const local = localWorkspace?.configured() ? [...localWorkspace.roles.values()].map(profile => ({ ...localWorkspace.publicRole(profile), available: true })) : []
  return [...online, ...local]
}
const publish = () => {
  if (microphoneContext !== microphoneKey()) microphoneContext = ''
  syncConversation()
  windows?.update(snapshot())
}
const syncConversation = () => {
  if (!conversation || !windows) return
  const state = snapshot()
  // Memory belongs to a role inside its tenant, so the identity of the open
  // conversation has to include who is bound. Rebinding to another account with
  // the same role must not keep replaying the previous owner's context. The
  // snapshot itself scrubs the owner, hence it is read from the channel here.
  const key = !closing && windows.state.visible && deviceInputResult(state).ok
    ? JSON.stringify([storageScope(), state.current, state.renderId, modelRevision]) : ''
  const localActive = !closing && windows.state.visible && state.models.voiceAvailable && deviceInputResult(state).ok
  if (!localActive) lam?.setActive(false)
  conversation.setContext(key)
  if (localActive) lam?.setActive(true)
  firstGreeting?.schedule()
}

async function installationId(userData) {
  const file = path.join(userData, 'device-identity.json')
  try {
    const { deviceId } = JSON.parse(await readFile(file, 'utf8'))
    if (!/^zhanlv:desktop-[a-f0-9-]{36}$/.test(deviceId)) throw new Error('Invalid device identity')
    return deviceId
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    const deviceId = `zhanlv:desktop-${randomUUID()}`
    await writeFile(file, JSON.stringify({ deviceId }), { flag: 'wx', mode: 0o600 })
    return deviceId
  }
}

async function loadRuntimeConfiguration() {
  if (app.isPackaged) return
  const projectRoot = path.resolve(directory, '..')
  Object.assign(process.env, await loadSourceRuntime(projectRoot, process.env, message => {
    void dialog.showMessageBox({ type: 'info', title: 'AIBanlv 运行环境', message,
      detail: '初始化会自动下载并验证模型、Python 和 Java，完成后重新启动即可。', buttons: ['知道了'] })
  }))
}

async function start() {
  app.setName('AIBanlv')
  app.setAppUserModelId(deviceAppId)
  const profileDirectory = process.env.PET_DEVICE_USER_DATA
    ? path.resolve(process.env.PET_DEVICE_USER_DATA) : path.join(app.getPath('appData'), 'Control Device')
  // The single-instance lock needs an existing profile directory on first run.
  // Configure Chromium's paths before the ready event can initialize a session.
  mkdirSync(profileDirectory, { recursive: true })
  app.setPath('userData', profileDirectory)
  const sessionDirectory = path.join(profileDirectory, 'session')
  mkdirSync(sessionDirectory, { recursive: true })
  app.setPath('sessionData', sessionDirectory)
  if (!app.isPackaged && await sourceUpdateActive(path.join(profileDirectory, 'updates'))) { app.quit(); return }
  if (!app.requestSingleInstanceLock()) { app.quit(); return }
  ownsInstance = true
  const registerLaunch = automatic => registerDesktop({ directory: profileDirectory, root: path.resolve(directory, '..'),
    executable: process.execPath, isPackaged: app.isPackaged, automatic })
    .catch(error => console.warn('[desktop launch]', error.code || error.message))
  app.on('second-instance', (_event, argv) => {
    if (!argv.includes('--aibanlv-auto-start')) { void registerLaunch(false); windows?.showController() }
  })
  await registerLaunch(process.argv.includes('--aibanlv-auto-start'))
  await app.whenReady()
  await loadRuntimeConfiguration()
  const userData = app.getPath('userData')
  await mkdir(userData, { recursive: true })
  firstGreeting = new DeviceFirstGreeting({ directory: userData,
    context: () => ({ ...snapshot(), visible: windows?.state.visible, closing,
      busy: Boolean(conversation?.turn) }),
    speak: (text, options) => conversation.send(text, options),
    onError: code => console.warn('[first greeting]', code) })
  const updateDirectory = path.join(userData, 'updates')
  const updateInstallDirectory = await installedDirectory({ isPackaged: app.isPackaged, platform: process.platform, executable: process.execPath })
  if (updateInstallDirectory && !process.env.PET_DEVICE_USER_DATA) {
    repairOwnedShortcuts({ shell, executable: process.execPath, desktop: app.getPath('desktop'), appData: app.getPath('appData') })
  }
  desktopUpdate = await createDesktopUpdate({ directory: updateDirectory,
    isPackaged: app.isPackaged, sourceDirectory: path.resolve(directory, '../../..'),
    version: await desktopVersion({ isPackaged: app.isPackaged, version: app.getVersion() }),
    platform: process.platform, arch: process.arch, installed: Boolean(updateInstallDirectory), url: process.env.PET_DESKTOP_UPDATE_URL,
    sourceQuit: () => app.quit(),
    onState: value => {
      if (windows?.controller && !windows.controller.isDestroyed()) windows.controller.webContents.send('device:update', value)
    },
    handoff: async (file, manifest) => {
      await prepareUpdateInstall({ file, manifest, directory: updateDirectory, installDirectory: updateInstallDirectory })
      setImmediate(() => app.quit())
    } })
  try {
    if (desktopUpdate.snapshot().runMode === 'installed' && JSON.parse(await readFile(path.join(updateDirectory, 'handoff.json'), 'utf8')).status === 'error') {
      desktopUpdate.publish('error', '上次升级未完成，请检查更新后重试')
    }
  } catch {}
  const startup = new DeviceStartup({ app, file: path.join(userData, 'startup-preference.json'), allowRegistration: !process.env.PET_DEVICE_USER_DATA })
  startup.initialize()
  try { const value=JSON.parse(await readFile(path.join(userData,'desktop-language.json'),'utf8')); if(['zh-Hans','zh-Hant','en','ja'].includes(value.language))uiLanguage=value.language } catch {}
  let gpu=''
  try { const info=await app.getGPUInfo('complete');gpu=(info.gpuDevice || []).map(item=>[item.deviceString,item.vendorString,item.vendorId===0x10de?'NVIDIA':''].filter(Boolean).join(' ')).join(' ')+' '+(info.auxAttributes?.glRenderer || '') } catch {}
  if(/software|disabled/.test(app.getGPUFeatureStatus().webgl || ''))gpu+=' software'
  renderQuality=renderingQuality({ memoryGB:os.totalmem()/1024**3,cores:os.cpus().length,gpu })
  guestMemory = new DeviceGuestMemory({ file: path.join(userData, 'guest-memory.json'), encryption: safeStorage })
  const savedGuest = await guestMemory.load()
  if (!savedGuest.ok) throw Object.assign(new Error('旧记录读取失败'), { code: 'HISTORY_STORAGE_UNAVAILABLE' })
  conversationStore = new ConversationStore({ directory: userData, encryption: safeStorage })
  await conversationStore.load()
  assetsDirectory = await mkdtemp(path.join(userData, 'avatars-'))
  const files = resolveTextFiles()
  for (const route of files.keys()) {
    if (route.startsWith('/desktop/') || route === '/assets/avatar.zip') files.delete(route)
  }
  for (const name of ['device.html', 'device-view.mjs', 'device-settings-navigation.mjs', 'device-update-view.mjs', 'device.css', 'device-pet.html', 'device-pet.mjs', 'device-chat.mjs', 'device-audio.mjs',
    'device-microphone.mjs', 'device-microphone-worklet.mjs', 'device-voice.mjs', 'device-waveform.mjs',
    'device-touch.mjs', 'device-touch-policy.mjs', 'device-mood.mjs', 'device-mood-policy.mjs', 'device-face-bank.mjs',
    'device-assistant-view.mjs', 'device-mail-view.mjs', 'device-workbuddy-view.mjs', 'device-codex-view.mjs', 'device-activity-view.mjs',
    'device-transfer-view.mjs', 'device-direct-peer.mjs', 'device-services-view.mjs', 'device-invite.mjs', 'device-invite-view.mjs', 'device-points.mjs', 'device-points-view.mjs',
    'device-moments.mjs', 'device-moments-view.mjs', 'device-i18n.mjs', 'device-traditional.mjs',
    'device-model-view.mjs', 'device-roles-view.mjs', 'device-plugins-view.mjs', 'device-pet-policy.mjs', 'policy.mjs']) {
    files.set(`/device/${name}`, path.join(directory, name))
  }
  const faceBank = await prepareFaceBank(faceLibrary(), path.join(userData, 'face-bank.json'))
  if (faceBank) files.set('/device/face-bank.json', faceBank)
  files.set('/desktop/desktop.css', path.join(directory, 'desktop.css'))
  files.set('/src/lam-track.mjs', path.resolve(directory, '../src/lam-track.mjs'))
  files.set('/src/device-presentation.mjs', path.resolve(directory, '../src/device-presentation.mjs'))
  files.set('/src/device-particles.mjs', path.resolve(directory, '../src/device-particles.mjs'))
  files.set('/src/device-idle.mjs', path.resolve(directory, '../src/device-idle.mjs'))
  files.set('/assets/idle-expressions.json', path.resolve(directory, '../../../android-native/digitalhuman-core/src/main/assets/AIBANLVKeyframeFace.json'))
  files.set('/device/logo.png', path.resolve(directory, '../../../static/aibanlv-logo.png'))
  const token = randomBytes(32).toString('hex')
  server = createTextServer(files, { accessToken: token, microphone: true })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const origin = `http://127.0.0.1:${server.address().port}`
  channel = new DeviceChannel({
    deviceId: await installationId(userData), endpoint: process.env.PET_CONTROL_WS_URL,
    qr: value => QRCode.toDataURL(value, { errorCorrectionLevel: 'M', margin: 4, width: 320 }),
  })
  await conversationStore.migrate(savedGuest, channel.state.deviceId)
  if (!(await guestMemory.clear()).ok) throw Object.assign(new Error('旧缓存清理失败'), { code: 'HISTORY_STORAGE_UNAVAILABLE' })
  await conversationStore.setScope(storageScope())
  modelSettings = new ModelSettings({ file: path.join(userData, 'model-settings.json'), encryption: safeStorage,
    region: realtimeRegion(app.getLocaleCountryCode(), app.getSystemLocale()) })
  await modelSettings.load()
  historyReader = new DeviceHistory({ channel })
  channel.on('state', state => {
    void conversationStore.setScope(storageScope()).catch(storageFailure)
    const nextAccess = JSON.stringify([state.binding, channel.state.owner, channel.tenantId])
    const changed = Boolean(accessScope && accessScope !== nextAccess)
    accessScope = nextAccess
    const identity = scoreIdentity()
    if (scoreScope !== identity) {
      scoreScope = identity; score = null; scoreError = ''; scoreErrorCode = ''
      scoreCadence.reset(identity)
      if (changed && runtime && !runtime.retainLocalRole()) {
        if (!runtime.state.current?.publicAvatar) {
          runtime.clear(); void runtime.ensureInitialProfile()
        } else {
          runtime.cache.clear()
          runtime.publish({ roles: runtime.state.roles.filter(profile => profile.publicAvatar || profile.source === 'local') })
        }
      }
      void refreshScore()
    }
  })
  const bindingProof = new DeviceBindingProof({ channel, file: path.join(userData, 'binding-proof.json'), encryption: safeStorage })
  await bindingProof.load()
  httpAuth = new DeviceHttpAuth({ channel, proof: () => bindingProof.httpProof(), origin: process.env.PET_CONTROL_HTTP_ORIGIN })
  runtime = new DeviceRuntime({ channel, files, directory: assetsDirectory,
    defaultProfile: signal => localWorkspace?.configured() && localWorkspace.roles.has(localWorkspace.config.selectedRole)
      ? localWorkspace.profile(localWorkspace.config.selectedRole) : loadDefaultProfile(signal, httpAuth.fetch),
    download: (url, options) => url.startsWith('local:') ? localWorkspace.avatar(url.slice(6)) : downloadAvatar(url, options),
    assetCache: new DeviceAvatarCache({ directory: path.join(userData, 'avatar-cache') }) })
  deviceAccount = new DeviceAccount({ channel })
  channel.on('account', () => {
    const metadata = deviceAccount.snapshot()
    if (metadata.bound && Number.isFinite(metadata.points)) {
      score = Math.max(0, metadata.points); scoreError = ''
      scoreCadence.finish(scoreIdentity(), { ok: true, empty: score === 0 }); publish()
    }
  })
  catalog = new DeviceCatalog({ channel, load: (scope, signal) => loadCatalog(scope, signal, httpAuth.fetch) })
  catalog.on('state', publish)
  assistantSettings = new AssistantSettings({ file: path.join(userData, 'assistant-settings.json'), encryption: safeStorage })
  await assistantSettings.load().catch(() => { assistantState = { state: 'error', message: assistantMessage('KEY_STORAGE_UNAVAILABLE') } })
  harnessClient = new HarnessClient({ file: path.join(userData, 'harness-connection.json'),
    authorizeTask: async (task, signal) => {
      signal.throwIfAborted()
      if (!windows?.controller || windows.controller.isDestroyed()) return ''
      windows.showController()
      const selection = await dialog.showOpenDialog(windows.controller, {
        title: '选择本次 Harness 任务的工作目录', properties: ['openDirectory'],
      })
      signal.throwIfAborted()
      if (selection.canceled || !selection.filePaths[0]) return ''
      const workspace = await realpath(selection.filePaths[0])
      const result = await dialog.showMessageBox(windows.controller, { type: 'question', signal,
        title: 'Harness 任务确认', message: '是否在选定目录中执行这项任务？',
        detail: `工作目录：${workspace}\n任务：${task}\n\n任务会使用 Harness 宿主已有的工具权限；工作目录本身不是文件访问沙箱。`,
        buttons: ['取消', '执行本次任务'], defaultId: 0, cancelId: 0, noLink: true })
      signal.throwIfAborted()
      return result.response === 1 ? workspace : ''
    } })
  await harnessClient.start()
  let harnessSource = ''
  harnessClient.on('changed', () => {
    const source = harnessClient.ready() ? harnessClient.owner : ''
    if (source !== harnessSource) {
      harnessSource = source
      // Include the previous route so losing the only DeepSeek source still
      // cancels its turn. Independent Realtime sessions keep their context.
      if (conversation?.route === 'deepseek' || routing().route === 'deepseek') {
        modelRevision++; conversation?.stop(true)
      }
      void assistant?.reset().catch(() => {})
      assistantState = { state: assistant?.enabled() ? 'ready' : 'disabled' }
    }
    publishAssistant(assistantState); publish()
  })
  if (assistantState.state !== 'error') assistantState = { state: assistantSettings.snapshot().enabled ? 'ready' : 'disabled' }
  // A stored Key comes back switched on, so the console shows the truth at once
  // instead of waiting for the first status change.
  if (assistantSettings.snapshot().enabled) assistantState = { state: 'ready' }
  localWorkspace = new LocalWorkspace({ directory: path.join(userData, 'local-companion'), encryption: safeStorage, assistantSettings, modelSettings, textReady: () => harnessClient?.ready() })
  await localWorkspace.load()
  channel.state.local = localMode()
  for (const profile of localWorkspace.roles.values()) {
    const photo = path.join(localWorkspace.folder(profile.agentId), 'avatar.png')
    if (await stat(photo).then(value => value.isFile()).catch(() => false)) files.set(`/assets/local-${profile.agentId}.png`, photo)
  }
  localWorkspace.on('state', () => { if (windows) publish() })
  assistantLog = new AssistantLog({ file: path.join(userData, 'assistant.log') })
  assistantLog.event('boot', { version: app.getVersion(), electron: process.versions.electron,
    assistant: assistantSettings.snapshot().enabled })
  assistantLog.event('startup.status', startup.snapshot())
  channel.on('notification-diagnostic', value => assistantLog.event('notification.channel', value))
  channel.on('control-diagnostic', value => assistantLog.event('control.channel', value))
  mailSettings = new MailSettings({ file: path.join(userData, 'mail-settings.json'), encryption: safeStorage })
  let mailLoadError = false
  await mailSettings.load().catch(() => { mailLoadError = true })
  mail = new MailService({ settings: mailSettings, checkpoint: path.join(userData, 'mail-checkpoint.json'),
    approve: (action, signal) => assistant.confirm(action, signal), onStatus: publishMail,
    notify: (count, detail) => {
      notifications.receive({ eventId: `mail:${Date.now()}:${randomUUID()}`, sentAt: Date.now(),
        mailContentAccount: detail?.account, content: mailAnnouncement(count, detail) })
      if (!mailSettings.snapshot().notifications) return
      if (!Notification.isSupported()) {
        mail.publish({ notificationWarning: `收到 ${count} 封新邮件；系统通知不可用，请在对话中查看` })
        return
      }
      const notification = new Notification({ title: 'AIBanlv · 新邮件', body: `收到 ${count} 封新邮件，可在对话中查看。` })
      notification.on('click', () => windows?.showController())
      notification.on('failed', () => mail.publish({ notificationWarning: '系统未能显示来信通知，请检查 Windows 通知设置' }))
      notification.show()
    } })
  if (mailLoadError) mail.state = { status: 'error', message: mailMessage('MAIL_STORAGE_UNAVAILABLE'), lastCheck: null }
  assistant = new AssistantService({ settings: assistantSettings, root: path.join(userData, 'assistant'),
    mail, log: assistantLog, approvalMode: 'automatic',
    approveComputer: async (args, signal) => {
      signal.throwIfAborted()
      const result = await dialog.showMessageBox(windows.controller, { type: 'question',
        signal,
        title: 'Harness 电脑操作确认', message: `是否允许这一步电脑操作：${args.action}？`,
        detail: '仅执行当前任务中的这一步。发送、删除、付款及安全授权不能自动确认。\n' + JSON.stringify(args).slice(0, 1200),
        buttons: ['取消', '允许这一步'], defaultId: 0, cancelId: 0, noLink: true })
      signal.throwIfAborted()
      return result.response === 1
    },
    desktop: app.getPath('desktop'), history: path.join(userData, 'assistant-desktop-history'),
    onStatus: publishAssistant, openPath: target => shell.openPath(target), openExternal: target => shell.openExternal(target),
  })
  assistant.onActivity = value => activity.add('Harness', value.kind, value.text, value.key)
  assistant.client = harnessClient
  fileTransfer = new DeviceFileTransfer({ channel, directory: path.join(userData, 'captures'), log: assistantLog,
    fileRoots: ['desktop', 'documents', 'downloads'].map((name, index) => ({ directory: app.getPath(name), label: ['桌面', '文档', '下载'][index] })),
    chooseFile: async () => {
      windows.showController()
      const result = await dialog.showOpenDialog(windows.controller, { title: '选择要直传到绑定手机的文件（最多 8 MiB）', properties: ['openFile'] })
      return result.canceled ? '' : result.filePaths[0]
    },
    captureScreen: async () => {
      const display = screen.getPrimaryDisplay(), scale = Math.min(display.scaleFactor || 1, 4096 / Math.max(display.size.width, display.size.height))
      const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: Math.round(display.size.width * scale), height: Math.round(display.size.height * scale) } })
      const source = sources.find(value => value.display_id === String(display.id)) || (sources.length === 1 ? sources[0] : null)
      if (!source || source.thumbnail.isEmpty()) throw new Error('主屏截图不可用，请检查系统屏幕权限')
      return source.thumbnail.toPNG()
    },
    sendWorker: (type, value) => { if (windows && !windows.controller.isDestroyed()) windows.controller.webContents.send('device:transfer', { type, value }) },
    onActivity: value => activity.add('Harness', value.kind, value.text, value.key) })
  assistant.files = fileTransfer
  lam = new DeviceLam({ engineFactory: signal => createLamEngine(signal, {
    runtimeRoot: app.isPackaged ? path.join(app.getAppPath(), 'runtime') : undefined,
    cacheDirectory: app.getPath('userData'),
  }), emit: data => {
    activity.conversation(data, runtime.state.current?.agentName)
    windows?.conversation(data)
  },
    keepWarm: process.platform === 'darwin',
    onStatus: () => { windows?.update(snapshot()); firstGreeting?.schedule() },
    onFailure: error => conversation.fail(error) })
  const realtime = new DeviceRealtime({
    beforeSend: beforeModelSend,
    ...(process.platform === 'darwin' ? { playbackFactor: 8, playbackGraceMs: 30000 } : {}),
    assistant, log: assistantLog,
    receipt: options => fileTransfer.receipt(options),
    prepare: (requestId, signal) => lam.begin(requestId, signal),
    bootstrap: async (requestId, signal) => {
      const history = await restoreHistory(signal)
      if (routing().route === 'realtime') {
        const session = ownRealtimeSession(modelSettings, runtime.state.current)
        if (localWorkspace.roles.has(runtime.state.current.agentId)) {
          const local = await localWorkspace.session(runtime.state.current.agentId, signal)
          session.instructions = local.instructions
        }
        return { ...session, history }
      }
      if (routing().route !== 'platform' || !(await refreshScore() > 0)) throw Object.assign(new Error(isGuestDevice(channel) ? guestCreditsMessage : platformCreditsMessage), { code: 'SCORE_DEPLETED' })
      try {
        const session = await createDeviceSession({ deviceId: channel.state.deviceId, profile: runtime.state.current,
          tenantId: channel.tenantId, anonymous: isGuestDevice(channel), requestId, signal, fetchImpl: httpAuth.fetch, baseOrigin: httpAuth.origin })
        return { ...session, history }
      } catch (error) {
        if (error.code === 'SCORE_DEPLETED') { score = 0; publish() }
        throw error
      }
    },
    billingFactory: (session, onFailure) => session.funding === 'own' ? localBilling() : new DeviceBilling({ session, onFailure }),
  })
  const text = new DeviceTextConversation({ settings: assistantSettings, assistant, client: harnessClient, beforeSend: beforeModelSend,
    fetchImpl: (...args) => globalThis.fetch(...args),
    context: () => ({ agentId: runtime.state.current?.agentId, ...storageScope(),
      persona: runtime.state.current?.characterSetting || `你是${runtime.state.current?.agentName || '数字人'}。` }),
    getHistory: signal => restoreHistory(signal),
    onEvent: event => conversation.emit('event', { ...event, textOnly: true }) })
  conversation = new DeviceConversation({ realtime, text, routing })
  const isolated = session.fromPartition('control-device')
  const mediaPermission = (contents, permission, details, check = false) => microphonePermission({
    contents, permission, details, check, expected: windows?.pet?.webContents, petUrl: `${origin}/device/device-pet.html`,
    enabled: Boolean(microphoneContext && microphoneContext === microphoneKey() && windows?.state.visible),
  })
  isolated.setPermissionRequestHandler((contents, permission, callback, details) => callback(mediaPermission(contents, permission, details)))
  isolated.setPermissionCheckHandler((contents, permission, _origin, details) => mediaPermission(contents, permission, details, true))
  isolated.on('will-download', event => event.preventDefault())
  isolated.webRequest.onBeforeRequest((details, callback) => callback({
    cancel: !details.url.startsWith(`${origin}/`) && !details.url.startsWith(`blob:${origin}/`) && !details.url.startsWith('data:') &&
      !momentResourceAllowed(details, windows?.controller?.webContents.id),
  }))
  isolated.webRequest.onBeforeSendHeaders((details, callback) => {
    const headers = { ...details.requestHeaders }
    if (details.url.startsWith(`${origin}/`)) headers['X-Pet-Token'] = token
    else for (const key of Object.keys(headers)) if (/^(authorization|cookie|x-pet-token|referer)$/i.test(key)) delete headers[key]
    callback({ requestHeaders: headers })
  })
  windows = new DeviceWindows({
    startup,
    preferences: loadDisplayPreferences(path.join(userData, 'display-preferences.json')),
    savePreferences: value => saveDisplayPreferences(path.join(userData, 'display-preferences.json'), value),
    origin, directory, session: isolated, iconPath: path.resolve(directory, '../../../static/aibanlv.ico'),
    retry: () => {
      const profile = runtime.state.desired || runtime.state.current
      if (profile?.fromCatalog && !catalog.find(profile.agentId)) { void catalog.refresh(); return }
      runtime.retry()
    },
    onVisibilityChange: syncConversation,
    stopConversation: () => {
      if (conversation.turn || conversation.connection || conversation.connecting) conversation.stop()
      else assistant.reset().catch(() => {})
    },
  })
  windows.pet.webContents.on('did-start-navigation', (_event, _url, _inPlace, mainFrame) => {
    if (mainFrame) microphoneContext = ''
  })
  ipcMain.handle('device:activity-state', event => windows.trusted(event) ? activity.snapshot() : null)
  ipcMain.on('device:activity-expanded', (event, value) => {
    if (windows.fromPet(event) && typeof value === 'boolean') windows.taskActivityExpanded = value && windows.taskActivityVisible
  })
  ipcMain.handle('device:codex-state', event => windows.trusted(event) ? codex?.snapshot() : null)
  const codexAction = work => async event => {
    if (!windows.fromController(event)) return { ok: false, message: '请求来源无效' }
    try { return { ok: true, ...await work() } }
    catch (error) { return { ok: false, message: error.message } }
  }
  ipcMain.handle('device:codex-connect', codexAction(() => { codex.startAutoConnect(); return codex.connect() }))
  ipcMain.handle('device:codex-disconnect', codexAction(() => { codex.stopAutoConnect(); return {} }))
  ipcMain.handle('device:codex-interrupt', async (event, id) => {
    if (!windows.fromController(event) || typeof id !== 'string') return { ok: false, message: '请求来源无效' }
    try { return await taskDispatcher.execute({ provider: 'codex', operation: 'interrupt', taskId: id }) } catch (error) { return { ok: false, message: error.message } }
  })
  ipcMain.on('device:codex-announce', (event, enabled) => { if (windows.fromController(event)) announceCodex = enabled === true })
  ipcMain.handle('device:state', event => windows.trusted(event) ? snapshot() : null)
  const pluginCatalog = new OnlinePluginCatalog()
  ipcMain.handle('device:plugins-query', event => windows.fromController(event)
    ? pluginCatalog.query() : { ok: false, code: 'INVALID_SOURCE' })
  registerModelControls({ ipcMain, windows, settings: modelSettings, deepseek: assistantSettings, harnessClient, channel, runtime,
    changed: async () => { modelRevision++; conversation.stop(true); await assistant.reset(); publish(); void refreshScore({ force: true }) } })
  const roleMedia = new Map()
  ipcMain.handle('device:app-download', async event => {
    if (!windows.fromController(event)) return { ok: false }
    await shell.openExternal('https://aibanlv.ai/zh?view=desktop-companion')
    return { ok: true }
  })
  ipcMain.handle('device:provider-console', async (event, provider, region) => {
    if (!windows.fromController(event)) return { ok: false }
    const target = provider === 'deepseek' ? 'https://platform.deepseek.com/api_keys'
      : provider === 'qwen' ? `https://bailian.console.aliyun.com/${modelSettings.snapshot().region}/model/settings/api-key` : ''
    if (!target) return { ok: false }
    try { await shell.openExternal(target); return { ok: true } } catch { return { ok: false } }
  })
  ipcMain.handle('device:lam-project', async event => {
    if (!windows.fromController(event)) return { ok: false }
    try { await shell.openExternal('https://github.com/aigc3d/LAM'); return { ok: true } } catch { return { ok: false } }
  })
  const roleResult = work => async (event, value) => {
    if (!windows.fromController(event) || closing) return { ok: false, code: 'FORBIDDEN' }
    try { return await work(value) }
    catch (error) { return { ok: false, code: error.code || 'LOCAL_ROLE_FAILED', message: error.message?.slice(0, 250) || '角色操作失败，请重试' } }
  }
  ipcMain.handle('device:local-configure', roleResult(value => {
    const job = settingsWork.then(async () => {
      if (!value || Object.keys(value).length !== 1 || typeof value.momentsEnabled !== 'boolean') return { ok: false, code: 'INVALID_SETTINGS' }
      return localWorkspace.setMoments(value.momentsEnabled)
    })
    settingsWork = job.catch(() => {}); return job
  }))
  ipcMain.handle('device:local-documents', roleResult(async id => {
    const folder = id ? localWorkspace.folder(id) : localWorkspace.directory
    if (id && !localWorkspace.roles.has(id)) return { ok: false, message: '本地角色不存在' }
    const message = await shell.openPath(folder)
    return { ok: !message, message: message ? '无法打开本地文档目录' : '' }
  }))
  ipcMain.handle('device:role-media', roleResult(async kind => {
    const formats = { lam: ['zip'], voice: ['wav', 'mp3', 'm4a', 'ogg'], photo: ['jpg', 'jpeg', 'png', 'webp'] }
    if (!formats[kind]) return { ok: false, code: 'INVALID_ROLE' }
    const result = await dialog.showOpenDialog(windows.controller, { title: { lam: '选择 LAM 资产包', voice: '选择声音文件', photo: '选择角色照片' }[kind],
      properties: ['openFile'], filters: [{ name: kind, extensions: formats[kind] }] })
    if (result.canceled) return { ok: false, code: 'CANCELLED' }
    const file = result.filePaths[0], info = await stat(file), extension = path.extname(file).toLowerCase().slice(1)
    if (!info.isFile() || !formats[kind].includes(extension) || info.size > (kind === 'lam' ? 64 : 12) * 1024 * 1024 || !info.size) {
      return { ok: false, message: kind === 'lam' ? 'LAM ZIP 须小于 64 MiB' : '文件格式不符或超过 12 MiB' }
    }
    let bytes = await readFile(file)
    if (kind === 'photo') {
      const image = nativeImage.createFromBuffer(bytes)
      if (image.isEmpty()) return { ok: false, message: '无法读取这张照片' }
      bytes = image.resize({ width: 720 }).toPNG()
    }
    const id = randomUUID()
    for (const [key, item] of roleMedia) if (item.expiresAt < Date.now()) roleMedia.delete(key)
    while (roleMedia.size >= 6) roleMedia.delete(roleMedia.keys().next().value)
    roleMedia.set(id, { kind, bytes, extension, expiresAt: Date.now() + 30 * 60000 })
    return { ok: true, id, name: path.basename(file), ...(kind === 'photo' ? { preview: `data:image/png;base64,${bytes.toString('base64')}` } : {}) }
  }))
  ipcMain.handle('device:role-save', roleResult(async value => {
    if (!value || !['local','online'].includes(value.mode)) return { ok: false, code: 'INVALID_ROLE' }
    const media = {}
    const onlineMedia = {}
    for (const kind of ['lam', 'voice', 'photo']) {
      if (!value.media?.[kind]) continue
      const item = roleMedia.get(value.media[kind])
      if (!item || item.kind !== kind || item.expiresAt < Date.now()) return { ok: false, message: '文件选择已失效，请重新选择' }
      media[kind] = item.bytes
      onlineMedia[kind] = item
      if (kind === 'voice') media.voiceMime = { wav: 'audio/wav', mp3: 'audio/mpeg', m4a: 'audio/mp4', ogg: 'audio/ogg' }[item.extension]
    }
    if (value.mode === 'online') {
      const result = await onlineRoles.create(value, onlineMedia)
      await catalog.refresh()
      for (const id of Object.values(value.media || {})) roleMedia.delete(id)
      return { ...result, role: roleChoices().find(row => row.agentId === result.agentId) }
    }
    const result = await localWorkspace.saveRole(value, media)
    const photo = path.join(localWorkspace.folder(result.role.agentId), 'avatar.png')
    if (await stat(photo).then(value => value.isFile()).catch(() => false)) files.set(`/assets/local-${result.role.agentId}.png`, photo)
    if (runtime.state.current?.agentId === result.role.agentId) {
      await chooseRole(result.role.agentId)
    }
    for (const id of Object.values(value.media || {})) roleMedia.delete(id)
    publish(); return result
  }))
  async function chooseRole(id) {
    if (localWorkspace.roles.has(id) && localWorkspace.configured()) {
      const profile = await localWorkspace.profile(id)
      conversation.stop(true)
      if (profile.zipUrl) runtime.clear()
      await localWorkspace.select(id); channel.state.local = true
      await runtime.track(runtime.apply(profile))
      return true
    }
    const profile = catalog.find(id)
    if (!profile || !profile.publicAvatar && channel.state.binding !== 'bound') return false
    conversation.stop(true); runtime.clear()
    await localWorkspace.select(''); channel.state.local = false
    await runtime.track(runtime.apply({ ...profile, fromCatalog: true, profileVersion: 0 }))
    return true
  }
  ipcMain.handle('device:role-open', roleResult(async id => {
    if (typeof id !== 'string' || !roleChoices().some(row => row.agentId === id && row.available !== false)) return { ok: false, code: 'INVALID_ROLE' }
    if (runtime.state.current?.agentId === id && runtime.state.phase === 'error') await runtime.retry()
    if (runtime.state.current?.agentId !== id && !await chooseRole(id)) return { ok: false, code: 'INVALID_ROLE' }
    const scope = JSON.stringify(storageScope())
    const saved = localWorkspace.roles.has(id) ? await localWorkspace.history(id)
      : channel.state.binding === 'bound' ? await historyReader.load(id, AbortSignal.timeout(15000)) : []
    await conversationStore.queue
    if (scope !== JSON.stringify(storageScope())) return { ok: false, code: 'HISTORY_SCOPE_CHANGED', message: '账号已改变，请重新选择角色' }
    const pending = conversationStore.context(id)
    let overlap = Math.min(saved.length, pending.length)
    while (overlap && !saved.slice(-overlap).every((row, index) => row.role === pending[index].role && row.text === pending[index].text)) overlap--
    const history = [...saved, ...pending.slice(overlap)].slice(-400)
    return { ok: true, history, ...(localWorkspace.roles.has(id) ? { role: localWorkspace.publicRole(await localWorkspace.profile(id)) } : {}) }
  }))
  ipcMain.handle('device:role-chat', roleResult(async value => {
    if (typeof value?.agentId !== 'string' || value.agentId !== runtime.state.current?.agentId) return { ok: false, message: '请先选择角色并等待形象就绪' }
    const result = chatInputResult(value.text, snapshot())
    return result.ok ? conversation.send(value.text, { textOnly: true }) : result
  }))
  ipcMain.handle('device:copy-installation-prompt', event => {
    if (!windows.fromController(event)) return { ok: false }
    try { clipboard.writeText(installationPrompt); return { ok: true } } catch { return { ok: false } }
  })
  ipcMain.handle('device:ai-tools-acknowledge', event => windows.fromController(event) ? aiTools?.acknowledge() : null)
  ipcMain.handle('device:account-state', event => windows.fromController(event) ? deviceAccount.snapshot() : null)
  ipcMain.handle('device:account-refresh', async event => {
    if (!windows.fromController(event)) return { ok: false, message: '请求来源无效' }
    if (!isGuestDevice(channel)) return deviceAccount.request('get_device_account')
    const points = await refreshScore({ force: true })
    return { ok: isGuestDevice(channel) && Number.isFinite(points), message: scoreError || '积分已刷新' }
  })
  ipcMain.handle('device:language', async (event, value) => {
    if (!windows.trusted(event)) return null
    if (value !== undefined) {
      if (!windows.fromController(event) || !['zh-Hans','zh-Hant','en','ja'].includes(value)) return null
      uiLanguage=value;await writeFile(path.join(userData,'desktop-language.json'),JSON.stringify({language:uiLanguage}),{mode:0o600});publish()
    }
    return uiLanguage
  })
  ipcMain.handle('device:desktop-action', async (event, operation, payload = {}, requestId) => {
    if (!windows.fromController(event) || !['memo_list','memo_create','memo_delete','invite','invite_list','unbind','points_list', ...momentOperations].includes(operation) ||
        !payload || typeof payload !== 'object' || Array.isArray(payload) || JSON.stringify(payload).length > 8000 ||
        requestId !== undefined && (typeof requestId !== 'string' || !/^[A-Za-z0-9_-]{16,64}$/.test(requestId))) return {ok:false,code:'INVALID_ACTION'}
    if (operation === 'memo_create' && runtime.state.roles.some(role => role.source === 'local' && role.agentId === payload.agentId)) {
      return { ok: false, code: 'LOCAL_ROLE_PRIVATE', message: '本地角色不上传平台，请为平台提醒选择线上角色' }
    }
    const scope=JSON.stringify([channel.tenantId,channel.state.owner])
    if (operation === 'invite' && (Object.keys(payload).some(key => key !== 'copy') ||
         payload.copy !== undefined && !['url','app','code','text'].includes(payload.copy))) return {ok:false,code:'INVALID_ACTION'}
    const result=await desktopServices.request(operation,operation === 'invite' ? {} : payload,requestId)
    if (operation !== 'unbind' && scope!==JSON.stringify([channel.tenantId,channel.state.owner])) return {ok:false,code:'BIND_REQUIRED'}
    if(result.ok && operation==='invite') {
      try {return invitationResult(result.data?.code,uiLanguage,payload,value=>clipboard.writeText(value))}
      catch{return {ok:false,code:'INVALID_ACTION'}}
    }
    return result
  })
  ipcMain.handle('device:moments-upload', (event, value) => {
    if (!windows.fromController(event) || !windows.controller.isVisible() || closing) return { ok: false, code: 'FORBIDDEN' }
    return momentsUpload?.upload(value) || { ok: false, code: 'OFFLINE' }
  })
  ipcMain.handle('device:transfer-chunk', (event, id, offset, length) => {
    if (!windows.fromController(event)) throw new Error('请求来源无效')
    return fileTransfer.chunk(id, offset, length)
  })
  ipcMain.handle('device:transfer-signal', (event, value) => windows.fromController(event) && fileTransfer.signal(value))
  ipcMain.on('device:transfer-state', (event, value) => { if (windows.fromController(event)) fileTransfer.state(value) })
  for (const [name, action] of Object.entries({ 'check-update': () => desktopUpdate.check(), 'update-state': () => desktopUpdate.snapshot(),
    'update-download': () => desktopUpdate.download(), 'update-cancel': () => desktopUpdate.cancel(), 'update-install': () => desktopUpdate.install() })) {
    ipcMain.handle(`device:${name}`, event => windows.fromController(event) ? action() : { ok: false, message: '请求来源无效' })
  }
  conversation.on('event', data => {
    if (data.textOnly) {
      activity.conversation(data, runtime.state.current?.agentName)
      windows.conversation(data)
    } else lam.accept(data)
    if (['connection', 'complete', 'error', 'stopped', 'interrupted'].includes(data.type)) firstGreeting?.schedule()
  })
  ipcMain.handle('device:assistant-state', event => windows.fromController(event) ? assistantSnapshot() : null)
  ipcMain.handle('device:mail-state', event => windows.fromController(event) ? mail.snapshot() : null)
  ipcMain.handle('device:mail-configure', (event, value) => {
    if (!windows.fromController(event)) return { ok: false, code: 'FORBIDDEN' }
    const job = settingsWork.then(async () => {
      try {
        conversation.stop(true)
        await assistant.reset()
        await mail.stop()
        if (value?.forget === true && Object.keys(value).length === 1) {
          await mailSettings.forget()
          await mail.forget()
        } else {
          await mailSettings.configure(value)
          mail.publish({ status: 'idle', message: '', lastCheck: null })
          mail.start()
        }
        publishMail(mail.snapshot())
        return { ok: true, ...mail.snapshot() }
      } catch (error) { mail.start(); return { ok: false, message: mailMessage(error.code) } }
    })
    settingsWork = job.catch(() => {})
    return job
  })
  ipcMain.handle('device:mail-check', async event => {
    if (!windows.fromController(event)) return { ok: false, code: 'FORBIDDEN' }
    await mail.check(true)
    return mail.snapshot()
  })
  ipcMain.handle('device:assistant-test', async event => {
    if (!windows.fromController(event)) return { ok: false, code: 'FORBIDDEN', message: '请求来源无效' }
    return assistant.verify()
  })
  // The provider's wording never reaches the screen, so the file is the only way
  // to answer "which reason is it". Showing its tail here avoids asking the user
  // to hunt through AppData.
  ipcMain.handle('device:assistant-log', async event => {
    if (!windows.fromController(event)) return { ok: false, code: 'FORBIDDEN', message: '请求来源无效' }
    return { ok: true, path: assistantLog.path, lines: await assistantLog.tail(60) }
  })
  ipcMain.on('device:assistant-log-open', event => {
    if (!windows.fromController(event)) return
    shell.openPath(assistantLog.path)
  })
  ipcMain.handle('device:workbuddy-state', event => windows.fromController(event) ? { ...workbuddy.snapshot(), worker: workbuddyAgent?.snapshot() } : null)
  ipcMain.handle('device:workbuddy-interrupt', async (event, id) => {
    if (!windows.fromController(event) || typeof id !== 'string') return { ok: false, message: '请求来源无效' }
    try { return await taskDispatcher.execute({ provider: 'workbuddy', operation: 'interrupt', taskId: id }) }
    catch (error) { return { ok: false, message: error.message } }
  })
  ipcMain.handle('device:workbuddy-answer', (event, value) => {
    if (!windows.fromController(event) || typeof value?.callId !== 'string') return { ok: false, message: '请求无效' }
    const settle = value.ignore === true ? workbuddy.discard(value.callId)
      : workbuddy.answer(value.callId, String(value.choice || ''))
    return settle.then(result => { publishWorkbuddy(); return result })
  })
  ipcMain.on('device:workbuddy-open', (event, sessionId) => {
    if (!windows.fromController(event) || typeof sessionId !== 'string') return
    const session = workbuddy.sessions.get(sessionId)
    // Opening the directory is the honest version of "take me there": the app
    // owns its own window, and files are what this integration can point at.
    if (session?.cwd) shell.openPath(session.cwd)
  })
  ipcMain.on('device:workbuddy-announce', (event, enabled) => {
    if (windows.fromController(event)) announceWorkbuddy = enabled === true
  })
  ipcMain.handle('device:assistant-configure', (event, value) => {
    if (!windows.fromController(event)) return { ok: false, code: 'FORBIDDEN' }
    const job = settingsWork.then(async () => {
      try {
        if (value?.forget === true && Object.keys(value).length === 1) await assistantSettings.forget()
        else if (value && Object.keys(value).length === 1 && typeof value.enabled === 'boolean') {
          if (value.enabled && !assistantSettings.key() && !(harnessClient.state.online && harnessClient.state.signedIn)) throw Object.assign(new Error(), { code: 'HARNESS_CLIENT_UNAVAILABLE' })
          await harnessClient.setEnabled(value.enabled)
          if (assistantSettings.key() || !value.enabled) await assistantSettings.configure(value)
        } else {
          await assistantSettings.configure(value)
          if (value?.enabled === true) await harnessClient.setEnabled(true)
        }
        modelRevision++
        conversation.stop(true)
        await assistant.reset()
        publishAssistant({ state: assistant.enabled() ? 'ready' : 'disabled' })
        publish()
        return { ok: true, ...assistantSnapshot() }
      } catch (error) { return { ok: false, message: assistantMessage(error.code) } }
    })
    settingsWork = job.catch(() => {})
    return job
  })
  ipcMain.on('device:refresh', event => { if (windows.fromController(event) && modelSettings.snapshot().platformEnabled) channel.refresh() })
  ipcMain.on('device:catalog-refresh', event => { if (windows.fromController(event)) void catalog.refresh() })
  ipcMain.on('device:select', (event, id) => {
    if (!windows.fromController(event) || typeof id !== 'string' || id.length > 256) return
    const profile = catalog.find(id)
    if (localWorkspace.roles.has(id) || profile) void chooseRole(id)
    else if (runtime.state.roles.some(role => role.agentId === id && !role.fromCatalog &&
        (role.source === 'local' || channel.state.connection === 'connected' && channel.state.binding === 'bound'))) runtime.select(id)
  })
  ipcMain.on('device:rendered', (event, id, status) => {
    if (windows.fromPet(event) && typeof id === 'string' && ['ready', 'error'].includes(status)) runtime.rendered(id, status)
  })
  const chat = async (text, allowComputer = true, remoteSessionId = '') => {
    if (conversationStore.failed) return { ok: false, code: 'HISTORY_STORAGE_UNAVAILABLE', message: memoryError }
    await refreshScore()
    const result = chatInputResult(text, snapshot())
    return result.ok ? conversation.send(text, { allowComputer, remoteSessionId }) : result
  }
  ipcMain.handle('device:chat', (event, text) => windows.fromPet(event) && windows.state.visible
    ? chat(text) : { ok: false, code: 'FORBIDDEN', message: '请求来源无效' })
  ipcMain.handle('device:touch', (event, touch) => {
    if (!windows.fromPet(event) || !windows.state.visible || windows.state.clickThrough) {
      return { ok: false, code: 'FORBIDDEN', message: '当前无法进行触控互动' }
    }
    const result = deviceInputResult(snapshot())
    return result.ok ? conversation.sendTouch(touch) : result
  })
  ipcMain.handle('device:microphone', (event, enabled) => {
    if (!windows.fromPet(event) || typeof enabled !== 'boolean') return false
    if (!enabled) { microphoneContext = ''; return true }
    microphoneContext = windows.state.visible ? microphoneKey() : ''
    return Boolean(microphoneContext)
  })
  ipcMain.handle('device:voice', (event, pcm) => {
    if (conversationStore.failed) return { ok: false, code: 'HISTORY_STORAGE_UNAVAILABLE', message: memoryError }
    if (!windows.fromPet(event) || !windows.state.visible || !microphoneContext || microphoneContext !== microphoneKey()) {
      return { ok: false, code: 'MICROPHONE_CLOSED', message: '请重新开启麦克风' }
    }
    return conversation.sendVoice(pcm)
  })
  ipcMain.handle('device:chat-interrupt', event => windows.trusted(event)
    ? conversation.interrupt() : { ok: false, code: 'FORBIDDEN', message: '请求来源无效' })
  ipcMain.on('device:chat-stop', event => { if (windows.trusted(event)) conversation.stop() })
  ipcMain.on('device:chat-played', (event, id) => {
    if (windows.fromPet(event) && typeof id === 'string') conversation.played(id)
  })
  ipcMain.on('device:audio-failed', event => { if (windows.fromPet(event)) conversation.fail() })
  channel.on('state', () => { publish(); void syncMemoryBinding() })
  // The durable transcript lives server-side; the device reports every turn it
  // speaks so the app can show the same conversation the machine just had.
  const remoteReplies = new DeviceRemoteReplies({ send: value => channel.send(value),
    persist: (payload, context) => conversationStore.record(payload, context), onPersistError: storageFailure,
    // The control service has already verified the controller owns this binding.
    // Mobile and local conversation commands share the same Harness tool path.
    chat: (value, metadata) => {
      const access = remoteTaskAccess(value, metadata)
      return access.ok ? chat(value, access.allowComputer, metadata?.originSessionId || '') : access
    }, context: () => ({ ...roleContext(), profileVersion: runtime.state.current?.profileVersion }) })
  conversation.on('event', event => remoteReplies.accept(event))
  let localTurn
  conversation.on('event', event => {
    if (event.type === 'preparing') localTurn = localMode() ? { agentId: runtime.state.current.agentId, id: event.requestId, user: '', assistant: '' } : null
    if (!localTurn || localTurn.id !== event.requestId) return
    if (['user', 'assistant'].includes(event.type)) localTurn[event.type] = event.text || ''
    if (['done', 'error', 'stopped', 'interrupted', 'reset'].includes(event.type)) {
      const turn = localTurn; localTurn = null
      void localWorkspace.appendTurn(turn.agentId, turn.id, ['user', 'assistant'].filter(role => turn[role]).map(role => ({ role, text: turn[role] })))
        .catch(() => { localWorkspace.error = '本地文档保存失败，请检查存储空间'; localWorkspace.publish() })
    }
  })
  registerHistoryControls({ ipcMain, windows, store: conversationStore, dialog,
    beforeClear: () => {
      historyClearing = true; publish()
      conversation.stop(true); loadedHistory.clear(); remoteReplies.clear()
    },
    changed: () => { memoryError = '' },
    resume: () => { historyClearing = false; publish() } })
  conversation.on('event', event => {
    const context = roleContext()
    void conversationStore.accept(event, context).then(() => {
      if (event.type === 'done') void syncMemoryBinding()
    }).catch(storageFailure)
    if (['complete', 'error'].includes(event.type)) void refreshScore()
  })
  const syncMemoryBinding = async () => {
    await conversationStore.queue
    const context = roleContext()
    if (closing || historyClearing || conversationStore.failed || !context.bound || channel.state.connection !== 'connected') return
    for (const payload of conversationStore.pending()) channel.send(payload)
  }
  syncTimer = setInterval(() => { void syncMemoryBinding() }, 2000)
  const notifications = new DeviceNotifications({
    context: () => ({ ...roleContext(), roleSource: runtime.state.current?.source ?? 'online',
      bound: runtime.state.current?.source === 'local' || channel.state.binding === 'bound',
      ready: windows.state.visible && runtime.state.phase === 'ready' && Boolean(runtime.state.current),
      blockedCode: windows.state.visible ? 'AVATAR_NOT_READY' : 'HIDDEN' }),
    busy: () => Boolean(conversation.turn), speak: (text, options) => conversation.send(text, options),
    isCurrent: event => {
      if (event.mailContentAccount && !mail.announcementCurrent(event.mailContentAccount)) return false
      if (!event.reportTurnId) return true
      const task = codex?.tasks.get(event.reportTaskId)
      return task && (task.lastTurnId || task.turnId) === event.reportTurnId &&
        (event.progress ? task.status === 'inProgress' : ['completed','failed','interrupted'].includes(task.status))
    },
    onNotice: event => { activity.add('通知', 'message', event.content, `notice:${event.eventId}`); assistantLog.event('notification.received', { eventId: event.eventId }) },
    onStatus: value => {
      assistantLog.event('notification.delivery', value)
      if (value.state === 'waiting') activity.add('通知', 'status', ({ TEXT_ONLY: '通知已收到；积分用尽，暂不能语音播报',
        HIDDEN: '通知已收到；显示数字人后播报', AVATAR_NOT_READY: '通知已收到；等待形象加载后播报',
        CHAT_BUSY: '通知已收到；当前对话结束后播报', OFFLINE: '通知已收到；等待设备重新连接' })[value.code] || '通知已收到，等待对话就绪后播报', `notice-status:${value.eventId}`)
      if (value.state === 'failed') activity.add('通知', 'error', '通知已收到，但本次语音未能确认开始；请查看实时信息中的通知文字', `notice-status:${value.eventId}`)
    },
  })
  const reportTask = async (provider, value) => {
    if (closing) return
    const current = () => provider !== 'codex' || !value.turnId || (codex?.tasks.get(value.id)?.lastTurnId || codex?.tasks.get(value.id)?.turnId) === value.turnId
    if (!current()) return
    if(value.scope?.bound && (value.scope.owner!==channel.state.owner || value.scope.tenantId!==channel.tenantId))return
    if(!value.progress) {
      const eventId=value.scope?taskReports?.add(provider,value,value.scope,{defer:true}):''
      await taskReports?.writes.catch(()=>{})
      try { value={...value,text:await assistant.summarizeTask({provider,text:value.text})} }
      catch { activity.add('Harness','error','任务汇报整理失败，保留执行器真实结果',`report:${provider}:${value.id}`) }
      if(closing)return
      if(!current()){if(eventId)taskReports?.discard(eventId);return}
      if(value.scope?.bound && (value.scope.owner!==channel.state.owner || value.scope.tenantId!==channel.tenantId))return
      if(eventId)taskReports.finalize(eventId,value.text)
    }
    if (provider === 'codex' ? !announceCodex : !announceWorkbuddy) return
    notifications.receive({ eventId: value.eventId || `${provider}:${value.id}:${Date.now()}`, sentAt: Date.now(),
      reportTaskId: provider === 'codex' ? value.id : undefined, reportTurnId: provider === 'codex' ? value.turnId : undefined,
      roleSource: value.scope?.roleSource ?? 'online', reportKey: `${provider}:${value.id}`, progress: value.progress === true, content: value.text })
  }
  codex = new DeviceCodex({
    log: assistantLog,
    monitorScope: roleContext,
    onActivity: value => activity.add(value.source, value.kind, value.text, value.key),
    onReport: value => {
      reportTask('codex', value)
    },
    approve: async ({ method, params }, signal) => {
      activity.add('Codex','approval','等待本机确认任务请求','task-review')
      return reviewTaskRequest({ task:codex.tasks.get(params.threadId),method,params,signal,
        confirm: (context, abort) => {
          if (!windows?.controller || windows.controller.isDestroyed()) return { decision: 'deny' }
          windows.showController()
          return confirmTaskRequest(context, abort, options => dialog.showMessageBox(windows.controller, options))
        } })
    },
  })
  codex.on('state', value => {
    if (!windows.controller.isDestroyed()) windows.controller.webContents.send('device:codex', value)
    aiTools?.observe()
  })
  channel.on('notification', event => { if (!localMode()) notifications.receive(event) })
  // WorkBuddy's own runs are local files, so the pet can report them without any
  // cloud: creation, progress, completion, and the questions it stops to ask.
  const say = event => notifications.receive({ eventId: `wb:${event.type}:${event.id}:${event.key}`,
    sentAt: event.at, content: workbuddySpeech(event) })
  workbuddy = new WorkBuddyBridge({ onEvent: event => {
    activity.add('WorkBuddy', event.type === 'task.confirm' ? 'approval' : 'status', workbuddySpeech(event), `${event.id}:${event.key}`)
    if (announceWorkbuddy && event.type !== 'task.confirmed') say(event)
    publishWorkbuddy()
  } })
  workbuddy.start().catch(() => {})
  workbuddyAgent = new WorkBuddyAgent({ log: assistantLog,
    onActivity: value => activity.add(value.source, value.kind, value.text, value.key),
    onReport: value => reportTask('workbuddy', value) })
  workbuddyAgent.on('state', publishWorkbuddy)
  taskDispatcher = new HarnessTaskDispatcher({ assistant, codex, workbuddy: workbuddyAgent,
    file: path.join(userData, 'task-projects.json'),
    workspaceRoots:[path.join(app.getPath('documents'),'AIBanlv Workspace'),path.join(os.homedir(),'kaifa'),
      ...(!app.isPackaged ? [path.resolve(directory,'../../..')] : [])],
    context: roleContext,
    onCompleted:(provider,value)=>{if(value.scope)taskReports?.add(provider,value,value.scope)},
    onActivity: value => activity.add(value.source, value.kind, value.text, value.key) })
  assistant.taskRouter = taskDispatcher
  await mkdir(path.join(app.getPath('documents'),'AIBanlv Workspace'),{recursive:true})
  await taskDispatcher.load()
  desktopServices=new DesktopServices({channel})
  onlineRoles = new OnlineRoles({ channel, httpFetch: httpAuth.fetch, file: path.join(userData,'online-role-jobs.enc'), encryption: safeStorage })
  await onlineRoles.load()
  onlineRoles.on('state', () => windows?.update(snapshot()))
  momentsUpload = new MomentsUpload({ channel, services: desktopServices })
  notificationSync = new DeviceNotificationSync({ channel, services: desktopServices, notifications,
    onStatus: value => { assistantLog.event('notification.sync', value); windows.update(snapshot()) } })
  notificationSync.start()
  assistant.reminders = new DeviceReminders({ services: desktopServices, context: roleContext })
  taskReports=new TaskReportOutbox({ file:path.join(userData,'task-reports.enc'),encryption:safeStorage,
    context: roleContext,
    deliver:payload=>desktopServices.request('task_report',payload) })
  await taskReports.load()
  let monthlyClaim='', monthlyBusy=false
  const monthlyCadence = new RefreshCadence({ retryMs: 30000 })
  const syncDesktopServices=()=>{
    if(localMode())return
    if(channel.state.binding!=='bound'||!channel.state.accountAuthReady||!channel.state.desktopServicesSupported)return
    void taskReports.flush().catch(()=>{})
    const month=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit'}).format(new Date())
    const key=JSON.stringify([channel.tenantId,channel.state.owner,month])
    if(monthlyClaim===key||monthlyBusy)return
    if (!monthlyCadence.begin(key)) return
    monthlyBusy=true
    void desktopServices.request('claim_monthly').then(result=>{
      monthlyCadence.finish(key, { ok: result.ok === true })
      if(result.ok){monthlyClaim=key;void deviceAccount.request('get_device_account');void refreshScore()}
    }).catch(()=>monthlyCadence.finish(key, {ok:false})).finally(()=>{monthlyBusy=false})
  }
  channel.on('state',syncDesktopServices)
  const desktopTimer=setInterval(syncDesktopServices,30000);desktopTimer.unref()
  // Monitoring uses the existing local login and never starts a model turn.
  // It is independent of the Harness Key and the task-creation workspace.
  aiTools = new DeviceAiTools({ file: path.join(userData, 'ai-tools-onboarding.json'),
    context: () => ({ bound: channel.state.binding === 'bound', connected: channel.state.connection === 'connected',
      authorized: !channel.state.proofRequired || channel.state.accountAuthReady,
      scope: channel.state.binding === 'bound' ? createHash('sha256').update(JSON.stringify([channel.tenantId, channel.state.owner])).digest('hex') : '' }),
    assistant: assistantSnapshot, codex: () => ({ status: codex.status }) })
  aiTools.on('state', () => windows?.update(snapshot()))
  codex.startAutoConnect()
  aiTools.start()
  mail.start()
  let pluginOwner = ''
  channel.on('state', state => {
    aiTools.observe()
    if (state.binding !== 'bound') return
    const owner = JSON.stringify([state.owner, channel.tenantId])
    if (owner !== pluginOwner) {
      pluginOwner = owner
      if (!codex.autoConnect) codex.startAutoConnect()
    }
  })
  channel.on('reply-saved', (id, metadata) => {
    remoteReplies.saved(id, metadata)
    void conversationStore.acknowledge(id, storageScope()).catch(storageFailure)
  })
  channel.on('state', state => { if (state.binding === 'bound') remoteReplies.retry() })
  channel.on('revoked', () => {
    pluginOwner = ''
    void taskReports.clear()
    remoteReplies.clear(); notifications.clear()
    if (!localMode()) {
      void assistant.reset().catch(()=>{})
      workbuddyAgent?.shutdown(); codex?.stopAutoConnect()
    }
  })
  channel.on('text', (value, requestId, metadata) => { if (!localMode()) remoteReplies.submit(value, requestId, metadata || {}) })
  channel.on('history', (agentId, requestId) => remoteReplies.replay(agentId, requestId))
  runtime.on('state', () => {
    void conversationStore.setScope(storageScope()).catch(storageFailure)
    publish(); void refreshScore()
  })
  runtime.on('diagnostic', value => assistantLog.event('avatar.failed', value))
  runtime.on('stop-speech', () => { remoteReplies.clear({ keepOutbox: true }); conversation.stop(true); windows.pause() })
  app.once('before-quit', () => { aiTools?.stop();momentsUpload?.cancel();clearInterval(desktopTimer);notificationSync.stop();desktopServices.clear();remoteReplies.clear(); notifications.clear(); workbuddy?.stop(); workbuddyAgent?.shutdown(); codex?.stopAutoConnect() })
  await windows.load()
  localWorkspace.start()
  if (modelSettings.snapshot().platformEnabled) channel.start()
  void runtime.ensureInitialProfile()
  void refreshScore()
  scoreTimer = setInterval(() => { if (!closing) void refreshScore() }, 5000)
}

app.on('window-all-closed', () => app.quit())
app.on('before-quit', event => {
  if (closing) return
  event.preventDefault()
  closing = true
  if (ownsInstance) {
    try { pauseAutomaticLaunch(app.getPath('userData')) }
    catch (error) { console.warn('[desktop launch pause]', error.code || error.name) }
  }
  desktopUpdate?.dispose()
  firstGreeting?.dispose()
  fileTransfer?.reset()
  clearInterval(scoreTimer)
  clearInterval(syncTimer)
  httpAuth?.dispose()
  catalog?.dispose()
  historyReader?.dispose()
  channel?.stop()
  Promise.allSettled([conversation?.dispose(), assistant?.reset(), harnessClient?.stop(), mail?.stop(), lam?.dispose(), runtime?.dispose(), conversationStore?.queue, localWorkspace?.dispose(), onlineRoles?.dispose()]).finally(async () => {
    server?.closeAllConnections()
    server?.close()
    if (assetsDirectory) await rmdir(assetsDirectory).catch(() => {})
    windows?.dispose()
    app.quit()
  })
})
start().catch(error => {
  console.error('[device]', error.code || error.name)
  dialog.showErrorBox('Control 设备启动失败', '无法读取设备配置或启动设备服务，请检查资源与配置。')
  app.quit()
})
