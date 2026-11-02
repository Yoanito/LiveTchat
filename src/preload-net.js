const { contextBridge, ipcRenderer } = require('electron');

// Pont entre la page réseau (WebRTC) et le processus principal.
contextBridge.exposeInMainWorld('net', {
  onCommand: (cb) => ipcRenderer.on('net:command', (_e, cmd) => cb(cmd)),
  emit: (event, payload) => ipcRenderer.send('net:event', event, payload),
});
