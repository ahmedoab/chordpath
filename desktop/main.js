/* ChordPath — desktop/main.js
 * The desktop application shell (Electron main process). It opens one window
 * and serves the app's own files to it over a private app:// address.
 *
 * ChordPath is self-contained, and this file enforces it: every request the
 * page makes to anything other than the app's own files is cancelled, and
 * the page can neither navigate away nor open windows. Links the user clicks
 * on purpose are handed to their normal web browser instead.
 *
 * There is one way online, and it does not go through the page: when the
 * user asks Muse to look a song up, this shell asks Wikipedia on its behalf
 * (see lookup.js), over a session that can reach that one host and nothing
 * else, and hands back plain text.
 *
 * Sound cards and plugins are another process's business entirely: see
 * audioservice.js, which starts that process and introduces the window to it.
 */
'use strict';

const { app, BrowserWindow, Menu, protocol, session, shell, dialog, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const Lookup = require('./lookup');
const AudioService = require('./audioservice');

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

// Nothing the page asks for leaves this computer: anything that is not one of
// the app's own local addresses is cancelled before it starts.
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

// ── Saving exported files ───────────────────────────────────────────────────
// The page can only ever write audio, MIDI or JSON, under a plain file name,
// into a folder the user has just chosen.
const EXPORT_TYPES = new Set(['.wav', '.mid', '.json']);

function safeExportName(name) {
  const base = path.basename(String(name)).replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim().slice(0, 120);
  const ext = path.extname(base).toLowerCase();
  const stem = base.slice(0, base.length - ext.length);
  if (!EXPORT_TYPES.has(ext) || !stem || /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(stem)) return null;
  return base;
}

function handleExports() {
  ipcMain.handle('save-files', async (event, files) => {
    const sender = event.senderFrame ? String(event.senderFrame.url) : '';
    if (!sender.startsWith(ORIGIN + '/') || !Array.isArray(files) || !files.length || files.length > 64) return { saved: 0 };
    let folder = E2E ? process.env.CHORDPATH_DOWNLOADS : null;
    if (!folder) {
      const picked = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), {
        title: 'Choose a folder for the exported files',
        properties: ['openDirectory', 'createDirectory'],
      });
      if (picked.canceled || !picked.filePaths[0]) return { saved: 0 };
      folder = picked.filePaths[0];
    }
    let saved = 0;
    for (const file of files) {
      const name = file && safeExportName(file.name);
      if (!name || !(file.bytes instanceof Uint8Array)) continue;
      await fs.promises.writeFile(path.join(folder, name), file.bytes);
      saved++;
    }
    return { saved, folder };
  });
  // Tests save downloads straight into their own folder instead of asking.
  if (E2E && process.env.CHORDPATH_DOWNLOADS) {
    session.defaultSession.on('will-download', (event, item) => {
      item.setSavePath(path.join(process.env.CHORDPATH_DOWNLOADS, path.basename(item.getFilename())));
    });
  }
}

// ── Looking a song up ───────────────────────────────────────────────────────
// Muse's lookup has a session of its own: it keeps nothing between runs, it
// can reach Wikipedia and nowhere else, and it grants no permissions.
const LOOKUP_GAP_MS = 400;                // between requests: a well-behaved reader does not hammer
const LOOKUP_TIMEOUT_MS = 12000;
const LOOKUP_MAX_CHARS = 4 * 1024 * 1024;
let lastLookup = 0;

function lookupSession() {
  return session.fromPartition('lookup');   // no "persist:" prefix: held in memory only
}

function guardLookups() {
  const ses = lookupSession();
  ses.setUserAgent(`ChordPath/${app.getVersion()} (https://github.com/ahmedoab/chordpath)`);
  ses.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !Lookup.allowed(details.url) }));
  ses.setPermissionRequestHandler((wc, permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
}

async function fetchJson(url) {
  const stop = new AbortController();
  const timer = setTimeout(() => stop.abort(), LOOKUP_TIMEOUT_MS);
  try {
    const res = await lookupSession().fetch(url, { signal: stop.signal, credentials: 'omit', headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error('The lookup was answered with ' + res.status);
    const body = await res.text();
    if (body.length > LOOKUP_MAX_CHARS) throw new Error('The answer was too large');
    return JSON.parse(body);
  } finally {
    clearTimeout(timer);
  }
}

function handleLookups() {
  guardLookups();
  // ask: { kind: 'search' | 'page', words }. The address is built here, never by the page.
  ipcMain.handle('lookup', async (event, ask) => {
    const sender = event.senderFrame ? String(event.senderFrame.url) : '';
    if (!sender.startsWith(ORIGIN + '/') || !ask || typeof ask !== 'object') throw new Error('Not allowed');
    const url = Lookup.buildUrl(ask.kind, ask.words);
    if (!url || !Lookup.allowed(url)) throw new Error('Not allowed');
    // Tests answer from files of their own, so that they never go online.
    if (E2E && process.env.CHORDPATH_LOOKUP_FIXTURES) {
      const file = path.join(process.env.CHORDPATH_LOOKUP_FIXTURES, ask.kind + '.json');
      return Lookup.parse(ask.kind, JSON.parse(await fs.promises.readFile(file, 'utf8')));
    }
    const wait = lastLookup + LOOKUP_GAP_MS - Date.now();
    if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
    lastLookup = Date.now();
    return Lookup.parse(ask.kind, await fetchJson(url));
  });
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
        detail: 'Feeling-driven song studio.\nRuns on this computer, with no accounts and no services. ' +
          'The one time it goes online is when you ask Muse to look a song up on Wikipedia.',
      }) },
    ] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 980, minHeight: 620,
    title: 'ChordPath', backgroundColor: '#1a1916', show: false,
    icon: path.join(__dirname, 'icon.ico'),
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
  AudioService.watchFocus(win);
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
    handleExports();
    handleLookups();
    AudioService.install({ origin: ORIGIN });
    buildMenu();
    createWindow();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
