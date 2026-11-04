const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('confettiApp', {
  onBurst: (cb) => ipcRenderer.on('burst', (e, big) => cb(!!big)),
  onRain: (cb) => ipcRenderer.on('rain', (e, on) => cb(!!on)),
  onSplat: (cb) => ipcRenderer.on('splat', () => cb())
});
