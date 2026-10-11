/* ChordPath — ui/views/daw.js
 * The DAW: a song's parts as editable tracks on a timeline, with a note
 * editor, a tab view, a mixer, recording, and export.
 *
 * Opening a song here builds a project from it once (chords, bass, drums and
 * the two melodies, one clip per section); after that the project is its own
 * thing, saved alongside the song. This file owns the project and the screen;
 * the timeline, note editor and mixer are separate modules it talks to.
 */
(function (global) {
  'use strict';

  const doc = global.document;
  const UI = () => global.UI;
  const P = () => global.DawProject;

  const SNAPS = [[0, 'Off'], [4, 'Bar'], [1, '1/4'], [0.5, '1/8'], [0.25, '1/16'], [0.125, '1/32']];
  const HEAD_W = 236;

  const S = {
    active: false, songId: null, project: null, history: null, engine: null,
    sel: { trackId: null, clipId: null, noteIds: [] },
    pxPerBeat: 22, scrollBeat: 0, snap: 0.25, rollPx: 56,
    panel: 'notes', click: false, status: '',
    arrange: null, roll: null, rollClipId: null, rollFitId: null,
    raf: 0, saveTimer: 0, lastPos: -1, dirty: true, wasPlaying: false, recTrackId: null, ticket: 0,
    theme: '', observer: null, wired: false,
    panelH: 0,                       // editor panel height in px; 0 = the default share of the window
    input: '', inputs: [],           // the input recording listens to ('' = system default), and those on offer
    clipboard: null,                 // copied notes, as DawProject.copyNotes gives them
  };

  function root() { return doc.getElementById('dawRoot'); }
  function $(id) { return doc.getElementById(id); }
  function song() { return global.App.state.song; }
  function esc(v) { return UI().esc(v); }

  function selection() {
    const found = S.sel.clipId ? P().findClip(S.project, S.sel.clipId) : null;
    const track = found ? found.track : P().findTrack(S.project, S.sel.trackId);
    return { track: track || null, clip: found ? found.clip : null };
  }

  function snapBeat(beat) {
    return Math.max(0, S.snap > 0 ? Math.round(beat / S.snap) * S.snap : beat);
  }

  // ── Saving ───────────────────────────────────────────────────────────────
  function scheduleSave() {
    clearTimeout(S.saveTimer);
    S.saveTimer = setTimeout(flushSave, 700);
  }
  function flushSave() {
    clearTimeout(S.saveTimer);
    S.saveTimer = 0;
    if (!S.project) return Promise.resolve();
    return global.DawStore.saveProject(S.project)
      .catch(() => UI().toast('The DAW project could not be saved'));
  }

  function setStatus(text) {
    S.status = text || '';
    const node = $('dawStatus');
    if (node) node.textContent = S.status;
  }

  // Shows the editor panel at the height the user chose, as far as the window
  // allows: the timeline always keeps room for a few tracks.
  function showPanelHeight() {
    const node = root();
    if (!S.panelH) { node.style.removeProperty('--daw-panel'); return; }
    const most = Math.max(150, node.clientHeight - 230);
    node.style.setProperty('--daw-panel', Math.round(Math.max(150, Math.min(most, S.panelH))) + 'px');
  }

  // Applies an edit: the engine follows, undo remembers it, the screen updates.
  // structure: tracks were added or removed. keepPanel: leave the bottom panel alone.
  function commit(opts) {
    opts = opts || {};
    S.engine.sync(S.project);
    S.history.push(S.project);
    scheduleSave();
    if (opts.structure) { render(); return; }
    if (!opts.keepPanel) refreshPanel();
    refreshHeads();
    updateBar();
    S.arrange.resize();
    S.dirty = true;
  }

  function restore(state) {
    if (!state) return;
    S.project = P().sanitize(state);
    if (!P().findTrack(S.project, S.sel.trackId)) S.sel.trackId = S.project.tracks[0] ? S.project.tracks[0].id : null;
    if (S.sel.clipId && !P().findClip(S.project, S.sel.clipId)) S.sel.clipId = null;
    S.sel.noteIds = [];
    S.engine.sync(S.project);
    scheduleSave();
    render();
  }

  // ── Opening ──────────────────────────────────────────────────────────────
  async function loadAudio(project) {
    const ids = new Set();
    project.tracks.forEach(t => t.clips.forEach(c => { if (c.audioId && !S.engine.hasAudio(c.audioId)) ids.add(c.audioId); }));
    for (const id of ids) {
      try {
        const a = await global.DawStore.getAudio(id);
        if (a) S.engine.setAudio(id, a.sampleRate, a.channels);
      } catch (e) { /* the clip will show as missing */ }
    }
  }

  function audioIds(project) {
    const ids = [];
    project.tracks.forEach(t => t.clips.forEach(c => { if (c.audioId) ids.push(c.audioId); }));
    return ids;
  }

  // Removes everything the DAW keeps for a song. Called when the song is deleted.
  function forget(songId) {
    if (S.songId === songId) {
      clearTimeout(S.saveTimer);
      S.saveTimer = 0;
      S.songId = null;
      S.project = null;
      S.history = null;
      if (S.engine) S.engine.keepOnlyAudio([]);
    }
    return global.DawStore.deleteProject('daw_' + songId).catch(() => { /* nothing was saved for it */ });
  }

  async function enter() {
    const sg = song();
    if (!sg) return;
    const ticket = ++S.ticket;
    S.engine = global.DawEngine.get();
    S.active = true;
    if (!S.wired) { S.wired = true; wireOnce(); }
    if (S.songId !== sg.id || !S.project) {
      S.songId = sg.id;
      S.project = null;
      root().innerHTML = '<p class="meta daw-loading">Opening the project…</p>';
      const id = 'daw_' + sg.id;
      let project = null;
      try { project = await global.DawStore.loadProject(id); } catch (e) { project = null; }
      const fresh = !project;
      if (fresh) { project = P().fromSong(sg); project.id = id; }
      // A deleted clip's recording is kept, in memory and on disk, while Undo
      // could still bring the clip back. Undo starts afresh here, so it can go.
      const used = audioIds(project);
      S.engine.keepOnlyAudio(used);
      await loadAudio(project);
      if (ticket !== S.ticket || !S.active) return;          // left while loading
      if (!fresh) global.DawStore.pruneAudio(project.id, used).catch(() => { /* tidying only */ });
      S.project = project;
      S.history = new (P().History)(100);
      S.history.push(project);
      S.sel = { trackId: project.tracks[0] ? project.tracks[0].id : null, clipId: null, noteIds: [] };
      S.scrollBeat = 0;
      S.engine.stop();
      S.engine.sync(project);
      S.engine.seek(0);
      if (fresh) scheduleSave();
    } else {
      S.engine.sync(S.project);
    }
    render();
    cancelAnimationFrame(S.raf);
    S.raf = requestAnimationFrame(frame);
  }

  function leave() {
    if (!S.active) return;
    S.active = false;
    S.ticket++;
    cancelAnimationFrame(S.raf);
    if (S.engine) {
      if (S.engine.isRecording()) finishRecording();           // the take is kept, not thrown away
      S.engine.stop();
      if (S.engine.isMonitoring()) S.engine.setMonitor(false); // the microphone is not left open behind another page
    }
    if (S.saveTimer) flushSave();
  }

  // ── Layout ───────────────────────────────────────────────────────────────
  function headHTML(track) {
    const A = global.DawArrange;
    const insts = track.kind === 'instrument'
      ? `<select data-act="instrument" aria-label="Instrument">${P().INSTRUMENTS.map(i =>
          `<option value="${i.id}"${i.id === track.instrument ? ' selected' : ''}>${esc(i.name)}</option>`).join('')}</select>`
      : `<span class="daw-kind">${track.kind === 'drums' ? 'Drum kit' : 'Audio'}</span>`;
    return `
      <div class="daw-head${track.id === S.sel.trackId ? ' selected' : ''}" data-track="${esc(track.id)}" style="height:${A.LANE_H}px;--tc:${esc(track.color)}">
        <div class="daw-head-top">
          <span class="daw-swatch"></span>
          <span class="daw-name" title="Double-click to rename">${esc(track.name)}</span>
          <button type="button" class="daw-x" data-act="remove" title="Remove track" aria-label="Remove track">×</button>
        </div>
        <div class="daw-head-row">
          ${insts}
          <button type="button" class="mx-btn${track.mute ? ' on' : ''}" data-act="mute" title="Mute">M</button>
          <button type="button" class="mx-btn solo${track.solo ? ' on' : ''}" data-act="solo" title="Solo">S</button>
          ${track.kind === 'audio' ? `<button type="button" class="mx-btn arm${track.armed ? ' on' : ''}" data-act="arm" title="Record onto this track">●</button>` : ''}
        </div>
      </div>`;
  }

  // The choices in the input picker. An input chosen earlier that is not
  // plugged in now stays listed, so it is picked up again when it returns.
  function inputOptions() {
    const missing = S.input && !S.inputs.some(i => i.id === S.input);
    const option = (id, name) => `<option value="${esc(id)}"${id === S.input ? ' selected' : ''}>${esc(name)}</option>`;
    return option('', 'System default') + S.inputs.map(i => option(i.id, i.name)).join('') +
      (missing ? option(S.input, 'Chosen input (not connected)') : '');
  }

  function refreshInputs() {
    S.engine.inputs().then(list => {
      S.inputs = list;
      const pick = $('dawInput');
      if (pick) pick.innerHTML = inputOptions();
    }).catch(() => { /* no list; the system default still records */ });
  }

  function render() {
    if (!S.project) return;
    const A = global.DawArrange;
    const p = S.project;
    root().innerHTML = `
      <div class="daw-bar">
        <button type="button" class="ghost" id="dawHome" title="Back to the start (Home)">⏮</button>
        <button type="button" class="primary" id="dawPlay" title="Play / stop (Space)">▶ Play</button>
        <button type="button" class="ghost daw-rec" id="dawRec" title="Record onto an audio track (R)">● Record</button>
        <label class="daw-field" title="The input that recording listens to">from <select id="dawInput">${inputOptions()}</select></label>
        <button type="button" class="ghost daw-toggle" id="dawMonitor" title="Hear your input through the app while you play. Use headphones: through speakers the microphone would pick itself up.">Hear it</button>
        <div class="daw-pos"><span id="dawBars" class="mono">1.1</span><span id="dawClock" class="meta">0:00.0</span></div>
        <label class="daw-field">Tempo <input id="dawTempo" type="number" min="40" max="240" value="${esc(p.tempo)}" /></label>
        <button type="button" class="ghost daw-toggle" id="dawLoop" title="Loop (L). Drag in the bar ruler to set the range, or click a section.">Loop</button>
        <button type="button" class="ghost daw-toggle" id="dawClick" title="Metronome">Click</button>
        <label class="daw-field">Snap <select id="dawSnap">${SNAPS.map(([v, name]) =>
          `<option value="${v}"${v === S.snap ? ' selected' : ''}>${name}</option>`).join('')}</select></label>
        <div class="daw-actions">
          <button type="button" class="ghost" id="dawUndo" title="Undo (Ctrl+Z)">Undo</button>
          <button type="button" class="ghost" id="dawRedo" title="Redo (Ctrl+Y)">Redo</button>
          <button type="button" class="ghost" id="dawZoomOut" title="Zoom out (-)">−</button>
          <button type="button" class="ghost" id="dawZoomIn" title="Zoom in (+)">+</button>
          <button type="button" class="ghost" id="dawRebuild" title="Rebuild the note tracks from the song as it is now. Recordings are kept.">Rebuild</button>
          <button type="button" class="ghost" id="dawImport" title="Bring an audio file in on a track of its own. You can also drop a file anywhere here.">Import…</button>
          <input type="file" id="dawImportFile" accept="audio/*,.wav,.mp3,.ogg,.oga,.flac,.m4a,.aac,.opus" hidden />
          <button type="button" class="ghost" id="dawExport">Export…</button>
          <button type="button" class="ghost" id="dawKeys" title="Keyboard shortcuts (?)" aria-label="Keyboard shortcuts">?</button>
        </div>
      </div>
      <div class="daw-arrange" id="dawArrange">
        <div class="daw-heads" id="dawHeads" style="width:${HEAD_W}px;padding-top:${A.TOP}px">
          <div class="daw-status" id="dawStatus" style="height:${A.TOP}px" aria-live="polite">${esc(S.status)}</div>
          ${p.tracks.map(headHTML).join('')}
          <div class="daw-add">
            <button type="button" class="ghost small" data-add="instrument">+ Instrument</button>
            <button type="button" class="ghost small" data-add="drums">+ Drums</button>
            <button type="button" class="ghost small" data-add="audio">+ Audio</button>
          </div>
        </div>
        <div class="daw-lanes" id="dawLanes"><canvas id="dawCanvas"></canvas></div>
      </div>
      <div class="daw-hscroll" id="dawHScroll" style="margin-left:${HEAD_W}px"><div id="dawHSize"></div></div>
      <div class="daw-split" id="dawSplit" title="Drag to resize. Double-click to reset."></div>
      <div class="daw-panel" id="dawPanel">
        <div class="daw-panel-bar">
          <div class="viz-tabs" id="dawPanelTabs">
            ${[['notes', 'Notes'], ['tab', 'Tab'], ['mixer', 'Mixer']].map(([id, name]) =>
              `<button type="button" data-panel="${id}"${S.panel === id ? ' class="active"' : ''}>${name}</button>`).join('')}
          </div>
          <span id="dawClipInfo" class="meta"></span>
          <span class="spacer"></span>
          <div class="daw-tools" id="dawTools"></div>
        </div>
        <div class="daw-panel-body" id="dawPanelBody"></div>
      </div>`;

    showPanelHeight();
    S.arrange = A.create($('dawCanvas'), arrangeHost);
    S.roll = null;
    S.rollClipId = null;
    wireBar();
    wireSplit();
    wireHeads();
    S.arrange.resize();
    syncScrollbar();
    refreshPanel();
    updateBar();
    S.dirty = true;
  }

  function refreshHeads() {
    doc.querySelectorAll('#dawHeads .daw-head').forEach(node => {
      const track = P().findTrack(S.project, node.dataset.track);
      if (!track) return;
      node.classList.toggle('selected', track.id === S.sel.trackId);
      const set = (act, on) => { const b = node.querySelector(`[data-act="${act}"]`); if (b) b.classList.toggle('on', on); };
      set('mute', track.mute); set('solo', track.solo); set('arm', track.armed);
      node.querySelector('.daw-name').textContent = track.name;
    });
  }

  function updateBar() {
    if (!S.project || !$('dawPlay')) return;
    const playing = S.engine.isPlaying();
    const recording = S.engine.isRecording();
    $('dawPlay').textContent = playing || recording ? '■ Stop' : '▶ Play';
    $('dawRec').classList.toggle('on', recording);
    $('dawMonitor').classList.toggle('on', S.engine.isMonitoring());
    $('dawLoop').classList.toggle('on', S.project.loop.on);
    $('dawClick').classList.toggle('on', S.click);
    $('dawUndo').disabled = !S.history.canUndo();
    $('dawRedo').disabled = !S.history.canRedo();
    if (doc.activeElement !== $('dawTempo')) $('dawTempo').value = S.project.tempo;
  }

  function syncScrollbar() {
    const size = $('dawHSize'), bar = $('dawHScroll');
    if (!size) return;
    size.style.width = Math.round((Math.max(P().endBeat(S.project), 16) + 32) * S.pxPerBeat) + 'px';
    bar.scrollLeft = Math.round(S.scrollBeat * S.pxPerBeat);
  }

  // ── Timeline host ────────────────────────────────────────────────────────
  const arrangeHost = {
    state: () => ({
      project: S.project, sel: S.sel, pxPerBeat: S.pxPerBeat, scrollBeat: S.scrollBeat,
      snap: S.snap, playhead: S.engine.position(),
    }),
    audioPeaks: (id, n) => S.engine.audioPeaks(id, n),
    audioSeconds: id => S.engine.audioSeconds(id),
    actions: {
      select, seek,
      redraw: () => { S.dirty = true; },
      commit: () => commit(),
      previewLoop(a, b) { S.project.loop.start = a; S.project.loop.end = Math.max(b, a + 0.25); S.project.loop.on = true; S.dirty = true; },
      commitLoop() { commit({ keepPanel: true }); },
      pickSection(index) {
        const m = S.project.markers[index];
        const end = index + 1 < S.project.markers.length ? S.project.markers[index + 1].beat : P().endBeat(S.project);
        const same = S.project.loop.on && S.project.loop.start === m.beat && S.project.loop.end === end;
        S.project.loop = { on: !same, start: m.beat, end: Math.max(end, m.beat + 0.25) };
        if (!same) seek(m.beat);
        commit({ keepPanel: true });
      },
      createClip(trackId, beat) {
        const track = P().findTrack(S.project, trackId);
        const clip = P().addClip(track, { start: beat, length: 4, name: sectionAt(beat) || track.name });
        if (!clip) return;
        S.sel = { trackId, clipId: clip.id, noteIds: [] };
        S.panel = 'notes';
        commit();
        markPanelTab();
      },
      openClip(trackId, clipId) {
        S.panel = 'notes';
        select(trackId, clipId);
        markPanelTab();
      },
      zoom,
      scrollBy(beats) { S.scrollBeat = Math.max(0, S.scrollBeat + beats); syncScrollbar(); S.dirty = true; },
    },
  };

  // The name of the section a beat falls in, going by the song's markers.
  function sectionAt(beat) {
    let found = null;
    S.project.markers.forEach(m => { if (m.beat <= beat + 1e-6 && (!found || m.beat >= found.beat)) found = m; });
    return found ? found.name : '';
  }

  function select(trackId, clipId) {
    const changed = S.sel.trackId !== trackId || S.sel.clipId !== clipId;
    S.sel = { trackId, clipId: clipId || null, noteIds: [] };
    if (!changed) return;
    refreshHeads();
    refreshPanel();
    S.dirty = true;
  }

  function seek(beat) {
    S.engine.seek(Math.max(0, beat));
    S.dirty = true;
  }

  function zoom(factor, anchor) {
    const before = S.pxPerBeat;
    S.pxPerBeat = Math.max(4, Math.min(120, S.pxPerBeat * factor));
    if (anchor != null) S.scrollBeat = Math.max(0, anchor - (anchor - S.scrollBeat) * before / S.pxPerBeat);
    syncScrollbar();
    S.dirty = true;
  }

  // ── Bottom panel ─────────────────────────────────────────────────────────
  function markPanelTab() {
    doc.querySelectorAll('#dawPanelTabs [data-panel]').forEach(b => b.classList.toggle('active', b.dataset.panel === S.panel));
  }

  function toolsHTML(track, clip) {
    if (!clip) return '';
    const midi = !!clip.notes;
    const picked = pickedNotes(clip);
    const some = picked.length ? ' the selected notes' : ' every note';
    return `
      <button type="button" class="ghost small" data-tool="split" title="Split at the playhead (S)">Split</button>
      <button type="button" class="ghost small" data-tool="dup" title="Duplicate (Ctrl+D)">Duplicate</button>
      <button type="button" class="ghost small danger" data-tool="del" title="Delete (Del)">Delete</button>
      ${midi ? `
      <span class="daw-sep"></span>
      <button type="button" class="ghost small" data-tool="quant" title="Move${some} onto the snap grid">Quantize</button>
      ${track.kind === 'drums' ? '' : [-12, -1, 1, 12].map(n =>
        `<button type="button" class="ghost small" data-tool="tr" data-n="${n}" title="Transpose${some}">${n > 0 ? '+' : ''}${n}</button>`).join('')}
      ${picked.length ? `<label class="daw-field">Velocity <input type="range" id="dawVel" min="0.05" max="1" step="0.01" value="${esc(picked[0].v)}" /></label>` : ''}
      <span class="daw-sep"></span>
      <button type="button" class="ghost small" data-tool="rollOut" title="Zoom the note editor out">−</button>
      <button type="button" class="ghost small" data-tool="rollIn" title="Zoom the note editor in">+</button>` : ''}`;
  }

  function drumGridText(clip) {
    const lanes = P().DRUM_LANES;
    const bars = Math.ceil(clip.length / 4);
    const out = [];
    for (let bar = 0; bar < bars; bar++) {
      const lines = lanes.map(l => {
        const cells = Array(16).fill('-');
        clip.notes.forEach(n => {
          const step = Math.round((n.t - bar * 4) * 4);
          if (n.n === l.note && n.t < clip.length && step >= 0 && step < 16) cells[step] = 'x';
        });
        return l.name.padEnd(11) + '|' + cells.join('') + '|';
      }).filter(line => line.includes('x'));
      if (lines.length) out.push('Bar ' + (bar + 1) + '\n' + lines.join('\n') + '\n' + ' '.repeat(11) + ' 1e+a2e+a3e+a4e+a');
    }
    return out.length ? out.join('\n\n') : '(no hits in this clip)';
  }

  // Six-line guitar tab of the selected clip.
  function tabText(track, clip) {
    if (!clip.notes) return 'Recorded audio has no tab.';
    if (track.kind === 'drums') return drumGridText(clip);
    const events = clip.notes.filter(n => n.t < clip.length).map(n => ({ midi: n.n, beatStart: n.t }));
    if (!events.length) return '(no notes in this clip)';
    // A part that sits low is written on the low strings, like a bass line.
    const pitches = events.map(e => e.midi).sort((a, b) => a - b);
    const low = pitches[Math.floor(pitches.length / 2)] < 52;
    return global.Tabs.renderNotesTab(events, {
      totalBeats: clip.length, tempo: S.project.tempo, register: low ? 'bass' : 'full', lineWidth: 140,
    });
  }

  // "Verse 1 on Bass: 16 beats, 24 notes"
  function clipInfo(track, clip) {
    const count = (n, word) => n + ' ' + word + (n === 1 ? '' : 's');
    const beats = Math.round(clip.length * 100) / 100;
    const picked = pickedNotes(clip).length;
    return `${clip.name || 'Clip'} on ${track.name}: ${count(beats, 'beat')}` +
      (clip.notes ? ', ' + count(clip.notes.length, 'note') : '') + (picked > 1 ? `, ${picked} selected` : '');
  }

  // The selected notes that are still in the clip.
  function pickedNotes(clip) {
    return clip && clip.notes ? clip.notes.filter(n => S.sel.noteIds.includes(n.id)) : [];
  }

  // Opens the note editor zoomed so the whole clip fills its width.
  function fitRoll(wrap, clip) {
    const room = wrap.offsetWidth - global.DawRoll.KEYS_W - 44;      // less the keys and a scrollbar's worth
    S.rollPx = Math.max(24, Math.min(180, room / Math.max(clip.length, 1)));
  }

  function refreshPanel() {
    const body = $('dawPanelBody');
    if (!body || !S.project) return;
    const { track, clip } = selection();
    $('dawClipInfo').textContent = clip ? clipInfo(track, clip) : (track ? track.name : '');
    $('dawTools').innerHTML = S.panel === 'mixer' ? '' : toolsHTML(track, clip);
    wireTools();

    if (S.panel === 'mixer') {
      S.roll = null; S.rollClipId = null;
      global.DawMixer.render(body, S.project, {
        live: () => { S.engine.sync(S.project); S.dirty = true; },
        done: () => { commit({ keepPanel: true }); },
      });
      return;
    }
    if (!clip) {
      S.roll = null; S.rollClipId = null;
      body.innerHTML = `<p class="meta daw-hint">Select a clip to ${S.panel === 'tab' ? 'see its tab' : 'edit its notes'}.
        Double-click an empty stretch of a track to make a new clip; press Record to capture audio.</p>`;
      return;
    }
    if (S.panel === 'tab') {
      S.roll = null; S.rollClipId = null;
      body.innerHTML = '<pre class="tab-pre daw-tab" id="dawTab"></pre>';
      $('dawTab').textContent = tabText(track, clip);
      return;
    }
    if (!clip.notes) {
      S.roll = null; S.rollClipId = null;
      body.innerHTML = `
        <div class="daw-hint">
          <p>Recorded audio. Drag it on the timeline to move it, drag its right edge to trim it, press S to split it at the playhead.</p>
          <label class="daw-field">Clip gain <input type="range" id="dawGain" min="0" max="2" step="0.01" value="${esc(clip.gain)}" /></label>
        </div>`;
      const gain = $('dawGain');
      gain.addEventListener('input', () => { clip.gain = parseFloat(gain.value); S.engine.sync(S.project); S.dirty = true; });
      gain.addEventListener('change', () => commit({ keepPanel: true }));
      return;
    }
    // Note editor: rebuilt when another clip is chosen, otherwise just resized.
    if (S.rollClipId !== clip.id || !S.roll) {
      body.innerHTML = '<div class="daw-roll" id="dawRollWrap"><canvas id="dawRoll"></canvas></div>';
      const wrap = $('dawRollWrap');
      if (S.rollFitId !== clip.id) { fitRoll(wrap, clip); S.rollFitId = clip.id; }   // a redraw keeps your zoom
      S.roll = global.DawRoll.create($('dawRoll'), rollHost);
      S.rollClipId = clip.id;
      S.roll.resize();
      wrap.scrollTop = Math.max(0, S.roll.focusY() - wrap.clientHeight / 2);
      wrap.addEventListener('scroll', () => { if (S.roll) S.roll.draw(); });
    } else {
      S.roll.resize();
    }
    S.roll.draw();
  }

  const rollHost = {
    state() {
      const { track, clip } = selection();
      const wrap = $('dawRollWrap');
      return {
        project: S.project, track, clip, sel: S.sel, snap: S.snap, rollPx: S.rollPx,
        playhead: S.engine.position(), scroll: { left: wrap ? wrap.scrollLeft : 0, top: wrap ? wrap.scrollTop : 0 },
      };
    },
    actions: {
      selectNotes(ids) { selectNotes(ids); },
      audition(midi) { S.engine.sync(S.project); S.engine.audition(S.sel.trackId, midi, 0.8); },
      redraw() { if (S.roll) S.roll.draw(); S.dirty = true; },
      commit() { commit(); },
    },
  };

  // ── Notes: selection and clipboard ───────────────────────────────────────
  function selectNotes(ids) {
    const same = ids.length === S.sel.noteIds.length && ids.every(id => S.sel.noteIds.includes(id));
    if (same) return;
    S.sel.noteIds = ids.slice();
    const { track, clip } = selection();
    $('dawClipInfo').textContent = clip ? clipInfo(track, clip) : '';
    $('dawTools').innerHTML = toolsHTML(track, clip);
    wireTools();
  }

  // The clip open in the note editor, when that is what the keyboard is for.
  function editedClip() {
    const { clip } = selection();
    return S.panel === 'notes' && clip && clip.notes ? clip : null;
  }

  function copySelectedNotes(cut) {
    const clip = editedClip();
    const copied = clip ? P().copyNotes(clip, S.sel.noteIds) : null;
    if (!copied) return false;
    S.clipboard = copied;
    if (cut) {
      P().removeNotes(clip, S.sel.noteIds);
      S.sel.noteIds = [];
      commit();
    }
    return true;
  }

  // Pasted notes land at the playhead, or at the start of the clip when the
  // playhead is somewhere else, and become the selection.
  function pasteNotes() {
    const clip = editedClip();
    if (!clip || !S.clipboard) return false;
    const at = snapBeat(S.engine.position()) - clip.start;
    const made = P().pasteNotes(clip, S.clipboard, at >= 0 && at < clip.length ? at : 0);
    if (!made.length) { UI().toast('No room in this clip for the copied notes'); return true; }
    S.sel.noteIds = made;
    commit();
    return true;
  }

  // Arrow keys: a step along, or a semitone (an octave with Shift) up or down.
  function nudgeNotes(dt, dn) {
    const clip = editedClip();
    const { track } = selection();
    const picked = pickedNotes(clip);
    if (!picked.length) return false;
    const base = picked.map(n => ({ id: n.id, t: n.t, n: n.n }));
    const went = P().shiftNotes(clip, base, dt, track.kind === 'drums' ? 0 : dn,
      { low: global.DawRoll.LOW, high: global.DawRoll.HIGH, step: S.snap > 0 ? S.snap : 0.25 });
    if (went.dt || went.dn) {
      if (went.dn) S.engine.audition(track.id, picked[0].n, 0.7);
      commit();
    }
    return true;
  }

  // ── Clip tools ───────────────────────────────────────────────────────────
  function splitSelected() {
    if (!S.sel.clipId) return;
    const parts = P().splitClip(S.project, S.sel.clipId, snapBeat(S.engine.position()));
    if (!parts) { UI().toast('Put the playhead inside the clip to split it'); return; }
    S.sel.clipId = parts[1].id;
    S.sel.noteIds = [];
    commit();
  }
  function duplicateSelected() {
    if (!S.sel.clipId) return;
    const copy = P().duplicateClip(S.project, S.sel.clipId);
    if (!copy) return;
    S.sel.clipId = copy.id;
    S.sel.noteIds = [];
    commit();
  }
  function deleteSelected() {
    const { clip } = selection();
    if (!clip) return;
    const picked = pickedNotes(clip);
    if (picked.length) {
      P().removeNotes(clip, picked.map(n => n.id));
      S.sel.noteIds = [];
    } else {
      P().removeClip(S.project, clip.id);
      S.sel.clipId = null;
    }
    commit();
  }

  function wireTools() {
    doc.querySelectorAll('#dawTools [data-tool]').forEach(btn => btn.addEventListener('click', () => {
      btn.blur();
      const { clip } = selection();
      const tool = btn.dataset.tool;
      if (tool === 'split') splitSelected();
      else if (tool === 'dup') duplicateSelected();
      else if (tool === 'del') deleteSelected();
      else if (tool === 'quant' && clip) { P().quantize(clip, S.snap > 0 ? S.snap : 0.25, S.sel.noteIds); commit(); }
      else if (tool === 'tr' && clip) { P().transpose(clip, parseInt(btn.dataset.n, 10), S.sel.noteIds); commit(); }
      else if (tool === 'rollIn' || tool === 'rollOut') {
        S.rollPx = Math.max(14, Math.min(220, S.rollPx * (tool === 'rollIn' ? 1.3 : 1 / 1.3)));
        refreshPanel();
      }
    }));
    const vel = $('dawVel');
    if (vel) {
      vel.addEventListener('input', () => {
        const { clip } = selection();
        if (clip && S.sel.noteIds.length) { P().setVelocity(clip, S.sel.noteIds, parseFloat(vel.value)); S.engine.sync(S.project); if (S.roll) S.roll.draw(); }
      });
      vel.addEventListener('change', () => commit({ keepPanel: true }));
    }
  }

  // ── Transport ────────────────────────────────────────────────────────────
  async function togglePlay() {
    if (S.engine.isRecording()) { await finishRecording(); return; }
    if (S.engine.isPlaying()) S.engine.stop();
    else {
      S.engine.sync(S.project);
      await S.engine.play();
    }
    updateBar();
  }

  function goHome() {
    seek(0);
    S.scrollBeat = 0;
    syncScrollbar();
  }

  function nextAudioName() {
    return 'Audio ' + (S.project.tracks.filter(t => t.kind === 'audio').length + 1);
  }

  // Says so when the input in use is not the one that was chosen.
  function heardFrom(opened) {
    if (opened && opened.fellBack) UI().toast('The chosen input is not connected. Using the system default.');
    updateBar();
  }

  // Monitoring: hear the input through the app. It starts switched off every
  // time, because through speakers a microphone would feed back on itself.
  async function toggleMonitor() {
    try {
      heardFrom(await S.engine.setMonitor(!S.engine.isMonitoring()));
      refreshInputs();                                // their real names are known once listening is allowed
    } catch (e) {
      UI().toast('Could not open an input to listen to');
      updateBar();
    }
  }

  async function toggleRecord() {
    if (S.engine.isRecording()) { await finishRecording(); return; }
    let track = S.project.tracks.find(t => t.kind === 'audio' && t.armed);
    if (!track) {
      const picked = P().findTrack(S.project, S.sel.trackId);
      track = picked && picked.kind === 'audio' ? picked : P().addTrack(S.project, 'audio', { name: nextAudioName() });
      if (!track) { UI().toast('No room for another track'); return; }
      S.project.tracks.forEach(t => { t.armed = false; });
      track.armed = true;
      S.sel = { trackId: track.id, clipId: null, noteIds: [] };
      commit({ structure: true });
    }
    S.recTrackId = track.id;
    setStatus('Opening the input…');
    try {
      const opened = await S.engine.startRecording();
      setStatus('One bar of clicks, then recording. Press Stop when done.');
      heardFrom(opened);
      refreshInputs();                                // their real names are known once recording is allowed
    } catch (e) {
      setStatus('');
      UI().toast('Could not open an input to record from');
    }
    updateBar();
  }

  async function finishRecording() {
    const take = S.engine.stopRecording();
    setStatus('');
    const track = P().findTrack(S.project, S.recTrackId);
    if (!take || take.beats < 0.1 || !track) { UI().toast('Nothing was recorded'); updateBar(); return; }
    const audioId = newAudioId();
    S.engine.setAudio(audioId, take.sampleRate, take.channels);
    try {
      await global.DawStore.putAudio(audioId, S.project.id, take.sampleRate, take.channels);
    } catch (e) {
      UI().toast('The take could not be saved; it will be lost when the app closes');
    }
    const clip = P().addClip(track, {
      start: take.startBeat, length: take.beats, audioId, offset: take.latency,
      name: 'Take ' + (track.clips.length + 1),
    });
    if (clip) S.sel = { trackId: track.id, clipId: clip.id, noteIds: [] };
    commit();
    flushSave();                                      // a take is not left waiting on the autosave timer
  }

  // ── Bringing audio in ────────────────────────────────────────────────────
  function newAudioId() {
    return 'aud_' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
  }

  // The file's name without its extension, as a track name.
  function trackNameFor(file) {
    const base = String(file.name || '').replace(/\.[A-Za-z0-9]{1,5}$/, '').replace(/[\u0000-\u001f]+/g, ' ').trim();
    return (base || 'Audio').slice(0, P().LIMITS.name);
  }

  // Puts an audio file on a new track, starting at the playhead. The file is
  // decoded and copied into the project, so the original is not needed again.
  async function importAudio(file) {
    if (!file || !S.project) return;
    if (S.engine.isRecording()) { UI().toast('Stop recording before importing audio'); return; }
    const unfit = P().audioFileProblem(file.name, file.size);
    if (unfit) { UI().toast(unfit); return; }
    if (S.project.tracks.length >= P().LIMITS.tracks) { UI().toast('No room for another track'); return; }
    const projectId = S.project.id;
    const stillHere = () => S.active && S.project && S.project.id === projectId;
    setStatus(`Reading ${file.name}…`);
    let audio = null;
    try {
      audio = await S.engine.decode(await file.arrayBuffer());
    } catch (e) {
      audio = null;
    }
    setStatus('');
    if (!stillHere()) return;                         // left, or opened another song, meanwhile
    if (!audio) { UI().toast(`"${file.name}" could not be read as audio`); return; }
    const seconds = audio.channels[0].length / audio.sampleRate;
    const overlong = P().audioLengthProblem(seconds);
    if (overlong) { UI().toast(overlong); return; }

    const audioId = newAudioId();
    S.engine.setAudio(audioId, audio.sampleRate, audio.channels);
    try {
      await global.DawStore.putAudio(audioId, projectId, audio.sampleRate, audio.channels);
    } catch (e) {
      UI().toast('The audio could not be saved; it will be lost when the app closes');
    }
    if (!stillHere()) return;
    const track = P().addTrack(S.project, 'audio', { name: trackNameFor(file) });
    if (!track) { UI().toast('No room for another track'); return; }
    const clip = P().addClip(track, {
      start: snapBeat(S.engine.position()), length: seconds * S.project.tempo / 60, audioId, name: track.name,
    });
    S.sel = { trackId: track.id, clipId: clip ? clip.id : null, noteIds: [] };
    commit({ structure: true });
    flushSave();
    UI().toast('Audio imported');
  }

  // ── Export ───────────────────────────────────────────────────────────────
  function fileSlug() {
    return (S.project.title || 'song').replace(/[^A-Za-z0-9 _-]+/g, '').trim().slice(0, 60) || 'song';
  }

  function saveBytes(name, bytes, mime) {
    const a = doc.createElement('a');
    a.href = URL.createObjectURL(new Blob([bytes], { type: mime }));
    a.download = name;
    doc.body.appendChild(a);
    a.click();
    doc.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  async function exportMix(bits) {
    S.engine.stop();
    setStatus('Rendering the mixdown…');
    try {
      const out = await global.DawEngine.render(S.project, S.engine.audio);
      saveBytes(fileSlug() + '.wav', global.Wav.encode(out.channels, out.sampleRate, bits), 'audio/wav');
      UI().toast('Mixdown exported');
    } catch (e) {
      UI().toast('The mixdown could not be rendered');
    }
    setStatus('');
  }

  async function exportStems(bits) {
    S.engine.stop();
    const tracks = S.project.tracks.filter(t => t.clips.length);
    const files = [];
    try {
      for (let i = 0; i < tracks.length; i++) {
        setStatus(`Rendering stem ${i + 1} of ${tracks.length}…`);
        const out = await global.DawEngine.render(S.project, S.engine.audio, { onlyTrackId: tracks[i].id });
        const name = tracks[i].name.replace(/[^A-Za-z0-9 _-]+/g, '').trim() || 'track';
        files.push({ name: `${fileSlug()} - ${String(i + 1).padStart(2, '0')} ${name}.wav`, bytes: global.Wav.encode(out.channels, out.sampleRate, bits) });
      }
      if (global.Desktop && global.Desktop.saveFiles) {
        const res = await global.Desktop.saveFiles(files);
        UI().toast(res && res.saved ? `Saved ${res.saved} stems` : 'Export cancelled');
      } else {
        files.forEach((f, i) => setTimeout(() => saveBytes(f.name, f.bytes, 'audio/wav'), i * 400));
        UI().toast(`Exporting ${files.length} stems`);
      }
    } catch (e) {
      UI().toast('The stems could not be rendered');
    }
    setStatus('');
  }

  function openExport() {
    UI().openModal(`
      <div class="daw-export">
        <h2>Export</h2>
        <p>A mixdown is the whole song as one audio file, exactly as it plays here. Stems give you one file per track, each with its own effects, for mixing elsewhere.</p>
        <label class="daw-field">Audio quality
          <select id="dawBits"><option value="16">16-bit WAV</option><option value="24" selected>24-bit WAV</option></select></label>
        <div class="fd-actions">
          <button type="button" class="primary" data-export="mix">Mixdown</button>
          <button type="button" class="ghost" data-export="stems">Stems, one per track</button>
          <button type="button" class="ghost" data-export="midi">MIDI of the notes</button>
        </div>
      </div>`);
    doc.querySelectorAll('#modalContent [data-export]').forEach(btn => btn.addEventListener('click', () => {
      const bits = parseInt($('dawBits').value, 10) === 16 ? 16 : 24;
      const kind = btn.dataset.export;
      UI().closeModal();
      if (kind === 'mix') exportMix(bits);
      else if (kind === 'stems') exportStems(bits);
      else { saveBytes(fileSlug() + '.mid', P().toMidi(S.project), 'audio/midi'); UI().toast('MIDI exported'); }
    }));
  }

  function rebuild() {
    const sg = song();
    if (!sg) return;
    UI().confirmBox('Replace the note tracks with a fresh copy of the song as it is now? Note edits made here are lost (Undo brings them back); recordings are kept.')
      .then(ok => {
        if (!ok) return;
        const fresh = P().fromSong(sg);
        fresh.id = S.project.id;
        fresh.master = S.project.master;
        S.project.tracks.filter(t => t.kind === 'audio').forEach(t => fresh.tracks.push(t));
        S.project = P().sanitize(fresh);
        S.sel = { trackId: S.project.tracks[0] ? S.project.tracks[0].id : null, clipId: null, noteIds: [] };
        commit({ structure: true });
        UI().toast('Rebuilt from the song');
      });
  }

  // ── Wiring ───────────────────────────────────────────────────────────────
  function on(id, event, fn) {
    const node = $(id);
    if (node) node.addEventListener(event, fn);
  }
  // A clicked button gives focus back so Space keeps meaning play/stop.
  function press(id, fn) { on(id, 'click', e => { e.currentTarget.blur(); fn(); }); }

  // Sliders do the same once the mouse lets go of them: left focused, Home
  // would drag a fader to the bottom instead of going to the start. A slider
  // reached with Tab keeps the keyboard, so the arrow keys can still nudge it.
  function wireSliderFocus() {
    let held = null;
    const release = e => {
      if (!held || e.target !== held) return;
      const slider = held;
      held = null;
      setTimeout(() => slider.blur(), 0);
    };
    root().addEventListener('pointerdown', e => {
      held = e.target.matches && e.target.matches('input[type="range"]') ? e.target : null;
    });
    root().addEventListener('pointerup', release);
    root().addEventListener('change', release);
  }

  function carriesFiles(e) {
    return !!e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
  }

  // Listeners that outlive a redraw: they sit on the view itself or the window.
  function wireOnce() {
    wireSliderFocus();
    const settings = global.Storage.getSettings();
    S.panelH = typeof settings.dawPanel === 'number' && Number.isFinite(settings.dawPanel) && settings.dawPanel > 0 ? settings.dawPanel : 0;
    S.input = typeof settings.dawInput === 'string' ? settings.dawInput.slice(0, 200) : '';
    S.engine.setInput(S.input);
    refreshInputs();
    const devices = global.navigator.mediaDevices;
    if (devices && devices.addEventListener) devices.addEventListener('devicechange', refreshInputs);
    global.addEventListener('resize', () => { if (S.active && S.project) showPanelHeight(); });
    // An audio file dropped anywhere on the DAW is imported.
    root().addEventListener('dragover', e => {
      if (!carriesFiles(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    });
    root().addEventListener('drop', e => {
      if (!carriesFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer.files[0]) importAudio(e.dataTransfer.files[0]);
    });
  }

  // The divider above the editor panel: drag to resize, double-click to reset.
  function wireSplit() {
    const grip = $('dawSplit');
    const remember = () => global.Storage.setSettings({ dawPanel: S.panelH });
    grip.addEventListener('pointerdown', e => {
      e.preventDefault();
      grip.setPointerCapture(e.pointerId);
      grip.classList.add('dragging');
      const fromY = e.clientY;
      const fromH = $('dawPanel').getBoundingClientRect().height;
      const move = ev => { S.panelH = Math.max(150, fromH + fromY - ev.clientY); showPanelHeight(); };
      const done = () => {
        grip.classList.remove('dragging');
        grip.removeEventListener('pointermove', move);
        grip.removeEventListener('pointerup', done);
        grip.removeEventListener('pointercancel', done);
        S.panelH = Math.round($('dawPanel').getBoundingClientRect().height);   // what the window allowed
        remember();
      };
      grip.addEventListener('pointermove', move);
      grip.addEventListener('pointerup', done);
      grip.addEventListener('pointercancel', done);
    });
    grip.addEventListener('dblclick', () => { S.panelH = 0; showPanelHeight(); remember(); });
  }

  function wireBar() {
    press('dawHome', goHome);
    press('dawPlay', togglePlay);
    press('dawRec', toggleRecord);
    press('dawLoop', () => { S.project.loop.on = !S.project.loop.on; commit({ keepPanel: true }); });
    press('dawClick', () => { S.click = !S.click; S.engine.setClick(S.click); updateBar(); });
    press('dawUndo', () => restore(S.history.undo()));
    press('dawRedo', () => restore(S.history.redo()));
    press('dawZoomIn', () => zoom(1.3, S.engine.position()));
    press('dawZoomOut', () => zoom(1 / 1.3, S.engine.position()));
    press('dawRebuild', rebuild);
    press('dawExport', openExport);
    press('dawImport', () => $('dawImportFile').click());
    on('dawImportFile', 'change', () => {
      const input = $('dawImportFile');
      const file = input.files && input.files[0];
      input.value = '';                               // so the same file can be chosen again
      if (file) importAudio(file);
    });
    press('dawKeys', () => UI().openModal(global.Learn.renderShortcuts('daw')));
    on('dawTempo', 'change', () => {
      const input = $('dawTempo');
      const tempo = Math.max(40, Math.min(240, Math.round(parseFloat(input.value) || S.project.tempo)));
      input.value = tempo;
      input.blur();
      if (tempo !== S.project.tempo) { S.project.tempo = tempo; commit({ keepPanel: true }); }
    });
    on('dawSnap', 'change', () => {
      S.snap = parseFloat($('dawSnap').value) || 0;
      $('dawSnap').blur();
      if (S.roll) S.roll.draw();
    });
    on('dawInput', 'change', () => {
      S.input = $('dawInput').value;
      $('dawInput').blur();
      global.Storage.setSettings({ dawInput: S.input });
      S.engine.setInput(S.input).then(heardFrom, () => {
        UI().toast('Could not open that input');
        updateBar();
      });
    });
    press('dawMonitor', toggleMonitor);
    on('dawHScroll', 'scroll', () => {
      S.scrollBeat = $('dawHScroll').scrollLeft / S.pxPerBeat;
      S.dirty = true;
    });
    doc.querySelectorAll('#dawPanelTabs [data-panel]').forEach(btn => btn.addEventListener('click', () => {
      btn.blur();
      S.panel = btn.dataset.panel;
      markPanelTab();
      refreshPanel();
    }));
    if (global.ResizeObserver) {
      if (S.observer) S.observer.disconnect();
      S.observer = new global.ResizeObserver(() => {
        if (!S.active || !S.arrange) return;
        S.arrange.resize();
        if (S.roll) { S.roll.resize(); S.roll.draw(); }
        S.dirty = true;
      });
      S.observer.observe($('dawLanes'));
      S.observer.observe($('dawPanelBody'));
    }
  }

  function wireHeads() {
    doc.querySelectorAll('#dawHeads .daw-head').forEach(node => {
      const id = node.dataset.track;
      node.addEventListener('click', e => {
        const track = P().findTrack(S.project, id);
        const act = e.target.dataset && e.target.dataset.act;
        if (!track) return;
        if (act === 'mute' || act === 'solo') {
          e.target.blur();
          track[act] = !track[act];
          commit({ keepPanel: S.panel !== 'mixer' });
        } else if (act === 'arm') {
          e.target.blur();
          const next = !track.armed;
          S.project.tracks.forEach(t => { t.armed = false; });
          track.armed = next;
          commit({ keepPanel: true });
        } else if (act === 'remove') {
          UI().confirmBox(`Remove the track "${track.name}" and everything on it?`).then(ok => {
            if (!ok) return;
            P().removeTrack(S.project, id);
            if (S.sel.trackId === id) S.sel = { trackId: S.project.tracks[0] ? S.project.tracks[0].id : null, clipId: null, noteIds: [] };
            commit({ structure: true });
          });
        } else if (act !== 'instrument') {
          select(id, S.sel.trackId === id ? S.sel.clipId : null);
        }
      });
      node.querySelector('.daw-name').addEventListener('dblclick', () => {
        const track = P().findTrack(S.project, id);
        UI().promptBox('Track name:', track.name).then(name => {
          if (name === null || !name.trim()) return;
          track.name = name.trim().slice(0, 60);
          commit({ structure: true });
        });
      });
      const inst = node.querySelector('select[data-act="instrument"]');
      if (inst) inst.addEventListener('change', () => {
        const track = P().findTrack(S.project, id);
        inst.blur();
        track.instrument = inst.value;
        commit({ keepPanel: true });
        S.engine.audition(id, 60, 0.7);
      });
    });
    doc.querySelectorAll('#dawHeads [data-add]').forEach(btn => btn.addEventListener('click', () => {
      const kind = btn.dataset.add;
      const track = P().addTrack(S.project, kind, kind === 'audio' ? { name: nextAudioName() } : {});
      if (!track) { UI().toast('No room for another track'); return; }
      S.sel = { trackId: track.id, clipId: null, noteIds: [] };
      commit({ structure: true });
    }));
  }

  // ── Frame loop ───────────────────────────────────────────────────────────
  function frame() {
    if (!S.active) return;
    S.raf = requestAnimationFrame(frame);
    if (!S.project || !S.arrange) return;
    const playing = S.engine.isPlaying();
    const pos = S.engine.position();
    const themeNow = doc.documentElement.dataset.theme;
    if (themeNow !== S.theme) { S.theme = themeNow; S.dirty = true; }   // the canvases read the theme's colours

    if (playing && !S.project.loop.on && !S.engine.isRecording() && pos > Math.max(P().endBeat(S.project), 4) + 4) {
      S.engine.stop();
      S.engine.seek(0);
    }
    if (playing !== S.wasPlaying) { S.wasPlaying = playing; updateBar(); }
    // A take held in memory cannot grow for ever.
    if (S.engine.recordedSeconds() >= P().LIMITS.audioSeconds) {
      finishRecording().then(() => UI().toast('Recording stopped: that is the longest take a project can hold.'));
    }

    if (playing) {
      const canvas = $('dawCanvas');
      const visible = canvas.clientWidth / S.pxPerBeat;
      if (pos > S.scrollBeat + visible * 0.94 || pos < S.scrollBeat) {
        S.scrollBeat = Math.max(0, pos - visible * 0.08);
        syncScrollbar();
      }
    }
    if (playing || pos !== S.lastPos || S.dirty) {
      S.lastPos = pos;
      S.dirty = false;
      const whole = Math.floor(pos + 1e-6);
      $('dawBars').textContent = (Math.floor(whole / 4) + 1) + '.' + (whole % 4 + 1);
      const sec = pos * 60 / S.project.tempo;
      $('dawClock').textContent = Math.floor(sec / 60) + ':' + (sec % 60).toFixed(1).padStart(4, '0');
      S.arrange.draw();
      if (S.roll && S.panel === 'notes') S.roll.draw();
    }
    if (S.panel === 'mixer') global.DawMixer.setLevels($('dawPanelBody'), S.engine.levels());
  }

  // ── Keyboard ─────────────────────────────────────────────────────────────
  function handleKey(e) {
    if (!S.active || !S.project) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (k === ' ') { e.preventDefault(); togglePlay(); }
    else if (k === 'Home') { e.preventDefault(); goHome(); }
    else if (mod && k === 'z') { e.preventDefault(); restore(e.shiftKey ? S.history.redo() : S.history.undo()); }
    else if (mod && k === 'y') { e.preventDefault(); restore(S.history.redo()); }
    else if (mod && k === 'd') { e.preventDefault(); duplicateSelected(); }
    else if (mod && k === 'a') {
      e.preventDefault();                               // never "select all the text on the page"
      const clip = editedClip();
      if (clip) { selectNotes(clip.notes.map(n => n.id)); if (S.roll) S.roll.draw(); }
    }
    // Copying text someone has highlighted, such as a tab, is left to the system.
    else if (mod && (k === 'c' || k === 'x')) { if (!String(global.getSelection()) && copySelectedNotes(k === 'x')) e.preventDefault(); }
    else if (mod && k === 'v') { if (pasteNotes()) e.preventDefault(); }
    else if (mod) return;
    else if (k === 'ArrowLeft' || k === 'ArrowRight') {
      if (nudgeNotes((k === 'ArrowLeft' ? -1 : 1) * (S.snap > 0 ? S.snap : 0.25), 0)) e.preventDefault();
    } else if (k === 'ArrowUp' || k === 'ArrowDown') {
      if (nudgeNotes(0, (k === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 12 : 1))) e.preventDefault();
    }
    else if (k === 'r') toggleRecord();
    else if (k === 'l') { S.project.loop.on = !S.project.loop.on; commit({ keepPanel: true }); }
    else if (k === 's') splitSelected();
    else if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); deleteSelected(); }
    else if (k === '+' || k === '=') zoom(1.3, S.engine.position());
    else if (k === '-') zoom(1 / 1.3, S.engine.position());
  }

  global.Views = global.Views || {};
  global.Views.Daw = { enter, leave, handleKey, forget };
})(typeof window !== 'undefined' ? window : globalThis);
