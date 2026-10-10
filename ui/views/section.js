/* ChordPath — ui/views/section.js
 * The writing workspace, ported from the old single-screen app.js onto the
 * multi-section song model. All edits flow through App.mutate() → autosave.
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
  const M = () => global.Melody;
  const F = () => global.Feelings;
  const T = () => global.Tabs;
  const Song = () => global.Song;
  const Au = () => global.Audio;
  const UI = () => global.UI;
  const Viz = () => global.Viz;
  const App = () => global.App;

  let built = false;
  let shapePreviewChord = null;
  let currentTab = 'chords';
  let chordCache = [];

  // ── Accessors ────────────────────────────────────────────────────────────
  function song() { return App().state.song; }
  function section() {
    const s = song();
    if (!s) return null;
    return Song().getSection(s, App().state.sectionId) || s.sections[0] || null;
  }
  function prefs() { return App().prefs; }

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

  // ── Static builds (once) ─────────────────────────────────────────────────
  function buildStatic() {
    if (built) return;
    built = true;
    buildKeyGrid();
    Viz().buildPiano(name => Au().previewNote(name).catch(() => {}));
    Viz().buildFretboard();
    wireEvents();
  }

  function buildKeyGrid() {
    const disp = { 'C#': 'C♯', 'D#': 'D♯', 'F#': 'F♯', 'G#': 'G♯', 'A#': 'A♯' };
    const host = $('keyGrid');
    host.innerHTML = '';
    ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'].forEach(k => {
      const b = doc.createElement('button');
      b.type = 'button';
      b.textContent = disp[k] || k;
      b.dataset.key = k;
      b.addEventListener('click', () => {
        App().mutate(s => {
          s.key = k;
          const mode = doc.querySelector('#keyModeToggle button.active');
          if ((s.scale === 'major' || s.scale === 'natural_minor') && mode) {
            s.scale = mode.dataset.mode === 'minor' ? 'natural_minor' : 'major';
          }
        });
        renderAll();
      });
      host.appendChild(b);
    });
  }

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
    sel.value = sectionFeelingId();
  }

  function buildArrangementControls() {
    const sec = section();
    UI().addOptions($('paletteStyle'), R().GENRE_PROFILES.map(p => ({ ...p, family: '' })), song().genreId, p => p.name);
    UI().addOptions($('sectionRole'), R().SECTIONS, sec.role, s => s.name);
    UI().addOptions($('rhythmPattern'), R().RHYTHMS, sec.rhythmPattern, r => r.name);
    UI().addOptions($('drumPattern'), R().DRUMS, sec.drumPattern, d => d.name);
    UI().addOptions($('vocalPattern'), R().VOCAL_MELODIES, sec.vocalPattern, v => v.name);
    UI().addOptions($('underPattern'), R().UNDER_MELODIES, sec.underPattern, u => u.name);
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

  function promptAddSection() {
    const ui = UI();
    const roles = R().SECTIONS.map(r =>
      `<button type="button" class="ghost" data-role="${r.id}">${ui.esc(r.name)} <span class="meta">${ui.esc(r.target)}</span></button>`
    ).join('');
    ui.openModal(`<div class="role-picker"><h3>Add a section</h3><div class="role-list">${roles}</div></div>`);
    doc.querySelectorAll('#modalContent [data-role]').forEach(b => {
      b.addEventListener('click', () => {
        const role = b.dataset.role;
        const s = song();
        const feeling = F().contrastFor(s.feelingId, role);
        const sec = F().generateSectionSpec(s, role, feeling, Date.now() & 0xffff);
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
      const fn = A().functionalLabel(ch, s.key, s.scale);
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
          App().mutate(() => {
            const specs = section().progSpecs;
            const [moved] = specs.splice(from, 1);
            specs.splice(to, 0, moved);
          });
          renderAll();
        }
      });
      card.addEventListener('click', (e) => {
        if (e.target.classList.contains('del')) {
          e.stopPropagation();
          App().mutate(() => section().progSpecs.splice(i, 1));
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

  // ── Next-chord options ───────────────────────────────────────────────────
  function renderOptions() {
    const host = $('options');
    const s = song();
    host.innerHTML = '';
    const opts = P().getNextChordOptions({
      key: s.key, scale: s.scale,
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
      const t = A().tensionScore(ch, s.key);
      const card = doc.createElement('div');
      card.className = 'opt ' + ch.category;
      card.tabIndex = 0;

      const isDefining = typeof ch.scaleDegree === 'number' && characteristicDegrees.includes(ch.scaleDegree - 1);
      const isEmotionTop = emotionTop.includes(ch);

      const trial = chords().slice();
      const probe = { ...ch, roman: C().romanNumeral(ch, s.key, s.scale) };
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
    const fn = A().functionalLabel(ch, s.key, s.scale);
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
    App().mutate(() => section().progSpecs.push(`${ch.root}:${ch.quality}`));
    shapePreviewChord = null;
    renderAll();
  }

  function pickBestForFeeling() {
    const feeling = F().getFeeling(sectionFeelingId());
    if (!feeling) { UI().toast('Pick a feeling first'); return; }
    const s = song();
    const opts = P().getNextChordOptions({
      key: s.key, scale: s.scale, progression: chords(),
      sevenths: prefs().sevenths, filters: prefs().filters,
    });
    const best = E().bestForEmotion(opts, feeling.emotionId, { progression: chords() });
    if (best.length > 0) onAddChord(best[0]);
    else UI().toast('No strong match — try more chord colors or fewer chords');
  }

  // ── Info panels ──────────────────────────────────────────────────────────
  function renderDescription() {
    const s = song();
    const desc = D().describe(chords(), s.key, s.scale);
    const modal = A().detectModalColour ? A().detectModalColour(chords(), s.key, s.scale) : null;
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
    const selectedRhythm = R().byId(R().RHYTHMS, sec.rhythmPattern);
    const selectedDrums = R().byId(R().DRUMS, sec.drumPattern);
    const selectedVocal = R().byId(R().VOCAL_MELODIES, sec.vocalPattern);
    const r = selectedRhythm || m.primary.rhythm;
    $('rhythmTime').textContent = r.time + (r.bpm ? ' · ' + r.bpm + ' BPM' : '');
    $('rhythmTip').textContent = [
      r.tip,
      selectedDrums ? selectedDrums.tip : '',
      selectedVocal ? selectedVocal.tip : '',
    ].filter(Boolean).join(' ');
  }

  function renderArrangementInfo() {
    const s = song();
    const sec = section();
    const profile = R().profileFor(s.genreId);
    const rhythm = R().byId(R().RHYTHMS, sec.rhythmPattern);
    const drums = R().byId(R().DRUMS, sec.drumPattern);
    const vocal = R().byId(R().VOCAL_MELODIES, sec.vocalPattern);
    const under = R().byId(R().UNDER_MELODIES, sec.underPattern);
    if ($('comboMeta') && profile) {
      $('comboMeta').textContent = profile.subgenres ? profile.subgenres.join(', ') : '';
    }
    if ($('sectionAdvice')) {
      const combo = R().describeCombo(s.genreId, sec.rhythmPattern, sec.drumPattern, sec.vocalPattern, sec.underPattern);
      const analysis = R().sectionAnalysis(chords(), s.key, s.scale, sec.role);
      const color = profile ? profile.summary : '';
      const layerTips = [
        rhythm ? rhythm.tip : '',
        drums ? drums.tip : '',
        vocal ? vocal.tip : '',
        under && under.id !== 'none' ? under.tip : '',
      ].filter(Boolean).join(' ');
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
    const cad = A().detectCadence(chords(), s.key, s.scale);
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
    const arc = A().tensionArc(chords(), s.key);
    const end = arc[arc.length - 1] || 0;
    const cadence = A().detectCadence(chords(), s.key, s.scale);
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
  function vocalMelodyEvents() {
    const sec = section();
    const pattern = R().byId(R().VOCAL_MELODIES, sec.vocalPattern);
    return M().generatePatternMelody(chords(), song().scale, song().key, pattern,
      { beatsPerChord: sec.beatsPerChord || 4, section: sec.role, seed: sec.melodySeed });
  }

  function underMelodyEvents() {
    const sec = section();
    const pattern = R().byId(R().UNDER_MELODIES, sec.underPattern);
    if (!pattern || pattern.type === 'none') return [];
    return M().generateUnderMelody(chords(), song().scale, song().key, pattern,
      { beatsPerChord: sec.beatsPerChord || 4, seed: sec.underSeed });
  }

  function renderTabPane() {
    const pane = $('tabPane');
    if (!pane) return;
    const sec = section();
    const list = chords();
    doc.querySelectorAll('#tabTabs button').forEach(b =>
      b.classList.toggle('active', b.dataset.tab === currentTab));
    if (!list.length) { pane.textContent = '(add chords first)'; return; }
    const bpc = sec.beatsPerChord || 4;
    try {
      if (currentTab === 'chords') {
        pane.textContent = T().renderChordTab(list, { beatsPerChord: bpc });
      } else if (currentTab === 'melody') {
        pane.textContent = T().renderMelodyTab(vocalMelodyEvents(), { chords: list, beatsPerChord: bpc, register: 'lead' });
      } else if (currentTab === 'bass') {
        const rhythm = R().byId(R().RHYTHMS, sec.rhythmPattern);
        pane.textContent = T().renderBassTab(list, rhythm ? rhythm.bass : 'root', { beatsPerChord: bpc });
      } else if (currentTab === 'under') {
        const evs = underMelodyEvents();
        pane.textContent = evs.length
          ? T().renderMelodyTab(evs, { chords: list, beatsPerChord: bpc, register: 'mid' })
          : '(no under-melody selected)';
      } else if (currentTab === 'drums') {
        pane.textContent = T().renderDrumGrid(R().byId(R().DRUMS, sec.drumPattern));
      }
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

  function selectedArrangementPattern() {
    const sec = section();
    const pattern = R().makePlaybackPattern(sec.rhythmPattern, sec.drumPattern);
    if (prefs().style === 'arpeggio') pattern.chords = 'arp';
    if (prefs().style === 'strum') pattern.chords = song().genreId === 'shoegaze' ? 'glide-strum' : 'strum';
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
    [...$('progression').querySelectorAll('.prog-chord')].forEach(c => c.classList.remove('playing'));
    doc.querySelectorAll('.beat-led span').forEach(sp => sp.classList.remove('on'));
    const pk = $('pianoKeys');
    if (pk) [...pk.children].forEach(k => k.classList.remove('preview'));
    clearNoteFlashes();
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

  function onBeat(b) {
    doc.querySelectorAll('.beat-led span').forEach((sp, i) => sp.classList.toggle('on', i === b));
  }

  function playOrStop() {
    if (chords().length === 0) { UI().toast('Add some chords first'); return; }
    applyBandToneSettings();
    Au().setInstrument(prefs().instrument);
    Au().playProgression(chords(), {
      tempo: song().tempo, style: prefs().style, voicing: prefs().voicing,
      withBass: prefs().withBass, loop: () => prefs().loop,
      metronome: prefs().metronome, countIn: prefs().metronome,
      onChordStart: highlightIdx, onNote: flashPlayingNote, onDone: clearHighlights, onBeat,
    });
  }

  // ── Feeling / regeneration ───────────────────────────────────────────────
  function setSectionFeeling(feelingId) {
    App().mutate(sg => {
      section().feelingId = feelingId === sg.feelingId ? null : feelingId;
    });
    renderAll();
  }

  function regenerate(kind) {
    const s = song();
    const sec = section();
    const feelingId = sectionFeelingId();
    const seed = Date.now() & 0xffff;
    App().mutate(() => {
      if (kind === 'chords' || kind === 'all') {
        const prog = F().buildProgression({
          key: s.key, scale: s.scale, feelingId, role: sec.role, genreId: s.genreId, seed,
        });
        Song().setProgression(sec, prog);
        sec.melodySeed = (seed * 7919 + 17) & 0xffff;
      }
      if (kind === 'arr' || kind === 'all') {
        const arr = F().pickArrangement({
          genreId: s.genreId, feelingId, role: sec.role, energy: s.energy, tempo: s.tempo, seed: seed + 101,
        });
        Object.assign(sec, arr);
      }
    });
    buildArrangementControls();
    renderAll();
    UI().toast('Section regenerated for "' + (F().getFeeling(feelingId) || {}).name + '"');
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
    [...$('keyGrid').children].forEach(b => b.classList.toggle('active', b.dataset.key === song().key));
  }

  function renderHeading() {
    const sec = section();
    const f = F().getFeeling(sectionFeelingId());
    $('sectionHeading').innerHTML = `${UI().esc(sec.name)} <span class="chip chip-feeling">${UI().esc(f ? f.name : '')}</span>`;
  }

  // ── Master render ────────────────────────────────────────────────────────
  function renderAll() {
    if (!song() || !section()) return;
    refreshChords();
    renderSectionSwitch();
    renderHeading();
    renderKeyGrid();
    renderScaleMeta();
    renderProgression();
    renderOptions();
    renderDescription();
    renderGenreRhythm();
    renderArrangementInfo();
    renderSongs();
    renderCadence();
    Viz().renderTensionChart(A().tensionArc(chords(), song().key));
    renderModulation();
    renderFeelingMeta();
    renderShapeAndViz();
    renderTabPane();
  }

  // ── Event wiring (once) ──────────────────────────────────────────────────
  function wireEvents() {
    $('scaleSelect').addEventListener('change', () => {
      App().mutate(s => { s.scale = $('scaleSelect').value; });
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
    $('btnRegenChords').addEventListener('click', () => regenerate('chords'));
    $('btnRegenArr').addEventListener('click', () => regenerate('arr'));
    $('btnRegenAll').addEventListener('click', () => regenerate('all'));

    $('btnPlay').addEventListener('click', playOrStop);
    $('btnPlayDrums').addEventListener('click', async () => {
      applyBandToneSettings();
      const pattern = selectedArrangementPattern();
      await Au().playDrums({
        tempo: song().tempo, pattern, bars: Math.max(4, chords().length || 0),
        loop: () => prefs().loop, swing: pattern && pattern.swing || 0,
        metronome: prefs().metronome, countIn: prefs().metronome,
        onDone: clearHighlights, onBeat,
      });
    });
    $('btnPlayBand').addEventListener('click', async () => {
      if (chords().length === 0) { UI().toast('Add some chords first'); return; }
      applyBandToneSettings();
      Au().setInstrument(prefs().instrument);
      const pattern = selectedArrangementPattern();
      await Au().playBacking(chords(), {
        tempo: song().tempo, voicing: prefs().voicing,
        pattern, loop: () => prefs().loop, withBass: prefs().withBass,
        swing: pattern && pattern.swing || 0,
        metronome: prefs().metronome, countIn: prefs().metronome,
        onChordStart: highlightIdx, onNote: flashPlayingNote, onDone: clearHighlights, onBeat,
      });
    });
    $('btnPlayCombo').addEventListener('click', async () => {
      if (chords().length === 0) { UI().toast('Add some chords first'); return; }
      applyBandToneSettings();
      Au().setInstrument(prefs().instrument);
      const pattern = selectedArrangementPattern();
      await Au().playBacking(chords(), {
        tempo: song().tempo, voicing: prefs().voicing,
        pattern, melody: vocalMelodyEvents(), underMelody: underMelodyEvents(),
        loop: () => prefs().loop, withBass: prefs().withBass,
        swing: pattern && pattern.swing || 0,
        metronome: prefs().metronome, countIn: prefs().metronome,
        onChordStart: highlightIdx, onNote: flashPlayingNote, onDone: clearHighlights, onBeat,
      });
    });
    $('btnPlayMelody').addEventListener('click', async () => {
      if (chords().length === 0) { UI().toast('Add some chords first'); return; }
      applyBandToneSettings();
      Au().setInstrument(prefs().instrument);
      await Au().playWithMelody(chords(), vocalMelodyEvents(), {
        tempo: song().tempo, voicing: prefs().voicing, withBass: prefs().withBass,
        loop: () => prefs().loop, beatsPerChord: section().beatsPerChord || 4,
        metronome: prefs().metronome, countIn: prefs().metronome,
        onChordStart: highlightIdx, onNote: flashPlayingNote, onDone: clearHighlights, onBeat,
      });
    });
    $('btnStop').addEventListener('click', () => { Au().stop(); clearHighlights(); });
    $('btnUndo').addEventListener('click', () => {
      App().mutate(() => section().progSpecs.pop());
      renderAll();
    });
    $('btnReset').addEventListener('click', () => {
      App().mutate(() => { section().progSpecs = []; });
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

    $('paletteStyle').addEventListener('change', () => {
      const genreId = $('paletteStyle').value;
      const defs = R().defaultsForStyle(genreId);
      App().mutate(s => {
        s.genreId = genreId;
        if (defs.tempo) s.tempo = defs.tempo;
        const sec = section();
        Object.assign(sec, {
          rhythmPattern: defs.rhythmPattern || sec.rhythmPattern,
          drumPattern: defs.drumPattern || sec.drumPattern,
          vocalPattern: defs.vocalPattern || sec.vocalPattern,
          underPattern: defs.underPattern || sec.underPattern,
          textureTone: defs.textureTone || sec.textureTone,
          drumTone: defs.drumTone || sec.drumTone,
          melodyTone: defs.melodyTone || sec.melodyTone,
        });
      });
      buildArrangementControls();
      syncControls();
      renderAll();
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
          App().mutate(s => {
            s.key = p.key; s.scale = p.scale;
            if (p.focusStyle) s.genreId = p.focusStyle;
            const sec = section();
            if (p.sectionRole) sec.role = p.sectionRole;
            if (p.rhythmPattern) sec.rhythmPattern = p.rhythmPattern;
            if (p.drumPattern) sec.drumPattern = p.drumPattern;
            if (p.vocalPattern) sec.vocalPattern = p.vocalPattern;
            if (p.underPattern) sec.underPattern = p.underPattern;
            sec.progSpecs = p.specs.slice();
            Song().autoNameSections(s);
          });
          buildArrangementControls();
          UI().closeModal();
          renderAll();
          UI().toast(`Loaded "${p.name}"`);
        });
      });
    });
    $('btnQuizStart').addEventListener('click', startQuiz);
    $('btnExportMidi').addEventListener('click', () => {
      if (chords().length === 0) { UI().toast('Add some chords first'); return; }
      const ok = global.Midi.download({
        tempo: song().tempo, chords: chords(), voicing: prefs().voicing,
        withBass: prefs().withBass, beatsPerChord: section().beatsPerChord || 4,
        melody: vocalMelodyEvents(),
        filename: `chordpath-${section().name.toLowerCase().replace(/\s+/g, '-')}`,
      });
      if (ok) UI().toast('Section MIDI downloaded');
    });

    // Key-mode toggle
    doc.querySelectorAll('#keyModeToggle button').forEach(b => {
      b.addEventListener('click', () => {
        App().mutate(s => {
          s.scale = b.dataset.mode === 'minor' ? 'natural_minor' : 'major';
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
    if (e.key === ' ') { e.preventDefault(); playOrStop(); return; }
    if (e.key.toLowerCase() === 'd') { e.preventDefault(); $('btnPlayDrums').click(); return; }
    if (e.key.toLowerCase() === 'b') { e.preventDefault(); $('btnPlayBand').click(); return; }
    if (e.key.toLowerCase() === 'x') { e.preventDefault(); $('btnPlayCombo').click(); return; }
    if (e.key.toLowerCase() === 'm') { $('btnPlayMelody').click(); return; }
    if (e.key.toLowerCase() === 'l') {
      prefs().loop = !prefs().loop; $('loop').checked = prefs().loop;
      App().savePrefs(); UI().toast('Loop ' + (prefs().loop ? 'on' : 'off')); return;
    }
    if (e.key === '7') {
      prefs().sevenths = !prefs().sevenths; $('withSevenths').checked = prefs().sevenths;
      App().savePrefs(); renderOptions(); UI().toast('7ths ' + (prefs().sevenths ? 'on' : 'off')); return;
    }
    if (e.key === 'Backspace' || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z')) {
      e.preventDefault(); App().mutate(() => section().progSpecs.pop()); renderAll(); return;
    }
    if (e.key.toLowerCase() === 'c' && !e.metaKey && !e.ctrlKey) {
      App().mutate(() => { section().progSpecs = []; }); renderAll(); return;
    }
    if (e.key.toLowerCase() === 'p') {
      const next = prefs().viz === 'piano' ? 'guitar' : 'piano';
      const btn = doc.querySelector(`.viz-tabs [data-viz="${next}"]`);
      if (btn) btn.click();
      return;
    }
    if (e.key.toLowerCase() === 'e' || e.key.toLowerCase() === 'f') { pickBestForFeeling(); return; }
    if (e.key === '[' || e.key === ']') {
      const s = song();
      const idx = s.sections.findIndex(x => x.id === section().id);
      const next = s.sections[idx + (e.key === ']' ? 1 : -1)];
      if (next) global.Nav.go('section', s.id, next.id);
      return;
    }
    if (/^[1-9]$/.test(e.key)) {
      const optEls = doc.querySelectorAll('#options .opt');
      const idx = parseInt(e.key, 10) - 1;
      if (optEls[idx]) optEls[idx].click();
    }
  }

  // ── View lifecycle ───────────────────────────────────────────────────────
  function enter() {
    buildStatic();
    buildScaleSelect();
    buildFeelingSelect();
    buildArrangementControls();
    syncControls();
    renderAll();
  }

  global.Views = global.Views || {};
  global.Views.Section = { enter, renderAll, handleKey, stopAudioHighlights: clearHighlights };
})(typeof window !== 'undefined' ? window : globalThis);
