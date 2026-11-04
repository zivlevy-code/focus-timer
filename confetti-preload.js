const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('confettiApp', {
  onBurst: (cb) => ipcRenderer.on('burst', (e, big) => cb(!!big))
});
