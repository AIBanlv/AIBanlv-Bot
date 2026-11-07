const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('controlDevice', {
  state: () => ipcRenderer.invoke('device:state'),
  queryPlugins: () => ipcRenderer.invoke('device:plugins-query'),
  modelState: () => ipcRenderer.invoke('device:models-state'),
  configureModels: value => ipcRenderer.invoke('device:models-configure', value),
  testRealtime: value => ipcRenderer.invoke('device:models-test', value),
  testDeepseek: value => ipcRenderer.invoke('device:models-test-text', value),
  exportHistory: () => ipcRenderer.invoke('device:history-export'),
  clearHistory: () => ipcRenderer.invoke('device:history-clear'),
  configureLocal: value => ipcRenderer.invoke('device:local-configure', value),
  openAppDownload: () => ipcRenderer.invoke('device:app-download'),
  openProviderConsole: (provider, region) => ipcRenderer.invoke('device:provider-console', provider, region),
  openLamProject: () => ipcRenderer.invoke('device:lam-project'),
  openLocalDocuments: id => ipcRenderer.invoke('device:local-documents', id),
  chooseRoleMedia: kind => ipcRenderer.invoke('device:role-media', kind),
  saveRole: value => ipcRenderer.invoke('device:role-save', value),
  openRole: id => ipcRenderer.invoke('device:role-open', id),
  roleChat: value => ipcRenderer.invoke('device:role-chat', value),
  desktopAction: (operation, payload, requestId) => ipcRenderer.invoke('device:desktop-action', operation, payload, requestId),
  copyInstallationPrompt: () => ipcRenderer.invoke('device:copy-installation-prompt'),
  uploadMomentMedia: value => ipcRenderer.invoke('device:moments-upload', value),
  language: value => ipcRenderer.invoke('device:language', value),
  accountState: () => ipcRenderer.invoke('device:account-state'),
  refreshAccount: () => ipcRenderer.invoke('device:account-refresh'),
  // This menu action means closing the desktop app, not revoking the binding.
  // The existing command handler accepts quit only from the trusted controller.
  logout: () => ipcRenderer.send('pet:command', 'quit'),
  checkUpdate: () => ipcRenderer.invoke('device:check-update'),
  updateState: () => ipcRenderer.invoke('device:update-state'),
  downloadUpdate: () => ipcRenderer.invoke('device:update-download'),
  cancelUpdate: () => ipcRenderer.invoke('device:update-cancel'),
  installUpdate: () => ipcRenderer.invoke('device:update-install'),
  onUpdate: callback => {
    const listener = (_event, value) => callback(value)
    ipcRenderer.on('device:update', listener)
    return () => ipcRenderer.removeListener('device:update', listener)
  },
  transferChunk: (id, offset, length) => ipcRenderer.invoke('device:transfer-chunk', id, offset, length),
  transferSignal: value => ipcRenderer.invoke('device:transfer-signal', value),
  transferState: value => ipcRenderer.send('device:transfer-state', value),
  onTransfer: callback => {
    const listener = (_event, value) => callback(value)
    ipcRenderer.on('device:transfer', listener)
    return () => ipcRenderer.removeListener('device:transfer', listener)
  },
  activityState: () => ipcRenderer.invoke('device:activity-state'),
  activityExpanded: value => ipcRenderer.send('device:activity-expanded', value),
  codexState: () => ipcRenderer.invoke('device:codex-state'),
  codexConnect: () => ipcRenderer.invoke('device:codex-connect'),
  codexDisconnect: () => ipcRenderer.invoke('device:codex-disconnect'),
  codexInterrupt: id => ipcRenderer.invoke('device:codex-interrupt', id),
  codexAnnounce: enabled => ipcRenderer.send('device:codex-announce', enabled),
  onActivity: callback => {
    const listener = (_event, value) => callback(value)
    ipcRenderer.on('device:activity', listener)
    return () => ipcRenderer.removeListener('device:activity', listener)
  },
  onCodex: callback => {
    const listener = (_event, value) => callback(value)
    ipcRenderer.on('device:codex', listener)
    return () => ipcRenderer.removeListener('device:codex', listener)
  },
  assistantState: () => ipcRenderer.invoke('device:assistant-state'),
  acknowledgeAiToolsGuide: () => ipcRenderer.invoke('device:ai-tools-acknowledge'),
  configureAssistant: value => ipcRenderer.invoke('device:assistant-configure', value),
  testAssistant: () => ipcRenderer.invoke('device:assistant-test'),
  assistantLog: () => ipcRenderer.invoke('device:assistant-log'),
  openAssistantLog: () => ipcRenderer.send('device:assistant-log-open'),
  workbuddyState: () => ipcRenderer.invoke('device:workbuddy-state'),
  workbuddyInterrupt: taskId => ipcRenderer.invoke('device:workbuddy-interrupt', taskId),
  workbuddyAnswer: (callId, choice) => ipcRenderer.invoke('device:workbuddy-answer', { callId, choice }),
  workbuddyIgnore: callId => ipcRenderer.invoke('device:workbuddy-answer', { callId, ignore: true }),
  workbuddyOpen: sessionId => ipcRenderer.send('device:workbuddy-open', sessionId),
  workbuddyAnnounce: enabled => ipcRenderer.send('device:workbuddy-announce', enabled),
  onWorkbuddy: callback => {
    const listener = (_event, value) => callback(value)
    ipcRenderer.on('device:workbuddy', listener)
    return () => ipcRenderer.removeListener('device:workbuddy', listener)
  },
  mailState: () => ipcRenderer.invoke('device:mail-state'),
  configureMail: value => ipcRenderer.invoke('device:mail-configure', value),
  checkMail: () => ipcRenderer.invoke('device:mail-check'),
  onMail: callback => {
    const listener = (_event, value) => callback(value)
    ipcRenderer.on('device:mail', listener)
    return () => ipcRenderer.removeListener('device:mail', listener)
  },
  onAssistant: callback => {
    const listener = (_event, value) => callback(value)
    ipcRenderer.on('device:assistant', listener)
    return () => ipcRenderer.removeListener('device:assistant', listener)
  },
  refresh: () => ipcRenderer.send('device:refresh'),
  refreshCatalog: () => ipcRenderer.send('device:catalog-refresh'),
  select: agentId => ipcRenderer.send('device:select', agentId),
  rendered: (id, status) => ipcRenderer.send('device:rendered', id, status),
  chat: text => ipcRenderer.invoke('device:chat', text),
  touch: event => ipcRenderer.invoke('device:touch', event),
  microphone: enabled => ipcRenderer.invoke('device:microphone', enabled),
  voice: pcm => ipcRenderer.invoke('device:voice', pcm),
  interrupt: () => ipcRenderer.invoke('device:chat-interrupt'),
  stopChat: () => ipcRenderer.send('device:chat-stop'),
  played: requestId => ipcRenderer.send('device:chat-played', requestId),
  audioFailed: () => ipcRenderer.send('device:audio-failed'),
  onConversation: callback => {
    const listener = (_event, data) => callback(data)
    ipcRenderer.on('device:conversation', listener)
    return () => ipcRenderer.removeListener('device:conversation', listener)
  },
  onState: callback => {
    const listener = (_event, state) => callback(state)
    ipcRenderer.on('device:state', listener)
    return () => ipcRenderer.removeListener('device:state', listener)
  },
  onStopSpeech: callback => {
    const listener = () => callback()
    ipcRenderer.on('device:stop-speech', listener)
    return () => ipcRenderer.removeListener('device:stop-speech', listener)
  },
})

contextBridge.exposeInMainWorld('desktopPet', {
  status: () => ipcRenderer.invoke('pet:status'),
  command: (name, value) => ipcRenderer.send('pet:command', name, value),
  drag: (phase, point) => ipcRenderer.send('pet:drag', phase, point),
  onState: callback => {
    const listener = (_event, value) => callback(value)
    ipcRenderer.on('pet:state', listener)
    return () => ipcRenderer.removeListener('pet:state', listener)
  },
  onPause: callback => {
    const listener = () => callback()
    ipcRenderer.on('pet:pause', listener)
    return () => ipcRenderer.removeListener('pet:pause', listener)
  },
  onPointer: callback => {
    const listener = (_event, value) => callback(value)
    ipcRenderer.on('pet:pointer', listener)
    return () => ipcRenderer.removeListener('pet:pointer', listener)
  },
})
