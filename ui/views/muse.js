/* ChordPath — ui/views/muse.js
 * Muse, the app's own AI. Name a song and it either shows what it already
 * knows or asks you for the chords; then it asks how the song feels, stores
 * both, and drafts a new progression from what it has learned. The panel on
 * the right is its memory. Nothing here goes online.
 */
(function (global) {
  'use strict';

  const doc = global.document;
  const UI = () => global.UI;
  const M = () => global.Muse;
  const F = () => global.Feelings;
  const P = () => global.ChordParse;

  const KEYS = {
    major: ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'],
    minor: ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'G#', 'A', 'Bb', 'B'],
  };
  const BASIS = {
    memory: 'from songs you taught me',
    library: 'from my built-in library',
    theory: 'from music theory alone',
  };

  // thread: the conversation so far. step: what Muse is waiting for.
  let state = { thread: [], step: 'idle', mode: 'teach', song: null, draft: null };

  function root() { return doc.getElementById('museRoot'); }
  function say(html) { state.thread.push({ who: 'muse', html }); }
  function said(text) { state.thread.push({ who: 'you', text }); }
  function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }

  function greet() {
    const s = M().stats();
    say(s.taught
      ? `You've taught me ${plural(s.taught, 'song')}. Name another and I'll learn it — or describe a feeling and I'll draft something from what I know.`
      : `I'm Muse. I start with ${s.library} well-known songs and learn the rest from you. Name a song: if I don't know it I'll ask you for the chords, then for how it feels. After that I can draft progressions in the same spirit.`);
  }

  // ── Small render helpers ─────────────────────────────────────────────────
  function chordChips(chords, big) {
    const ui = UI();
    return `<span class="chord-chips${big ? ' big' : ''}">${chords.map((c, i) =>
      `<span class="cc${c.category === 'borrowed' ? ' borrowed' : ''}" data-i="${i}"><b>${ui.esc(c.shortName)}</b><i>${ui.esc(c.roman || '')}</i></span>`
    ).join('')}</span>`;
  }

  function sectionChords(entry, sec) {
    return entry.key ? P().realize(sec.degrees, entry.key, entry.scale || undefined)
      : sec.specs.map(sp => { const [r, q] = sp.split(':'); return P().toChord({ root: r, quality: q }); });
  }

  function keyLabel(entry) {
    if (!entry.key) return '';
    const meta = global.Scales.getScaleMeta(entry.scale);
    return entry.key + ' ' + (meta ? meta.name.replace(/\s*\(.*\)$/, '').toLowerCase() : entry.mode || '');
  }

  function feelingChips(feelings, n) {
    return Object.keys(feelings || {}).sort((a, b) => feelings[b] - feelings[a]).slice(0, n || 3)
      .map(id => UI().feelingChipHTML(id)).join('');
  }

  // ── Steps ────────────────────────────────────────────────────────────────
  function stepIdle() {
    const teach = state.mode === 'teach';
    return `
      <div class="seg" id="museMode">
        <button type="button" data-mode="teach"${teach ? ' class="active"' : ''}>Teach me a song</button>
        <button type="button" data-mode="ask"${teach ? '' : ' class="active"'}>Ask for a draft</button>
      </div>
      ${teach ? `
      <form id="museSongForm" class="muse-form">
        <input id="museTitle" type="text" maxlength="120" placeholder="Song title" aria-label="Song title" required />
        <input id="museArtist" type="text" maxlength="120" placeholder="Artist (optional)" aria-label="Artist" />
        <button type="submit" class="primary">Teach</button>
      </form>` : `
      <form id="museAskForm" class="muse-form col">
        <textarea id="museAsk" rows="3" maxlength="600" aria-label="Describe a feeling"
          placeholder="Describe the feeling you're after, in your own words…"></textarea>
        <div class="muse-row"><button type="submit" class="primary">Draft it</button></div>
      </form>`}`;
  }

  function stepChords() {
    const ui = UI();
    const s = state.song;
    const q = encodeURIComponent((s.title + ' ' + s.artist + ' chords').replace(/\s+/g, ' ').trim());
    return `
      <form id="museChordsForm" class="muse-form col">
        <textarea id="museChords" class="mono" rows="6" spellcheck="false" maxlength="6000" aria-label="Chords"
          placeholder="Am F C G">${ui.esc(s.chordsText)}</textarea>
        <p class="meta">Type the chords (<code>Am F C G</code>), use numerals (<code>i-bVI-bIII-bVII</code>), or paste a whole
          chord sheet — lyrics and all. I'll pick the chords out and keep <code>[Verse]</code> / <code>[Chorus]</code> labels.</p>
        <div class="muse-row">
          <button type="submit" class="primary">Continue</button>
          <button type="button" class="ghost" id="museNoChords">I don't know the chords</button>
          <button type="button" class="ghost" id="museCancel">Cancel</button>
          <a class="muse-link" href="https://www.google.com/search?q=${q}" target="_blank" rel="noopener noreferrer">Look them up in your browser ↗</a>
        </div>
      </form>`;
  }

  function stepCheckChords() {
    const ui = UI();
    const pv = state.song.preview;
    const names = KEYS[pv.mode] || KEYS.major;
    const options = (names.includes(pv.key) ? names : [pv.key].concat(names)).map(k =>
      `<option value="${ui.esc(k)}"${k === pv.key ? ' selected' : ''}>${ui.esc(k)}</option>`).join('');
    const rows = pv.sections.map(sec => `
      <div class="muse-sec"><span class="label">${ui.esc(sec.label)}</span>${chordChips(sectionChords(pv, sec))}</div>`).join('');
    return `
      <div class="muse-card">
        ${rows}
        <div class="muse-row">
          <span class="meta">I hear this in</span>
          <select id="museKey" aria-label="Key">${options}</select>
          <div class="seg" id="museKeyMode">
            <button type="button" data-m="major"${pv.mode === 'major' ? ' class="active"' : ''}>major</button>
            <button type="button" data-m="minor"${pv.mode === 'minor' ? ' class="active"' : ''}>minor</button>
          </div>
          ${state.song.numerals ? '<span class="meta">Numerals need a key — set the song\'s key here.</span>' : ''}
        </div>
        <div class="muse-row">
          <button type="button" class="primary" id="museChordsOk">That's right</button>
          <button type="button" class="ghost" id="museChordsEdit">Edit chords</button>
        </div>
      </div>`;
  }

  function stepFeel() {
    return `
      <form id="museFeelForm" class="muse-form col">
        <textarea id="museFeel" rows="3" maxlength="2000" aria-label="How it feels"
          placeholder="Bittersweet, like driving home at 3am…">${UI().esc(state.song.feelText)}</textarea>
        <div class="muse-row">
          <button type="submit" class="primary">Continue</button>
          <button type="button" class="ghost" id="museFeelBack">Back</button>
        </div>
      </form>`;
  }

  function stepCheckFeel() {
    const ui = UI();
    const s = state.song;
    const shown = s.heard.top.concat([...s.picked].filter(id => !s.heard.top.includes(id)));
    const chips = shown.map(id => {
      const f = F().getFeeling(id);
      return `<button type="button" class="chip toggle${s.picked.has(id) ? ' on' : ''}" data-feel="${ui.esc(id)}" title="${ui.esc(f.vibe)}">${ui.esc(f.name)}</button>`;
    }).join('');
    const groups = Object.entries(F().groupedFeelings()).map(([group, list]) =>
      `<optgroup label="${ui.esc(group)}">${list.filter(f => !shown.includes(f.id)).map(f =>
        `<option value="${f.id}">${ui.esc(f.name)}</option>`).join('')}</optgroup>`).join('');
    const unknown = s.heard.unknown.slice(0, 8);
    return `
      <div class="muse-card">
        <p>${shown.length ? 'Here\'s what I heard. Tap one to drop it, or add what I missed:'
          : 'I didn\'t catch a feeling word in that. Pick the closest ones and I\'ll learn your words from them:'}</p>
        <div class="chip-row">${chips}
          <select id="museAddFeel" aria-label="Add a feeling"><option value="">+ add a feeling</option>${groups}</select>
        </div>
        ${unknown.length ? `<p class="meta">New words to me: <em>${ui.esc(unknown.join(', '))}</em>. I'll learn what they mean from the songs you use them for.</p>` : ''}
        <div class="muse-row">
          <button type="button" class="primary" id="museSave"${!s.picked.size && !s.feelText.trim() ? ' disabled' : ''}>Save to memory</button>
          <button type="button" class="ghost" id="museFeelEdit">Edit description</button>
        </div>
      </div>`;
  }

  function stepDraft() {
    const ui = UI();
    const d = state.draft.res;
    const mine = d.influences.filter(i => !i.builtin).slice(0, 3);
    const lib = d.influences.filter(i => i.builtin).slice(0, 3 - Math.min(mine.length, 2));
    const names = mine.map(i => `<strong>${ui.esc(i.title)}</strong>`).concat(lib.map(i => ui.esc(i.title)));
    const moves = [];
    d.moves.forEach(m => {
      if (moves.length < 3 && !moves.some(x => x.title === m.title)) moves.push(m);
    });
    const why = d.basis === 'theory'
      ? 'I don\'t know any songs like that yet, so this one comes from music theory alone. Teach me a few and I\'ll have opinions.'
      : `Shaped mostly by ${names.join(', ')}.` + (moves.length
        ? ' Moves I borrowed: ' + moves.map(m => `${ui.esc(m.from)}→${ui.esc(m.to)} from “${ui.esc(m.title)}”`).join('; ') + '.'
        : '');
    const close = state.draft.req.closeness;
    return `
      <div class="muse-card draft-card">
        <div class="draft-head">
          <span class="label">Draft</span>
          <span class="chip">${ui.esc(keyLabel(d))}</span>
          <span class="chip">${ui.esc(BASIS[d.basis])}</span>
          ${feelingChips(d.feelings, 3)}
        </div>
        <div id="mdChords">${chordChips(d.chords, true)}</div>
        <div class="muse-row">
          <button type="button" class="primary" id="mdPlay">▶ Play</button>
          <button type="button" class="ghost" id="mdStop">Stop</button>
          <button type="button" class="ghost" id="mdAgain">↻ Another</button>
          <span class="meta">How close to the source:</span>
          <div class="seg" id="mdClose">
            ${['loose', 'near', 'close'].map(c =>
              `<button type="button" data-c="${c}"${c === close ? ' class="active"' : ''}>${c.charAt(0).toUpperCase() + c.slice(1)}</button>`).join('')}
          </div>
        </div>
        <p class="meta">${why}</p>
        <div class="muse-row">
          <button type="button" class="primary" id="mdSong">Make a full song from this</button>
          <button type="button" class="ghost" id="mdCopy">Copy chords</button>
          <button type="button" class="ghost" id="mdDone">Done</button>
        </div>
      </div>`;
  }

  // ── Memory panel ─────────────────────────────────────────────────────────
  function memoryPanel() {
    const ui = UI();
    const s = M().stats();
    const rows = M().all().map(e => `
      <div class="mem-row" data-id="${ui.esc(e.id)}">
        <div class="mem-title">${ui.esc(e.title)}${e.artist ? ` <span class="meta">— ${ui.esc(e.artist)}</span>` : ''}</div>
        <div class="mem-chords">${e.sections.length
          ? ui.esc(keyLabel(e)) + ' · ' + ui.esc(M().chordsText({ sections: e.sections.slice(0, 1) }))
          : '<span class="meta">no chords yet</span>'}</div>
        ${e.feelText ? `<div class="mem-feel">“${ui.esc(e.feelText.length > 110 ? e.feelText.slice(0, 110) + '…' : e.feelText)}”</div>` : ''}
        <div class="chip-row">${feelingChips(e.feelings, 3)}</div>
        <div class="mem-actions">
          <button type="button" class="ghost small" data-act="draft"${e.sections.length ? '' : ' disabled'}>Draft from it</button>
          <button type="button" class="ghost small" data-act="edit">Edit</button>
          <button type="button" class="ghost small danger" data-act="forget">Forget</button>
        </div>
      </div>`).join('');
    const words = M().vocabulary().filter(v => Object.keys(v.feelings).length).slice(0, 24).map(v => {
      const top = Object.keys(v.feelings).sort((a, b) => v.feelings[b] - v.feelings[a])[0];
      return `<span class="chip">${ui.esc(v.word)} → ${ui.esc(F().getFeeling(top).name.toLowerCase())}</span>`;
    }).join('');
    return `
      <h4>What I know</h4>
      <p class="meta">${plural(s.taught, 'song')} taught by you · ${s.library} built in · ${plural(s.words, 'word')} learned</p>
      <div class="mem-list">${rows || '<p class="meta">Nothing from you yet. Teach me a song you love and tell me how it feels.</p>'}</div>
      ${words ? `<h4>Your words</h4><div class="chip-row">${words}</div>` : ''}
      <div class="muse-row">
        <button type="button" class="ghost small" id="memExport"${s.taught ? '' : ' disabled'}>Export memory</button>
        <button type="button" class="ghost small" id="memImport">Import memory</button>
        <input id="memFile" type="file" accept=".json,application/json" hidden />
      </div>`;
  }

  // ── Render ───────────────────────────────────────────────────────────────
  const STEPS = {
    idle: stepIdle, chords: stepChords, checkChords: stepCheckChords,
    feel: stepFeel, checkFeel: stepCheckFeel, draft: stepDraft,
  };

  function render() {
    const ui = UI();
    const bubbles = state.thread.map(b => b.who === 'muse'
      ? `<div class="bubble from-muse">${b.html}</div>`
      : `<div class="bubble from-you">${ui.esc(b.text)}</div>`).join('');
    root().innerHTML = `
      <div class="muse">
        <header class="muse-head">
          <h3>Muse <span class="badge">Experimental</span></h3>
          <p class="meta">ChordPath's own AI. It lives inside this app, learns only from the songs you teach it, and never goes online.</p>
        </header>
        <div class="muse-grid">
          <section class="muse-talk">
            <div class="muse-thread" id="museThread">${bubbles}</div>
            <div class="muse-step" id="museStep">${STEPS[state.step]()}</div>
          </section>
          <aside class="muse-memory" id="museMemory">${memoryPanel()}</aside>
        </div>
      </div>`;
    wireStep();
    wireMemory();
    const step = doc.getElementById('museStep');
    if (step && step.scrollIntoView && state.thread.length > 1) step.scrollIntoView({ block: 'nearest' });
    const first = step && step.querySelector('input[type="text"], textarea');
    if (first) first.focus();
  }

  function on(id, event, fn) {
    const node = doc.getElementById(id);
    if (node) node.addEventListener(event, fn);
  }

  function stopAudio() {
    if (global.Audio && global.Audio.stop) { try { global.Audio.stop(); } catch (e) {} }
  }

  function toIdle() {
    stopAudio();
    state.step = 'idle';
    state.song = null;
    state.draft = null;
    render();
  }

  // ── Teaching ─────────────────────────────────────────────────────────────
  function beginTeach(title, artist) {
    const ui = UI();
    const known = M().knows(title, artist);
    const s = state.song = {
      id: null, title, artist, chordsText: '', startText: '', feelText: '',
      key: null, mode: null, extra: {}, preview: null, heard: null, picked: new Set(), numerals: false,
    };
    said(artist ? title + ' — ' + artist : title);
    if (known) {
      const e = known.entry;
      s.title = e.title;
      s.artist = e.artist || artist;
      s.chordsText = s.startText = M().chordsText(e);
      s.key = e.key || null;
      s.mode = e.mode || null;
      if (known.builtin) {
        s.extra = { tempo: e.tempo, genreId: e.genreId, year: e.year };
        say(`I know <strong>${ui.esc(e.title)}</strong>${e.artist ? ' by ' + ui.esc(e.artist) : ''} from my built-in library. These are the chords I have — fix anything that's off.`);
      } else {
        s.id = e.id;
        s.feelText = e.feelText;
        say(`I already know <strong>${ui.esc(e.title)}</strong> — you taught me. Change anything you like.`);
      }
    } else {
      say(`I don't know <strong>${ui.esc(title)}</strong> yet, and I never look anything up — I learn from you. What are the chords?`);
    }
    state.step = 'chords';
    render();
  }

  function readChords(text) {
    const s = state.song;
    const untouched = text.trim() === s.startText.trim();
    s.numerals = P().isRoman(text);
    // A key Muse already had only applies while the chords are unchanged.
    const hint = untouched || s.keyChosen ? { key: s.key, mode: s.mode } : {};
    const pv = M().preview(Object.assign({ chordsText: text }, hint));
    if (!pv.sections.length) return false;
    s.chordsText = text;
    s.preview = pv;
    s.source = untouched && !s.id && s.startText ? 'library' : 'user';
    return true;
  }

  function askFeel() {
    state.step = 'feel';
    say('What does it feel like to you? Use your own words — a place, a time of day, a memory, anything.');
    render();
  }

  function saveSong() {
    const s = state.song;
    const input = Object.assign({}, s.extra, {
      title: s.title, artist: s.artist, feelText: s.feelText, chordsText: s.chordsText,
      source: s.source || 'user',
    });
    if (s.preview) { input.key = s.preview.key; input.mode = s.preview.mode; }
    const heardSet = new Set(s.heard.top);
    const changed = s.picked.size !== heardSet.size || [...s.picked].some(id => !heardSet.has(id));
    if (changed && s.picked.size) {
      input.feelings = {};
      s.picked.forEach(id => { input.feelings[id] = 1; });
    }
    let entry;
    try {
      entry = s.id ? M().update(s.id, input) : M().teach(input);
    } catch (e) {
      UI().toast(e.message);
      return;
    }
    const n = M().stats().taught;
    state.song = null;
    if (entry.sections.length) {
      say(`Learned. That makes ${plural(n, 'song')} you've taught me. Here's a draft in its spirit:`);
      startDraft({ seedId: entry.id });
    } else {
      say(`Learned how it feels. That makes ${plural(n, 'song')} you've taught me. Give me the chords some time and I'll be able to draft from it.`);
      state.step = 'idle';
      render();
    }
  }

  // ── Drafting ─────────────────────────────────────────────────────────────
  function startDraft(req) {
    state.draft = { req: Object.assign({ closeness: 'near', seed: Date.now() & 0xffff }, req), res: null };
    state.draft.res = M().draft(state.draft.req);
    state.step = 'draft';
    render();
  }

  function redraft(patch) {
    stopAudio();
    Object.assign(state.draft.req, patch);
    state.draft.res = M().draft(state.draft.req);
    render();
  }

  function playDraft() {
    const d = state.draft.res;
    if (!global.Audio) return;
    global.Audio.playProgression(d.chords, {
      tempo: 96, style: 'strum', voicing: 'smart', withBass: true,
      onChordStart: i => {
        doc.querySelectorAll('#mdChords .cc').forEach((n, j) => n.classList.toggle('playing', j === i));
      },
      onDone: () => doc.querySelectorAll('#mdChords .cc').forEach(n => n.classList.remove('playing')),
    }).catch(() => UI().toast('Audio could not start'));
  }

  function makeSong() {
    stopAudio();
    const song = M().draftSong(Object.assign({}, state.draft.req, { verse: state.draft.res }));
    if (!global.Storage.saveProject(song)) { UI().toast('Could not save the song'); return; }
    UI().toast(`"${song.title}" created`);
    state.step = 'idle';
    state.draft = null;
    say(`I turned that draft into a full song: <strong>${UI().esc(song.title)}</strong>.`);
    global.Nav.go('overview', song.id);
  }

  // ── Wiring ───────────────────────────────────────────────────────────────
  function wireStep() {
    doc.querySelectorAll('#museMode [data-mode]').forEach(b =>
      b.addEventListener('click', () => { state.mode = b.dataset.mode; render(); }));

    on('museSongForm', 'submit', e => {
      e.preventDefault();
      const title = doc.getElementById('museTitle').value.trim();
      if (title) beginTeach(title, doc.getElementById('museArtist').value.trim());
    });
    on('museAskForm', 'submit', e => {
      e.preventDefault();
      const text = doc.getElementById('museAsk').value.trim();
      if (!text) return;
      said(text);
      say('Here\'s a draft for that:');
      startDraft({ text });
    });

    on('museChordsForm', 'submit', e => {
      e.preventDefault();
      const text = doc.getElementById('museChords').value;
      if (!readChords(text)) { UI().toast('I couldn\'t find any chords in that. Try it like: Am F C G'); return; }
      state.step = 'checkChords';
      render();
    });
    on('museNoChords', 'click', () => {
      state.song.chordsText = '';
      state.song.preview = null;
      say('No problem — I can still learn how it feels.');
      askFeel();
    });
    on('museCancel', 'click', () => { say('Okay, dropped it.'); toIdle(); });

    const rekey = () => {
      const s = state.song;
      s.keyChosen = true;
      s.key = doc.getElementById('museKey').value;
      const active = doc.querySelector('#museKeyMode button.active');
      s.mode = active ? active.dataset.m : s.preview.mode;
      readChords(s.chordsText);
      render();
    };
    on('museKey', 'change', rekey);
    doc.querySelectorAll('#museKeyMode [data-m]').forEach(b => b.addEventListener('click', () => {
      doc.querySelectorAll('#museKeyMode [data-m]').forEach(x => x.classList.toggle('active', x === b));
      rekey();
    }));
    on('museChordsOk', 'click', () => {
      const pv = state.song.preview;
      said(M().chordsText(pv));
      say(`Got them — ${UI().esc(keyLabel(pv))}.`);
      askFeel();
    });
    on('museChordsEdit', 'click', () => { state.step = 'chords'; render(); });

    on('museFeelForm', 'submit', e => {
      e.preventDefault();
      const s = state.song;
      s.feelText = doc.getElementById('museFeel').value.trim();
      s.heard = M().hear(s.feelText);
      s.picked = new Set(s.heard.top);
      if (s.feelText) said(s.feelText);
      state.step = 'checkFeel';
      render();
    });
    on('museFeelBack', 'click', () => { state.step = state.song.preview ? 'checkChords' : 'chords'; render(); });

    doc.querySelectorAll('#museStep [data-feel]').forEach(b => b.addEventListener('click', () => {
      const id = b.dataset.feel;
      if (state.song.picked.has(id)) state.song.picked.delete(id); else state.song.picked.add(id);
      render();
    }));
    on('museAddFeel', 'change', () => {
      const id = doc.getElementById('museAddFeel').value;
      if (id && F().getFeeling(id)) { state.song.picked.add(id); render(); }
    });
    on('museSave', 'click', saveSong);
    on('museFeelEdit', 'click', () => { state.step = 'feel'; render(); });

    on('mdPlay', 'click', playDraft);
    on('mdStop', 'click', () => {
      stopAudio();
      doc.querySelectorAll('#mdChords .cc').forEach(n => n.classList.remove('playing'));
    });
    on('mdAgain', 'click', () => redraft({ seed: (state.draft.req.seed * 31 + 7) & 0xffff }));
    doc.querySelectorAll('#mdClose [data-c]').forEach(b =>
      b.addEventListener('click', () => redraft({ closeness: b.dataset.c })));
    on('mdSong', 'click', makeSong);
    on('mdCopy', 'click', () => {
      const text = state.draft.res.chords.map(c => c.shortName).join(' ');
      const done = () => UI().toast('Chords copied');
      if (global.navigator && global.navigator.clipboard) {
        global.navigator.clipboard.writeText(text).then(done, () => UI().toast(text));
      } else UI().toast(text);
    });
    on('mdDone', 'click', toIdle);
  }

  function wireMemory() {
    doc.querySelectorAll('#museMemory .mem-row').forEach(row => {
      const id = row.dataset.id;
      row.addEventListener('click', e => {
        const act = e.target.dataset && e.target.dataset.act;
        const entry = M().get(id);
        if (!act || !entry) return;
        if (act === 'draft') {
          stopAudio();
          said('Draft something from ' + entry.title);
          say(`Here's a draft in the spirit of <strong>${UI().esc(entry.title)}</strong>:`);
          startDraft({ seedId: id });
        } else if (act === 'edit') {
          stopAudio();
          beginTeach(entry.title, entry.artist);
        } else if (act === 'forget') {
          UI().confirmBox(`Forget "${entry.title}"? Muse will no longer draw on it.`).then(ok => {
            if (!ok) return;
            M().forget(id);
            if (state.draft && state.draft.req.seedId === id) { state.step = 'idle'; state.draft = null; }
            render();
            UI().toast('Forgotten');
          });
        }
      });
    });

    on('memExport', 'click', () => {
      const blob = new Blob([M().exportJSON()], { type: 'application/json' });
      const a = doc.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'muse-memory.json';
      doc.body.appendChild(a);
      a.click();
      doc.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      UI().toast('Memory exported');
    });
    const file = doc.getElementById('memFile');
    on('memImport', 'click', () => file.click());
    if (file) file.addEventListener('change', () => {
      const f = file.files && file.files[0];
      if (!f) return;
      f.text().then(text => {
        const r = M().importJSON(text);
        UI().toast(r.errors.length && !r.added ? 'Import failed: ' + r.errors[0] : `Imported ${plural(r.added, 'song')}`);
        render();
      });
      file.value = '';
    });
  }

  function enter() {
    if (!state.thread.length) greet();
    render();
  }

  global.Views = global.Views || {};
  global.Views.Muse = { enter, render };
})(typeof window !== 'undefined' ? window : globalThis);
