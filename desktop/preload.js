const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('studioHost', {
  isDesktop: true,
  launchEditor: (body) => ipcRenderer.invoke('host:launch-editor', body),
  setRect: (r) => ipcRenderer.send('host:rect', r),
  focusGame: () => ipcRenderer.send('host:focus-game'),
  closeGame: () => ipcRenderer.send('host:close-game'),
  status: () => ipcRenderer.invoke('host:status'),
  onGameState: (cb) => ipcRenderer.on('game-state', (_e, s) => cb(s)),
});
