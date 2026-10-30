// DayZ Studio desktop shell: updates from GitHub Releases (electron-updater) - only in the installed app.
// Nothing downloads without the user saying so: check -> "available" -> download (on request) -> "ready" ->
// restart and install (or it installs when Studio is closed). DZSTUDIO_UPDATE_URL points it at another feed
// (a folder with latest.yml + the setup .exe) to try an update without a GitHub release.
const { app, ipcMain } = require('electron');

/** manual: an add-on's { mode: 'manual', note, url } (a build that is updated from elsewhere) - the
    public GitHub feed must not replace that build with the free one */
function setup(getWin, stopServer, manual) {
  // the installer starts Studio again with --updated after an update
  const state = { state: 'idle', version: app.getVersion(), updated: process.argv.includes('--updated') };
  if (manual && app.isPackaged) {
    Object.assign(state, { state: 'manual', note: manual.note || '', url: manual.url || '' });
    ['host:update-state', 'host:update-check', 'host:update-download', 'host:update-install'].forEach((ch) => ipcMain.handle(ch, () => state));
    return;
  }
  const send = (patch) => {
    Object.assign(state, patch);
    const win = getWin();
    if (win && !win.isDestroyed()) win.webContents.send('update-state', state);
  };
  if (!app.isPackaged) {
    state.state = 'unsupported';
    ipcMain.handle('host:update-state', () => state);
    ipcMain.handle('host:update-check', () => state);
    return;
  }
  const { autoUpdater } = require('electron-updater');
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  if (process.env.DZSTUDIO_UPDATE_URL) autoUpdater.setFeedURL({ provider: 'generic', url: process.env.DZSTUDIO_UPDATE_URL });

  // release notes come as HTML from GitHub: hand the page plain text only
  const plain = (n) => String(Array.isArray(n) ? n.map((x) => x.note).join('\n') : n || '')
    .replace(/<\/(p|li|h\d)>|<br\s*\/?>/gi, '\n').replace(/<li>/gi, '• ').replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n').trim();

  autoUpdater.on('checking-for-update', () => send({ state: 'checking', error: null }));
  autoUpdater.on('update-available', (i) => send({ state: 'available', latest: i.version, notes: plain(i.releaseNotes), date: i.releaseDate }));
  autoUpdater.on('update-not-available', (i) => send({ state: 'none', latest: i.version, checked: Date.now() }));
  autoUpdater.on('download-progress', (p) => send({ state: 'downloading', percent: p.percent, done: p.transferred, total: p.total }));
  autoUpdater.on('update-downloaded', (i) => send({ state: 'ready', latest: i.version }));
  autoUpdater.on('error', (e) => send({ state: 'error', error: String((e && e.message) || e).split('\n')[0] }));

  ipcMain.handle('host:update-state', () => state);
  ipcMain.handle('host:update-check', async () => {
    if (state.state === 'downloading' || state.state === 'ready') return state;
    try { await autoUpdater.checkForUpdates(); } catch (e) { /* reported through 'error' */ }
    return state;
  });
  ipcMain.handle('host:update-download', async () => {
    if (state.state !== 'available') return state;
    send({ state: 'downloading', percent: 0 });
    try { await autoUpdater.downloadUpdate(); } catch (e) { /* reported through 'error' */ }
    return state;
  });
  ipcMain.handle('host:update-install', async () => {
    if (state.state !== 'ready') return state;
    await stopServer();   // the bundled Python must not hold its files while the installer replaces them
    // write the editor's storage to disk now - the installer may end this process before it would on its own
    const win = getWin();
    if (win && !win.isDestroyed()) { try { await win.webContents.session.flushStorageData(); } catch (e) { /* ignore */ } }
    await new Promise((r) => setTimeout(r, 500));
    setImmediate(() => autoUpdater.quitAndInstall(true, true));   // silent, start Studio again afterwards
    return state;
  });
}

module.exports = { setup };
