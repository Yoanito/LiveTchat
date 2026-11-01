const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('livetchat', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  editZone: () => ipcRenderer.invoke('zone:edit'),
  pickMedia: () => ipcRenderer.invoke('media:pick'),
  sendMedia: (payload) => ipcRenderer.invoke('media:send', payload),
  onSettingsChanged: (cb) => ipcRenderer.on('settings:changed', (_e, s) => cb(s)),
  onDisplaysChanged: (cb) => ipcRenderer.on('displays:changed', (_e, d) => cb(d)),
  onQueueChanged: (cb) => ipcRenderer.on('queue:changed', (_e, n) => cb(n)),
});
