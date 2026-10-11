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
});
