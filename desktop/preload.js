const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('studioHost', {
  isDesktop: true,
  launchEditor: (body) => ipcRenderer.invoke('host:launch-editor', body),
  setRect: (r) => ipcRenderer.send('host:rect', r),
  focusGame: () => ipcRenderer.send('host:focus-game'),
  closeGame: () => ipcRenderer.send('host:close-game'),
  status: () => ipcRenderer.invoke('host:status'),
  onGameState: (cb) => ipcRenderer.on('game-state', (_e, s) => cb(s)),
  // updates from GitHub Releases (installed app only; state.state === 'unsupported' when run from the source)
  update: {
    state: () => ipcRenderer.invoke('host:update-state'),
    check: () => ipcRenderer.invoke('host:update-check'),
    download: () => ipcRenderer.invoke('host:update-download'),
    install: () => ipcRenderer.invoke('host:update-install'),
    onState: (cb) => ipcRenderer.on('update-state', (_e, s) => cb(s)),
  },
});
