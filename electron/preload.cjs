const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  chromeVersion: process.versions.chrome,
  electronVersion: process.versions.electron,
  sendNavContext: (ctx) => {
    try {
      ipcRenderer.send('nav-context', ctx);
    } catch {
      /* ignore */
    }
  }
});
