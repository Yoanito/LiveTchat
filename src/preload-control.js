const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('livetchat', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  editZone: () => ipcRenderer.invoke('zone:edit'),
  pickMedia: () => ipcRenderer.invoke('media:pick'),
  sendMedia: (payload) => ipcRenderer.invoke('media:send', payload),
  getRoom: () => ipcRenderer.invoke('room:get'),
  hostRoom: () => ipcRenderer.invoke('room:host'),
  joinRoom: (address) => ipcRenderer.invoke('room:join', address),
  leaveRoom: () => ipcRenderer.invoke('room:leave'),
  sendToRoom: (payload) => ipcRenderer.invoke('room:send', payload),
  setMuted: (id, muted) => ipcRenderer.invoke('room:mute', { id, muted }),
  copy: (text) => ipcRenderer.invoke('clipboard:write', text),
  onRoomChanged: (cb) => ipcRenderer.on('room:changed', (_e, room) => cb(room)),
  onSettingsChanged: (cb) => ipcRenderer.on('settings:changed', (_e, s) => cb(s)),
  onDisplaysChanged: (cb) => ipcRenderer.on('displays:changed', (_e, d) => cb(d)),
  onQueueChanged: (cb) => ipcRenderer.on('queue:changed', (_e, n) => cb(n)),
});
