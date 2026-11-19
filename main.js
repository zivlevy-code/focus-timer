const { app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, Tray, nativeImage, nativeTheme, powerMonitor, screen, session, shell } = require('electron');
const path = require('path');
const fs = require('fs');

// Global shortcuts (work from anywhere in Windows). These are the defaults; the user can
// change them in the app's shortcut legend, and the choice is kept in shortcuts.json.
const DEFAULT_KEYS = {
  focus: 'CommandOrControl+Alt+S',    // start / pause / resume focus, or end a break
  show: 'CommandOrControl+Alt+P',     // show / minimize the window
  confetti: 'CommandOrControl+Alt+C', // confetti across the whole screen
  tomato: 'CommandOrControl+Alt+T',   // throw one tomato at the middle of the screen
  note: 'CommandOrControl+Alt+N'      // quick note: jot a passing thought into the backlog
};

const ICON = path.join(__dirname, 'build', 'icon.png');

let win = null;
let tray = null;
let quitting = false;
let floating = false;
let normalBounds = null;
let status = { mode: 'idle', running: false, remaining: 0, total: 0, lunch: false, task: '' };
let keys = Object.assign({}, DEFAULT_KEYS);
const shortcutState = { show: false, focus: false, confetti: false, tomato: false, note: false }; // false when another program already owns the keys
let noteReturn = null; // how the window looked before a quick note brought it forward

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function showWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function toggleWindow() {
  if (!win) return;
  if (win.isVisible() && !win.isMinimized() && win.isFocused()) win.minimize();
  else showWindow();
}

function fmt(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
}

function applyStatus() {
  if (win && !win.isDestroyed()) {
    if (status.mode === 'idle' || !status.total) win.setProgressBar(-1);
    else win.setProgressBar(Math.min(1, Math.max(0, 1 - status.remaining / status.total)), { mode: status.running ? 'normal' : 'paused' });
  }
  if (tray) {
    let tip = 'Focus Timer';
    if (status.mode !== 'idle') {
      const en = status.lang === 'en';
      const label = status.mode === 'break'
        ? (status.lunch ? (en ? 'Lunch' : 'הפסקת צהריים') : (en ? 'Break' : 'הפסקה'))
        : (status.running ? (en ? 'Focus' : 'עבודה') : (en ? 'Paused' : 'בהשהיה'));
      tip = label + ' ' + fmt(status.remaining) + (status.task && status.mode === 'work' ? ' · ' + status.task : '');
    }
    tray.setToolTip(tip.slice(0, 120));
  }
}

// ---- shortcuts ----
function keysFile() { return path.join(app.getPath('userData'), 'shortcuts.json'); }
function loadKeys() {
  try {
    const saved = JSON.parse(fs.readFileSync(keysFile(), 'utf8'));
    Object.keys(DEFAULT_KEYS).forEach((k) => { if (typeof saved[k] === 'string') keys[k] = saved[k]; });
  } catch (e) {}
}
function saveKeys() {
  try { fs.writeFileSync(keysFile(), JSON.stringify(keys, null, 2)); } catch (e) {}
}

// A quick note brings the window forward; once the note is saved it goes back the way it was.
function quickNote() {
  if (!win) return;
  noteReturn = !win.isVisible() ? 'hide' : (win.isMinimized() || !win.isFocused()) ? 'minimize' : null;
  showWindow();
  send('hotkey', 'note');
}
const ACTIONS = {
  focus: () => send('hotkey', 'toggle'),
  show: toggleWindow,
  confetti: () => burstConfetti(true),
  tomato: () => throwTomato(),
  note: quickNote
};
function registerKey(name, accel) {
  if (!accel) return false;
  try { return globalShortcut.register(accel, ACTIONS[name]); } catch (e) { return false; }
}
function registerAll() {
  globalShortcut.unregisterAll();
  Object.keys(DEFAULT_KEYS).forEach((k) => { shortcutState[k] = registerKey(k, keys[k]); });
}
// Change one shortcut. If the new keys cannot be taken, the old ones are kept.
function setKey(name, accel) {
  if (!DEFAULT_KEYS[name]) return { ok: false };
  accel = accel || DEFAULT_KEYS[name];
  const taken = Object.keys(keys).some((k) => k !== name && keys[k].toLowerCase() === accel.toLowerCase());
  if (taken) return { ok: false, reason: 'dup' };
  const old = keys[name];
  try { if (shortcutState[name]) globalShortcut.unregister(old); } catch (e) {}
  if (registerKey(name, accel)) {
    keys[name] = accel; shortcutState[name] = true; saveKeys();
    return { ok: true };
  }
  shortcutState[name] = registerKey(name, old);
  return { ok: false, reason: 'busy' };
}

// Screen effects (confetti, tomato rain, the thrown tomato) are drawn in transparent,
// click-through windows that cover every screen, so they appear over whatever you are
// doing and not only inside the app.
let overlays = [];       // { win, displayId, ready, queue }
let overlayTimer = null;
let rainOn = false;
let rainBriefTimer = null;

function closeOverlays() {
  clearTimeout(overlayTimer);
  overlayTimer = null;
  rainOn = false;
  overlays.forEach((o) => { if (!o.win.isDestroyed()) o.win.destroy(); });
  overlays = [];
}

function ensureOverlays() {
  if (overlays.length) return;
  overlays = screen.getAllDisplays().map((d) => {
    const w = new BrowserWindow({
      x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height,
      transparent: true, frame: false, show: false, resizable: false, movable: false,
      focusable: false, skipTaskbar: true, hasShadow: false, fullscreenable: false,
      webPreferences: {
        preload: path.join(__dirname, 'confetti-preload.js'),
        contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false,
        autoplayPolicy: 'no-user-gesture-required'
      }
    });
    const entry = { win: w, displayId: d.id, ready: false, queue: [] };
    w.setIgnoreMouseEvents(true);
    w.setAlwaysOnTop(true, 'screen-saver');
    w.loadFile(path.join(__dirname, 'confetti.html'));
    w.webContents.once('did-finish-load', () => {
      if (w.isDestroyed()) return;
      entry.ready = true;
      w.showInactive();
      entry.queue.forEach(([ch, payload]) => w.webContents.send(ch, payload));
      entry.queue = [];
    });
    return entry;
  });
}

function toOverlays(channel, payload, onlyDisplayId) {
  overlays.forEach((o) => {
    if (o.win.isDestroyed()) return;
    if (onlyDisplayId != null && o.displayId !== onlyDisplayId) return;
    if (o.ready) o.win.webContents.send(channel, payload); else o.queue.push([channel, payload]);
  });
}

// Close the windows a while after the last effect, unless tomato rain is still going.
function holdOverlays(ms) {
  clearTimeout(overlayTimer);
  if (!rainOn) overlayTimer = setTimeout(closeOverlays, ms);
}

// Sound volume for the effects (0 when the page's sound is off), from the page's status.
function effectVolume() { return status.vol == null ? 70 : Math.max(0, Math.min(100, +status.vol || 0)); }

function burstConfetti(big) {
  ensureOverlays();
  toOverlays('burst', !!big);
  // One sound, from the main screen only, even when confetti covers several screens.
  toOverlays('sound', { kind: big ? 'popBig' : 'pop', vol: effectVolume() }, screen.getPrimaryDisplay().id);
  holdOverlays(8000);
}

function throwTomato() {
  ensureOverlays();
  const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  toOverlays('splat', { vol: effectVolume() }, d.id); // on the screen where the pointer is
  holdOverlays(9000);
}

// mode: 'on' (until 'off'), 'brief' (about ten seconds) or 'off'
function setRain(mode) {
  clearTimeout(rainBriefTimer);
  if (mode === 'on' || mode === 'brief') {
    ensureOverlays();
    rainOn = true;
    clearTimeout(overlayTimer);
    toOverlays('rain', true);
    if (mode === 'brief') rainBriefTimer = setTimeout(() => setRain('off'), 10000);
  } else if (rainOn) {
    rainOn = false;
    toOverlays('rain', false);
    holdOverlays(13000);
  }
}

// ---- the window in front, for spotting distractions during a focus round ----
// A small PowerShell loop reports the program and title of the window in front, only when
// it changes, every 3 seconds. It runs during focus rounds (and a minute after, so a short
// pause does not restart it), and exits by itself if the app is gone.
const { spawn } = require('child_process');
let watcher = null;
let watcherStop = null;
function watcherScript() {
  return [
    "$ErrorActionPreference = 'SilentlyContinue'",
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    "Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; using System.Text; public static class FgWin { [DllImport(\"user32.dll\")] public static extern IntPtr GetForegroundWindow(); [DllImport(\"user32.dll\", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n); [DllImport(\"user32.dll\")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid); }'",
    '$owner = ' + process.pid,
    '$last = $null',
    'while ($true) {',
    '  if (-not (Get-Process -Id $owner -ErrorAction SilentlyContinue)) { exit }',
    '  $h = [FgWin]::GetForegroundWindow()',
    '  $sb = New-Object System.Text.StringBuilder 512',
    '  [void][FgWin]::GetWindowText($h, $sb, 512)',
    '  $procId = [uint32]0',
    '  [void][FgWin]::GetWindowThreadProcessId($h, [ref]$procId)',
    "  $name = ''",
    '  $p = Get-Process -Id $procId -ErrorAction SilentlyContinue',
    '  if ($p) { $name = $p.ProcessName }',
    "  $line = $name + [char]9 + ($sb.ToString() -replace '[\\r\\n\\t]', ' ')",
    '  if ($line -ne $last) { [Console]::Out.WriteLine($line); [Console]::Out.Flush(); $last = $line }',
    '  Start-Sleep -Seconds 3',
    '}'
  ].join('\n');
}
function startWatcher() {
  clearTimeout(watcherStop);
  watcherStop = null;
  if (watcher || process.platform !== 'win32') return;
  try {
    watcher = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-EncodedCommand', Buffer.from(watcherScript(), 'utf16le').toString('base64')],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (e) { watcher = null; return; }
  const me = watcher;
  let buf = '';
  me.stdout.setEncoding('utf8');
  me.stdout.on('data', (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).replace(/\r$/, '');
      buf = buf.slice(i + 1);
      const tab = line.indexOf('\t');
      send('window', { proc: tab >= 0 ? line.slice(0, tab) : '', title: (tab >= 0 ? line.slice(tab + 1) : line).slice(0, 300) });
    }
  });
  me.on('exit', () => { if (watcher === me) watcher = null; });
  me.on('error', () => { if (watcher === me) watcher = null; });
}
function stopWatcher() {
  clearTimeout(watcherStop);
  watcherStop = null;
  if (watcher) { try { watcher.kill(); } catch (e) {} watcher = null; }
}
function stopWatcherSoon() {
  if (!watcher || watcherStop) return;
  watcherStop = setTimeout(stopWatcher, 60000);
}

function createWindow() {
  win = new BrowserWindow({
    width: 520,
    height: 860,
    minWidth: 300,
    minHeight: 260,
    title: 'Focus Timer',
    icon: ICON,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0E1621' : '#EDF1F5',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // the preload script writes the data file
      backgroundThrottling: false, // keep the timer exact while minimized or hidden
      spellcheck: false
    }
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'app', 'index.html'));
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  // Closing the window while a timer is running keeps it going in the tray.
  win.on('close', (e) => {
    if (!quitting && tray && status.running) { e.preventDefault(); win.hide(); }
  });
  win.on('closed', () => { win = null; closeOverlays(); });
}

function createTray() {
  try {
    tray = new Tray(nativeImage.createFromPath(ICON).resize({ width: 16, height: 16 }));
  } catch (e) { tray = null; return; }
  tray.setToolTip('Focus Timer');
  tray.on('click', showWindow);
  buildTrayMenu();
}

// The tray menu follows the language chosen in the page.
let menuLang = null;
function buildTrayMenu() {
  if (!tray) return;
  const en = status.lang === 'en';
  if (menuLang === (en ? 'en' : 'he')) return;
  menuLang = en ? 'en' : 'he';
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: en ? 'Show / hide' : 'הצג / הסתר', click: () => { if (win && win.isVisible() && !win.isMinimized()) win.hide(); else showWindow(); } },
    { label: en ? 'Start / pause' : 'התחל / השהה', click: () => send('hotkey', 'toggle') },
    { label: en ? 'Quick note' : 'פתק מהיר', click: quickNote },
    { label: en ? 'Confetti' : 'קונפטי', click: () => burstConfetti(true) },
    { label: en ? 'Throw a tomato' : 'זרוק עגבנייה', click: throwTomato },
    { type: 'separator' },
    { label: en ? 'Quit' : 'יציאה', click: () => { quitting = true; app.quit(); } }
  ]));
}

ipcMain.on('data:path', (e) => {
  e.returnValue = path.join(app.getPath('userData'), 'focus-timer-data.json');
});

// The tasks file lives in Documents/Focus Timer so it is easy to find and edit.
function tasksFilePath() {
  const dir = path.join(app.getPath('documents'), 'Focus Timer');
  try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {}
  return path.join(dir, 'tasks.md');
}
ipcMain.on('tasks:path', (e) => { e.returnValue = tasksFilePath(); });
ipcMain.handle('shell:openTasks', async () => {
  const p = tasksFilePath();
  try { if (!fs.existsSync(p)) fs.writeFileSync(p, ''); } catch (e) {}
  return shell.openPath(p);
});
ipcMain.handle('shell:openData', async () => shell.openPath(app.getPath('userData')));
// The weekly report opens a Gmail draft in the default browser. Only Gmail links are allowed.
ipcMain.handle('shell:openMail', async (e, url) => {
  if (typeof url !== 'string' || !url.startsWith('https://mail.google.com/mail/')) return false;
  await shell.openExternal(url);
  return true;
});

ipcMain.on('confetti:burst', (e, big) => burstConfetti(!!big));
ipcMain.on('rain:set', (e, mode) => setRain(mode));
ipcMain.on('shortcuts:status', (e) => { e.returnValue = { ok: shortcutState, keys, defaults: DEFAULT_KEYS }; });
ipcMain.handle('shortcuts:set', (e, name, accel) => setKey(String(name), accel ? String(accel) : ''));
ipcMain.handle('shortcuts:reset', () => {
  keys = Object.assign({}, DEFAULT_KEYS);
  saveKeys();
  registerAll();
  return true;
});
// While the user records new keys, the current shortcuts must not fire.
ipcMain.on('shortcuts:pause', (e, on) => {
  if (on) globalShortcut.unregisterAll(); else registerAll();
});
// The page has a question for you (were you working while idle?): bring the window
// forward; 'note:done' puts it back the way it was once answered.
ipcMain.on('window:forward', () => {
  if (!win) return;
  noteReturn = !win.isVisible() ? 'hide' : (win.isMinimized() || !win.isFocused()) ? 'minimize' : null;
  showWindow();
});
ipcMain.on('note:done', () => {
  if (win && noteReturn === 'minimize') win.minimize();
  else if (win && noteReturn === 'hide') win.hide();
  noteReturn = null;
});

ipcMain.handle('autostart:get', () => app.getLoginItemSettings().openAtLogin);
ipcMain.handle('autostart:set', (e, on) => {
  app.setLoginItemSettings({ openAtLogin: !!on });
  return app.getLoginItemSettings().openAtLogin;
});

// Save a CSV (opens in Excel). The user picks where; the default is Documents\Focus Timer.
ipcMain.handle('file:saveCsv', async (e, name, text) => {
  const dir = path.join(app.getPath('documents'), 'Focus Timer');
  try { fs.mkdirSync(dir, { recursive: true }); } catch (err) {}
  const safe = String(name || 'focus-timer.csv').replace(/[\\/:*?"<>|]/g, '_');
  const r = await dialog.showSaveDialog(win, { defaultPath: path.join(dir, safe), filters: [{ name: 'Excel (CSV)', extensions: ['csv'] }] });
  if (r.canceled || !r.filePath) return null;
  fs.writeFileSync(r.filePath, '﻿' + String(text || ''), 'utf8');
  shell.showItemInFolder(r.filePath);
  return r.filePath;
});

ipcMain.on('status:set', (e, st) => {
  if (st && typeof st === 'object') {
    status = st; applyStatus(); buildTrayMenu();
    if (st.mode === 'work' && st.running && st.watch) startWatcher(); else stopWatcherSoon();
  }
});
// A distraction squashed the round's tomato: throw one at the screen.
ipcMain.on('tomato:throw', () => throwTomato());
// A big message in the middle of every screen, over whatever you are doing.
ipcMain.on('effects:message', (e, m) => {
  if (!m || typeof m.text !== 'string') return;
  const msg = {
    text: m.text.slice(0, 120),
    sub: typeof m.sub === 'string' ? m.sub.slice(0, 200) : '',
    icon: ['wilt', 'splat', 'brk'].indexOf(m.icon) > -1 ? m.icon : '',
    ms: Math.min(15000, Math.max(2000, +m.ms || 6000))
  };
  ensureOverlays();
  toOverlays('message', msg);
  holdOverlays(msg.ms + 1500);
});

ipcMain.handle('float:set', (e, on) => {
  if (!win) return false;
  if (on && !floating) {
    normalBounds = win.getBounds();
    win.setContentSize(400, 500);
    win.setAlwaysOnTop(true, 'floating');
    floating = true;
  } else if (!on && floating) {
    win.setAlwaysOnTop(false);
    if (normalBounds) win.setBounds(normalBounds);
    floating = false;
  }
  return floating;
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);
  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => {
      cb(permission === 'notifications' || permission === 'clipboard-sanitized-write');
    });
    createWindow();
    createTray();
    loadKeys();
    registerAll();

    // Tell the page when you leave and come back. Timestamps are taken here, at the
    // moment of the event, so a page that was frozen by sleep can still credit it correctly.
    powerMonitor.on('lock-screen', () => send('presence', { type: 'lock', ts: Date.now() }));
    powerMonitor.on('unlock-screen', () => send('presence', { type: 'unlock', ts: Date.now() }));
    powerMonitor.on('suspend', () => send('presence', { type: 'suspend', ts: Date.now() }));
    powerMonitor.on('resume', () => send('presence', { type: 'resume', ts: Date.now() }));
    setInterval(() => {
      try { send('presence', { type: 'idle', idleSec: powerMonitor.getSystemIdleTime() }); } catch (e) {}
    }, 2000);

    app.on('activate', () => { if (!win) createWindow(); });
  });
  app.on('before-quit', () => { quitting = true; });
  app.on('will-quit', () => { globalShortcut.unregisterAll(); stopWatcher(); });
  app.on('window-all-closed', () => app.quit());
}

module.exports = { burstConfetti, setRain, throwTomato }; // used by the tests
