/* ChordPath — app.js (bootstrap)
 * Shared state, mutate-and-autosave, editor preferences, theme, routing glue,
 * and global keyboard handling. All rendering lives in ui/views/*.
 */
(function () {
  'use strict';

  const St = window.Storage;
  const Song = window.Song;
  const UI = window.UI;
  const Nav = window.Nav;

  const App = {
    state: { songId: null, sectionId: null, song: null },
    prefs: Object.assign({
      instrument: 'piano',
      style: 'block',
      voicing: 'smart',
      viz: 'piano',
      pane: 'next',             // the section editor's left pane: 'next' (chords) or 'ideas'
      withBass: true,
      sevenths: false,
      loop: false,
      metronome: false,
      filters: {
        diatonic: true, borrowed: true, secondary: true, ttSub: false,
        dimPassing: false, neapolitan: true, chromatic: false, aug6: false,
      },
    }, (St.getSettings().editorPrefs || {})),
    mutate,
    savePrefs,
    flushSave,
  };
  window.App = App;

  // ── Autosave ─────────────────────────────────────────────────────────────
  let saveTimer = null;
  let dirty = false;

  function setSaveStatus(text, cls) {
    const el = document.getElementById('saveStatus');
    if (!el) return;
    el.textContent = text;
    el.className = 'save-status ' + (cls || '');
  }

  function mutate(fn, opts) {
    const song = App.state.song;
    if (!song) return;
    fn(song);
    Song.touch(song);
    dirty = true;
    setSaveStatus('●', 'dirty');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSave, 800);
    if (!(opts && opts.quiet)) {
      Nav.setSongOpen(song.id, song.title);
    }
  }

  function flushSave() {
    clearTimeout(saveTimer);
    if (!dirty || !App.state.song) return;
    const ok = St.saveProject(App.state.song);
    dirty = false;
    setSaveStatus(ok ? 'Saved' : 'Save failed!', ok ? 'saved' : 'error');
    if (!ok) UI.toast('Autosave failed — export your song as JSON to be safe');
  }

  function savePrefs() {
    St.setSettings({ editorPrefs: App.prefs });
  }

  window.addEventListener('beforeunload', flushSave);

  // ── Song loading per route ───────────────────────────────────────────────
  function ensureSong(songId) {
    if (App.state.song && App.state.songId === songId) return App.state.song;
    flushSave();
    const song = St.loadProject(songId);
    App.state.song = song;
    App.state.songId = song ? song.id : null;
    if (song) St.setSettings({ lastSongId: song.id });
    return song;
  }

  function onRoute(r) {
    // Leaving the editor stops audio so a section keeps playing nowhere.
    if (window.Audio && window.Audio.stop && r.view !== 'section') {
      try { window.Audio.stop(); } catch (e) {}
    }
    if (r.view !== 'daw' && window.Views.Daw) window.Views.Daw.leave();
    if (r.view === 'songs') {
      flushSave();
      Nav.setSongOpen(App.state.songId, App.state.song ? App.state.song.title : '');
      window.Views.Songs.render();
      return;
    }
    if (r.view === 'wizard') {
      window.Views.Wizard.enter();
      return;
    }
    if (r.view === 'muse') {
      flushSave();
      Nav.setSongOpen(App.state.songId, App.state.song ? App.state.song.title : '');
      window.Views.Muse.enter();
      return;
    }
    const song = ensureSong(r.songId);
    if (!song) {
      UI.toast('Song not found');
      Nav.go('songs');
      return;
    }
    Nav.setSongOpen(song.id, song.title);
    if (r.view === 'section') {
      let sectionId = r.sectionId;
      if (!Song.getSection(song, sectionId)) sectionId = (song.sections[0] || {}).id;
      App.state.sectionId = sectionId;
      window.Views.Section.enter();
    } else if (r.view === 'overview') {
      window.Views.Overview.enter();
    } else if (r.view === 'studio') {
      window.Views.Studio.enter();
    } else if (r.view === 'daw') {
      flushSave();
      window.Views.Daw.enter();
    } else if (r.view === 'handoff') {
      window.Views.Handoff.enter();
    }
  }

  // ── Theme ────────────────────────────────────────────────────────────────
  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    St.setSettings({ theme });
  }

  // ── Global keyboard ──────────────────────────────────────────────────────
  function isTyping() {
    const t = document.activeElement;
    return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
  }

  function handleKey(e) {
    if (e.key === 'Escape') {
      UI.closeModal();
      if (window.Audio) { try { window.Audio.stop(); } catch (err) {} }
      if (window.Views.Section.stopAudioHighlights) window.Views.Section.stopAudioHighlights();
      return;
    }
    if (isTyping()) return;
    if (document.getElementById('scrim').classList.contains('open')) return;
    if (e.key === '?' || (e.key === '/' && e.shiftKey)) {
      e.preventDefault();
      UI.openModal(window.Learn.renderShortcuts(Nav.route().view));
      return;
    }
    if (e.key.toLowerCase() === 't' && !e.metaKey && !e.ctrlKey) {
      const cur = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      applyTheme(cur);
      return;
    }
    const r = Nav.route();
    if (r.view === 'section') window.Views.Section.handleKey(e);
    else if (r.view === 'daw') window.Views.Daw.handleKey(e);
  }

  // ── Boot ─────────────────────────────────────────────────────────────────
  function init() {
    const settings = St.getSettings();
    applyTheme(settings.theme || 'dark');

    // One-time migration of old saves; old share links import as projects.
    const migrated = St.migrateLegacy();
    if (migrated > 0) UI.toast(`Imported ${migrated} old sketch${migrated > 1 ? 'es' : ''} into Songs`);

    const hash = window.location.hash || '';
    if (hash.includes('k=') && hash.includes('p=')) {
      const song = St.decodeLegacyHash(hash);
      if (song) {
        St.saveProject(song);
        UI.toast('Shared sketch imported as a song');
        window.location.hash = '#/song/' + song.id;
      }
    }

    document.getElementById('btnTheme').addEventListener('click', () => {
      applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
    });
    document.getElementById('btnGuides').addEventListener('click', () => {
      UI.openModal(window.Learn.renderPrimer());
    });
    document.getElementById('modalClose').addEventListener('click', UI.closeModal);
    document.getElementById('scrim').addEventListener('click', (e) => {
      if (e.target === document.getElementById('scrim')) UI.closeModal();
    });
    window.addEventListener('keydown', handleKey);

    // Browsers only allow audio after a user gesture; warm the context on the
    // first interaction so the first Play press never swallows the click.
    const warmAudio = () => { try { window.Tone && window.Tone.start(); } catch (e) {} };
    window.addEventListener('pointerdown', warmAudio, { once: true, capture: true });

    window.Views.Songs.wire();
    // The Section tab opens the last section worked on, or the first one.
    Nav.init(() => {
      const song = App.state.song;
      const known = song && Song.getSection(song, App.state.sectionId);
      return {
        songId: App.state.songId,
        sectionId: known ? known.id : (song && song.sections[0] ? song.sections[0].id : null),
      };
    });
    Nav.onRoute(onRoute);
    Nav.apply();

    // Desktop app: the window's menu bar drives the same navigation.
    if (window.Desktop && window.Desktop.onMenu) {
      window.Desktop.onMenu(command => {
        if (command === 'new-song') Nav.go('wizard');
        else if (command === 'songs') Nav.go('songs');
        else if (command === 'muse') Nav.go('muse');
        else if (command === 'guides') UI.openModal(window.Learn.renderPrimer());
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
