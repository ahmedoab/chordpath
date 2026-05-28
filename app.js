/* ChordPath — app.js (masterpiece edition)
 * State, rendering, event wiring, piano + guitar visualizers,
 * keyboard shortcuts, quiz mode, theme toggle, drag-to-reorder,
 * MIDI export, share link, learn modal.
 */
(function () {
  'use strict';

  const S = window.Scales;
  const C = window.Chords;
  const V = window.Voicings;
  const P = window.Progressions;
  const A = window.Analysis;
  const G = window.Genres;
  const E = window.Emotions;
  const D = window.Descriptions;
  const Sg = window.Songs;
  const M = window.Melody;
  const St = window.Storage;
  const Md = window.Midi;
  const Lr = window.Learn;
  const Au = window.Audio;

  const state = {
    key: 'C',
    keyMode: 'major',           // major | minor — only affects key-grid display, not scale
    scale: 'major',
    progression: [],
    tempo: 92,
    instrument: 'piano',
    style: 'block',
    voicing: 'smart',
    withBass: true,
    sevenths: false,
    loop: false,
    emotion: '',
    metronome: false,
    countIn: false,
    swing: 0,
    viz: 'piano',
    theme: 'dark',
    filters: {
      diatonic:true, borrowed:true, secondary:true, ttSub:false,
      dimPassing:false, neapolitan:true, chromatic:false, aug6:false,
    },
    quiz: { active:false, score:0, total:0, current:null },
  };

  const $ = (id) => document.getElementById(id);
  const els = {};
  ['keyGrid','scaleSelect','scaleMeta','progression','options',
   'description','genrePrimary','genreInfluences','rhythmTime','rhythmTip',
   'modulation','cadenceBanner','tensionChart','songList','vizPiano','vizGuitar','pianoKeys','fretGrid',
   'chordShape','chordShapeName',
   'btnPlay','btnPlayBand','btnPlayMelody','btnStop','btnUndo','btnReset',
   'tempo','tempoVal','instrument','style','voicing','withBass','withSevenths','loop','metronome',
   'emotionSelect','btnPickEmotion','emotionMeta',
   'loadSelect','saveName','btnSave','btnDelete','btnShare','btnExportMidi',
   'btnShortcuts','btnQuiz','btnLearn','btnTheme','btnPresets','keyModeToggle',
   'scrim','modal','modalContent','modalClose','toast','descriptionCard']
   .forEach(id => els[id] = $(id));

  // ─── Build static UI ─────────────────────────────────────────────────────
  function buildKeyGrid() {
    const sharpKeys = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
    const flatKeys  = ['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'];
    const disp = { 'C#':'C♯','D#':'D♯','F#':'F♯','G#':'G♯','A#':'A♯',
                   'Db':'D♭','Eb':'E♭','Gb':'G♭','Ab':'A♭','Bb':'B♭' };
    els.keyGrid.innerHTML = '';
    const keys = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
    keys.forEach(k => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = disp[k] || k;
      b.dataset.key = k;
      b.addEventListener('click', () => {
        state.key = k;
        // If keyMode is minor, jump to natural_minor; if major, jump to major
        // (preserve other scales when user has switched away)
        if (state.scale === 'major' || state.scale === 'natural_minor') {
          state.scale = state.keyMode === 'minor' ? 'natural_minor' : 'major';
        }
        els.scaleSelect.value = state.scale;
        state.progression = [];
        renderAll(); persistURL();
      });
      els.keyGrid.appendChild(b);
    });
  }

  function buildScaleSelect() {
    els.scaleSelect.innerHTML = '';
    S.SCALE_GROUPS.forEach(group => {
      const og = document.createElement('optgroup');
      og.label = group.label;
      group.ids.forEach(id => {
        const meta = S.getScaleMeta(id);
        if (!meta) return;
        const o = document.createElement('option');
        o.value = id; o.textContent = meta.name;
        og.appendChild(o);
      });
      els.scaleSelect.appendChild(og);
    });
    els.scaleSelect.value = state.scale;
  }

  function buildEmotionSelect() {
    els.emotionSelect.innerHTML = '<option value="">— any —</option>';
    const grouped = E.groupedEmotions();
    Object.entries(grouped).forEach(([group, list]) => {
      const og = document.createElement('optgroup');
      og.label = group;
      list.forEach(em => {
        const o = document.createElement('option');
        o.value = em.id; o.textContent = em.label;
        og.appendChild(o);
      });
      els.emotionSelect.appendChild(og);
    });
  }

  function refreshLoadSelect() {
    const saved = St.listSaved();
    els.loadSelect.innerHTML = '<option value="">— pick to load —</option>';
    saved.forEach(s => {
      const o = document.createElement('option');
      o.value = s.name; o.textContent = `${s.name} (${s.key} ${s.scale})`;
      els.loadSelect.appendChild(o);
    });
  }

  // ─── Piano viz ───────────────────────────────────────────────────────────
  const PIANO_PCS = [0,1,2,3,4,5,6,7,8,9,10,11]; // C..B
  const WHITE_PCS = [0,2,4,5,7,9,11];
  const BLACK_OFFSETS = { 1:0.65, 3:1.65, 6:3.65, 8:4.65, 10:5.65 }; // relative to leftmost white slot

  function buildPiano() {
    // Three octaves of whites + interspersed blacks, range C3..B5 visually
    const startOct = 3, endOct = 5;
    const whiteList = [];
    for (let o = startOct; o <= endOct; o++) {
      WHITE_PCS.forEach(pc => whiteList.push({ pc, oct: o }));
    }
    els.pianoKeys.innerHTML = '';
    // White keys laid out as flex items
    whiteList.forEach(({ pc, oct }, idx) => {
      const k = document.createElement('div');
      k.className = 'piano-key white';
      k.dataset.pc = pc; k.dataset.oct = oct;
      const noteName = ['C','D','E','F','G','A','B'][[0,2,4,5,7,9,11].indexOf(pc)];
      k.innerHTML = `<span class="name">${noteName}${oct}</span>`;
      k.addEventListener('click', () => {
        Au.previewNote(noteName + oct).catch(()=>{});
        k.classList.add('preview');
        setTimeout(() => k.classList.remove('preview'), 400);
      });
      els.pianoKeys.appendChild(k);
    });
    // Black keys positioned absolutely. There are 7 whites per octave; 5 blacks.
    // Width of each white = 100 / totalWhites (%)
    const totalWhites = whiteList.length;
    const whiteWidthPct = 100 / totalWhites;
    let whiteIdx = 0;
    for (let o = startOct; o <= endOct; o++) {
      WHITE_PCS.forEach((pc, j) => {
        // After C, D, F, G, A → there's a black above
        const nextHasBlack = [0,2,5,7,9].includes(pc); // C D F G A → C# D# F# G# A#
        if (nextHasBlack) {
          const blackPc = pc + 1;
          const b = document.createElement('div');
          b.className = 'piano-key black';
          b.dataset.pc = blackPc; b.dataset.oct = o;
          // Position: just right of this white key's center
          const left = (whiteIdx + 1) * whiteWidthPct - whiteWidthPct * 0.28;
          b.style.left = left + '%';
          b.addEventListener('click', (e) => {
            e.stopPropagation();
            const flat = state.key && (S.FLAT_KEYS.has(state.key) || state.key.includes('b'));
            const name = S.noteName(blackPc, flat);
            Au.previewNote(name + o).catch(()=>{});
            b.classList.add('preview');
            setTimeout(() => b.classList.remove('preview'), 400);
          });
          els.pianoKeys.appendChild(b);
        }
        whiteIdx++;
      });
    }
  }

  function renderPiano() {
    if (!els.pianoKeys) return;
    // Clear active classes
    [...els.pianoKeys.children].forEach(k => {
      k.classList.remove('active', 'root');
    });
    const last = state.progression[state.progression.length - 1];
    if (!last) return;
    const rootPc = last.rootPc;
    const chordPcs = new Set(last.intervals.map(iv => (last.rootPc + iv) % 12));
    [...els.pianoKeys.children].forEach(k => {
      const pc = parseInt(k.dataset.pc, 10);
      if (chordPcs.has(pc)) k.classList.add('active');
      if (pc === rootPc) k.classList.add('root');
    });
  }

  // ─── Guitar viz ──────────────────────────────────────────────────────────
  const GUITAR_TUNING = [4,11,7,2,9,4]; // High E, B, G, D, A, E (top → bottom)
  const FRET_COUNT = 12;

  function buildFretboard() {
    els.fretGrid.innerHTML = '';
    // Row per string: 1 label cell + 13 fret cells (fret 0 + 12 frets)
    for (let s = 0; s < 6; s++) {
      // String label
      const lbl = document.createElement('div');
      lbl.className = 'fret-cell open-label';
      const openMidi = GUITAR_TUNING[s] + (s === 0 ? 64 : s === 1 ? 59 : s === 2 ? 55 : s === 3 ? 50 : s === 4 ? 45 : 40);
      const openName = S.noteName(GUITAR_TUNING[s], false);
      lbl.textContent = openName;
      els.fretGrid.appendChild(lbl);
      for (let f = 0; f <= FRET_COUNT; f++) {
        const cell = document.createElement('div');
        cell.className = 'fret-cell' + (f === 0 ? ' head' : '');
        cell.dataset.string = s;
        cell.dataset.fret = f;
        // Markers (inlays) on 3, 5, 7, 9, 12 — but only on strings 2 and 3 visually
        if (s === 2 && [3,5,7,9].includes(f)) {
          const m = document.createElement('span'); m.className = 'fret-marker';
          cell.appendChild(m);
        }
        if (s === 2 && f === 12) {
          const m1 = document.createElement('span'); m1.className = 'fret-marker';
          m1.style.left = '35%';
          const m2 = document.createElement('span'); m2.className = 'fret-marker';
          m2.style.left = '65%';
          cell.appendChild(m1); cell.appendChild(m2);
        }
        const dot = document.createElement('span'); dot.className = 'dot';
        cell.appendChild(dot);
        els.fretGrid.appendChild(cell);
      }
    }
  }

  function renderFretboard() {
    if (!els.fretGrid) return;
    [...els.fretGrid.children].forEach(c => c.classList.remove('lit', 'root'));
    const last = state.progression[state.progression.length - 1];
    if (!last) return;
    const chordPcs = new Set(last.intervals.map(iv => (last.rootPc + iv) % 12));
    const rootPc = last.rootPc;
    // For each string, find frets that play a chord tone
    for (let s = 0; s < 6; s++) {
      for (let f = 0; f <= FRET_COUNT; f++) {
        const pc = (GUITAR_TUNING[s] + f) % 12;
        const cell = els.fretGrid.querySelector(`[data-string="${s}"][data-fret="${f}"]`);
        if (!cell) continue;
        if (chordPcs.has(pc)) {
          cell.classList.add('lit');
          const flat = last.preferFlats;
          cell.querySelector('.dot').textContent = S.noteName(pc, flat);
          if (pc === rootPc) cell.classList.add('root');
        }
      }
    }
  }

  function setViz(name) {
    state.viz = name;
    document.querySelectorAll('.viz-tabs button').forEach(b => b.classList.toggle('active', b.dataset.viz === name));
    els.vizPiano.classList.toggle('hidden', name !== 'piano');
    els.vizGuitar.classList.toggle('hidden', name !== 'guitar');
    if (name === 'piano') renderPiano(); else renderFretboard();
  }

  // ─── Chord-shape diagram (how to play it on guitar) ─────────────────────
  // Open-string pitch classes, low-E to high-E (drawn left → right in the diagram).
  const OPEN_PCS = [4, 9, 2, 7, 11, 4];

  function findChordShape(rootPc, intervals) {
    const chordPcs = new Set(intervals.map(iv => (rootPc + iv) % 12));
    let best = null;
    for (let base = 0; base <= 11; base++) {
      const candidateFrets = base === 0 ? [0,1,2,3,4] : [0, base, base+1, base+2, base+3];
      const shape = [];
      let played = 0, lowestSounding = -1, lowestRoot = -1, span = 0;
      const fretted = [];
      for (let s = 0; s < 6; s++) {
        let pick = null;
        for (const f of candidateFrets) {
          const pc = (OPEN_PCS[s] + f) % 12;
          if (!chordPcs.has(pc)) continue;
          if (!pick) pick = { fret: f, pc };
          else if (pc === rootPc && pick.pc !== rootPc) pick = { fret: f, pc };
          else if (pc === pick.pc && f < pick.fret) pick = { fret: f, pc };
        }
        shape.push(pick);
        if (pick) {
          played++;
          if (lowestSounding < 0) lowestSounding = s;
          if (pick.pc === rootPc && lowestRoot < 0) lowestRoot = s;
          if (pick.fret > 0) fretted.push(pick.fret);
        }
      }
      if (played < 4) continue;
      if (fretted.length > 1) span = Math.max(...fretted) - Math.min(...fretted);
      if (span > 3) continue;          // unplayable stretch
      let score = played * 2;
      if (lowestRoot === lowestSounding && lowestRoot >= 0) score += 6;
      if (lowestRoot >= 0 && lowestRoot <= 2) score += 4;
      score -= base * 0.35;            // prefer lower positions
      score -= span * 0.5;             // prefer compact shapes
      if (!best || score > best.score) best = { base, shape, played, score };
    }
    return best;
  }

  function renderChordShape() {
    const svg = els.chordShape;
    const nameEl = els.chordShapeName;
    if (!svg || !nameEl) return;

    const last = state.progression[state.progression.length - 1];
    if (!last) {
      nameEl.textContent = '—';
      svg.innerHTML = '<text x="100" y="68" class="empty-note">add a chord to see how to play it</text>';
      return;
    }

    nameEl.textContent = last.shortName + (last.fullName && last.fullName !== last.shortName ? ' — ' + last.fullName : '');
    const shape = findChordShape(last.rootPc, last.intervals);
    if (!shape) {
      svg.innerHTML = '<text x="100" y="68" class="empty-note">no comfortable shape in the low frets</text>';
      return;
    }

    const stringX = [25, 55, 85, 115, 145, 175];
    const fretY   = [22, 46, 70, 94, 118];
    const stringNames = ['E','A','D','G','B','E'];
    const parts = [];

    // Nut or top fret line
    const topClass = shape.base === 0 ? 'nut' : 'grid-line';
    parts.push(`<line class="${topClass}" x1="${stringX[0]}" y1="${fretY[0]}" x2="${stringX[5]}" y2="${fretY[0]}"/>`);

    // Inner fret lines
    for (let i = 1; i < fretY.length; i++) {
      parts.push(`<line class="grid-line" x1="${stringX[0]}" y1="${fretY[i]}" x2="${stringX[5]}" y2="${fretY[i]}"/>`);
    }

    // Vertical strings
    for (let s = 0; s < 6; s++) {
      parts.push(`<line class="grid-line" x1="${stringX[s]}" y1="${fretY[0]}" x2="${stringX[s]}" y2="${fretY[fretY.length-1]}"/>`);
    }

    // Position label (e.g. "5fr") when not in open position
    if (shape.base > 0) {
      parts.push(`<text class="fret-num" x="${stringX[5]+6}" y="${fretY[0]+12}">${shape.base}fr</text>`);
    }

    // X / O markers above the nut
    for (let s = 0; s < 6; s++) {
      const pick = shape.shape[s];
      if (!pick) {
        parts.push(`<text class="muted-x" x="${stringX[s]}" y="14">×</text>`);
      } else if (pick.fret === 0) {
        parts.push(`<circle cx="${stringX[s]}" cy="11" r="5" fill="none" stroke="currentColor" stroke-width="1.4" class="finger${pick.pc === last.rootPc ? ' root' : ''}" fill-opacity="0"/>`);
      }
    }

    // Finger dots (fretted notes)
    for (let s = 0; s < 6; s++) {
      const pick = shape.shape[s];
      if (!pick || pick.fret === 0) continue;
      const cellIdx = shape.base === 0 ? pick.fret : pick.fret - shape.base + 1;
      if (cellIdx < 1 || cellIdx >= fretY.length) continue;
      const y = (fretY[cellIdx-1] + fretY[cellIdx]) / 2;
      const isRoot = pick.pc === last.rootPc;
      parts.push(`<circle class="finger${isRoot ? ' root' : ''}" cx="${stringX[s]}" cy="${y}" r="7"/>`);
      parts.push(`<text class="finger-label" x="${stringX[s]}" y="${y}">${pick.fret}</text>`);
    }

    // String name labels
    for (let s = 0; s < 6; s++) {
      parts.push(`<text class="string-label" x="${stringX[s]}" y="${fretY[fretY.length-1]+10}">${stringNames[s]}</text>`);
    }

    svg.innerHTML = parts.join('');
  }

  // ─── Render core ─────────────────────────────────────────────────────────
  function renderKeyGrid() {
    [...els.keyGrid.children].forEach(b => b.classList.toggle('active', b.dataset.key === state.key));
  }

  function renderScaleMeta() {
    const meta = S.getScaleMeta(state.scale);
    if (!meta) return;
    els.scaleMeta.textContent = `${meta.mood} • ${(meta.genres || []).join(', ')}`;
  }

  function renderProgression() {
    els.progression.innerHTML = '';
    els.progression.classList.toggle('empty', state.progression.length === 0);
    state.progression.forEach((ch, i) => {
      if (i > 0) {
        const a = document.createElement('span');
        a.className = 'arrow'; a.textContent = '→';
        els.progression.appendChild(a);
      }
      const card = document.createElement('div');
      card.className = 'prog-chord ' + ch.category;
      card.dataset.idx = i;
      card.draggable = true;
      const fn = A.functionalLabel(ch, state.key, state.scale);
      card.innerHTML = `
        <div class="name">${ch.shortName}</div>
        <div class="roman">${ch.roman || ''}</div>
        <div class="func">${fn}</div>
        <button class="del" type="button" title="Remove" aria-label="Remove">×</button>
      `;
      // Drag-to-reorder
      card.addEventListener('dragstart', (e) => {
        card.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(i));
      });
      card.addEventListener('dragend', () => card.classList.remove('dragging'));
      card.addEventListener('dragover', (e) => {
        e.preventDefault();
        card.classList.add('drop-target');
        e.dataTransfer.dropEffect = 'move';
      });
      card.addEventListener('dragleave', () => card.classList.remove('drop-target'));
      card.addEventListener('drop', (e) => {
        e.preventDefault();
        card.classList.remove('drop-target');
        const from = parseInt(e.dataTransfer.getData('text/plain'), 10);
        const to = parseInt(card.dataset.idx, 10);
        if (Number.isFinite(from) && Number.isFinite(to) && from !== to) {
          const [moved] = state.progression.splice(from, 1);
          state.progression.splice(to, 0, moved);
          // Recompute roman after reorder
          state.progression.forEach(c => c.roman = C.romanNumeral(c, state.key, state.scale));
          renderAll(); persistURL();
        }
      });
      card.addEventListener('click', (e) => {
        if (e.target.classList.contains('del')) {
          e.stopPropagation();
          state.progression.splice(i, 1);
          renderAll(); persistURL();
        } else {
          Au.previewChord(ch, state.voicing).catch(()=>{});
        }
      });
      els.progression.appendChild(card);
    });
  }

  function renderOptions() {
    els.options.innerHTML = '';
    const opts = P.getNextChordOptions({
      key: state.key, scale: state.scale,
      progression: state.progression,
      sevenths: state.sevenths,
      filters: state.filters,
    });

    if (opts.length === 0) {
      els.options.innerHTML = '<p class="meta">No options match your filters. Enable more categories above.</p>';
      return;
    }

    const scaleMeta = S.getScaleMeta(state.scale);
    const characteristicDegrees = (scaleMeta && scaleMeta.characteristicDegrees) || [];
    const emotionTop = state.emotion
      ? E.bestForEmotion(opts, state.emotion, { progression: state.progression })
      : [];

    opts.forEach((ch, idx) => {
      const t = A.tensionScore(ch, state.key);
      const card = document.createElement('div');
      card.className = 'opt ' + ch.category;
      card.tabIndex = 0;

      const isDefining = typeof ch.scaleDegree === 'number' && characteristicDegrees.includes(ch.scaleDegree - 1);
      const isEmotionTop = emotionTop.includes(ch);
      const emotion = state.emotion ? E.getEmotion(state.emotion) : null;

      // Detect if adding this chord would complete a famous song's intro
      const trial = state.progression.slice();
      const probe = { ...ch, roman: C.romanNumeral(ch, state.key, state.scale) };
      trial.push(probe);
      const songHit = Sg ? Sg.matchSongs(trial, { max: 1 })[0] : null;

      const badges = [];
      if (isDefining) badges.push('<span class="badge best">Defining sound</span>');
      if (isEmotionTop && emotion) badges.push(`<span class="badge feel">${emotion.label.split(' /')[0]}</span>`);
      if (songHit && songHit.windowLen >= 3) badges.push(`<span class="badge song">Sounds like: ${songHit.title}</span>`);

      const shortcut = idx < 9 ? `<span class="kbd" style="opacity:.4">${idx + 1}</span>` : '';

      card.innerHTML = `
        <div class="opt-head">
          <div class="opt-name">${ch.shortName}</div>
          <div class="opt-roman">${ch.roman || ''}</div>
        </div>
        <div class="opt-cat"><span class="opt-dot"></span>${prettyCat(ch.category)} ${shortcut}</div>
        <div class="opt-note">${ch.categoryNote || ''}</div>
        ${badges.length ? `<div class="opt-badges">${badges.join('')}</div>` : ''}
        <div class="opt-meta">
          <span class="fullname">${ch.fullName}</span>
          <span class="tension-num">Tension <strong>${t}</strong>/10</span>
        </div>
      `;
      card.addEventListener('click', () => onAddChord(ch));
      card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onAddChord(ch); } });
      els.options.appendChild(card);
    });
  }

  function prettyCat(c) {
    return {
      diatonic:'Diatonic', borrowed:'Borrowed', secondary:'Secondary V7',
      'tt-sub':'Tritone Sub', 'dim-passing':'Passing °7',
      neapolitan:'Neapolitan', chromatic:'Chromatic Mediant', aug6:'Augmented 6th',
    }[c] || c;
  }

  function renderDescription() {
    const desc = D.describe(state.progression, state.key, state.scale);
    const modal = A.detectModalColour ? A.detectModalColour(state.progression, state.key, state.scale) : null;
    const loop = A.detectLoop ? A.detectLoop(state.progression) : 0;
    let extras = '';
    if (modal && modal.length) {
      extras += `<p class="meta" style="margin-top:.5rem">Modal hints: ${modal.map(m => `<strong>${m.mode}</strong> — ${m.because}`).join(' · ')}</p>`;
    }
    if (loop && state.progression.length >= 4) {
      extras += `<p class="meta" style="margin-top:.35rem">Recognised as a ${loop}-chord loop.</p>`;
    }
    els.description.innerHTML = `<span class="lead">${desc}</span>${extras}`;
  }

  function renderGenreRhythm() {
    const m = G.matchGenre(state.progression, state.scale);
    if (!m.primary) {
      els.genrePrimary.textContent = '—';
      els.genreInfluences.textContent = state.progression.length ? 'searching…' : 'pick a chord to begin';
      els.rhythmTime.textContent = '—';
      els.rhythmTip.textContent = 'Add chords to get a tailored rhythm tip.';
      return;
    }
    els.genrePrimary.textContent = m.primary.name;
    els.genreInfluences.textContent = m.influences.length ? '+ ' + m.influences.map(i => i.name).join(', ') : '';
    const r = m.primary.rhythm;
    els.rhythmTime.textContent = r.time + (r.bpm ? ' · ' + r.bpm + ' BPM' : '');
    els.rhythmTip.textContent = r.tip;
  }

  function renderSongs() {
    if (!Sg || !els.songList) return;
    const matches = Sg.matchSongs(state.progression, { max: 4 });
    if (!matches.length) {
      els.songList.innerHTML = state.progression.length >= 2
        ? '<div class="song faint" style="color: var(--faint); font-style: italic;">No famous match yet — keep building.</div>'
        : '<div class="song faint" style="color: var(--faint); font-style: italic;">Add 2–4 chords to find matches.</div>';
      return;
    }
    els.songList.innerHTML = matches.map(s => `
      <div class="song"><em>${s.title}</em> — ${s.artist} <small>${s.genre || ''}${s.year ? ' · ' + s.year : ''}${s.section ? ' · ' + s.section : ''}</small></div>
    `).join('');
  }

  function renderCadence() {
    const cad = A.detectCadence(state.progression, state.key, state.scale);
    if (!cad) { els.cadenceBanner.classList.add('hidden'); return; }
    els.cadenceBanner.classList.remove('hidden');
    els.cadenceBanner.innerHTML = `<strong>${cad.label}</strong> — ${cad.detail}`;
  }

  function renderTensionChart() {
    const svg = els.tensionChart;
    svg.innerHTML = '';
    const arc = A.tensionArc(state.progression, state.key);
    if (arc.length === 0) {
      svg.innerHTML = '<text x="100" y="24" text-anchor="middle" fill="rgba(241,236,220,0.35)" font-size="10" font-family="JetBrains Mono">— no data yet —</text>';
      return;
    }
    const W = 200, H = 40, pad = 6;
    const stepX = arc.length > 1 ? (W - 2*pad) / (arc.length - 1) : 0;
    const pts = arc.map((v, i) => {
      const x = pad + i * stepX;
      const y = H - pad - (v / 10) * (H - 2*pad);
      return [x, y];
    });
    const areaPath = (pts.length >= 2 ? `M ${pad} ${H - pad} ` + pts.map(p => `L ${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ') + ` L ${W - pad} ${H - pad} Z` : '');
    const linePath = pts.map((p,i) => (i===0?'M':'L') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
    const grad = `<defs>
        <linearGradient id="g1" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0%"  stop-color="#7fbf6a" stop-opacity="0.0"/>
          <stop offset="60%" stop-color="#d49a3e" stop-opacity="0.25"/>
          <stop offset="100%" stop-color="#d36464" stop-opacity="0.45"/>
        </linearGradient>
        <linearGradient id="g2" x1="0" x2="1">
          <stop offset="0%"  stop-color="#7fbf6a"/>
          <stop offset="50%" stop-color="#d49a3e"/>
          <stop offset="100%" stop-color="#d36464"/>
        </linearGradient>
      </defs>`;
    const area = areaPath ? `<path d="${areaPath}" fill="url(#g1)" />` : '';
    const line = `<path d="${linePath}" stroke="url(#g2)" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round" />`;
    const dots = pts.map(p => `<circle cx="${p[0]}" cy="${p[1]}" r="2.6" fill="#d4a857"/>`).join('');
    svg.innerHTML = grad + area + line + dots;
  }

  function renderModulation() {
    if (state.progression.length < 3) {
      els.modulation.innerHTML = '<p class="meta">Add 3+ chords to see modulation options.</p>';
      return;
    }
    const mods = A.modulationSuggestions(state.key, state.scale);
    els.modulation.innerHTML = '';
    mods.forEach(m => {
      const d = document.createElement('div');
      d.className = 'mod-item'; d.tabIndex = 0;
      d.innerHTML = `
        <div class="mod-key">${m.key} ${S.getScaleMeta(m.scale)?.name || ''}</div>
        <div class="mod-label">${m.label}</div>
        <div class="mod-inst">${m.instruction}</div>
      `;
      const apply = () => {
        state.key = m.key; state.scale = m.scale;
        els.scaleSelect.value = state.scale;
        // Recompute roman for existing chords in the new key
        state.progression.forEach(c => c.roman = C.romanNumeral(c, state.key, state.scale));
        renderAll(); persistURL();
        toast(`Modulated to ${m.key} ${S.getScaleMeta(m.scale)?.name || ''}`);
      };
      d.addEventListener('click', apply);
      d.addEventListener('keydown', (e) => { if (e.key === 'Enter') apply(); });
      els.modulation.appendChild(d);
    });
  }

  function renderEmotionMeta() {
    if (!state.emotion) { els.emotionMeta.textContent = ''; return; }
    const e = E.getEmotion(state.emotion);
    if (e) els.emotionMeta.textContent = e.vibe;
  }

  function renderAll() {
    renderKeyGrid();
    renderScaleMeta();
    renderProgression();
    renderOptions();
    renderDescription();
    renderGenreRhythm();
    renderSongs();
    renderCadence();
    renderTensionChart();
    renderModulation();
    renderEmotionMeta();
    renderChordShape();
    if (state.viz === 'piano') renderPiano(); else renderFretboard();
  }

  // ─── URL / Storage ───────────────────────────────────────────────────────
  function persistURL() {
    try {
      const url = St.encodeURL(state);
      history.replaceState(null, '', url || '#');
    } catch (e) {}
  }

  function loadFromHash() {
    const parsed = St.decodeURL(location.hash);
    if (!parsed) return false;
    state.key = parsed.key;
    state.scale = parsed.scale;
    state.progression = parsed.progSpecs.map(spec => buildFromSpec(spec));
    els.scaleSelect.value = state.scale;
    return true;
  }

  function buildFromSpec(spec) {
    const [root, qual] = spec.split(':');
    const ch = C.buildChord(root, qual || 'maj');
    ch.roman = C.romanNumeral(ch, state.key, state.scale);
    return ch;
  }

  // ─── Events ──────────────────────────────────────────────────────────────
  function onAddChord(ch) {
    // Clone to avoid mutating pool entries
    const clone = { ...ch };
    clone.roman = C.romanNumeral(clone, state.key, state.scale);
    state.progression.push(clone);
    renderAll(); persistURL();
  }

  function pickBestForEmotion() {
    if (!state.emotion) { toast('Pick an emotion first'); return; }
    const opts = P.getNextChordOptions({
      key: state.key, scale: state.scale,
      progression: state.progression, sevenths: state.sevenths, filters: state.filters,
    });
    const best = E.bestForEmotion(opts, state.emotion, { progression: state.progression });
    if (best.length > 0) onAddChord(best[0]);
    else toast('No good match found — try adjusting filters or starting a different way');
  }

  function clearHighlights() {
    [...els.progression.querySelectorAll('.prog-chord')].forEach(c => c.classList.remove('playing'));
    document.querySelectorAll('.beat-led span').forEach(s => s.classList.remove('on'));
    if (els.pianoKeys) [...els.pianoKeys.children].forEach(k => k.classList.remove('preview'));
  }
  function highlightIdx(idx) {
    [...els.progression.querySelectorAll('.prog-chord')].forEach((c, i) => c.classList.toggle('playing', i === idx));
    // Flash the chord on whichever viz is showing so the user sees what's playing
    const ch = state.progression[idx];
    if (!ch) return;
    if (state.viz === 'piano' && els.pianoKeys) {
      const chordPcs = new Set(ch.intervals.map(iv => (ch.rootPc + iv) % 12));
      [...els.pianoKeys.children].forEach(k => {
        const pc = parseInt(k.dataset.pc, 10);
        k.classList.remove('preview');
        if (chordPcs.has(pc)) {
          // force reflow then re-add for repeated flashes
          void k.offsetWidth;
          k.classList.add('preview');
        }
      });
    }
    if (state.viz === 'piano') renderPiano();
    else renderFretboard();
  }
  function onBeat(b) {
    const leds = document.querySelectorAll('.beat-led span');
    leds.forEach((s, i) => s.classList.toggle('on', i === b));
  }

  // ─── Toast ───────────────────────────────────────────────────────────────
  let toastTimer = null;
  function toast(message) {
    if (!els.toast) return;
    els.toast.textContent = message;
    els.toast.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.add('hidden'), 2200);
  }

  // ─── Modal ───────────────────────────────────────────────────────────────
  function openModal(html) {
    document.querySelectorAll('[popover]').forEach(p => { try { p.hidePopover(); } catch(e) {} });
    els.modalContent.innerHTML = html;
    els.scrim.classList.add('open');
  }
  function closeModal() {
    els.scrim.classList.remove('open');
    state.quiz.active = false;
  }

  // ─── Quiz mode ───────────────────────────────────────────────────────────
  const QUIZ_QUALITIES = ['maj','m','7','maj7','m7','m7b5','dim7','aug','sus4'];
  const QUIZ_QUALITY_LABELS = { maj:'Major', m:'Minor', '7':'Dominant 7', maj7:'Major 7', m7:'Minor 7', m7b5:'Half-dim (m7♭5)', dim7:'Diminished 7', aug:'Augmented', sus4:'Sus 4' };
  const QUIZ_ROOTS = ['C','D','E','F','G','A','B'];

  function newQuizQuestion() {
    const correct = QUIZ_QUALITIES[Math.floor(Math.random() * QUIZ_QUALITIES.length)];
    const root = QUIZ_ROOTS[Math.floor(Math.random() * QUIZ_ROOTS.length)];
    const chord = C.buildChord(root, correct);
    // 4 choices: correct + 3 distractors
    const opts = [correct];
    while (opts.length < 4) {
      const candidate = QUIZ_QUALITIES[Math.floor(Math.random() * QUIZ_QUALITIES.length)];
      if (!opts.includes(candidate)) opts.push(candidate);
    }
    // Shuffle
    for (let i = opts.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [opts[i], opts[j]] = [opts[j], opts[i]];
    }
    state.quiz.current = { chord, correct, opts };
    renderQuiz();
    setTimeout(() => Au.previewChord(chord, 'smart').catch(()=>{}), 200);
  }

  function renderQuiz() {
    const q = state.quiz.current;
    if (!q) return;
    const html = `
      <div class="quiz-card">
        <h2>Ear training</h2>
        <p class="quiz-question">What quality of chord is this?</p>
        <div class="quiz-choices">
          ${q.opts.map(o => `<button data-q="${o}" type="button">${QUIZ_QUALITY_LABELS[o] || o}</button>`).join('')}
        </div>
        <p class="quiz-score">Score: ${state.quiz.score} / ${state.quiz.total} · <button type="button" id="quizPlayAgain" class="ghost pill">Hear again</button> · <button type="button" id="quizNext" class="ghost pill">Skip</button></p>
      </div>
    `;
    openModal(html);
    document.querySelectorAll('.quiz-choices button').forEach(b => {
      b.addEventListener('click', () => {
        const ans = b.dataset.q;
        state.quiz.total++;
        if (ans === q.correct) { b.classList.add('correct'); state.quiz.score++; }
        else {
          b.classList.add('wrong');
          document.querySelector(`.quiz-choices button[data-q="${q.correct}"]`).classList.add('correct');
        }
        setTimeout(newQuizQuestion, 950);
      });
    });
    document.getElementById('quizPlayAgain').addEventListener('click', () => Au.previewChord(q.chord, 'smart').catch(()=>{}));
    document.getElementById('quizNext').addEventListener('click', newQuizQuestion);
  }

  function startQuiz() {
    state.quiz = { active:true, score:0, total:0, current:null };
    newQuizQuestion();
  }

  // ─── Share ───────────────────────────────────────────────────────────────
  function shareLink() {
    persistURL();
    const url = window.location.href;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(() => toast('Share link copied to clipboard'));
    } else {
      // Fallback
      const ta = document.createElement('textarea'); ta.value = url; document.body.appendChild(ta);
      ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
      toast('Share link copied');
    }
  }

  function exportMidi() {
    if (state.progression.length === 0) { toast('Add some chords first'); return; }
    const ok = Md.download({
      tempo: state.tempo, chords: state.progression, voicing: state.voicing,
      withBass: state.withBass, beatsPerChord: 4,
      filename: `chordpath-${state.key}-${state.scale}-${state.progression.length}`,
    });
    if (ok) toast('MIDI file downloaded');
  }

  // ─── Theme ───────────────────────────────────────────────────────────────
  function applyTheme() {
    document.documentElement.dataset.theme = state.theme;
    try { localStorage.setItem('chordpath:theme', state.theme); } catch(e){}
  }
  function toggleTheme() {
    state.theme = state.theme === 'dark' ? 'light' : 'dark';
    applyTheme();
  }

  // ─── Keyboard shortcuts ──────────────────────────────────────────────────
  function isTyping() {
    const t = document.activeElement;
    return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');
  }

  function handleKey(e) {
    if (state.quiz.active && els.scrim.classList.contains('open')) {
      if (e.key === 'Escape') closeModal();
      return;
    }
    if (isTyping()) return;
    if (e.key === '?' || (e.key === '/' && e.shiftKey)) { e.preventDefault(); openModal(Lr.renderShortcuts()); return; }
    if (e.key === 'Escape') { closeModal(); Au.stop(); clearHighlights(); return; }
    if (e.key === ' ') { e.preventDefault(); playOrStop(); return; }
    if (e.key.toLowerCase() === 'b') { e.preventDefault(); els.btnPlayBand.click(); return; }
    if (e.key.toLowerCase() === 'm') { els.btnPlayMelody.click(); return; }
    if (e.key.toLowerCase() === 'l') { state.loop = !state.loop; els.loop.checked = state.loop; toast('Loop ' + (state.loop?'on':'off')); return; }
    if (e.key === '7') { state.sevenths = !state.sevenths; els.withSevenths.checked = state.sevenths; state.progression = []; renderAll(); persistURL(); toast('7ths ' + (state.sevenths?'on':'off')); return; }
    if (e.key === 'Backspace' || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z')) {
      e.preventDefault(); state.progression.pop(); renderAll(); persistURL(); return;
    }
    if (e.key.toLowerCase() === 'c' && !e.metaKey && !e.ctrlKey) { state.progression = []; renderAll(); persistURL(); return; }
    if (e.key.toLowerCase() === 'p') { setViz(state.viz === 'piano' ? 'guitar' : 'piano'); return; }
    if (e.key.toLowerCase() === 'e' || e.key.toLowerCase() === 'f') { pickBestForEmotion(); return; }
    if (e.key.toLowerCase() === 't') { toggleTheme(); return; }
    // 1..9 add the n-th option
    if (/^[1-9]$/.test(e.key)) {
      const idx = parseInt(e.key, 10) - 1;
      const optEls = document.querySelectorAll('#options .opt');
      if (optEls[idx]) optEls[idx].click();
      return;
    }
  }

  function playOrStop() {
    // Toggle: if nothing playing, play; if playing, stop
    if (state.progression.length === 0) { toast('Add some chords first'); return; }
    Au.setInstrument(state.instrument);
    Au.playProgression(state.progression, {
      tempo: state.tempo, style: state.style, voicing: state.voicing,
      withBass: state.withBass, loop: state.loop,
      metronome: state.metronome, countIn: state.metronome,
      onChordStart: highlightIdx, onDone: clearHighlights, onBeat,
    });
  }

  // ─── Wire ────────────────────────────────────────────────────────────────
  function wireEvents() {
    els.scaleSelect.addEventListener('change', () => {
      state.scale = els.scaleSelect.value;
      state.progression = [];
      renderAll(); persistURL();
    });

    document.querySelectorAll('.filters input[data-filter]').forEach(cb => {
      cb.addEventListener('change', () => {
        state.filters[cb.dataset.filter] = cb.checked;
        renderOptions();
      });
    });

    els.emotionSelect.addEventListener('change', () => {
      state.emotion = els.emotionSelect.value;
      renderOptions(); renderEmotionMeta();
    });
    els.btnPickEmotion.addEventListener('click', pickBestForEmotion);

    els.btnPlay.addEventListener('click', playOrStop);
    els.btnPlayBand.addEventListener('click', async () => {
      if (state.progression.length === 0) { toast('Add some chords first'); return; }
      Au.setInstrument(state.instrument);
      const match = G.matchGenre(state.progression, state.scale);
      const pattern = (match.primary && G.getPattern(match.primary.id)) || null;
      await Au.playBacking(state.progression, {
        tempo: state.tempo, voicing: state.voicing,
        pattern, loop: state.loop, swing: state.swing,
        metronome: state.metronome, countIn: state.metronome,
        onChordStart: highlightIdx, onDone: clearHighlights, onBeat,
      });
    });

    els.btnPlayMelody.addEventListener('click', async () => {
      if (state.progression.length === 0) { toast('Add some chords first'); return; }
      Au.setInstrument(state.instrument);
      const melody = M.generateMelody(state.progression, state.scale, state.key, { beatsPerChord: 2, subdiv: 2 });
      await Au.playWithMelody(state.progression, melody, {
        tempo: state.tempo, voicing: state.voicing, withBass: state.withBass, loop: state.loop,
        metronome: state.metronome, countIn: state.metronome,
        onChordStart: highlightIdx, onDone: clearHighlights, onBeat,
      });
    });

    els.btnStop.addEventListener('click', () => { Au.stop(); clearHighlights(); });
    els.btnUndo.addEventListener('click', () => { state.progression.pop(); renderAll(); persistURL(); });
    els.btnReset.addEventListener('click', () => { state.progression = []; renderAll(); persistURL(); });

    els.tempo.addEventListener('input', () => {
      state.tempo = parseInt(els.tempo.value, 10);
      els.tempoVal.textContent = state.tempo;
    });
    els.instrument.addEventListener('change', () => {
      state.instrument = els.instrument.value;
      if (Au) Au.setInstrument(state.instrument);
    });
    els.style.addEventListener('change', () => { state.style = els.style.value; });
    els.voicing.addEventListener('change', () => { state.voicing = els.voicing.value; });
    els.withBass.addEventListener('change', () => { state.withBass = els.withBass.checked; });
    els.withSevenths.addEventListener('change', () => {
      state.sevenths = els.withSevenths.checked;
      state.progression = []; renderAll(); persistURL();
    });
    els.loop.addEventListener('change', () => { state.loop = els.loop.checked; });
    els.metronome.addEventListener('change', () => { state.metronome = els.metronome.checked; });

    // Save / Load
    els.btnSave.addEventListener('click', () => {
      const name = (els.saveName.value || '').trim();
      if (!name) { els.saveName.focus(); return; }
      St.save(name, state);
      els.saveName.value = '';
      refreshLoadSelect();
      els.loadSelect.value = name;
      toast('Saved "' + name + '"');
    });
    els.btnDelete.addEventListener('click', () => {
      const name = els.loadSelect.value;
      if (!name) return;
      St.remove(name);
      refreshLoadSelect();
      toast('Deleted "' + name + '"');
    });
    els.loadSelect.addEventListener('change', () => {
      const name = els.loadSelect.value;
      if (!name) return;
      const saved = St.load(name);
      if (!saved) return;
      state.key = saved.key; state.scale = saved.scale;
      els.scaleSelect.value = state.scale;
      state.progression = saved.progSpecs.map(spec => buildFromSpec(spec));
      renderAll(); persistURL();
    });

    // Share / Export
    els.btnShare.addEventListener('click', shareLink);
    els.btnExportMidi.addEventListener('click', exportMidi);

    // Modals
    els.btnShortcuts.addEventListener('click', () => openModal(Lr.renderShortcuts()));
    els.btnLearn.addEventListener('click', () => openModal(Lr.renderPrimer()));
    els.btnPresets.addEventListener('click', () => {
      openModal(Lr.renderPresets());
      document.querySelectorAll('[data-preset]').forEach(b => {
        b.addEventListener('click', () => {
          const idx = parseInt(b.dataset.preset, 10);
          const p = Lr.PRESETS[idx];
          if (!p) return;
          state.key = p.key; state.scale = p.scale;
          els.scaleSelect.value = state.scale;
          state.progression = p.specs.map(spec => buildFromSpec(spec));
          renderAll(); persistURL(); closeModal();
          toast(`Loaded "${p.name}"`);
        });
      });
    });
    els.btnQuiz.addEventListener('click', startQuiz);
    els.btnTheme.addEventListener('click', toggleTheme);
    els.modalClose.addEventListener('click', closeModal);
    els.scrim.addEventListener('click', (e) => { if (e.target === els.scrim) closeModal(); });

    // Visualizer tabs
    document.querySelectorAll('.viz-tabs button').forEach(b => {
      b.addEventListener('click', () => setViz(b.dataset.viz));
    });

    // Key-mode toggle
    document.querySelectorAll('#keyModeToggle button').forEach(b => {
      b.addEventListener('click', () => {
        document.querySelectorAll('#keyModeToggle button').forEach(x => {
          x.classList.toggle('active', x === b);
          x.setAttribute('aria-selected', x === b ? 'true' : 'false');
        });
        state.keyMode = b.dataset.mode;
        state.scale = state.keyMode === 'minor' ? 'natural_minor' : 'major';
        els.scaleSelect.value = state.scale;
        state.progression = [];
        renderAll(); persistURL();
      });
    });

    // Hash change
    window.addEventListener('hashchange', () => { if (loadFromHash()) renderAll(); });

    // Global keyboard
    window.addEventListener('keydown', handleKey);
  }

  // ─── Init ────────────────────────────────────────────────────────────────
  function init() {
    // Load theme preference
    try { state.theme = localStorage.getItem('chordpath:theme') || 'dark'; } catch(e){}
    applyTheme();

    buildKeyGrid();
    buildScaleSelect();
    buildEmotionSelect();
    buildPiano();
    buildFretboard();
    refreshLoadSelect();
    document.querySelectorAll('.filters input[data-filter]').forEach(cb => {
      state.filters[cb.dataset.filter] = cb.checked;
    });
    wireEvents();
    if (location.hash) loadFromHash();
    renderAll();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
