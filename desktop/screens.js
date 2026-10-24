/* ChordPath — desktop/screens.js
 * Where a test run opens the window: on the laptop's own screen, never over
 * the work on the main one. The built-in display if there is one, else any
 * screen but the main one, else the only screen there is. No Electron in
 * here, so it can be tested without opening a window anywhere.
 */
'use strict';

// displays: Electron's screen.getAllDisplays(). Returns the window's { x, y }.
function testPlacement(displays, primaryId, width) {
  const all = Array.isArray(displays) ? displays : [];
  const chosen = all.find(d => d.internal) || all.find(d => d.id !== primaryId) || all[0];
  if (!chosen) return {};
  const area = chosen.workArea;
  return { x: area.x + Math.max(0, Math.round((area.width - width) / 2)), y: area.y };
}

module.exports = { testPlacement };
