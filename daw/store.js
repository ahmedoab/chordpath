/* ChordPath — daw/store.js
 * Where DAW projects and recordings live: the app's own local database
 * (IndexedDB) on this computer. Projects are small JSON; recordings are kept
 * as raw samples so nothing is lost to compression.
 */
(function (global) {
  'use strict';

  const DB_NAME = 'chordpath-daw';
  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = global.indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        db.createObjectStore('projects', { keyPath: 'id' });
        db.createObjectStore('audio', { keyPath: 'id' }).createIndex('projectId', 'projectId');
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
      .then(() => open())
      .then(db => new Promise((resolve, reject) => {
        const tx = db.transaction('audio', 'readwrite');
        const cursor = tx.objectStore('audio').index('projectId').openCursor(global.IDBKeyRange.only(id));
        cursor.onsuccess = () => {
          const c = cursor.result;
          if (c) { c.delete(); c.continue(); }
        };
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      }));
  }

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

  global.DawStore = { saveProject, loadProject, deleteProject, putAudio, getAudio };
})(typeof window !== 'undefined' ? window : globalThis);
