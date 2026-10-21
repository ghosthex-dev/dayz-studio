// DayZ Studio desktop shell: hosts the web editor and docks the real DayZ (Editor mod) window inside it.
const { app, BrowserWindow, ipcMain, screen, Menu, shell } = require('electron');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const wh = require('./winhost');
const updater = require('./updater');

const PORT = 8765;
// installed (setup.exe): Studio's files and a private Python ship in resources/, and everything Studio writes goes to
// %LOCALAPPDATA%\DayZStudio so updates never touch it. From a download / git clone: the folder next to desktop/.
const PACKED = app.isPackaged;
const ROOT = PACKED ? path.join(process.resourcesPath, 'studio') : path.join(__dirname, '..');
const PYTHON = PACKED ? path.join(process.resourcesPath, 'python', 'python.exe') : 'python';
const HOME = PACKED ? path.join(process.env.LOCALAPPDATA || app.getPath('userData'), 'DayZStudio') : null;
const ICON = path.join(__dirname, 'icon.ico');
// one settings folder (window state, the editor's local storage) whether started from setup.exe or a download
app.setPath('userData', path.join(app.getPath('appData'), 'dayz-studio-desktop'));
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

// ---------------------------------------------------------------- game window docking
const game = { pid: 0, hwnd: 0, rect: null, visible: false, docked: false, timer: null };

function notify(state, extra) {
  if (win && !win.isDestroyed()) win.webContents.send('game-state', Object.assign({ state }, extra || {}));
}

function applyRect() {
  if (!game.hwnd || !win || win.isDestroyed()) return;
  if (!wh.alive(game.hwnd)) return;
  const show = game.visible && game.rect && !win.isMinimized();
  if (!show) { wh.hide(game.hwnd); return; }
  const cb = win.getContentBounds();
  const r = game.rect;
  const sr = screen.dipToScreenRect(win, { x: Math.round(cb.x + r.x), y: Math.round(cb.y + r.y), width: Math.round(r.w), height: Math.round(r.h) });
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
      if (w && win) {
        game.hwnd = w.hwnd;
        wh.dock(game.hwnd, Number(win.getNativeWindowHandle().readBigUInt64LE(0)));
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
  game.docked = false;
  httpJson('POST', '/api/capture/stop', {}).catch(() => {});
}

// ---------------------------------------------------------------- window
async function createWindow() {
  Menu.setApplicationMenu(null);
  win = new BrowserWindow({
    width: 1600, height: 960, minWidth: 1100, minHeight: 700, backgroundColor: '#0b0d11', title: 'DayZ Studio', icon: ICON,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
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
  win.webContents.setWindowOpenHandler(({ url, frameName }) => {
    // a panel floated out of the docking workspace (js/dock.js): a plain window the page fills itself
    if (/^dzs-float-/.test(frameName || '') && (!url || url === 'about:blank')) {
      return { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true, backgroundColor: '#0b0d11', icon: ICON, minWidth: 260, minHeight: 200 } };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

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
