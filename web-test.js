const { app, BrowserWindow } = require('electron');
const path = require('path');

app.whenReady().then(() => {
  const win = new BrowserWindow({
    webPreferences: {
      preload: path.join(__dirname, 'electron', 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      webviewTag: true
    }
  });

  win.loadFile('index.html');
  
  win.webContents.on('did-finish-load', async () => {
    try {
      const isElectron = await win.webContents.executeJavaScript('typeof window.electronAPI !== "undefined" && window.electronAPI.isElectron === true');
      console.log('--- IS ELECTRON ---\n' + isElectron);
      
      const useElectron = await win.webContents.executeJavaScript('els.useElectron');
      console.log('--- USE ELECTRON FLAG ---\n' + useElectron);
      
      app.quit();
    } catch (e) {
      console.error(e);
      app.quit();
    }
  });
});
