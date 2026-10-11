/* ChordPath — desktop/main.js
 * The desktop application shell (Electron main process). It opens one window
 * and serves the app's own files to it over a private app:// address.
 *
 * ChordPath is fully self-contained, and this file enforces it: every request
 * to anything other than the app's own files is cancelled, and the page can
 * neither navigate away nor open windows. Links the user clicks on purpose
 * are handed to their normal web browser instead.
 */
'use strict';

const { app, BrowserWindow, Menu, protocol, session, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

const APP_ROOT = path.join(__dirname, '..');
const HOST = 'chordpath';
const ORIGIN = 'app://' + HOST;
const E2E = process.env.CHORDPATH_E2E === '1';

// What the window may load: the page itself and these folders, nothing else
// from the install directory (not node_modules, not this shell).
const SERVED_FILES = new Set(['index.html', 'style.css', 'app.js', 'audio.js']);
const SERVED_DIRS = ['theory', 'ui', 'daw', 'vendor'];
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8',
};
const LOCAL_SCHEMES = new Set(['app', 'devtools', 'blob', 'data']);

// Tests point the app at a throwaway data folder.
if (process.env.CHORDPATH_USER_DATA) app.setPath('userData', process.env.CHORDPATH_USER_DATA);

// Tests record from Chromium's built-in fake microphone instead of a real one.
if (E2E) {
  app.commandLine.appendSwitch('use-fake-device-for-media-stream');
  app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
}

// Play should make sound on the first press.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

function resolveAppFile(requestUrl) {
  let url;
  try { url = new URL(requestUrl); } catch (e) { return null; }
  if (url.host !== HOST) return null;
  let rel;
  try { rel = decodeURIComponent(url.pathname).replace(/^\/+/, ''); } catch (e) { return null; }
  if (!rel) rel = 'index.html';
  const file = path.normalize(path.join(APP_ROOT, rel));
  const inside = path.relative(APP_ROOT, file);
  if (!inside || inside.startsWith('..') || path.isAbsolute(inside)) return null;
  const parts = inside.split(path.sep);
  const allowed = parts.length === 1 ? SERVED_FILES.has(parts[0]) : SERVED_DIRS.includes(parts[0]);
  return allowed ? file : null;
}

function serveAppFiles() {
  protocol.handle('app', async request => {
    const file = resolveAppFile(request.url);
    if (!file) return new Response('Not found', { status: 404 });
    try {
      const body = await fs.promises.readFile(file);
      return new Response(body, {
        headers: {
          'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
          'cache-control': 'no-cache',
          'x-content-type-options': 'nosniff',
        },
      });
    } catch (e) {
      return new Response('Not found', { status: 404 });
    }
  });
}

// Nothing leaves this computer: anything that is not one of the app's own
// local addresses is cancelled before it starts.
function blockNetwork() {
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const scheme = details.url.slice(0, details.url.indexOf(':'));
    callback({ cancel: !LOCAL_SCHEMES.has(scheme) });
  });
  // Recording needs the microphone; nothing else is ever granted.
  const audioOnly = details => !details || !details.mediaTypes || details.mediaTypes.every(t => t === 'audio');
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback, details) => {
    callback(permission === 'media' && audioOnly(details));
  });
  session.defaultSession.setPermissionCheckHandler((wc, permission, origin) =>
    permission === 'media' && String(origin || '').startsWith(ORIGIN));
}

// A link the user clicked goes to their own browser, never into the app.
function openInBrowser(target) {
  let url;
  try { url = new URL(target); } catch (e) { return; }
  if (url.protocol === 'https:') shell.openExternal(url.toString());
}

function send(command) {
  const win = BrowserWindow.getAllWindows()[0];
  if (win) win.webContents.send('menu', command);
}

function buildMenu() {
  const template = [
    {
      label: '&File',
      submenu: [
        { label: 'New Song…', accelerator: 'CmdOrCtrl+N', click: () => send('new-song') },
        { label: 'Songs', accelerator: 'CmdOrCtrl+1', click: () => send('songs') },
        { label: 'Muse', accelerator: 'CmdOrCtrl+2', click: () => send('muse') },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    { label: '&Edit', submenu: [
      { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
      { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
    ] },
    { label: '&View', submenu: [
      { role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' },
      { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' },
      { role: 'togglefullscreen' },
    ] },
    { label: '&Help', submenu: [
      { label: 'Guides', click: () => send('guides') },
      { label: 'About ChordPath', click: () => dialog.showMessageBox({
        type: 'info', title: 'About ChordPath',
        message: 'ChordPath ' + app.getVersion(),
        detail: 'Feeling-driven song studio.\nRuns entirely on this computer: no accounts, no online services.',
      }) },
    ] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 980, minHeight: 620,
    title: 'ChordPath', backgroundColor: '#1a1916', show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
      spellcheck: false,
    },
  });
  if (E2E) win.webContents.setAudioMuted(true);
  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => { openInBrowser(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(ORIGIN + '/')) { event.preventDefault(); openInBrowser(url); }
  });
  win.loadURL(ORIGIN + '/index.html');
  return win;
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });
  app.whenReady().then(() => {
    serveAppFiles();
    blockNetwork();
    buildMenu();
    createWindow();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
