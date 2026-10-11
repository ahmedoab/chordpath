/* ChordPath — desktop/preload.js
 * The only bridge between the page and the desktop shell. The page gets a
 * small, fixed set of functions and no access to Node or Electron.
 */
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('Desktop', {
  isDesktop: true,
  platform: process.platform,
  // Menu commands ("new-song", "songs", "muse", "guides").
  onMenu(handler) {
    ipcRenderer.on('menu', (event, command) => handler(String(command)));
  },
  // Writes several exported files into one folder the user picks.
  // files: [{ name, bytes: Uint8Array }] resolves to { saved, folder }.
  saveFiles(files) {
    return ipcRenderer.invoke('save-files', files);
  },
  // Asks Wikipedia about a song, when the user tells Muse to. kind: 'search'
  // (resolves to [{ title, snippet }]) or 'page' ({ title, url, text } or
  // null). The page gives words, never an address.
  lookup(kind, words) {
    return ipcRenderer.invoke('lookup', { kind: String(kind), words: String(words) });
  },
});
