const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('overlay', {
  onMedia: (cb) => ipcRenderer.on('overlay:media', (_e, media) => cb(media)),
  done: () => ipcRenderer.send('overlay:done'),
});
