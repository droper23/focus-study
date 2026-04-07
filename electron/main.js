import { app, BrowserWindow, ipcMain, session } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { checkNavigation, getDefaultBlocked, searchProviderHostFromTemplate } from '../js/security.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');

let navCtx = {
  blocked: getDefaultBlocked(),
  allowed: [],
  whitelistMode: false,
  strictMode: false,
  strictDomains: [],
  searchProvider: searchProviderHostFromTemplate('https://duckduckgo.com/?q=%s')
};

/** Match stock Chrome UA so CDNs / WAFs do not return 403 for "Electron". */
function buildChromeUserAgent() {
  const v = process.versions.chrome || '131.0.0.0';
  let ua = '';
  if (process.platform === 'darwin') {
    ua = `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${v} Safari/537.36`;
  } else if (process.platform === 'win32') {
    ua = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${v} Safari/537.36`;
  } else {
    ua = `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${v} Safari/537.36`;
  }
  return ua + ' FocusStudy-Electron';
}

function setupFocusBrowserSession() {
  const ses = session.fromPartition('persist:focus-browser');
  const ua = buildChromeUserAgent();
  ses.setUserAgent(ua);

  ses.webRequest.onBeforeSendHeaders({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => {
    const headers = { ...details.requestHeaders };
    delete headers['User-Agent'];
    delete headers['user-agent'];
    headers['User-Agent'] = ua;
    callback({ requestHeaders: headers });
  });

  ses.webRequest.onBeforeRequest((details, callback) => {
    try {
      const u = new URL(details.url);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') {
        callback({ cancel: false });
        return;
      }
      const res = checkNavigation(u.hostname, navCtx);
      callback({ cancel: !res.allowed });
    } catch {
      callback({ cancel: false });
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
      sandbox: false
    }
  });

  // Ensure renderer UA includes FocusStudy-Electron so the app selects <webview>.
  win.webContents.setUserAgent(buildChromeUserAgent());
  win.loadFile(path.join(rootDir, 'index.html'));
}

ipcMain.on('nav-context', (_event, ctx) => {
  if (!ctx || typeof ctx !== 'object') return;
  const sp =
    typeof ctx.searchProvider === 'string' && ctx.searchProvider.trim()
      ? ctx.searchProvider.trim().toLowerCase()
      : navCtx.searchProvider;
  navCtx = {
    blocked: Array.isArray(ctx.blocked) ? ctx.blocked : navCtx.blocked,
    allowed: Array.isArray(ctx.allowed) ? ctx.allowed : [],
    whitelistMode: !!ctx.whitelistMode,
    strictMode: !!ctx.strictMode,
    strictDomains: Array.isArray(ctx.strictDomains) ? ctx.strictDomains.slice(0, 3) : [],
    searchProvider: sp
  };
});


app.whenReady().then(() => {
  setupFocusBrowserSession();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
