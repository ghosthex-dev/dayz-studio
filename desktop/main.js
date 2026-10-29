// DayZ Studio desktop shell: hosts the web editor and docks the real DayZ (Editor mod) window inside it.
const { app, BrowserWindow, ipcMain, screen, Menu, shell } = require('electron');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const wh = require('./winhost');
const updater = require('./updater');

// DZS_PORT / DZS_USER_DATA (developers): a second copy with its own studio server and settings, e.g. to test a source
// build next to the installed app without touching its layout and storage
const PORT = Number(process.env.DZS_PORT) || 8765;
// installed (setup.exe): Studio's files and a private Python ship in resources/, and everything Studio writes goes to
// %LOCALAPPDATA%\DayZStudio so updates never touch it. From a download / git clone: the folder next to desktop/.
const PACKED = app.isPackaged;
const ROOT = PACKED ? path.join(process.resourcesPath, 'studio') : path.join(__dirname, '..');
const PYTHON = PACKED ? path.join(process.resourcesPath, 'python', 'python.exe') : 'python';
const HOME = PACKED ? path.join(process.env.LOCALAPPDATA || app.getPath('userData'), 'DayZStudio') : null;
const ICON = path.join(__dirname, 'icon.ico');
// one settings folder (window state, the editor's local storage) whether started from setup.exe or a download
app.setPath('userData', process.env.DZS_USER_DATA || path.join(app.getPath('appData'), 'dayz-studio-desktop'));
let win = null;
let serverProc = null;

// ---------------------------------------------------------------- server
function httpJson(method, p, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({ host: '127.0.0.1', port: PORT, path: p, method, headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {} }, (res) => {
      let b = '';
      res.on('data', (c) => (b += c));
      res.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { reject(e); } });
    });
    req.on('error', reject);
    req.setTimeout(8000, () => req.destroy(new Error('timeout')));
    if (data) req.write(data);
    req.end();
  });
}

async function serverUp() {
  try { const r = await httpJson('GET', '/api/env'); return !!(r && r.ok); } catch (e) { return false; }
}

async function ensureServer() {
  if (await serverUp()) return true;
  const env = Object.assign({}, process.env, HOME ? { DZSTUDIO_HOME: HOME } : {});
  serverProc = spawn(PYTHON, [path.join(ROOT, 'tools', 'studio_server.py'), String(PORT)], { cwd: ROOT, env, windowsHide: true, stdio: 'ignore' });
  serverProc.on('error', () => {});
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 250));
    if (await serverUp()) return true;
  }
  return false;
}

// ---------------------------------------------------------------- floating windows (js/dock.js window.open)
// name ('dzs-float-<key>') -> BrowserWindow; the page drags tabs between windows by their screen position
const floats = new Map();
let zoom = 1;   // interface size (Workspace menu), for every window

/** {x, y, width, height} of a floating window from window.open's features - moved onto the main screen when
    no screen shows enough of it (a monitor that has been unplugged since) */
function floatRect(features) {
  const num = (k) => { const m = new RegExp('(?:^|,)\\s*' + k + '\\s*=\\s*(-?\\d+)').exec(features || ''); return m ? Number(m[1]) : null; };
  const r = { x: num('left'), y: num('top'), width: num('width') || 600, height: num('height') || 500 };
  if (r.x === null || r.y === null) return { width: r.width, height: r.height };
  const seen = screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    const w = Math.min(r.x + r.width, a.x + a.width) - Math.max(r.x, a.x), h = Math.min(r.y + r.height, a.y + a.height) - Math.max(r.y, a.y);
    return w >= 120 && h >= 80;
  });
  if (!seen) {
    const a = screen.getPrimaryDisplay().workArea;
    r.width = Math.min(r.width, a.width); r.height = Math.min(r.height, a.height);
    r.x = a.x + Math.round((a.width - r.width) / 2); r.y = a.y + Math.round((a.height - r.height) / 2);
  }
  return r;
}

/** the window a panel is in: '' = the main window, else a floating window's name */
function hostWindow(name) {
  const w = name ? floats.get(name) : win;
  return w && !w.isDestroyed() ? w : null;
}

// ---------------------------------------------------------------- game window docking
// game.host: the window the Game view is in ('' = main); DayZ is docked (owned + placed) over that window
const game = { pid: 0, hwnd: 0, rect: null, visible: false, docked: false, timer: null, host: '', owner: 0 };

function notify(state, extra) {
  if (win && !win.isDestroyed()) win.webContents.send('game-state', Object.assign({ state }, extra || {}));
}

function dockTo(w) {
  const h = Number(w.getNativeWindowHandle().readBigUInt64LE(0));
  if (game.owner === h) return;
  wh.dock(game.hwnd, h);
  game.owner = h;
}

function applyRect() {
  if (!game.hwnd) return;
  if (!wh.alive(game.hwnd)) return;
  const hw = hostWindow(game.host);
  const show = hw && game.visible && game.rect && !hw.isMinimized();
  if (!show) { wh.hide(game.hwnd); return; }
  dockTo(hw);   // the Game view moved to another window: DayZ follows it
  const cb = hw.getContentBounds();
  const r = game.rect, z = hw.webContents.getZoomFactor() || 1;   // the page's px are zoomed by the interface size
  const sr = screen.dipToScreenRect(hw, { x: Math.round(cb.x + r.x * z), y: Math.round(cb.y + r.y * z), width: Math.round(r.w * z), height: Math.round(r.h * z) });
  wh.placeScreen(game.hwnd, sr.x, sr.y, sr.width, sr.height, true);
}

function startDockLoop(pid) {
  game.pid = pid;
  game.hwnd = 0;
  game.docked = false;
  clearInterval(game.timer);
  let ticks = 0;
  notify('launching');
  game.timer = setInterval(() => {
    ticks++;
    let alive = true;
    try { alive = wh.windowsOfPid(pid).length > 0 || !game.hwnd; } catch (e) {}
    if (game.hwnd && !wh.alive(game.hwnd)) {
      game.hwnd = 0;
      game.docked = false;
      notify('closed');
    }
    if (!game.hwnd) {
      const w = wh.findGameWindow(pid);
      const hw = hostWindow(game.host) || win;
      if (w && hw) {
        game.hwnd = w.hwnd;
        game.owner = 0;
        dockTo(hw);
        game.docked = true;
        applyRect();
        notify('docked');
      } else if (ticks > 400) {
        clearInterval(game.timer);
        notify('closed', { reason: 'no window' });
      }
    } else if (ticks % 3 === 0) {
      applyRect(); // keep it glued even if DayZ resized itself
    }
  }, 600);
}

function stopGame() {
  clearInterval(game.timer);
  game.hwnd = 0;
  game.owner = 0;
  game.docked = false;
  httpJson('POST', '/api/capture/stop', {}).catch(() => {});
}

// ---------------------------------------------------------------- window
async function createWindow() {
  Menu.setApplicationMenu(null);
  win = new BrowserWindow({
    width: 1600, height: 960, minWidth: 1100, minHeight: 700, backgroundColor: '#0b0d11', title: 'DayZ Studio', icon: ICON,
    // backgroundThrottling off: with the main window minimized, panels in floating windows (e.g. on a second
    // monitor) run on this page's timers - they must not slow down to once a second
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  });
  win.once('ready-to-show', () => win.show());
  const ok = await ensureServer();
  if (!ok) {
    win.loadURL('data:text/html,' + encodeURIComponent('<body style="background:#0b0d11;color:#e4e7ec;font:15px system-ui;padding:40px"><h2>DayZ Studio</h2><p>Could not start the studio server (tools/studio_server.py). ' + (PACKED ? 'Reinstall DayZ Studio, or check that nothing else uses port ' + PORT + '.' : 'Make sure Python is installed and on PATH.') + '</p>'));
    return;
  }
  // never run stale scripts: the studio's own files change often
  try { await win.webContents.session.clearCache(); } catch (e) { /* ignore */ }
  win.loadURL(`http://127.0.0.1:${PORT}/index.html?host=desktop`);
  // Chromium writes localStorage to disk lazily; flush it often so a crash or a killed process loses nothing
  const ses = win.webContents.session;
  const flushTimer = setInterval(() => { try { ses.flushStorageData(); } catch (e) { /* ignore */ } }, 5000);
  win.on('close', () => { try { ses.flushStorageData(); } catch (e) { /* ignore */ } });
  win.on('closed', () => clearInterval(flushTimer));
  for (const ev of ['move', 'resize', 'maximize', 'unmaximize', 'restore', 'minimize', 'show']) win.on(ev, applyRect);
  // floating panels (window.open from js/dock.js) close with the main window - the layout remembers them
  win.on('closed', () => { stopGame(); win = null; BrowserWindow.getAllWindows().forEach((w) => { try { w.destroy(); } catch (e) { /* gone */ } }); });
  win.webContents.setWindowOpenHandler(({ url, frameName, features }) => {
    // a panel floated out of the docking workspace (js/dock.js): a plain window the page fills itself, made right
    // where the layout wants it (left/top/width/height of the features = the window's outer rectangle)
    if (/^dzs-float-/.test(frameName || '') && (!url || url === 'about:blank')) {
      return { action: 'allow', overrideBrowserWindowOptions: Object.assign({ autoHideMenuBar: true, backgroundColor: '#0b0d11', icon: ICON, minWidth: 260, minHeight: 200,
        webPreferences: { backgroundThrottling: false } }, floatRect(features)) };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('did-create-window', (child, details) => {
    const name = details.frameName || '';
    if (!/^dzs-float-/.test(name)) return;
    floats.set(name, child);
    try { child.webContents.setZoomFactor(zoom); } catch (e) { /* not ready */ }
    child.webContents.on('did-finish-load', () => { try { child.webContents.setZoomFactor(zoom); } catch (e) { /* gone */ } });
    // the game docked over this window follows it
    for (const ev of ['move', 'resize', 'maximize', 'unmaximize', 'restore', 'minimize', 'show']) child.on(ev, () => { if (game.host === name) applyRect(); });
    child.on('closed', () => { if (floats.get(name) === child) floats.delete(name); if (game.host === name) { game.host = ''; applyRect(); } });
  });
}

// where every window's page is on the screen (DIPs) and its zoom - js/dock.js drags tabs between windows with it
ipcMain.handle('host:windows', () => {
  const out = [];
  const add = (name, w) => {
    if (!w || w.isDestroyed() || w.isMinimized() || !w.isVisible()) return;
    const b = w.getContentBounds();
    out.push({ win: name, x: b.x, y: b.y, w: b.width, h: b.height, zoom: w.webContents.getZoomFactor() || 1 });
  };
  add('', win);
  floats.forEach((w, name) => add(name, w));
  return out;
});
// interface size: the main page sets its own zoom (preload), the floating windows get it here
ipcMain.on('host:zoom', (_e, z) => {
  zoom = Math.min(2, Math.max(0.5, Number(z) || 1));
  floats.forEach((w) => { try { if (!w.isDestroyed()) w.webContents.setZoomFactor(zoom); } catch (e) { /* gone */ } });
  applyRect();
});

ipcMain.handle('host:launch-editor', async (_e, body) => {
  try {
    const r = await httpJson('POST', '/api/editor/launch', body || {});
    if (r && r.ok && r.pid) startDockLoop(r.pid);
    return r;
  } catch (e) {
    return { ok: false, error: String(e) };
  }
});
ipcMain.on('host:rect', (_e, r) => {
  game.rect = r && r.w > 20 ? { x: r.x, y: r.y, w: r.w, h: r.h } : game.rect;
  game.visible = !!(r && r.visible);
  game.host = (r && typeof r.win === 'string' && floats.has(r.win)) ? r.win : '';   // the window the Game view is in
  applyRect();
});
ipcMain.on('host:focus-game', () => { if (game.hwnd) { try { wh.focusWindow(game.hwnd); } catch (e) {} } });
ipcMain.on('host:close-game', () => stopGame());
ipcMain.handle('host:status', () => ({ docked: game.docked, pid: game.pid }));

// stop the studio server we started (before an update replaces its files)
function stopServer() {
  return new Promise((resolve) => {
    if (!serverProc || serverProc.exitCode !== null) return resolve();
    const t = setTimeout(resolve, 5000);
    serverProc.once('exit', () => { clearTimeout(t); resolve(); });
    try { serverProc.kill(); } catch (e) { clearTimeout(t); resolve(); }
  });
}
updater.setup(() => win, stopServer);

// developer hook: with DZS_DEBUG=1, run JS from _eval.js inside the page and write _eval.out
// (in desktop/, or in DZS_DEBUG_DIR - the installed app's own folder is read-only)
if (process.env.DZS_DEBUG) {
  const fs = require('fs');
  const dir = process.env.DZS_DEBUG_DIR || __dirname;
  const f = path.join(dir, '_eval.js'), o = path.join(dir, '_eval.out');
  setInterval(async () => {
    if (!win || !fs.existsSync(f)) return;
    const code = fs.readFileSync(f, 'utf8');
    fs.unlinkSync(f);
    try { fs.writeFileSync(o, JSON.stringify(await win.webContents.executeJavaScript(code)) || 'undefined'); }
    catch (e) { fs.writeFileSync(o, 'ERROR ' + e); }
  }, 700);
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
else {
  app.whenReady().then(createWindow);
  app.on('window-all-closed', () => {
    stopGame();
    if (serverProc) { try { serverProc.kill(); } catch (e) {} }
    app.quit();
  });
}
