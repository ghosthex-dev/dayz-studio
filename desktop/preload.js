const { contextBridge, ipcRenderer, webFrame } = require('electron');

contextBridge.exposeInMainWorld('studioHost', {
  isDesktop: true,
  launchEditor: (body) => ipcRenderer.invoke('host:launch-editor', body),
  setRect: (r) => ipcRenderer.send('host:rect', r),
  focusGame: () => ipcRenderer.send('host:focus-game'),
  closeGame: () => ipcRenderer.send('host:close-game'),
  status: () => ipcRenderer.invoke('host:status'),
  onGameState: (cb) => ipcRenderer.on('game-state', (_e, s) => cb(s)),
  // interface size (Workspace menu): real page zoom, so canvases and mouse positions stay in step
  setZoom: (f) => { const z = Math.min(2, Math.max(0.5, Number(f) || 1)); if (Math.abs(webFrame.getZoomFactor() - z) > 0.001) webFrame.setZoomFactor(z); ipcRenderer.send('host:zoom', z); },
  // floating windows (js/dock.js): where each window's page is on the screen, to drag tabs between them
  windowBounds: () => ipcRenderer.invoke('host:windows'),
  // updates from GitHub Releases (installed app only; state.state === 'unsupported' when run from the source)
  update: {
    state: () => ipcRenderer.invoke('host:update-state'),
    check: () => ipcRenderer.invoke('host:update-check'),
    download: () => ipcRenderer.invoke('host:update-download'),
    install: () => ipcRenderer.invoke('host:update-install'),
    onState: (cb) => ipcRenderer.on('update-state', (_e, s) => cb(s)),
  },
});
