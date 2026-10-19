/* ChordPath — daw/store.js
 * Where DAW projects, recordings and plugin settings live: the app's own
 * local database (IndexedDB) on this computer. Projects are small JSON;
 * recordings are kept as raw samples so nothing is lost to compression; a
 * plugin's settings are kept as the bytes the plugin itself hands over.
 */
(function (global) {
  'use strict';

  const DB_NAME = 'chordpath-daw';
  const DB_VERSION = 2;              // 2 added the plugins store
  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = global.indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        const has = name => db.objectStoreNames.contains(name);
        if (!has('projects')) db.createObjectStore('projects', { keyPath: 'id' });
        if (!has('audio')) db.createObjectStore('audio', { keyPath: 'id' }).createIndex('projectId', 'projectId');
        if (!has('plugins')) db.createObjectStore('plugins', { keyPath: 'id' }).createIndex('projectId', 'projectId');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => { dbPromise = null; reject(req.error); };
    });
    return dbPromise;
  }

  // Runs one request and resolves with its result once the write is durable.
  function run(storeName, mode, action) {
    return open().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const req = action(tx.objectStore(storeName));
      let result;
      if (req) req.onsuccess = () => { result = req.result; };
      tx.oncomplete = () => resolve(result);
      tx.onerror = tx.onabort = () => reject(tx.error);
    }));
  }

  function saveProject(project) {
    return run('projects', 'readwrite', store =>
      store.put({ id: project.id, songId: project.songId, updatedAt: new Date().toISOString(), project }));
  }

  // Returns a clean project, or null when there is none for that id.
  function loadProject(id) {
    return run('projects', 'readonly', store => store.get(id))
      .then(row => (row && row.project ? global.DawProject.sanitize(row.project) : null));
  }

  function deleteProject(id) {
    return run('projects', 'readwrite', store => store.delete(id))
      .then(() => Promise.all([pruneAudio(id, []), prunePlugins(id, [])]));
  }

  // Deletes what a project keeps in one store except the entries in keepIds,
  // and resolves to how many went. Walks keys only, so nothing is loaded to do it.
  function prune(storeName, projectId, keepIds) {
    const keep = new Set(keepIds);
    return open().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const cursor = store.index('projectId').openKeyCursor(global.IDBKeyRange.only(projectId));
      let removed = 0;
      cursor.onsuccess = () => {
        const c = cursor.result;
        if (!c) return;
        if (!keep.has(c.primaryKey)) { store.delete(c.primaryKey); removed++; }
        c.continue();
      };
      tx.oncomplete = () => resolve(removed);
      tx.onerror = tx.onabort = () => reject(tx.error);
    }));
  }
  function pruneAudio(projectId, keepIds) { return prune('audio', projectId, keepIds); }
  function prunePlugins(projectId, keepIds) { return prune('plugins', projectId, keepIds); }

  // channels: Float32Array per channel at `sampleRate`.
  function putAudio(id, projectId, sampleRate, channels) {
    return run('audio', 'readwrite', store => store.put({ id, projectId, sampleRate, channels }));
  }

  function getAudio(id) {
    return run('audio', 'readonly', store => store.get(id)).then(row => {
      if (!row || !Array.isArray(row.channels) || !(row.sampleRate > 0)) return null;
      const channels = row.channels.filter(c => c instanceof Float32Array).slice(0, 2);
      return channels.length ? { sampleRate: row.sampleRate, channels } : null;
    });
  }

  // A plugin's settings, under the id the project knows the plugin by.
  // state: Uint8Array, as the plugin gave it.
  function putPluginState(id, projectId, state) {
    return run('plugins', 'readwrite', store => store.put({ id, projectId, state }));
  }

  // Resolves to the bytes, or null when nothing has been saved for it.
  function getPluginState(id) {
    return run('plugins', 'readonly', store => store.get(id))
      .then(row => (row && row.state instanceof Uint8Array && row.state.length ? row.state : null));
  }

  global.DawStore = {
    saveProject, loadProject, deleteProject,
    putAudio, getAudio, pruneAudio,
    putPluginState, getPluginState, prunePlugins,
  };
})(typeof window !== 'undefined' ? window : globalThis);
