/* ChordPath — ui/views/section.js
 * The writing workspace for one section of a song. The chords are the
 * writer's: the next-chord list and the Ideas pane only offer, every idea
 * can be heard before it is used, and every change to the chords can be
 * undone. All edits flow through App.mutate() → autosave.
 * Editor-only preferences (instrument, viz, filters…) live in App.prefs.
 */
(function (global) {
  'use strict';

  const doc = global.document;
  const $ = id => doc.getElementById(id);

  // Module shorthands (resolved at call time where load order matters).
  const S = () => global.Scales;
  const C = () => global.Chords;
  const P = () => global.Progressions;
  const A = () => global.Analysis;
  const G = () => global.Genres;
  const R = () => global.Arrangements;
  const E = () => global.Emotions;
  const D = () => global.Descriptions;
  const Sg = () => global.Songs;
  const F = () => global.Feelings;
  const T = () => global.Tabs;
  const Mt = () => global.Meters;
  const I = () => global.Ideas;
  const Song = () => global.Song;
  const Au = () => global.Audio;
  const UI = () => global.UI;
  const Viz = () => global.Viz;
  const App = () => global.App;

  let built = false;
  let shapePreviewChord = null;
  let currentTab = 'chords';
  let chordCache = [];
  let playing = false;
  let ideaSeed = 1;               // which handful of ideas is on show
  let shownIdeas = {};            // group → the ideas on screen, for their buttons
  const history = new Map();      // section id → the chords before each change, for Undo

  // ── Accessors ────────────────────────────────────────────────────────────
  function song() { return App().state.song; }
  function section() {
    const s = song();
    if (!s) return null;
    return Song().getSection(s, App().state.sectionId) || s.sections[0] || null;
  }
  function prefs() { return App().prefs; }
  // The section's own key, time, tempo and chord length (each the song's unless it has one of its own).
  function key() { return Song().sectionKey(song(), section()); }
  function meter() { return Song().sectionMeter(song(), section()); }
  function tempo() { return Song().sectionTempo(song(), section()); }
  function chordBeats() { return Song().chordBeats(song(), section()); }
  // What the section plays: chords, patterns, melodies.
  function item() { return Song().playbackItem(song(), section()); }

  function chords() { return chordCache; }
  function refreshChords() {
    chordCache = (song() && section()) ? Song().chordsOf(song(), section()) : [];
  }

  function sectionFeelingId() {
    return Song().sectionFeeling(song(), section());
  }

  function displayChord() {
    return shapePreviewChord || chords()[chords().length - 1] || null;
  }

  // ── Changing the chords, and undoing it ──────────────────────────────────
  // Every change to the chords goes through here, so that Undo can put back
  // what was there before: a chord added or taken out, a progression from
  // the ideas, a starter sound, a cleared section.
  function editChords(change) {
    const sec = section();
    const before = sec.progSpecs.slice();
    App().mutate(() => change(sec));
    if (before.join(' ') === sec.progSpecs.join(' ')) return;
    const past = history.get(sec.id) || [];
    past.push(before);
    if (past.length > 100) past.shift();
    history.set(sec.id, past);
  }

  function undo() {
    const sec = section();
    const past = history.get(sec.id) || [];
    if (!past.length) { UI().toast('Nothing to undo'); return; }
    const before = past.pop();
    App().mutate(() => { sec.progSpecs = before; });
    renderAll();
  }

  // ── Static builds (once) ─────────────────────────────────────────────────
  function buildStatic() {
    if (built) return;
    built = true;
    buildKeyGrid();
    Viz().buildPiano(name => Au().previewNote(name).catch(() => {}));
    Viz().buildFretboard();
    wireEvents();
  }

  function glyph(name) { return String(name).replace('#', '♯').replace(/^([A-G])b/, '$1♭'); }

  // One button for each of the twelve notes, named the way the song's mode
  // names its key (D♭ major, C♯ minor). The song's key is lit by its note,
  // however an older song spelled it.
  function buildKeyGrid() {
    const host = $('keyGrid');
    host.innerHTML = '';
    for (let pc = 0; pc < 12; pc++) {
      const b = doc.createElement('button');
      b.type = 'button';
      b.dataset.pc = pc;
      b.addEventListener('click', () => {
        App().mutate(s => {
          const mode = doc.querySelector('#keyModeToggle button.active');
          if ((s.scale === 'major' || s.scale === 'natural_minor') && mode) {
            s.scale = mode.dataset.mode === 'minor' ? 'natural_minor' : 'major';
          }
          s.key = S().keyName(pc, s.scale);
        });
        renderAll();
      });
      host.appendChild(b);
    }
  }

  // The song's key, renamed for a new scale: C♯ when D♭ major turns minor.
  function respellKey(s) { s.key = S().keyName(S().noteIndex(s.key), s.scale); }

  function buildScaleSelect() {
    const sel = $('scaleSelect');
    sel.innerHTML = '';
    S().SCALE_GROUPS.forEach(group => {
      const og = doc.createElement('optgroup');
      og.label = group.label;
      group.ids.forEach(id => {
        const meta = S().getScaleMeta(id);
        if (!meta) return;
        const o = doc.createElement('option');
        o.value = id; o.textContent = meta.name;
        og.appendChild(o);
      });
      sel.appendChild(og);
    });
    sel.value = song().scale;
  }

  function buildFeelingSelect() {
    const sel = $('emotionSelect');
    sel.innerHTML = '';
    const none = doc.createElement('option');
    none.value = ''; none.textContent = 'No particular feeling';
    sel.appendChild(none);
    const groups = F().groupedFeelings();
    Object.entries(groups).forEach(([group, list]) => {
      const og = doc.createElement('optgroup');
      og.label = group;
      list.forEach(f => {
        const o = doc.createElement('option');
        o.value = f.id; o.textContent = f.name;
        og.appendChild(o);
      });
      sel.appendChild(og);
    });
    const f = F().getFeeling(sectionFeelingId());
    sel.value = f ? f.id : '';
  }

  // The pattern pickers list what can play in the section's time: plain
  // chords (or no drums) first, then the charts written for that time, and
  // in 4/4 the style patterns too. A chosen pattern that does not fit the
  // time shows as the one that plays in its place.
  function buildArrangementControls() {
    const sec = section();
    const m = meter();
    const time = Mt().id(m);
    const four = time === '4/4';
    const forTime = 'For ' + time;
    const sounding = R().makePlaybackPattern(sec.rhythmPattern, sec.drumPattern, m);

    UI().addOptions($('paletteStyle'), R().GENRE_PROFILES.map(p => ({ ...p, family: '' })), song().genreId, p => p.name);
    UI().addOptions($('sectionRole'), R().SECTIONS, sec.role, s => s.name);

    const rhythms = [{ id: '', name: 'Plain chords', family: '' }]
      .concat(Mt().rhythmsFor(m).map(r => ({ id: r.id, name: r.name, family: forTime })))
      .concat(four ? R().RHYTHMS : []);
    const rhythmShown = !sec.rhythmPattern ? ''
      : R().rhythmFor(sec.rhythmPattern, m) ? sec.rhythmPattern
      : (sounding.rhythm && sounding.rhythm.id) || '';
    UI().addOptions($('rhythmPattern'), rhythms, rhythmShown, r => r.name);

    const drums = [{ id: '', name: 'No drums', family: '' }]
      .concat(Mt().groovesFor(m).map(g => ({ id: g.id, name: g.name, family: forTime })))
      .concat(four ? R().DRUMS.filter(d => d.id !== 'none') : []);
    const drumShown = R().drumsFor(sec.drumPattern, m) ? sec.drumPattern
      : sec.drumPattern && sec.drumPattern !== 'none' && sounding.drum && sounding.drum.id !== 'none' ? sounding.drum.id : '';
    UI().addOptions($('drumPattern'), drums, drumShown, d => d.name);

    UI().addOptions($('vocalPattern'), [{ id: '', name: 'No melody', family: '' }].concat(R().VOCAL_MELODIES),
      R().vocalFor(sec.vocalPattern) ? sec.vocalPattern : '', v => v.name);
    UI().addOptions($('underPattern'), R().UNDER_MELODIES, R().underFor(sec.underPattern) ? sec.underPattern : 'none', u => u.name);
    buildTimeControls();
  }

  // The section's time signature, and how long each chord lasts in it.
  function buildTimeControls() {
    const s = song();
    const m = meter();
    const time = Mt().id(m);
    const songTime = Mt().id(s.meter);
    const list = Mt().LIST.map(t => t.id);
    if (!list.includes(time)) list.push(time);
    $('sectionMeter').innerHTML = list.map(id =>
      `<option value="${UI().esc(id)}">${UI().esc(id)}${id === songTime ? ' (song)' : ''}</option>`).join('');
    $('sectionMeter').value = time;

    // Half a bar where that falls on a beat or a half beat, then one, two or four bars.
    const bar = Song().barQuarters(m);
    const lengths = [];
    if (Number.isInteger(bar)) lengths.push({ beats: bar / 2, label: '½ bar' });
    [[1, '1 bar'], [2, '2 bars'], [4, '4 bars']].forEach(([n, label]) => {
      if (bar * n <= 24) lengths.push({ beats: bar * n, label });
    });
    const now = chordBeats();
    if (!lengths.some(l => l.beats === now)) lengths.push({ beats: now, label: now + ' beats' });
    $('chordLength').innerHTML = lengths.map(l => `<option value="${l.beats}">${UI().esc(l.label)}</option>`).join('');
    $('chordLength').value = String(now);
  }

  // ── Section switcher ─────────────────────────────────────────────────────
  function renderSectionSwitch() {
    const host = $('sectionSwitch');
    const s = song();
    const cur = section();
    const ui = UI();
    host.innerHTML = s.sections.map(sec => `
      <button type="button" class="sec-chip${sec.id === cur.id ? ' active' : ''}" data-sec="${ui.esc(sec.id)}"
        title="${ui.esc((F().getFeeling(Song().sectionFeeling(s, sec)) || {}).name || '')}">${ui.esc(sec.name)}</button>
    `).join('') + '<button type="button" class="sec-chip add" id="btnAddSection" title="Add section">+</button>';

    host.querySelectorAll('[data-sec]').forEach(b => {
      b.addEventListener('click', () => global.Nav.go('section', s.id, b.dataset.sec));
    });
    const add = $('btnAddSection');
    if (add) add.addEventListener('click', promptAddSection);
  }

  // A new section starts empty, for the writer to fill.
  function promptAddSection() {
    const ui = UI();
    const roles = R().SECTIONS.map(r =>
      `<button type="button" class="ghost" data-role="${r.id}">${ui.esc(r.name)} <span class="meta">${ui.esc(r.target)}</span></button>`
    ).join('');
    ui.openModal(`<div class="role-picker"><h3>Add a section</h3><p class="meta">It starts empty, in the song's key and time.</p><div class="role-list">${roles}</div></div>`);
    doc.querySelectorAll('#modalContent [data-role]').forEach(b => {
      b.addEventListener('click', () => {
        const s = song();
        const sec = Song().createSection({ role: b.dataset.role });
        App().mutate(sg => {
          sg.sections.push(sec);
          Song().autoNameSections(sg);
        });
        ui.closeModal();
        global.Nav.go('section', s.id, sec.id);
      });
    });
  }

  // ── Progression strip ────────────────────────────────────────────────────
  function renderProgression() {
    const host = $('progression');
    const list = chords();
    const s = song();
    host.innerHTML = '';
    host.classList.toggle('empty', list.length === 0);
    list.forEach((ch, i) => {
      if (i > 0) {
        const a = doc.createElement('span');
        a.className = 'arrow'; a.textContent = '→';
        host.appendChild(a);
      }
      const card = doc.createElement('div');
      card.className = 'prog-chord ' + ch.category;
      card.dataset.idx = i;
      card.draggable = true;
      const fn = A().functionalLabel(ch, key(), s.scale);
      card.innerHTML = `
        <div class="name">${UI().esc(ch.shortName)}</div>
        <div class="roman">${UI().esc(ch.roman || '')}</div>
        <div class="func">${UI().esc(fn)}</div>
        <button class="del" type="button" title="Remove" aria-label="Remove">×</button>
      `;
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
          editChords(sec => {
            const [moved] = sec.progSpecs.splice(from, 1);
            sec.progSpecs.splice(to, 0, moved);
          });
          renderAll();
        }
      });
      card.addEventListener('click', (e) => {
        if (e.target.classList.contains('del')) {
          e.stopPropagation();
          editChords(sec => sec.progSpecs.splice(i, 1));
          renderAll();
        } else {
          previewShapeChord(ch);
          applyBandToneSettings();
          Au().setInstrument(prefs().instrument);
          Au().previewChord(ch, prefs().voicing, { style: prefs().style, onNote: flashPlayingNote }).catch(() => {});
        }
      });
      host.appendChild(card);
    });
  }

  function previewShapeChord(ch) {
    shapePreviewChord = ch || null;
    renderShapeAndViz();
  }
  function clearShapePreview() {
    shapePreviewChord = null;
    renderShapeAndViz();
  }
  function renderShapeAndViz() {
    Viz().renderChordShape(displayChord(), { preview: !!shapePreviewChord });
    if (prefs().viz === 'piano') Viz().renderPiano(displayChord());
    else Viz().renderFretboard(displayChord());
  }

  // ── The left pane: next chord, or ideas ──────────────────────────────────
  function showPane(which) {
    prefs().pane = which === 'ideas' ? 'ideas' : 'next';
    App().savePrefs();
    renderPane();
  }

  function renderPane() {
    const ideas = prefs().pane === 'ideas';
    doc.querySelectorAll('#paneSwitch [data-pane]').forEach(b => {
      const on = (b.dataset.pane === 'ideas') === ideas;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    $('options').classList.toggle('hidden', ideas);
    $('ideas').classList.toggle('hidden', !ideas);
    $('paneHelp').innerHTML = ideas
      ? 'Hear one first. It goes in only if you use it.'
      : 'Sorted by fit. Click — or press <span class="kbd">1</span>–<span class="kbd">9</span>.';
    if (ideas) renderIdeas(); else renderOptions();
  }

  // ── Next-chord options ───────────────────────────────────────────────────
  function renderOptions() {
    const host = $('options');
    if (host.classList.contains('hidden')) return;
    const s = song();
    host.innerHTML = '';
    const opts = P().getNextChordOptions({
      key: key(), scale: s.scale,
      progression: chords(),
      sevenths: prefs().sevenths,
      filters: prefs().filters,
    });

    if (opts.length === 0) {
      host.innerHTML = '<p class="meta">No options match your filters. Enable more categories above.</p>';
      return;
    }

    const scaleMeta = S().getScaleMeta(s.scale);
    const characteristicDegrees = (scaleMeta && scaleMeta.characteristicDegrees) || [];
    const feeling = F().getFeeling(sectionFeelingId());
    const emotionTop = feeling
      ? E().bestForEmotion(opts, feeling.emotionId, { progression: chords() })
      : [];

    opts.forEach((ch, idx) => {
      const t = A().tensionScore(ch, key());
      const card = doc.createElement('div');
      card.className = 'opt ' + ch.category;
      card.tabIndex = 0;

      const isDefining = typeof ch.scaleDegree === 'number' && characteristicDegrees.includes(ch.scaleDegree - 1);
      const isEmotionTop = emotionTop.includes(ch);

      const trial = chords().slice();
      const probe = { ...ch, roman: C().romanNumeral(ch, key(), s.scale) };
      trial.push(probe);
      const songHit = Sg().matchSongs(trial, { max: 1 })[0] || null;

      const badges = [];
      if (isDefining) badges.push('<span class="badge best">Defining sound</span>');
      if (isEmotionTop && feeling) badges.push(`<span class="badge feel">${UI().esc(feeling.name)}</span>`);
      if (songHit && songHit.windowLen >= 3) badges.push(`<span class="badge song">Sounds like: ${UI().esc(songHit.title)}</span>`);

      const shortcut = idx < 9 ? `<span class="kbd" style="opacity:.4">${idx + 1}</span>` : '';

      card.innerHTML = `
        <div class="opt-head">
          <div class="opt-name">${UI().esc(ch.shortName)}</div>
          <div class="opt-roman">${UI().esc(ch.roman || '')}</div>
        </div>
        <div class="opt-cat"><span class="opt-dot"></span>${UI().theoryTerm(UI().prettyCat(ch.category), UI().THEORY_TERMS[ch.category])} ${shortcut}</div>
        <div class="opt-note">${UI().esc(plainChordOutcome(ch, t))}</div>
        ${ch.categoryNote ? `<div class="opt-theory">${UI().esc(ch.categoryNote)}</div>` : ''}
        ${badges.length ? `<div class="opt-badges">${badges.join('')}</div>` : ''}
        <div class="opt-meta">
          <span class="fullname">${UI().esc(ch.fullName)}</span>
          <span class="tension-num">Tension <strong>${t}</strong>/10</span>
        </div>
      `;
      card.addEventListener('mouseenter', () => previewShapeChord(ch));
      card.addEventListener('focus', () => previewShapeChord(ch));
      card.addEventListener('mouseleave', clearShapePreview);
      card.addEventListener('blur', clearShapePreview);
      card.addEventListener('click', () => onAddChord(ch));
      card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onAddChord(ch); } });
      host.appendChild(card);
    });
  }

  function plainChordOutcome(ch, tension) {
    const s = song();
    const fn = A().functionalLabel(ch, key(), s.scale);
    const last = chords()[chords().length - 1] || null;
    const phrase = [];
    if (!last) {
      if (fn === 'T') phrase.push('Good starting point: it feels like home.');
      else if (fn === 'PD') phrase.push('Starts with motion, like the song is already walking.');
      else if (fn === 'D') phrase.push('Starts tense, so the next chord will matter.');
      else phrase.push('Starts with color instead of a plain home chord.');
    } else {
      const vl = A().voiceLeadingSummary(last, ch);
      if (vl.common.length >= 2) phrase.push('Smooth change: several notes stay the same.');
      else if (vl.distance <= 4) phrase.push('Clean change: voices move by small steps.');
      else phrase.push('Noticeable jump: useful when you want a section to turn.');
      if (tension <= 2) phrase.push('It releases pressure.');
      else if (tension <= 5) phrase.push('It keeps the phrase moving.');
      else phrase.push('It adds pressure before a payoff.');
    }
    if (ch.category === 'borrowed') phrase.push('Color twist from outside the plain key.');
    if (ch.category === 'secondary') phrase.push('Points hard at another chord.');
    if (ch.category === 'neapolitan') phrase.push('Dark half-step shock.');
    if (ch.category === 'chromatic') phrase.push('Big sideways move.');
    if (ch.category === 'dim-passing') phrase.push('Passing shadow chord.');
    return phrase.join(' ');
  }

  function onAddChord(ch) {
    editChords(sec => sec.progSpecs.push(`${ch.root}:${ch.quality}`));
    shapePreviewChord = null;
    renderAll();
  }

  function pickBestForFeeling() {
    const feeling = F().getFeeling(sectionFeelingId());
    if (!feeling) { UI().toast('Pick a feeling first'); return; }
    const s = song();
    const opts = P().getNextChordOptions({
      key: key(), scale: s.scale, progression: chords(),
      sevenths: prefs().sevenths, filters: prefs().filters,
    });
    const best = E().bestForEmotion(opts, feeling.emotionId, { progression: chords() });
    if (best.length > 0) onAddChord(best[0]);
    else UI().toast('No strong match — try more chord colors or fewer chords');
  }

  // ── Ideas ────────────────────────────────────────────────────────────────
  // Progressions, rhythms, grooves, other times and melody shapes, all in the
  // section's key and time. Hearing one changes nothing; using one puts it in.
  function renderIdeas() {
    const host = $('ideas');
    if (!host || host.classList.contains('hidden')) return;
    const s = song();
    const sec = section();
    const ui = UI();
    const m = meter();
    const time = Mt().id(m);
    const keyName = key() + ' ' + ((S().getScaleMeta(s.scale) || {}).name || s.scale).toLowerCase();
    shownIdeas = {
      progressions: I().progressions(s, sec, { seed: ideaSeed }),
      rhythms: I().rhythms(s, sec),
      grooves: I().grooves(s, sec),
      times: I().times(s, sec),
      melodies: I().melodies(s, sec, { seed: ideaSeed }),
    };
    const drumsNow = R().drumsFor(sec.drumPattern, m) ? sec.drumPattern : '';
    const inUse = {
      progressions: idea => idea.specs.join(' ') === sec.progSpecs.join(' '),
      rhythms: idea => idea.id === sec.rhythmPattern,
      grooves: idea => idea.id === drumsNow,
      times: () => false,
      melodies: idea => idea.id === sec.vocalPattern,
    };
    const body = {
      progressions: idea => {
        const list = Song().chordsOf(s, { progSpecs: idea.specs, keyOverride: sec.keyOverride });
        const where = idea.kind === 'song'
          ? `as in “${ui.esc(idea.song.title)}”${idea.song.artist ? ' — ' + ui.esc(idea.song.artist) : ''}`
          : 'leaning that way';
        return {
          name: `${ui.esc(idea.label)} <span class="meta">${where}</span>`,
          chords: ui.esc(list.map(c => c.shortName).join(' ')),
          roman: ui.esc(list.map(c => c.roman || '?').join(' ')),
          tip: ui.esc(idea.tip),
        };
      },
      rhythms: r => ({ name: ui.esc(r.name), chart: ui.esc(T().renderStrumChart(r, m)), tip: ui.esc(r.tip) }),
      grooves: g => ({ name: ui.esc(g.name), chart: g.id ? ui.esc(T().renderDrumGrid(g, m)) : '', tip: ui.esc(g.tip) }),
      times: t => ({
        name: `<strong>${ui.esc(t.id)}</strong> <span class="meta">${ui.esc(t.name)}</span>`,
        tip: `${ui.esc(t.feel)} <span class="meta">Count it: ${ui.esc(t.count)}.</span>`,
      }),
      melodies: v => ({ name: ui.esc(v.name), tip: ui.esc(v.tip) }),
    };
    const titles = {
      progressions: ['Progressions', 'in ' + keyName],
      rhythms: ['Rhythms', 'strummed and picked, for ' + time],
      grooves: ['Drums', 'grooves for ' + time],
      times: ['Other times', 'the same chords, felt another way'],
      melodies: ['Melody shapes', 'to hum over the chords'],
    };
    const group = name => {
      const rows = shownIdeas[name].map((idea, i) => {
        const b = body[name](idea);
        const current = inUse[name](idea);
        return `
          <div class="idea${current ? ' current' : ''}" data-group="${name}" data-i="${i}" data-id="${ui.esc(idea.id == null ? '' : idea.id)}">
            <div class="idea-name">${b.name}</div>
            <div class="idea-actions">
              <button type="button" class="ghost small" data-act="hear" title="Hear it, without keeping it">▶ Hear</button>
              <button type="button" class="ghost small" data-act="use"${current ? ' disabled' : ''}>${current ? 'In use' : 'Use'}</button>
            </div>
            ${b.chords ? `<div class="idea-chords">${b.chords}</div><div class="idea-roman">${b.roman}</div>` : ''}
            ${b.chart ? `<pre class="idea-chart">${b.chart}</pre>` : ''}
            ${b.tip ? `<div class="idea-tip">${b.tip}</div>` : ''}
          </div>`;
      }).join('');
      return `
        <section class="idea-group" data-group="${name}">
          <h4>${titles[name][0]} <span class="meta">${ui.esc(titles[name][1])}</span></h4>
          <div class="idea-list">${rows}</div>
        </section>`;
    };
    host.innerHTML = `
      <div class="ideas-head">
        <p class="meta">Things to try in ${ui.esc(keyName)}, ${ui.esc(time)}. Using a progression replaces this section's chords; Undo puts yours back.</p>
        <button type="button" class="ghost small" id="ideasMore" title="Another handful of progressions and melody shapes">↻ Other ideas</button>
      </div>
      ${['progressions', 'rhythms', 'grooves', 'times', 'melodies'].map(group).join('')}`;
  }

  // The key's home chord, twice: something to hear a rhythm or a time over
  // before the section has chords of its own.
  function homeSpecs() {
    const list = C().diatonicChords(key(), song().scale, { sevenths: false });
    const home = list.find(c => c.scaleDegree === 1) || list[0];
    const spec = home ? home.root + ':' + home.quality : key() + ':maj';
    return [spec, spec];
  }

  // The section as it would be with one idea in it. Nothing is kept.
  function trialSection(group, idea) {
    const trial = JSON.parse(JSON.stringify(section()));
    if (group === 'progressions') trial.progSpecs = idea.specs.slice();
    else if (group === 'rhythms') trial.rhythmPattern = idea.id;
    else if (group === 'grooves') trial.drumPattern = idea.id;
    else if (group === 'times') I().useTime(song(), trial, idea.id);
    else if (group === 'melodies') { trial.vocalPattern = idea.id; trial.melodySeed = idea.seed; }
    if (!trial.progSpecs.length) trial.progSpecs = homeSpecs();
    return trial;
  }

  function hearIdea(group, idea) {
    const it = Song().playbackItem(song(), trialSection(group, idea));
    applyBandToneSettings();
    Au().setInstrument(prefs().instrument);
    renderBeatLed(it.meter);
    playing = true;
    Au().playBacking(it.chords, {
      tempo: it.tempo, voicing: prefs().voicing, pattern: it.pattern, stepsPerChord: it.stepsPerChord,
      withBass: prefs().withBass, melody: group === 'melodies' ? it.melody : null,
      loop: () => prefs().loop, onBeat, onNote: flashPlayingNote, onDone: clearHighlights,
    }).catch(() => UI().toast('Audio could not start'));
  }

  function useIdea(group, idea) {
    Au().stop();
    clearHighlights();
    if (group === 'progressions') {
      editChords(sec => { sec.progSpecs = idea.specs.slice(); });
      UI().toast(`Using "${idea.label}". Undo puts back what was there.`);
    } else {
      App().mutate(s => {
        const sec = section();
        if (group === 'rhythms') sec.rhythmPattern = idea.id;
        else if (group === 'grooves') sec.drumPattern = idea.id;
        else if (group === 'times') I().useTime(s, sec, idea.id);
        else if (group === 'melodies') { sec.vocalPattern = idea.id; sec.melodySeed = idea.seed; }
      });
    }
    renderAll();
  }

  // ── Info panels ──────────────────────────────────────────────────────────
  function renderDescription() {
    const s = song();
    const desc = D().describe(chords(), key(), s.scale);
    const modal = A().detectModalColour ? A().detectModalColour(chords(), key(), s.scale) : null;
    const loop = A().detectLoop ? A().detectLoop(chords()) : 0;
    let extras = '';
    if (modal && modal.length) {
      extras += `<p class="meta" style="margin-top:.5rem">Modal hints: ${modal.map(m => `<strong>${UI().esc(m.mode)}</strong> — ${UI().esc(m.because)}`).join(' · ')}</p>`;
    }
    if (loop && chords().length >= 4) {
      extras += `<p class="meta" style="margin-top:.35rem">Recognised as a ${loop}-chord loop.</p>`;
    }
    $('description').innerHTML = `<span class="lead">${desc}</span>${extras}`;
  }

  function renderGenreRhythm() {
    const s = song();
    const m = G().matchGenre(chords(), s.scale);
    const profile = R().profileFor(s.genreId);
    if (!m.primary) {
      $('genrePrimary').textContent = profile ? profile.name : '—';
      $('genreInfluences').textContent = chords().length ? 'listening for fit' : 'pick a chord to begin';
      $('rhythmTime').textContent = '—';
      $('rhythmTip').textContent = 'Add chords to hear how this palette behaves.';
      return;
    }
    $('genrePrimary').textContent = m.primary.name;
    $('genreInfluences').textContent = m.influences.length ? '+ ' + m.influences.map(i => i.name).join(', ') : '';
    const sec = section();
    const time = meter();
    const rhythm = R().rhythmFor(sec.rhythmPattern, time);
    const drums = R().drumsFor(sec.drumPattern, time);
    const vocal = R().vocalFor(sec.vocalPattern);
    const r = rhythm || m.primary.rhythm;
    $('rhythmTime').textContent = Mt().id(time) + (r.bpm ? ' · ' + r.bpm + ' BPM' : '');
    $('rhythmTip').textContent = [r.tip, drums ? drums.tip : '', vocal ? vocal.tip : ''].filter(Boolean).join(' ');
  }

  function renderArrangementInfo() {
    const s = song();
    const sec = section();
    const time = meter();
    const profile = R().profileFor(s.genreId);
    const rhythm = R().rhythmFor(sec.rhythmPattern, time);
    const drums = R().drumsFor(sec.drumPattern, time);
    const vocal = R().vocalFor(sec.vocalPattern);
    const under = R().underFor(sec.underPattern);
    if ($('comboMeta') && profile) {
      $('comboMeta').textContent = profile.subgenres ? profile.subgenres.join(', ') : '';
    }
    if ($('sectionAdvice')) {
      const combo = R().describeCombo(s.genreId, sec.rhythmPattern, sec.drumPattern, sec.vocalPattern, sec.underPattern, time);
      const analysis = R().sectionAnalysis(chords(), key(), s.scale, sec.role);
      const color = profile ? profile.summary : '';
      const layerTips = [rhythm && rhythm.tip, drums && drums.tip, vocal && vocal.tip, under && under.tip].filter(Boolean).join(' ');
      $('sectionAdvice').innerHTML = `<strong>${UI().esc(combo)}</strong>. ${UI().addTheoryHints(analysis)} ${UI().esc(color)} ${UI().addTheoryHints(layerTips)}`;
    }
  }

  function renderSongs() {
    const host = $('songList');
    if (!host) return;
    const matches = Sg().matchSongs(chords(), { max: 4 });
    if (!matches.length) {
      host.innerHTML = chords().length >= 2
        ? '<div class="song faint">No match yet - keep building.</div>'
        : '<div class="song faint">Add 2-4 chords to find matches.</div>';
      return;
    }
    host.innerHTML = matches.map(s => `
      <div class="song"><em>${UI().esc(s.title)}</em> — ${UI().esc(s.artist)} <small>${UI().esc(s.genre || '')}${s.year ? ' · ' + s.year : ''}${s.section ? ' · ' + UI().esc(s.section) : ''}</small></div>
    `).join('');
  }

  function renderCadence() {
    const s = song();
    const cad = A().detectCadence(chords(), key(), s.scale);
    const banner = $('cadenceBanner');
    if (!cad) { banner.classList.add('hidden'); return; }
    banner.classList.remove('hidden');
    banner.innerHTML = `<strong>${UI().theoryTerm(cad.label, cad.theoryName || UI().THEORY_TERMS[cad.type])}</strong> - ${UI().esc(cad.detail)}`;
  }

  function renderModulation() {
    const host = $('modulation');
    const s = song();
    const sec = section();
    if (chords().length === 0) {
      host.innerHTML = '<p class="meta">Add chords, then compare how the same loop behaves in other section roles.</p>';
      return;
    }
    const current = R().byId(R().SECTIONS, sec.role);
    const arc = A().tensionArc(chords(), key());
    const end = arc[arc.length - 1] || 0;
    const cadence = A().detectCadence(chords(), key(), s.scale);
    host.innerHTML = '';
    R().SECTIONS.filter(x => x.id !== sec.role).forEach(x => {
      const d = doc.createElement('div');
      d.className = 'mod-item'; d.tabIndex = 0;
      const advice = sectionMoveAdvice(current, x, end, cadence);
      d.innerHTML = `
        <div class="mod-key">${current ? UI().esc(current.name) + ' -> ' : ''}${UI().esc(x.name)}</div>
        <div class="mod-label">${UI().esc(x.target)}</div>
        <div class="mod-inst">${UI().esc(advice)}</div>
      `;
      const apply = () => {
        App().mutate(sg => {
          sec.role = x.id;
          Song().autoNameSections(sg);
        });
        renderAll();
        UI().toast(`Section role set to ${x.name}`);
      };
      d.addEventListener('click', apply);
      d.addEventListener('keydown', (e) => { if (e.key === 'Enter') apply(); });
      host.appendChild(d);
    });
  }

  function sectionMoveAdvice(from, to, endingTension, cadence) {
    const closed = !!cadence;
    if (!from || !to) return 'Change one layer first: drums, rhythm, vocal range, or under-melody.';
    if (from.id === 'intro' && to.id === 'verse') return 'Keep the same rhythm, bring in the vocal, and leave drums sparse.';
    if (from.id === 'verse' && to.id === 'prechorus') return endingTension >= 5 ? 'Hold the last chord longer and raise the vocal.' : 'Add a push-to chord or denser drums before the chorus.';
    if (from.id === 'prechorus' && to.id === 'chorus') return 'Use the same final chord as a launch pad, then widen the vocal melody.';
    if (to.id === 'chorus') return closed ? 'Start the chorus on the strongest chord and increase drum density.' : 'Answer the unfinished ending at the top of the chorus.';
    if (to.id === 'bridge') return 'Change the chord color or remove drums; keep one familiar melody fragment so it still belongs.';
    if (to.id === 'outro') return 'Repeat the most memorable two-chord fragment and fade the under-melody or drone.';
    return 'Change one layer at a time so the section shift is audible without losing the song identity.';
  }

  function renderFeelingMeta() {
    const f = F().getFeeling(sectionFeelingId());
    $('emotionMeta').textContent = f ? (f.vibe + ' ' + f.tip) : '';
  }

  // ── Tabs pane ────────────────────────────────────────────────────────────
  // Written from what the section plays, in its own time (see Tabs.sectionTab).
  function renderTabPane() {
    const pane = $('tabPane');
    if (!pane) return;
    doc.querySelectorAll('#tabTabs button').forEach(b =>
      b.classList.toggle('active', b.dataset.tab === currentTab));
    if (!chords().length) { pane.textContent = '(add chords first)'; return; }
    try {
      pane.textContent = T().sectionTab(song(), section(), currentTab);
    } catch (e) {
      pane.textContent = '(tab unavailable: ' + e.message + ')';
    }
  }

  // ── Playback ─────────────────────────────────────────────────────────────
  function applyBandToneSettings() {
    const sec = section();
    if (!Au() || !Au().setBandOptions) return;
    Au().setBandOptions({
      texture: sec.textureTone,
      drums: sec.drumTone,
      melody: sec.melodyTone,
      levels: {
        chords: sec.levels.chords,
        bass: sec.levels.bass,
        drums: sec.levels.drums,
        melody: sec.levels.melody,
      },
    });
  }

  // The section's rhythm and drums in its time. A 4/4 style can be played
  // another way with the Style picker; a chart always plays as written.
  function playbackPattern() {
    const sec = section();
    const pattern = R().makePlaybackPattern(sec.rhythmPattern, sec.drumPattern, meter());
    if (!pattern.steps) {
      if (prefs().style === 'arpeggio') pattern.chords = 'arp';
      if (prefs().style === 'strum') pattern.chords = song().genreId === 'shoegaze' ? 'glide-strum' : 'strum';
    }
    return pattern;
  }

  let noteFlashTimers = [];
  function clearNoteFlashes() {
    noteFlashTimers.forEach(t => clearTimeout(t));
    noteFlashTimers = [];
    const pk = $('pianoKeys'), fg = $('fretGrid'), cs = $('chordShape');
    if (pk) [...pk.children].forEach(k => k.classList.remove('note-playing'));
    if (fg) [...fg.children].forEach(c => c.classList.remove('note-playing'));
    if (cs) cs.querySelectorAll('.note-playing').forEach(n => n.classList.remove('note-playing'));
  }

  function notePcFromName(noteName) {
    const m = String(noteName || '').match(/^([A-G])([#b]?)/);
    if (!m) return null;
    const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1]];
    return (base + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + 12) % 12;
  }

  function flashPlayingNote(idx, chord, noteName) {
    const pc = notePcFromName(noteName);
    if (pc == null) return;
    const touched = [];
    const pk = $('pianoKeys'), fg = $('fretGrid'), cs = $('chordShape');
    if (pk) [...pk.children].forEach(k => {
      if (parseInt(k.dataset.pc, 10) === pc) { k.classList.add('note-playing'); touched.push(k); }
    });
    if (fg) [...fg.querySelectorAll('.fret-cell[data-string]')].forEach(cell => {
      const s = parseInt(cell.dataset.string, 10);
      const f = parseInt(cell.dataset.fret, 10);
      if (((Viz().GUITAR_TUNING[s] + f) % 12) === pc) { cell.classList.add('note-playing'); touched.push(cell); }
    });
    if (cs) cs.querySelectorAll(`[data-pc="${pc}"]`).forEach(el => {
      el.classList.add('note-playing'); touched.push(el);
    });
    noteFlashTimers.push(setTimeout(() => touched.forEach(el => el.classList.remove('note-playing')), 360));
  }

  function clearHighlights() {
    playing = false;
    [...$('progression').querySelectorAll('.prog-chord')].forEach(c => c.classList.remove('playing'));
    doc.querySelectorAll('.beat-led span').forEach(sp => sp.classList.remove('on'));
    const pk = $('pianoKeys');
    if (pk) [...pk.children].forEach(k => k.classList.remove('preview'));
    clearNoteFlashes();
    if (song() && section()) renderBeatLed();
  }

  function highlightIdx(idx) {
    [...$('progression').querySelectorAll('.prog-chord')].forEach((c, i) => c.classList.toggle('playing', i === idx));
    const ch = chords()[idx];
    if (!ch) return;
    if (prefs().viz === 'piano') {
      const pk = $('pianoKeys');
      if (pk) {
        const chordPcs = new Set(ch.intervals.map(iv => (ch.rootPc + iv) % 12));
        [...pk.children].forEach(k => {
          const pc = parseInt(k.dataset.pc, 10);
          k.classList.remove('preview');
          if (chordPcs.has(pc)) { void k.offsetWidth; k.classList.add('preview'); }
        });
      }
      Viz().renderPiano(displayChord());
    } else {
      Viz().renderFretboard(displayChord());
    }
  }

  // One light for every beat of the bar, a bigger one where each group starts.
  function renderBeatLed(m) {
    const host = doc.querySelector('.beat-led');
    if (!host) return;
    const time = Mt().id(m || meter());
    if (host.dataset.meter === time) return;
    host.dataset.meter = time;
    host.innerHTML = Mt().pulses(time).map(p => `<span${p.strong ? ' class="strong"' : ''}></span>`).join('');
  }

  function onBeat(b) {
    doc.querySelectorAll('.beat-led span').forEach((sp, i) => sp.classList.toggle('on', i === b));
  }

  // What every player shares: the section's tempo and time, and the lights.
  function playOptions(extra) {
    return Object.assign({
      tempo: tempo(), meter: meter(), voicing: prefs().voicing, withBass: prefs().withBass,
      loop: () => prefs().loop, metronome: prefs().metronome, countIn: prefs().metronome,
      onChordStart: highlightIdx, onNote: flashPlayingNote, onDone: clearHighlights, onBeat,
    }, extra);
  }

  function startPlaying(run) {
    applyBandToneSettings();
    Au().setInstrument(prefs().instrument);
    renderBeatLed();
    playing = true;
    Promise.resolve().then(run).catch(() => UI().toast('Audio could not start'));
  }

  function needsChords() {
    if (chords().length) return false;
    UI().toast('Add some chords first');
    return true;
  }

  function playChords() {
    if (needsChords()) return;
    startPlaying(() => Au().playProgression(chords(), playOptions({ style: prefs().style, beatsPerChord: chordBeats() })));
  }

  function playDrumsOnly() {
    const pattern = playbackPattern();
    const kit = pattern.drums;
    if (!kit.kick.length && !kit.snare.length && !kit.hhClosed.length && !kit.hhOpen.length) {
      UI().toast('No drums chosen: pick a groove under Drums, or in Ideas');
      return;
    }
    const bars = Math.max(4, Math.round(chords().length * chordBeats() / Song().barQuarters(meter())));
    startPlaying(() => Au().playDrums(playOptions({ pattern, bars, onChordStart: null, onNote: null })));
  }

  function playBand(withMelodies) {
    if (needsChords()) return;
    const it = item();
    startPlaying(() => Au().playBacking(chords(), playOptions({
      pattern: playbackPattern(), stepsPerChord: it.stepsPerChord,
      melody: withMelodies ? it.melody : null, underMelody: withMelodies ? it.under : null,
    })));
  }

  function playMelody() {
    if (needsChords()) return;
    const it = item();
    if (!it.melody.length) { UI().toast('No melody chosen: pick one under Vocal melody, or in Ideas'); return; }
    startPlaying(() => Au().playWithMelody(chords(), it.melody, playOptions({ beatsPerChord: chordBeats() })));
  }

  function stopAll() {
    Au().stop();
    clearHighlights();
  }

  // ── Feeling ──────────────────────────────────────────────────────────────
  // None chosen: the section has no feeling, even when the song has one.
  function setSectionFeeling(feelingId) {
    App().mutate(sg => {
      const sec = section();
      if (!feelingId) sec.feelingId = sg.feelingId ? 'none' : null;
      else sec.feelingId = feelingId === sg.feelingId ? null : feelingId;
    });
    renderAll();
  }

  // ── Starter sounds ───────────────────────────────────────────────────────
  // A starter sound plays in the song's key: its home chord lands on the
  // song's, and a major one in a minor song on the relative major (and the
  // other way round), so every chord stays in the key the writer chose.
  function presetSpecs(p) {
    const s = song();
    const k = key();
    const minor = scale => global.ChordParse.isMinorMode(scale);
    const home = S().noteIndex(k);
    const target = minor(p.scale) === minor(s.scale) ? home : (home + (minor(s.scale) ? 3 : 9)) % 12;
    const shift = (target - S().noteIndex(p.key) + 12) % 12;
    return p.specs.map(spec => {
      const [root, quality] = spec.split(':');
      return I().spell({ root: S().noteName((S().noteIndex(root) + shift) % 12), quality }, k, s.scale);
    });
  }

  function applyPreset(p) {
    editChords(sec => { sec.progSpecs = presetSpecs(p); });
    App().mutate(() => {
      const sec = section();
      const m = meter();
      // Its patterns are written for 4/4; in another time, the nearest of their kind.
      const fit = Mt().id(m) === '4/4'
        ? { rhythmPattern: p.rhythmPattern || '', drumPattern: p.drumPattern === 'none' ? '' : (p.drumPattern || '') }
        : I().patternsFor({ rhythmPattern: p.rhythmPattern, drumPattern: p.drumPattern }, '4/4', m);
      sec.rhythmPattern = fit.rhythmPattern;
      sec.drumPattern = fit.drumPattern;
      if (p.vocalPattern) sec.vocalPattern = p.vocalPattern;
      if (p.underPattern) sec.underPattern = p.underPattern;
    });
  }

  // ── Sync controls from state ─────────────────────────────────────────────
  function syncControls() {
    const s = song();
    const sec = section();
    const p = prefs();
    $('tempo').value = s.tempo; $('tempoVal').textContent = s.tempo;
    $('instrument').value = p.instrument;
    $('textureTone').value = sec.textureTone;
    $('drumTone').value = sec.drumTone;
    $('melodyTone').value = sec.melodyTone;
    $('chordLevel').value = sec.levels.chords; $('chordLevelVal').textContent = sec.levels.chords;
    $('bassLevel').value = sec.levels.bass; $('bassLevelVal').textContent = sec.levels.bass;
    $('drumLevel').value = sec.levels.drums; $('drumLevelVal').textContent = sec.levels.drums;
    $('melodyLevel').value = sec.levels.melody; $('melodyLevelVal').textContent = sec.levels.melody;
    $('style').value = p.style;
    $('voicing').value = p.voicing;
    $('withBass').checked = p.withBass;
    $('withSevenths').checked = p.sevenths;
    $('loop').checked = p.loop;
    $('metronome').checked = p.metronome;
    doc.querySelectorAll('.filters input[data-filter]').forEach(cb => {
      cb.checked = !!p.filters[cb.dataset.filter];
    });
    const minorish = /minor|phrygian|locrian/.test(s.scale) && s.scale !== 'dorian';
    doc.querySelectorAll('#keyModeToggle button').forEach(b => {
      const active = (b.dataset.mode === 'minor') === minorish;
      b.classList.toggle('active', active);
      b.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    applyBandToneSettings();
  }

  function renderScaleMeta() {
    const meta = S().getScaleMeta(song().scale);
    if (meta) $('scaleMeta').textContent = `${meta.mood} • ${(meta.genres || []).join(', ')}`;
  }

  function renderKeyGrid() {
    const s = song();
    const home = S().noteIndex(s.key);
    [...$('keyGrid').children].forEach(b => {
      const pc = parseInt(b.dataset.pc, 10);
      b.classList.toggle('active', pc === home);
      b.textContent = glyph(pc === home ? s.key : S().keyName(pc, s.scale));
    });
  }

  function renderHeading() {
    const sec = section();
    const f = F().getFeeling(sectionFeelingId());
    const own = sec.meterOverride ? ` <span class="chip" title="This section has a time of its own">in ${UI().esc(Mt().id(sec.meterOverride))}</span>` : '';
    $('sectionHeading').innerHTML = `${UI().esc(sec.name)}${f ? ` <span class="chip chip-feeling">${UI().esc(f.name)}</span>` : ''}${own}`;
  }

  // ── Master render ────────────────────────────────────────────────────────
  function renderAll() {
    if (!song() || !section()) return;
    refreshChords();
    buildArrangementControls();
    renderSectionSwitch();
    renderHeading();
    renderKeyGrid();
    renderScaleMeta();
    renderBeatLed();
    renderProgression();
    renderPane();
    renderDescription();
    renderGenreRhythm();
    renderArrangementInfo();
    renderSongs();
    renderCadence();
    Viz().renderTensionChart(A().tensionArc(chords(), key()));
    renderModulation();
    renderFeelingMeta();
    renderShapeAndViz();
    renderTabPane();
  }

  // ── Event wiring (once) ──────────────────────────────────────────────────
  function wireEvents() {
    $('scaleSelect').addEventListener('change', () => {
      App().mutate(s => { s.scale = $('scaleSelect').value; respellKey(s); });
      syncControls();
      renderAll();
    });

    doc.querySelectorAll('.filters input[data-filter]').forEach(cb => {
      cb.addEventListener('change', () => {
        prefs().filters[cb.dataset.filter] = cb.checked;
        App().savePrefs();
        renderOptions();
      });
    });

    $('emotionSelect').addEventListener('change', () => setSectionFeeling($('emotionSelect').value));
    $('btnPickEmotion').addEventListener('click', pickBestForFeeling);

    doc.querySelectorAll('#paneSwitch [data-pane]').forEach(b => b.addEventListener('click', () => showPane(b.dataset.pane)));
    $('ideas').addEventListener('click', e => {
      if (e.target.closest('#ideasMore')) {
        ideaSeed = (ideaSeed % 9973) + 1;
        renderIdeas();
        return;
      }
      const btn = e.target.closest('[data-act]');
      const row = btn && btn.closest('.idea');
      if (!row || btn.disabled) return;
      const idea = (shownIdeas[row.dataset.group] || [])[parseInt(row.dataset.i, 10)];
      if (!idea) return;
      if (btn.dataset.act === 'hear') hearIdea(row.dataset.group, idea);
      else if (btn.dataset.act === 'use') useIdea(row.dataset.group, idea);
    });

    $('sectionMeter').addEventListener('change', () => {
      Au().stop();
      App().mutate(s => { I().useTime(s, section(), $('sectionMeter').value); });
      renderAll();
    });
    $('chordLength').addEventListener('change', () => {
      const beats = parseFloat($('chordLength').value);
      if (!Number.isFinite(beats) || beats <= 0) return;
      App().mutate(s => {
        const sec = section();
        sec.beatsPerChord = beats === Song().barQuarters(Song().sectionMeter(s, sec)) ? null : beats;
      });
      renderAll();
    });

    $('btnPlay').addEventListener('click', playChords);
    $('btnPlayDrums').addEventListener('click', playDrumsOnly);
    $('btnPlayBand').addEventListener('click', () => playBand(false));
    $('btnPlayCombo').addEventListener('click', () => playBand(true));
    $('btnPlayMelody').addEventListener('click', playMelody);
    $('btnStop').addEventListener('click', stopAll);
    $('btnUndo').addEventListener('click', undo);
    $('btnReset').addEventListener('click', () => {
      editChords(sec => { sec.progSpecs = []; });
      renderAll();
    });

    $('tempo').addEventListener('input', () => {
      const v = parseInt($('tempo').value, 10);
      $('tempoVal').textContent = v;
      App().mutate(s => { s.tempo = v; }, { quiet: true });
    });
    $('instrument').addEventListener('change', () => {
      prefs().instrument = $('instrument').value;
      App().savePrefs();
      Au().setInstrument(prefs().instrument);
    });
    ['textureTone', 'drumTone', 'melodyTone'].forEach(id => {
      $(id).addEventListener('change', () => {
        App().mutate(() => { section()[id] = $(id).value; }, { quiet: true });
        applyBandToneSettings();
      });
    });
    [['chordLevel', 'chords'], ['bassLevel', 'bass'], ['drumLevel', 'drums'], ['melodyLevel', 'melody']].forEach(([id, k]) => {
      $(id).addEventListener('input', () => {
        const v = parseInt($(id).value, 10);
        $(id + 'Val').textContent = v;
        App().mutate(() => { section().levels[k] = v; }, { quiet: true });
        applyBandToneSettings();
      });
    });
    $('style').addEventListener('change', () => { prefs().style = $('style').value; App().savePrefs(); });
    $('voicing').addEventListener('change', () => { prefs().voicing = $('voicing').value; App().savePrefs(); });
    $('withBass').addEventListener('change', () => { prefs().withBass = $('withBass').checked; App().savePrefs(); });
    $('withSevenths').addEventListener('change', () => {
      prefs().sevenths = $('withSevenths').checked;
      App().savePrefs();
      renderOptions();
    });
    $('loop').addEventListener('change', () => { prefs().loop = $('loop').checked; App().savePrefs(); });
    $('metronome').addEventListener('change', () => { prefs().metronome = $('metronome').checked; App().savePrefs(); });

    // A genre's palette: its patterns and tones for this section (the nearest
    // of their kind outside 4/4). The tempo stays the writer's.
    $('paletteStyle').addEventListener('change', () => {
      const genreId = $('paletteStyle').value;
      const defs = R().defaultsForStyle(genreId);
      App().mutate(s => {
        s.genreId = genreId;
        const sec = section();
        const m = Song().sectionMeter(s, sec);
        const fit = Mt().id(m) === '4/4'
          ? { rhythmPattern: defs.rhythmPattern || sec.rhythmPattern, drumPattern: defs.drumPattern || sec.drumPattern }
          : I().patternsFor({ rhythmPattern: defs.rhythmPattern || sec.rhythmPattern, drumPattern: defs.drumPattern || sec.drumPattern }, '4/4', m);
        Object.assign(sec, fit, {
          vocalPattern: defs.vocalPattern || sec.vocalPattern,
          underPattern: defs.underPattern || sec.underPattern,
          textureTone: defs.textureTone || sec.textureTone,
          drumTone: defs.drumTone || sec.drumTone,
          melodyTone: defs.melodyTone || sec.melodyTone,
        });
      });
      syncControls();
      renderAll();
      if (defs.tempo) UI().toast(`${R().profileFor(genreId).name} usually sits around ${defs.tempo} BPM`);
    });
    $('sectionRole').addEventListener('change', () => {
      App().mutate(s => {
        section().role = $('sectionRole').value;
        Song().autoNameSections(s);
      });
      renderAll();
    });
    ['rhythmPattern', 'drumPattern', 'vocalPattern', 'underPattern'].forEach(id => {
      $(id).addEventListener('change', () => {
        App().mutate(() => { section()[id] = $(id).value; });
        renderAll();
      });
    });

    // More popover actions
    $('btnShortcuts').addEventListener('click', () => UI().openModal(global.Learn.renderShortcuts()));
    $('btnLearn').addEventListener('click', () => UI().openModal(global.Learn.renderPrimer()));
    $('btnLayerGuide').addEventListener('click', () => UI().openModal(global.Learn.renderLayerGuide()));
    $('btnPresets').addEventListener('click', () => {
      UI().openModal(global.Learn.renderPresets());
      doc.querySelectorAll('[data-preset]').forEach(b => {
        b.addEventListener('click', () => {
          const p = global.Learn.PRESETS[parseInt(b.dataset.preset, 10)];
          if (!p) return;
          applyPreset(p);
          UI().closeModal();
          renderAll();
          UI().toast(`"${p.name}", in ${key()}. Undo takes its chords out again.`);
        });
      });
    });
    $('btnQuizStart').addEventListener('click', startQuiz);
    $('btnExportMidi').addEventListener('click', () => {
      if (needsChords()) return;
      const ok = global.Midi.download({
        tempo: tempo(), chords: chords(), voicing: prefs().voicing,
        withBass: prefs().withBass, beatsPerChord: chordBeats(), meter: meter(),
        melody: item().melody,
        filename: `chordpath-${section().name.toLowerCase().replace(/\s+/g, '-')}`,
      });
      if (ok) UI().toast('Section MIDI downloaded');
    });

    // Key-mode toggle
    doc.querySelectorAll('#keyModeToggle button').forEach(b => {
      b.addEventListener('click', () => {
        App().mutate(s => {
          s.scale = b.dataset.mode === 'minor' ? 'natural_minor' : 'major';
          respellKey(s);
        });
        buildScaleSelect();
        renderAll();
        syncControls();
      });
    });

    // Viz + tab tabs
    doc.querySelectorAll('.viz-tabs [data-viz]').forEach(b => {
      b.addEventListener('click', () => {
        prefs().viz = b.dataset.viz;
        App().savePrefs();
        doc.querySelectorAll('.viz-tabs [data-viz]').forEach(x => x.classList.toggle('active', x === b));
        $('vizPiano').classList.toggle('hidden', prefs().viz !== 'piano');
        $('vizGuitar').classList.toggle('hidden', prefs().viz !== 'guitar');
        renderShapeAndViz();
      });
    });
    doc.querySelectorAll('#tabTabs [data-tab]').forEach(b => {
      b.addEventListener('click', () => { currentTab = b.dataset.tab; renderTabPane(); });
    });
    $('btnCopyTab').addEventListener('click', () => {
      const text = $('tabPane').textContent;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => UI().toast('Tab copied'));
      }
    });
  }

  // ── Quiz (ear training) ──────────────────────────────────────────────────
  const QUIZ_QUALITIES = ['maj', 'm', '7', 'maj7', 'm7', 'm7b5', 'dim7', 'aug', 'sus4'];
  const QUIZ_QUALITY_LABELS = { maj: 'Major', m: 'Minor', '7': 'Dominant 7', maj7: 'Major 7', m7: 'Minor 7', m7b5: 'Half-dim (m7♭5)', dim7: 'Diminished 7', aug: 'Augmented', sus4: 'Sus 4' };
  const quiz = { active: false, score: 0, total: 0, current: null };

  function newQuizQuestion() {
    const correct = QUIZ_QUALITIES[Math.floor(Math.random() * QUIZ_QUALITIES.length)];
    const root = 'CDEFGAB'[Math.floor(Math.random() * 7)];
    const chord = C().buildChord(root, correct);
    const opts = [correct];
    while (opts.length < 4) {
      const cand = QUIZ_QUALITIES[Math.floor(Math.random() * QUIZ_QUALITIES.length)];
      if (!opts.includes(cand)) opts.push(cand);
    }
    for (let i = opts.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [opts[i], opts[j]] = [opts[j], opts[i]];
    }
    quiz.current = { chord, correct, opts };
    renderQuiz();
    setTimeout(() => Au().previewChord(chord, 'smart').catch(() => {}), 200);
  }

  function renderQuiz() {
    const q = quiz.current;
    if (!q) return;
    UI().openModal(`
      <div class="quiz-card">
        <h2>Chord color check</h2>
        <p class="quiz-question">What quality of chord is this?</p>
        <div class="quiz-choices">
          ${q.opts.map(o => `<button data-q="${o}" type="button">${QUIZ_QUALITY_LABELS[o] || o}</button>`).join('')}
        </div>
        <p class="quiz-score">Score: ${quiz.score} / ${quiz.total} · <button type="button" id="quizPlayAgain" class="ghost pill">Hear again</button> · <button type="button" id="quizNext" class="ghost pill">Skip</button></p>
      </div>
    `);
    doc.querySelectorAll('.quiz-choices button').forEach(b => {
      b.addEventListener('click', () => {
        quiz.total++;
        if (b.dataset.q === q.correct) { b.classList.add('correct'); quiz.score++; }
        else {
          b.classList.add('wrong');
          const right = doc.querySelector(`.quiz-choices button[data-q="${q.correct}"]`);
          if (right) right.classList.add('correct');
        }
        setTimeout(newQuizQuestion, 950);
      });
    });
    doc.getElementById('quizPlayAgain').addEventListener('click', () => Au().previewChord(q.chord, 'smart').catch(() => {}));
    doc.getElementById('quizNext').addEventListener('click', newQuizQuestion);
  }

  function startQuiz() {
    quiz.active = true; quiz.score = 0; quiz.total = 0;
    newQuizQuestion();
  }

  // ── Keyboard (only while this view is active) ────────────────────────────
  function handleKey(e) {
    const k = e.key.toLowerCase();
    if (e.key === ' ') { e.preventDefault(); if (playing) stopAll(); else playChords(); return; }
    if (k === 'd') { e.preventDefault(); playDrumsOnly(); return; }
    if (k === 'b') { e.preventDefault(); playBand(false); return; }
    if (k === 'x') { e.preventDefault(); playBand(true); return; }
    if (k === 'm') { playMelody(); return; }
    if (k === 'i' && !e.metaKey && !e.ctrlKey) { showPane(prefs().pane === 'ideas' ? 'next' : 'ideas'); return; }
    if (k === 'l') {
      prefs().loop = !prefs().loop; $('loop').checked = prefs().loop;
      App().savePrefs(); UI().toast('Loop ' + (prefs().loop ? 'on' : 'off')); return;
    }
    if (e.key === '7') {
      prefs().sevenths = !prefs().sevenths; $('withSevenths').checked = prefs().sevenths;
      App().savePrefs(); renderOptions(); UI().toast('7ths ' + (prefs().sevenths ? 'on' : 'off')); return;
    }
    if ((e.metaKey || e.ctrlKey) && k === 'z') { e.preventDefault(); undo(); return; }
    if (e.key === 'Backspace') {
      e.preventDefault();
      editChords(sec => sec.progSpecs.pop());
      renderAll();
      return;
    }
    if (k === 'c' && !e.metaKey && !e.ctrlKey) {
      editChords(sec => { sec.progSpecs = []; });
      renderAll();
      return;
    }
    if (k === 'p') {
      const next = prefs().viz === 'piano' ? 'guitar' : 'piano';
      const btn = doc.querySelector(`.viz-tabs [data-viz="${next}"]`);
      if (btn) btn.click();
      return;
    }
    if (k === 'e' || k === 'f') { pickBestForFeeling(); return; }
    if (e.key === '[' || e.key === ']') {
      const s = song();
      const idx = s.sections.findIndex(x => x.id === section().id);
      const next = s.sections[idx + (e.key === ']' ? 1 : -1)];
      if (next) global.Nav.go('section', s.id, next.id);
      return;
    }
    if (/^[1-9]$/.test(e.key) && prefs().pane !== 'ideas') {
      const optEls = doc.querySelectorAll('#options .opt');
      const idx = parseInt(e.key, 10) - 1;
      if (optEls[idx]) optEls[idx].click();
    }
  }

  // ── View lifecycle ───────────────────────────────────────────────────────
  function enter() {
    buildStatic();
    playing = false;
    buildScaleSelect();
    buildFeelingSelect();
    syncControls();
    renderAll();
  }

  global.Views = global.Views || {};
  global.Views.Section = { enter, renderAll, handleKey, stopAudioHighlights: clearHighlights };
})(typeof window !== 'undefined' ? window : globalThis);
