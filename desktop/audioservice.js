/* ChordPath — desktop/audioservice.js
 * The shell's side of the audio host: starts the host process when the
 * window asks for it, hands the two of them channels to talk over directly,
 * says so if the host dies, and keeps the list of installed plugins.
 *
 * The shell itself never touches audio or plugin code. The host
 * (audiohost.js) and the plugin scanner (pluginscan.js) are processes of
 * their own for exactly that reason.
 */
'use strict';

const { app, ipcMain, utilityProcess, MessageChannelMain, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const ADDON = (process.env.CHORDPATH_NATIVE || path.join(__dirname, '..', 'native', 'build', 'Release', 'chordpath_native.node'))
  .replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
const SCAN_FILE_MS = 20000;               // longest one plugin file may take to say what it holds
const CACHE_VERSION = 1;

let origin = '';
let host = null;                          // { child, ready: Promise, attached }
let scanning = null;                      // the scan under way, shared by everyone who asks meanwhile

function available() {
  try { return fs.statSync(ADDON).isFile(); } catch (e) { return false; }
}

function fromApp(event) {
  return !!(event.senderFrame && String(event.senderFrame.url).startsWith(origin + '/'));
}

// ── The host process ───────────────────────────────────────────────────────
function startHost() {
  if (host) return host;
  const child = utilityProcess.fork(path.join(__dirname, 'audiohost.js'), [], { serviceName: 'ChordPath audio', stdio: 'ignore' });
  const mine = { child, waiting: [], ready: null };
  mine.ready = new Promise((resolve, reject) => {
    child.on('message', message => {
      if (message && message.type === 'ready') resolve(message);
      if (message && message.type === 'attached') (mine.waiting.shift() || (() => {}))(message);
    });
    child.once('exit', code => {
      reject(new Error('The audio host stopped'));
      mine.waiting.splice(0).forEach(done => done({ ok: false, error: 'The audio host stopped' }));
      if (host === mine) host = null;
      BrowserWindow.getAllWindows().forEach(win => {
        if (!win.isDestroyed()) win.webContents.send('audio-gone', { code });
      });
    });
  });
  mine.ready.catch(() => { /* reported to whoever was waiting */ });
  host = mine;
  return mine;
}

function stopHost() {
  if (!host) return;
  const going = host;
  host = null;
  try { going.child.postMessage({ type: 'quit' }); } catch (e) { /* already gone */ }
  setTimeout(() => { try { going.child.kill(); } catch (e) { /* already gone */ } }, 1500);
}

// Connects a window to the host: each gets one end of a channel, and from
// then on they talk without the shell.
async function connect(event) {
  if (!available()) return { ok: false, error: 'This copy of ChordPath was built without its audio host' };
  const mine = startHost();
  let ready;
  try { ready = await mine.ready; } catch (e) { return { ok: false, error: e.message }; }
  if (!ready.ok) return { ok: false, error: ready.error || 'The audio host could not start' };
  const control = new MessageChannelMain();
  const attached = new Promise(resolve => mine.waiting.push(resolve));
  mine.child.postMessage({ type: 'attach' }, [control.port1]);
  const answer = await attached;
  if (!answer.ok) return { ok: false, error: answer.error || 'The audio host could not start' };
  event.sender.postMessage('audio-ports', null, [control.port2]);
  return { ok: true };
}

// ── The plugins on this computer ───────────────────────────────────────────
function cacheFile() { return path.join(app.getPath('userData'), 'plugins.json'); }

function readCache() {
  try {
    const cache = JSON.parse(fs.readFileSync(cacheFile(), 'utf8'));
    return cache && cache.version === CACHE_VERSION && cache.files && typeof cache.files === 'object' ? cache.files : {};
  } catch (e) { return {}; }
}

function stamp(file) {
  try {
    const s = fs.statSync(file);
    return { mtimeMs: Math.round(s.mtimeMs), size: s.isDirectory() ? 0 : s.size };
  } catch (e) { return null; }
}

// One scanner process works through `paths`. Resolves to what it learned and
// which file, if any, it died on.
function scanWith(paths, onResult) {
  return new Promise(resolve => {
    const child = utilityProcess.fork(path.join(__dirname, 'pluginscan.js'), [], { serviceName: 'ChordPath plugin scan', stdio: 'ignore' });
    let current = null, finished = false, timer = null;
    const watch = () => {
      clearTimeout(timer);
      timer = setTimeout(() => { try { child.kill(); } catch (e) { /* gone */ } }, SCAN_FILE_MS);
    };
    child.on('message', message => {
      if (!message) return;
      if (message.start) { current = message.start; watch(); }
      if (message.done) { onResult(message.done, { plugins: message.plugins }); current = null; }
      if (message.failed) { onResult(message.failed, { failed: String(message.error || 'It could not be read') }); current = null; }
      if (message.finished) finished = true;
    });
    child.once('exit', () => {
      clearTimeout(timer);
      resolve({ finished, diedOn: finished ? null : current });
    });
    child.once('spawn', () => { watch(); child.postMessage({ paths }); });
  });
}

function listInstalled() {
  return new Promise(resolve => {
    const child = utilityProcess.fork(path.join(__dirname, 'pluginscan.js'), [], { serviceName: 'ChordPath plugin scan', stdio: 'ignore' });
    let listed = [];
    child.on('message', message => {
      if (message && Array.isArray(message.listed)) { listed = message.listed; try { child.kill(); } catch (e) { /* gone */ } }
    });
    child.once('exit', () => resolve(listed));
    child.once('spawn', () => child.postMessage({ type: 'list' }));
    setTimeout(() => { try { child.kill(); } catch (e) { /* gone */ } }, SCAN_FILE_MS);
  });
}

function clean(plugin, file) {
  const word = (v, most) => (typeof v === 'string' ? v.slice(0, most) : '');
  return {
    path: file, uid: word(plugin.uid, 64), name: word(plugin.name, 120) || path.basename(file, '.vst3'),
    vendor: word(plugin.vendor, 120), version: word(plugin.version, 40), category: word(plugin.category, 120),
    instrument: plugin.instrument === true,
  };
}

async function scan(rescan) {
  const installed = await listInstalled();
  const cache = rescan ? {} : readCache();
  const files = {};
  const todo = [];
  installed.forEach(file => {
    const now = stamp(file);
    const known = cache[file];
    if (known && now && known.mtimeMs === now.mtimeMs && known.size === now.size) files[file] = known;
    else if (now) todo.push(file);
  });
  let left = todo.slice();
  // A file that kills the scanner is set aside and the scan picks up after it.
  for (let rounds = 0; left.length && rounds <= todo.length; rounds++) {
    const outcome = await scanWith(left, (file, result) => {
      const now = stamp(file) || { mtimeMs: 0, size: 0 };
      files[file] = result.failed
        ? { mtimeMs: now.mtimeMs, size: now.size, plugins: [], failed: result.failed }
        : { mtimeMs: now.mtimeMs, size: now.size, plugins: (Array.isArray(result.plugins) ? result.plugins : []).slice(0, 64).map(p => clean(p, file)) };
    });
    if (outcome.diedOn) {
      const now = stamp(outcome.diedOn) || { mtimeMs: 0, size: 0 };
      files[outcome.diedOn] = { mtimeMs: now.mtimeMs, size: now.size, plugins: [], failed: 'It crashed while being looked at' };
    }
    left = left.filter(file => !files[file]);
    if (outcome.finished || !outcome.diedOn) break;
  }
  try {
    fs.writeFileSync(cacheFile(), JSON.stringify({ version: CACHE_VERSION, files }));
  } catch (e) { /* it will simply be scanned again next time */ }
  const plugins = [], failed = [];
  Object.keys(files).sort().forEach(file => {
    if (files[file].failed) failed.push({ path: file, name: path.basename(file, '.vst3'), error: files[file].failed });
    files[file].plugins.forEach(p => plugins.push(p));
  });
  plugins.sort((a, b) => a.name.localeCompare(b.name));
  return { plugins, failed };
}

function plugins(rescan) {
  if (!available()) return Promise.resolve({ plugins: [], failed: [] });
  if (!scanning) {
    scanning = scan(rescan).finally(() => { scanning = null; });
  }
  return scanning;
}

// Plugin windows belong to another process, so nothing makes them stay above
// the app's window by itself: the host is told when the app is in front.
function watchFocus(win) {
  const tell = on => { if (host) { try { host.child.postMessage({ type: 'onTop', on }); } catch (e) { /* gone */ } } };
  win.on('focus', () => tell(true));
  win.on('blur', () => tell(false));
  win.on('minimize', () => tell(false));
}

function install(options) {
  origin = options.origin;
  ipcMain.handle('audio-info', event => (fromApp(event) ? { available: available() } : { available: false }));
  ipcMain.handle('audio-connect', event => (fromApp(event) ? connect(event) : { ok: false, error: 'Not allowed' }));
  ipcMain.handle('audio-plugins', (event, ask) => (fromApp(event) ? plugins(!!(ask && ask.rescan)) : { plugins: [], failed: [] }));
  app.on('before-quit', stopHost);
}

module.exports = { install, watchFocus, stopHost };
