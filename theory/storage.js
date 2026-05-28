/* ChordPath — storage.js
 * URL-hash share state + localStorage named saves.
 * Encoding format: #k=C&s=major&p=C:maj,A:m7,F:maj7,G:7
 */
(function (global) {
  'use strict';

  const KEY = 'chordpath:saved';

  function encodeURL(state) {
    if (!state || !state.progression) return '';
    const parts = [
      'k=' + encodeURIComponent(state.key),
      's=' + encodeURIComponent(state.scale),
      'p=' + state.progression.map(c => `${c.root}:${c.quality}`).join(','),
    ];
    return '#' + parts.join('&');
  }

  function decodeURL(hash) {
    if (!hash || hash.length < 2) return null;
    const h = hash.replace(/^#/, '');
    const params = {};
    h.split('&').forEach(seg => {
      const [k, v] = seg.split('=');
      params[k] = decodeURIComponent(v || '');
    });
    if (!params.k || !params.s) return null;
    const progSpecs = (params.p || '').split(',').filter(Boolean);
    return { key: params.k, scale: params.s, progSpecs };
  }

  // localStorage CRUD
  function readAll() {
    try {
      return JSON.parse(localStorage.getItem(KEY) || '{}');
    } catch (e) { return {}; }
  }
  function writeAll(o) {
    try { localStorage.setItem(KEY, JSON.stringify(o)); } catch (e) {}
  }

  function listSaved() {
    const all = readAll();
    return Object.keys(all).map(name => ({ name, ...all[name] }));
  }

  function save(name, state) {
    if (!name) return false;
    const all = readAll();
    all[name] = {
      key: state.key,
      scale: state.scale,
      progSpecs: state.progression.map(c => `${c.root}:${c.quality}`),
      savedAt: new Date().toISOString(),
    };
    writeAll(all);
    return true;
  }

  function load(name) {
    const all = readAll();
    return all[name] || null;
  }

  function remove(name) {
    const all = readAll();
    delete all[name];
    writeAll(all);
  }

  global.Storage = { encodeURL, decodeURL, listSaved, save, load, remove };
})(typeof window !== 'undefined' ? window : globalThis);
