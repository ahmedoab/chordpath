/* ChordPath — storage.js
 * Project persistence: named song projects with autosave, immutable
 * snapshots, JSON export/import, and one-time migration of the legacy
 * single-progression saves.
 *
 * localStorage layout:
 *   chordpath:projects:index          [{id,title,genreId,feelingId,updatedAt,progress}]
 *   chordpath:project:<id>            full song JSON (the ONLY key autosave writes)
 *   chordpath:snapshots:index:<songId> [{snapId,name,takenAt}]
 *   chordpath:snapshot:<songId>:<snapId> {name, takenAt, song}   (never overwritten)
 *   chordpath:settings                {theme, lastSongId, singerRange, dawPanel}
 *   chordpath:saved                   legacy v1 saves — migrated once, kept as backup
 */
(function (global) {
  'use strict';

  const LEGACY_KEY = 'chordpath:saved';
  const INDEX_KEY = 'chordpath:projects:index';
  const SETTINGS_KEY = 'chordpath:settings';
  const MIGRATED_KEY = 'chordpath:migrated:v2';

  function store() {
    try { return global.localStorage; } catch (e) { return null; }
  }

  function readJSON(key, fallback) {
    const s = store();
    if (!s) return fallback;
    try {
      const raw = s.getItem(key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch (e) { return fallback; }
  }

  function writeJSON(key, value) {
    const s = store();
    if (!s) return false;
    try { s.setItem(key, JSON.stringify(value)); return true; }
    catch (e) {
      if (global.console) console.warn('ChordPath storage write failed:', e);
      return false;
    }
  }

  function removeKey(key) {
    const s = store();
    if (!s) return;
    try { s.removeItem(key); } catch (e) {}
  }

  // ── Projects ─────────────────────────────────────────────────────────────
  function readIndex() { return readJSON(INDEX_KEY, []); }
  function writeIndex(idx) { return writeJSON(INDEX_KEY, idx); }

  function indexEntry(song) {
    return {
      id: song.id,
      title: song.title,
      genreId: song.genreId,
      feelingId: song.feelingId,
      key: song.key,
      scale: song.scale,
      tempo: song.tempo,
      sectionCount: (song.sections || []).length,
      progress: song.progress || {},
      updatedAt: song.updatedAt,
      createdAt: song.createdAt,
    };
  }

  function listProjects() {
    return readIndex().slice().sort((a, b) =>
      String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  }

  function loadProject(id) {
    const raw = readJSON('chordpath:project:' + id, null);
    if (!raw) return null;
    return global.Song.migrate(raw);
  }

  function saveProject(song) {
    if (!song || !song.id) return false;
    const ok = writeJSON('chordpath:project:' + song.id, song);
    if (!ok) return false;
    const idx = readIndex().filter(e => e.id !== song.id);
    idx.push(indexEntry(song));
    writeIndex(idx);
    return true;
  }

  function deleteProject(id) {
    removeKey('chordpath:project:' + id);
    writeIndex(readIndex().filter(e => e.id !== id));
    // Remove this song's snapshots too.
    for (const snap of listSnapshots(id)) {
      removeKey('chordpath:snapshot:' + id + ':' + snap.snapId);
    }
    removeKey('chordpath:snapshots:index:' + id);
  }

  function duplicateProject(id) {
    const song = loadProject(id);
    if (!song) return null;
    song.id = global.Song.newId('song');
    song.title = song.title + ' (copy)';
    song.createdAt = new Date().toISOString();
    global.Song.touch(song);
    // Fresh section ids so the copy is fully independent.
    song.sections.forEach(sec => { sec.id = global.Song.newId('sec'); });
    saveProject(song);
    return song.id;
  }

  // ── Snapshots (immutable; autosave never touches these keys) ─────────────
  function snapIndexKey(songId) { return 'chordpath:snapshots:index:' + songId; }

  function listSnapshots(songId) {
    return readJSON(snapIndexKey(songId), []).slice().sort((a, b) =>
      String(b.takenAt || '').localeCompare(String(a.takenAt || '')));
  }

  function takeSnapshot(songId, name) {
    const song = loadProject(songId);
    if (!song) return null;
    const snapId = global.Song.newId('snap');
    const takenAt = new Date().toISOString();
    const label = name || ('Snapshot ' + new Date().toLocaleString());
    const ok = writeJSON('chordpath:snapshot:' + songId + ':' + snapId,
      { name: label, takenAt, song });
    if (!ok) return null;
    const idx = readJSON(snapIndexKey(songId), []);
    idx.push({ snapId, name: label, takenAt });
    writeJSON(snapIndexKey(songId), idx);
    return snapId;
  }

  function loadSnapshot(songId, snapId) {
    const raw = readJSON('chordpath:snapshot:' + songId + ':' + snapId, null);
    if (!raw || !raw.song) return null;
    return global.Song.migrate(raw.song);
  }

  // Restoring never overwrites current work: the snapshot becomes a NEW
  // project alongside the live one.
  function restoreSnapshot(songId, snapId) {
    const snapRaw = readJSON('chordpath:snapshot:' + songId + ':' + snapId, null);
    if (!snapRaw || !snapRaw.song) return null;
    const song = global.Song.migrate(snapRaw.song);
    song.id = global.Song.newId('song');
    song.title = song.title + ' — ' + (snapRaw.name || 'snapshot');
    song.sections.forEach(sec => { sec.id = global.Song.newId('sec'); });
    global.Song.touch(song);
    saveProject(song);
    return song.id;
  }

  function deleteSnapshot(songId, snapId) {
    removeKey('chordpath:snapshot:' + songId + ':' + snapId);
    writeJSON(snapIndexKey(songId),
      readJSON(snapIndexKey(songId), []).filter(s => s.snapId !== snapId));
  }

  // ── Settings ─────────────────────────────────────────────────────────────
  function getSettings() {
    return Object.assign(
      { theme: '', lastSongId: null, singerRange: { low: 'A2', high: 'E4' } },
      readJSON(SETTINGS_KEY, {}));
  }

  function setSettings(patch) {
    const merged = Object.assign(getSettings(), patch || {});
    writeJSON(SETTINGS_KEY, merged);
    return merged;
  }

  // ── JSON export / import ─────────────────────────────────────────────────
  function exportText(songId) {
    const song = loadProject(songId);
    if (!song) return null;
    return global.Song.serialize(song);
  }

  function importJSON(text) {
    const { song, errors } = global.Song.deserialize(text);
    if (!song) return { song: null, errors };
    // Fresh ids so an import never collides with an existing project.
    song.id = global.Song.newId('song');
    song.sections.forEach(sec => { sec.id = global.Song.newId('sec'); });
    global.Song.touch(song);
    saveProject(song);
    return { song, errors: [] };
  }

  // ── Legacy migration ─────────────────────────────────────────────────────
  // One-time: convert every old {name: flatState} save into a project.
  // The legacy key is left in place as a backup.
  function migrateLegacy() {
    const s = store();
    if (!s) return 0;
    try { if (s.getItem(MIGRATED_KEY)) return 0; } catch (e) { return 0; }
    const legacy = readJSON(LEGACY_KEY, null);
    let migrated = 0;
    if (legacy && typeof legacy === 'object') {
      for (const name of Object.keys(legacy)) {
        const flat = Object.assign({ name }, legacy[name]);
        const song = global.Song.migrate(flat);
        if (global.Song.validate(song).ok) {
          saveProject(song);
          migrated++;
        }
      }
    }
    try { s.setItem(MIGRATED_KEY, '1'); } catch (e) {}
    return migrated;
  }

  // Decode an old-format share hash (#k=C&s=major&p=C:maj,...) into a song
  // so ancient share links still open as an imported project.
  function decodeLegacyHash(hash) {
    if (!hash || hash.indexOf('k=') === -1 || hash.indexOf('p=') === -1) return null;
    const h = hash.replace(/^#/, '');
    const params = {};
    h.split('&').forEach(seg => {
      const eq = seg.indexOf('=');
      if (eq > 0) params[seg.slice(0, eq)] = decodeURIComponent(seg.slice(eq + 1) || '');
    });
    if (!params.k || !params.s) return null;
    const flat = {
      name: 'Shared sketch',
      key: params.k,
      scale: params.s,
      progSpecs: (params.p || '').split(',').filter(Boolean),
      focusStyle: params.fs || '',
      sectionRole: params.sec || '',
      rhythmPattern: params.rh || '',
      drumPattern: params.dr || '',
      vocalPattern: params.vo || '',
      underPattern: params.un || '',
      textureTone: params.tex || '',
      drumTone: params.dt || '',
      melodyTone: params.mt || '',
    };
    const song = global.Song.migrate(flat);
    return global.Song.validate(song).ok ? song : null;
  }

  global.Storage = {
    listProjects, loadProject, saveProject, deleteProject, duplicateProject,
    listSnapshots, takeSnapshot, loadSnapshot, restoreSnapshot, deleteSnapshot,
    getSettings, setSettings,
    exportText, importJSON,
    migrateLegacy, decodeLegacyHash,
  };
})(typeof window !== 'undefined' ? window : globalThis);
