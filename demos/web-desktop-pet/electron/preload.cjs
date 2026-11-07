const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('desktopPet', {
  status: () => ipcRenderer.invoke('pet:status'),
  command: (name, value) => ipcRenderer.send('pet:command', name, value),
  relay: (value) => ipcRenderer.send('pet:relay', value),
  avatarStatus: (value) => ipcRenderer.send('pet:avatar-status', value),
  drag: (phase, point) => ipcRenderer.send('pet:drag', phase, point),
  onState: (callback) => {
    const listener = (_event, value) => callback(value)
    ipcRenderer.on('pet:state', listener)
    return () => ipcRenderer.removeListener('pet:state', listener)
  },
  onPresentation: (callback) => {
    const listener = (_event, value) => callback(value)
    ipcRenderer.on('pet:presentation', listener)
    return () => ipcRenderer.removeListener('pet:presentation', listener)
  },
  onPause: (callback) => {
    const listener = () => callback()
    ipcRenderer.on('pet:pause', listener)
    return () => ipcRenderer.removeListener('pet:pause', listener)
  },
})
