const { app, BrowserWindow } = require('electron');
const path = require('path');
app.whenReady().then(() => {
  const win = new BrowserWindow({
    webPreferences: {
      preload: path.join(__dirname, 'electron', 'preload.cjs'),
      contextIsolation: true,
      sandbox: true
    }
  });
  win.webContents.on('console-message', (e, level, msg) => {
    console.log('Renderer console:', msg);
  });
  win.loadFile('index.html');
  setTimeout(() => app.quit(), 2000);
});
