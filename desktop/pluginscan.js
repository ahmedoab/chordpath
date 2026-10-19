/* ChordPath — desktop/pluginscan.js
 * Looks inside plugin files to see what each one holds. Opening a plugin
 * file runs code from it, and a broken one can crash whatever opened it, so
 * this is done in a throwaway process: if it dies, the shell knows which
 * file it was looking at, sets that one aside and carries on with the rest.
 *
 * It is sent { paths } and answers, in order, { start: path } then
 * { done: path, plugins } or { failed: path, error }, and at last
 * { finished: true }.
 */
'use strict';

const path = require('path');

const ADDON = (process.env.CHORDPATH_NATIVE || path.join(__dirname, '..', 'native', 'build', 'Release', 'chordpath_native.node'))
  .replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');

let native = null;
let loadError = '';
try { native = require(ADDON); } catch (e) { loadError = String((e && e.message) || e); }

const say = message => process.parentPort.postMessage(message);

process.parentPort.on('message', message => {
  const what = message.data || {};
  if (what.type === 'list') {
    say({ listed: native ? native.pluginPaths() : [], error: loadError });
    return;
  }
  const paths = Array.isArray(what.paths) ? what.paths : [];
  for (const file of paths) {
    say({ start: file });
    try {
      if (!native) throw new Error(loadError || 'The audio host is not available');
      say({ done: file, plugins: native.describePlugins(file) });
    } catch (e) {
      say({ failed: file, error: String((e && e.message) || e) });
    }
  }
  say({ finished: true });
  // Plugins leave threads of their own running; there is nothing more to do here.
  setTimeout(() => process.exit(0), 50);
});
