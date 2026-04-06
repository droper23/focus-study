import { app, BrowserWindow, ipcMain, session } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { checkNavigation, getDefaultBlocked } from '../js/security.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');

let navCtx = {
  blocked: getDefaultBlocked(),
  allowed: [],
  whitelistMode: false,
  strictMode: false,
  strictDomains: []
};

function setupRequestBlocking() {
  const ses = session.fromPartition('persist:focus-browser');
  ses.webRequest.onBeforeRequest((details, callback) => {
    try {
      const u = new URL(details.url);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') {
        callback({ cancel: true });
        return;
      }
      const res = checkNavigation(u.hostname, navCtx);
      callback({ cancel: !res.allowed });
    } catch {
      callback({ cancel: true });
    }
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1120,
    height: 780,
    minWidth: 680,
    minHeight: 520,
    backgroundColor: '#080808',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
      sandbox: true
    }
  });

  win.loadFile(path.join(rootDir, 'index.html'));
}

ipcMain.on('nav-context', (_event, ctx) => {
  if (!ctx || typeof ctx !== 'object') return;
  navCtx = {
    blocked: Array.isArray(ctx.blocked) ? ctx.blocked : navCtx.blocked,
    allowed: Array.isArray(ctx.allowed) ? ctx.allowed : [],
    whitelistMode: !!ctx.whitelistMode,
    strictMode: !!ctx.strictMode,
    strictDomains: Array.isArray(ctx.strictDomains) ? ctx.strictDomains.slice(0, 3) : []
  };
});

app.whenReady().then(() => {
  setupRequestBlocking();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
