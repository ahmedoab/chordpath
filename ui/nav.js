/* ChordPath — ui/nav.js
 * Hash router + top navigation. Routes:
 *   #/songs                          project browser
 *   #/wizard                         new-song wizard
 *   #/song/<id>                      song overview
 *   #/song/<id>/section/<sectionId>  section editor
 *   #/song/<id>/studio               studio guide
 *   #/song/<id>/handoff              handoff pack
 * Old-format share hashes (#k=...&p=...) are detected at boot by app.js and
 * imported as projects before routing begins.
 */
(function (global) {
  'use strict';

  const doc = global.document;
  const VIEWS = ['songs', 'wizard', 'overview', 'section', 'studio', 'handoff'];
  const listeners = [];

  function route() {
    const h = (global.location.hash || '').replace(/^#\/?/, '');
    const parts = h.split('/').filter(Boolean);
    if (parts[0] === 'wizard') return { view: 'wizard' };
    if (parts[0] === 'song' && parts[1]) {
      const songId = parts[1];
      if (parts[2] === 'section' && parts[3]) return { view: 'section', songId, sectionId: parts[3] };
      if (parts[2] === 'studio') return { view: 'studio', songId };
      if (parts[2] === 'handoff') return { view: 'handoff', songId };
      return { view: 'overview', songId };
    }
    return { view: 'songs' };
  }

  function go(view, songId, sectionId) {
    let hash = '#/songs';
    if (view === 'wizard') hash = '#/wizard';
    else if (view === 'overview' && songId) hash = '#/song/' + songId;
    else if (view === 'section' && songId && sectionId) hash = '#/song/' + songId + '/section/' + sectionId;
    else if (view === 'studio' && songId) hash = '#/song/' + songId + '/studio';
    else if (view === 'handoff' && songId) hash = '#/song/' + songId + '/handoff';
    if (global.location.hash === hash) apply();  // re-render same route
    else global.location.hash = hash;
  }

  function onRoute(fn) { listeners.push(fn); }

  function apply() {
    const r = route();
    VIEWS.forEach(v => {
      const elView = doc.getElementById('view-' + v);
      if (elView) elView.hidden = v !== r.view;
    });
    doc.querySelectorAll('#navTabs [data-nav]').forEach(btn => {
      const nav = btn.dataset.nav;
      const active = nav === r.view || (nav === 'songs' && r.view === 'wizard');
      btn.classList.toggle('active', active);
    });
    listeners.forEach(fn => { try { fn(r); } catch (e) { console.error('route handler failed:', e); } });
  }

  // A song is open → enable the song-scoped nav tabs.
  function setSongOpen(songId, title) {
    doc.querySelectorAll('#navTabs [data-nav]').forEach(btn => {
      const nav = btn.dataset.nav;
      if (nav !== 'songs') btn.disabled = !songId;
    });
    const titleEl = doc.getElementById('navSongTitle');
    if (titleEl) titleEl.textContent = title || '';
  }

  function init(getSongContext) {
    doc.querySelectorAll('#navTabs [data-nav]').forEach(btn => {
      btn.addEventListener('click', () => {
        const nav = btn.dataset.nav;
        const ctx = getSongContext ? getSongContext() : {};
        if (nav === 'songs') go('songs');
        else if (ctx.songId) go(nav, ctx.songId, ctx.sectionId);
      });
    });
    global.addEventListener('hashchange', apply);
  }

  global.Nav = { route, go, onRoute, apply, init, setSongOpen };
})(typeof window !== 'undefined' ? window : globalThis);
