const { contextBridge, ipcRenderer } = require('electron');
const fs = require('fs');

const KEY = 'focus-timer-v1';
let file = null;
try { file = ipcRenderer.sendSync('data:path'); } catch (e) {}

// The data file is the source of truth at startup: it is copied into the page's
// storage before the page's own script runs, and mirrored back to the file as it changes.
try {
  if (file && fs.existsSync(file)) {
    const txt = fs.readFileSync(file, 'utf8');
    JSON.parse(txt);
    localStorage.setItem(KEY, txt);
  }
} catch (e) {}

let last = null;
try { last = localStorage.getItem(KEY); } catch (e) {}

function flush() {
  try {
    const cur = localStorage.getItem(KEY);
    if (file && cur && cur !== last) {
      fs.writeFileSync(file + '.tmp', cur);
      fs.renameSync(file + '.tmp', file);
      last = cur;
    }
  } catch (e) {}
}
setInterval(flush, 1000);
window.addEventListener('beforeunload', flush);
window.addEventListener('pagehide', flush);

contextBridge.exposeInMainWorld('focusApp', {
  isApp: true,
  dataFile: file,
  setFloat: (on) => ipcRenderer.invoke('float:set', !!on),
  setStatus: (st) => ipcRenderer.send('status:set', st),
  onPresence: (cb) => ipcRenderer.on('presence', (e, d) => cb(d)),
  onHotkey: (cb) => ipcRenderer.on('hotkey', (e, name) => cb(name))
});
