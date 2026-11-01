const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('zone', {
  init: () => ipcRenderer.invoke('zone:init'),
  save: (zone) => ipcRenderer.invoke('zone:save', zone),
  cancel: () => ipcRenderer.invoke('zone:cancel'),
});
