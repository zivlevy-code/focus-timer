const { contextBridge, ipcRenderer } = require('electron');
const fs = require('fs');
const md = require('./tasksmd');

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

// ---- tasks.md: the tasks as a markdown file you can edit anywhere ----
let tasksFile = null;
try { tasksFile = ipcRenderer.sendSync('tasks:path'); } catch (e) {}
let lastSeen = null; // what the file contained when we last read or wrote it

function readTasksFile() {
  try { return fs.readFileSync(tasksFile, 'utf8'); } catch (e) { return null; }
}

function syncTasks(tasks) {
  if (!tasksFile || !Array.isArray(tasks)) return;
  const onDisk = readTasksFile();
  // If the file changed behind our back, let the watcher pick that up first
  // rather than overwriting it.
  if (onDisk != null && lastSeen != null && onDisk !== lastSeen) return;
  const cur = onDisk == null ? '' : onDisk;
  const next = md.patchText(cur, tasks);
  if (onDisk != null && next === cur) { lastSeen = cur; return; }
  try {
    fs.writeFileSync(tasksFile + '.tmp', next);
    fs.renameSync(tasksFile + '.tmp', tasksFile);
    lastSeen = next;
  } catch (e) {}
}

function readTasks() {
  const txt = readTasksFile();
  if (txt == null) return null;
  lastSeen = txt;
  return md.parseMarkdown(txt);
}

function onTasksFile(cb) {
  let pending = null;
  setInterval(() => {
    const txt = readTasksFile();
    if (txt == null || txt.trim() === '') return; // an editor may be mid-save
    if (txt === lastSeen) { pending = null; return; }
    if (pending !== txt) { pending = txt; return; } // act once it has been stable for a second
    pending = null;
    lastSeen = txt;
    cb(md.parseMarkdown(txt));
  }, 1000);
}

contextBridge.exposeInMainWorld('focusApp', {
  isApp: true,
  dataFile: file,
  setFloat: (on) => ipcRenderer.invoke('float:set', !!on),
  setStatus: (st) => ipcRenderer.send('status:set', st),
  onPresence: (cb) => ipcRenderer.on('presence', (e, d) => cb(d)),
  onHotkey: (cb) => ipcRenderer.on('hotkey', (e, name) => cb(name)),
  readTasks,
  syncTasks,
  onTasksFile,
  openTasksFile: () => ipcRenderer.invoke('shell:openTasks'),
  openDataFolder: () => ipcRenderer.invoke('shell:openData')
});
