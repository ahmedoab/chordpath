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
    shownStretch: '',                // the tempo and time signature the transport bar is showing
    fitting: false,                  // takes are being stretched to the tempo right now
    reopened: false,                 // the sound card saved from last time has been tried
    resetting: false,                // an ASIO driver asked to be opened again, and is being
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

  const BAR = 4;                     // the Snap setting that means "to the bar line"

  function snapBeat(beat) {
    if (S.snap === BAR) return P().nearestBar(S.project, Math.max(0, beat));   // bars follow the time signature
    return Math.max(0, S.snap > 0 ? Math.round(beat / S.snap) * S.snap : beat);
  }
  // The grid step in beats: for "Bar", the length of the bar at that point.
  function gridStep(at) {
    if (S.snap === BAR) return P().positionAt(S.project, at).length;
    return S.snap > 0 ? S.snap : 0.25;
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
    fitTakes();
    if (opts.structure || headShape() !== S.headShape) { render(); return; }
    if (!opts.keepPanel) refreshPanel();
    refreshHeads();
    updateBar();
    S.arrange.resize();
    S.dirty = true;
  }

  // Undo and redo. Not while a take is being made: that could take away the track it is going onto.
  function undo(back) {
    if (S.engine.isRecording()) { UI().toast('Stop recording before undoing'); return; }
    restore(back ? S.history.undo() : S.history.redo());
  }

  function restore(state) {
    if (!state) return;
    S.project = P().sanitize(state);
    if (!P().findTrack(S.project, S.sel.trackId)) S.sel.trackId = S.project.tracks[0] ? S.project.tracks[0].id : null;
    if (S.sel.clipId && !P().findClip(S.project, S.sel.clipId)) S.sel.clipId = null;
    S.sel.noteIds = [];
    S.engine.sync(S.project);
    scheduleSave();
    fitTakes();
    render();
  }

  // ── Opening ──────────────────────────────────────────────────────────────
  async function loadAudio(project) {
    const ids = new Set(audioIds(project).filter(id => !S.engine.hasAudio(id)));
    for (const id of ids) {
      try {
        const a = await global.DawStore.getAudio(id);
        if (a) S.engine.setAudio(id, a.sampleRate, a.channels);
      } catch (e) { /* the clip will show as missing */ }
    }
  }

  // Every recording the project uses: each clip's own, and those of its other takes.
  function audioIds(project) {
    const ids = new Set();
    project.tracks.forEach(t => t.clips.forEach(c => P().takesOf(c).forEach(take => ids.add(take.audioId))));
    return Array.from(ids);
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
    fitTakes();
    reopenCard();
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
  // What decides how the track headers are laid out: when it changes, they are drawn again.
  function headShape() {
    const A = global.DawArrange;
    const lanes = list => list.map(l => l.id + (l.on ? '+' : '-') + l.name).join(';');
    return S.project.tracks.map(t => t.id + ':' + A.laneHeight(t) + ':' + hasTakes(t) + ':' + (t.showAuto ? lanes(t.auto) : '')).join(',') +
      '|' + A.masterHeight(S.project) + ':' + (S.project.showMaster ? lanes(S.project.masterAuto) : '');
  }

  // The rows beside a track's (or the master's) automation: each lane's
  // name, a switch to use it or not, and a cross to take it away; then a row
  // to add another from.
  function autoHeadHTML(list, master) {
    const A = global.DawArrange;
    return list.map(lane => `
      <div class="daw-auto-row" data-lane="${esc(lane.id)}" style="height:${A.AUTO_H}px">
        <input type="checkbox" data-act="laneOn"${lane.on ? ' checked' : ''} title="Use this lane. Off, the mixer's own setting is used." aria-label="Use this lane" />
        <span class="daw-auto-name" title="${esc(lane.name)}">${esc(lane.name)}</span>
        <button type="button" class="daw-x" data-act="laneRemove" title="Remove this lane" aria-label="Remove this lane">×</button>
      </div>`).join('') + `
      <div class="daw-auto-row add" style="height:${A.AUTO_H}px">
        <button type="button" class="ghost small" data-act="laneAdd" data-target="volume" title="Automate the volume">+ Volume</button>
        ${master ? '' : '<button type="button" class="ghost small" data-act="laneAdd" data-target="pan" title="Automate the pan">+ Pan</button>'}
        <button type="button" class="ghost small" data-act="laneAdd" data-target="param" title="Automate a setting of one of the plugins here">+ Plugin…</button>
      </div>`;
  }

  function headHTML(track) {
    const A = global.DawArrange;
    const insts = track.kind === 'instrument'
      ? `<select data-act="instrument" aria-label="Instrument">${P().INSTRUMENTS.map(i =>
          `<option value="${i.id}"${i.id === track.instrument ? ' selected' : ''}>${esc(i.name)}</option>`).join('')}</select>`
      : `<span class="daw-kind">${track.kind === 'drums' ? 'Drum kit' : 'Audio'}</span>`;
    return `
      <div class="daw-head${track.id === S.sel.trackId ? ' selected' : ''}" data-track="${esc(track.id)}" style="height:${A.laneHeight(track)}px;--tc:${esc(track.color)}">
        <div class="daw-head-main" style="height:${A.LANE_H - 1}px">
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
            ${hasTakes(track) ? `<button type="button" class="mx-btn takes${track.showTakes ? ' on' : ''}" data-act="takes" title="Show every take in rows under the track, to choose the best of each">Takes</button>` : ''}
            <button type="button" class="mx-btn auto${track.showAuto ? ' on' : ''}${track.auto.length ? ' has' : ''}" data-act="auto" title="Automation: the volume, pan or a plugin setting changing as the song plays">Auto</button>
          </div>
        </div>
        ${A.takesHeight(track) ? `<div style="height:${A.takesHeight(track)}px"></div>` : ''}
        ${track.showAuto ? autoHeadHTML(track.auto, false) : ''}
      </div>`;
  }

  // The master's lanes, below the tracks, while they are shown.
  function masterHeadHTML() {
    if (!S.project.showMaster) return '';
    return `
      <div class="daw-head master" data-master="1" style="height:${global.DawArrange.masterHeight(S.project)}px" title="Automation of the master: the whole mix">
        ${autoHeadHTML(S.project.masterAuto, true)}
      </div>`;
  }

  function hasTakes(track) {
    return track.kind === 'audio' && track.clips.some(c => P().takesOf(c).length > 1);
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
      if (!pick) return;
      pick.innerHTML = inputOptions();
      nameInput();
    }).catch(() => { /* no list; the system default still records */ });
  }
  // The picker is narrow, so the whole name of the chosen input is its tooltip.
  function nameInput() {
    const pick = $('dawInput');
    const chosen = pick && pick.options[pick.selectedIndex];
    if (chosen) pick.title = chosen.textContent;
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
        <label class="daw-field" title="The input that recording listens to">Input <select id="dawInput" aria-label="Input to record from">${inputOptions()}</select></label>
        <button type="button" class="ghost daw-toggle" id="dawMonitor" title="Monitor: hear your input through the app while you play. Use headphones: through speakers the microphone would pick itself up.">Monitor</button>
        <div class="daw-pos"><span id="dawBars" class="mono">1.1</span><span id="dawClock" class="meta">0:00.0</span></div>
        <label class="daw-field" title="The tempo where the playhead is. Typing here changes it for that stretch of the song.">♩ <input id="dawTempo" aria-label="Tempo" type="number" min="40" max="240" value="${esc(p.tempo)}" /></label>
        <button type="button" class="ghost" id="dawMeter" title="Time signature where the playhead is. Click to change tempo or time signature part-way through the song.">4/4</button>
        <button type="button" class="ghost daw-toggle" id="dawLoop" title="Loop (L). Drag in the bar ruler to set the range, or click a section. Recording while it loops keeps every pass as a take.">Loop</button>
        <button type="button" class="ghost daw-toggle daw-punch" id="dawPunch" title="Punch in and out (P): recording keeps only the stretch marked in red on the bar ruler. Shift-drag in the ruler to mark it.">Punch</button>
        <button type="button" class="ghost daw-toggle" id="dawClick" title="Metronome">Click</button>
        <label class="daw-field">Snap <select id="dawSnap">${SNAPS.map(([v, name]) =>
          `<option value="${v}"${v === S.snap ? ' selected' : ''}>${name}</option>`).join('')}</select></label>
        <div class="daw-actions">
          <button type="button" class="ghost" id="dawUndo" title="Undo (Ctrl+Z)" aria-label="Undo">↶</button>
          <button type="button" class="ghost" id="dawRedo" title="Redo (Ctrl+Y)" aria-label="Redo">↷</button>
          <span class="daw-zoom" role="group" aria-label="Zoom" title="Zoom the timeline (- and +, or Ctrl and the mouse wheel)">
            <button type="button" class="ghost" id="dawZoomOut" title="Zoom out (-)" aria-label="Zoom out">−</button>
            <button type="button" class="ghost" id="dawZoomIn" title="Zoom in (+)" aria-label="Zoom in">+</button>
          </span>
          <button type="button" class="ghost" id="dawRebuild" title="Bring in the song's chords and parts as they are now in Write, replacing the note tracks here. Recordings are kept.">Update from song</button>
          <button type="button" class="ghost" id="dawImport" title="Bring an audio file in on a track of its own. You can also drop a file anywhere here.">Import…</button>
          <input type="file" id="dawImportFile" accept="audio/*,.wav,.mp3,.ogg,.oga,.flac,.m4a,.aac,.opus" hidden />
          <button type="button" class="ghost" id="dawExport">Export…</button>
          <button type="button" class="ghost daw-toggle" id="dawAudio">Audio…</button>
          <button type="button" class="ghost" id="dawKeys" title="Keyboard shortcuts (?)" aria-label="Keyboard shortcuts">?</button>
        </div>
      </div>
      <div class="daw-arrange" id="dawArrange">
        <div class="daw-heads" id="dawHeads" style="width:${HEAD_W}px;padding-top:${A.TOP}px">
          <div class="daw-status" id="dawStatus" style="height:${A.TOP}px" aria-live="polite">${esc(S.status)}</div>
          ${p.tracks.map(headHTML).join('')}
          ${masterHeadHTML()}
          <div class="daw-add">
            <button type="button" class="ghost small" data-add="instrument">+ Instrument</button>
            <button type="button" class="ghost small" data-add="drums">+ Drums</button>
            <button type="button" class="ghost small" data-add="audio">+ Audio</button>
          </div>
          <div class="daw-add daw-add-master">
            <button type="button" class="ghost small daw-toggle${p.showMaster ? ' on' : ''}" id="dawMasterAuto" title="Automate the master: the volume of the whole mix, such as a fade at the end, or a setting of a plugin on it">Master automation</button>
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

    S.headShape = headShape();
    showPanelHeight();
    S.arrange = A.create($('dawCanvas'), arrangeHost);
    S.roll = null;
    S.rollClipId = null;
    wireBar();
    markAudio();
    wireSplit();
    wireHeads();
    S.arrange.resize();
    syncScrollbar();
    refreshPanel();
    updateBar();
    S.dirty = true;
  }

  function refreshHeads() {
    doc.querySelectorAll('#dawHeads .daw-head[data-track]').forEach(node => {
      const track = P().findTrack(S.project, node.dataset.track);
      if (!track) return;
      node.classList.toggle('selected', track.id === S.sel.trackId);
      const set = (act, on) => { const b = node.querySelector(`[data-act="${act}"]`); if (b) b.classList.toggle('on', on); };
      set('mute', track.mute); set('solo', track.solo); set('arm', track.armed); set('takes', track.showTakes); set('auto', track.showAuto);
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
    $('dawPunch').classList.toggle('on', !!P().punchRange(S.project));
    $('dawClick').classList.toggle('on', S.click);
    $('dawUndo').disabled = !S.history.canUndo();
    $('dawRedo').disabled = !S.history.canRedo();
    showTimingAt(S.engine.position());
  }

  // The tempo box and the time-signature button read what holds at the playhead.
  function showTimingAt(beat) {
    const here = P().stretchAt(S.project, beat);
    if (doc.activeElement !== $('dawTempo')) $('dawTempo').value = here.tempo;
    $('dawMeter').textContent = here.num + '/' + here.den;
    S.shownStretch = here.beat + ':' + here.tempo + ':' + here.num + '/' + here.den;
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
    peakBetween: (id, from, to) => S.engine.peakBetween(id, from, to),
    snapBeat, gridStep,
    actions: {
      select, seek,
      openTiming,
      redraw: () => { S.dirty = true; },
      commit: () => commit(),
      previewLoop(a, b) {
        if (loopLocked()) return;
        S.project.loop.start = a; S.project.loop.end = Math.max(b, a + 0.25); S.project.loop.on = true; S.dirty = true;
      },
      commitLoop() { if (!loopLocked()) commit({ keepPanel: true }); },
      previewPunch(a, b) {
        if (S.engine.isRecording()) return;
        S.project.punch = { on: true, start: a, end: Math.max(b, a + 0.25) };
        S.dirty = true;
      },
      commitPunch() { if (!S.engine.isRecording()) commit({ keepPanel: true }); },
      pickSection(index) {
        if (loopLocked()) return;
        const m = S.project.markers[index];
        const end = index + 1 < S.project.markers.length ? S.project.markers[index + 1].beat : P().endBeat(S.project);
        const same = S.project.loop.on && S.project.loop.start === m.beat && S.project.loop.end === end;
        S.project.loop = { on: !same, start: m.beat, end: Math.max(end, m.beat + 0.25) };
        if (!same) seek(m.beat);
        commit({ keepPanel: true });
      },
      // A new clip fills the bar that was double-clicked.
      createClip(trackId, beat) {
        const track = P().findTrack(S.project, trackId);
        const bar = P().positionAt(S.project, beat);
        const clip = P().addClip(track, { start: bar.start, length: bar.length, name: sectionAt(bar.start) || track.name });
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

  // While a take is being recorded round a loop the loop stays as it is:
  // the passes are cut from the take by it.
  function loopLocked() {
    if (!S.engine.isRecording()) return false;
    UI().toast('Stop recording to change the loop');
    return true;
  }
  function toggleLoop() {
    if (loopLocked()) return;
    S.project.loop.on = !S.project.loop.on;
    commit({ keepPanel: true });
  }

  // Punch in and out. Turned on with no range marked, it marks the loop's,
  // or else the bar the playhead is in.
  function togglePunch() {
    if (S.engine.isRecording()) { UI().toast('Stop recording to change the punch range'); return; }
    const punch = S.project.punch;
    if (punch.on) { punch.on = false; commit({ keepPanel: true }); return; }
    if (!(punch.end - punch.start >= 0.25)) {
      const loop = S.project.loop;
      const bar = P().positionAt(S.project, S.engine.position());
      const range = loop.end > loop.start ? [loop.start, loop.end] : [bar.start, bar.start + bar.length];
      punch.start = range[0];
      punch.end = range[1];
    }
    punch.on = true;
    commit({ keepPanel: true });
    setStatus(`Punch: recording keeps bar ${P().positionAt(S.project, punch.start).bar} to bar ${P().positionAt(S.project, punch.end - 1e-6).bar}. Shift-drag in the ruler to change it.`);
  }

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

  // A drum clip as a step grid, a block for every bar that has hits in it.
  function drumGridText(clip) {
    const lanes = P().DRUM_LANES;
    const out = [];
    P().clipBars(S.project, clip).forEach(bar => {
      const steps = Math.max(1, Math.round(bar.length * 4));
      const lines = lanes.map(l => {
        const cells = Array(steps).fill('-');
        clip.notes.forEach(n => {
          const step = Math.round((n.t - bar.start) * 4);
          if (n.n === l.note && n.t < clip.length && step >= 0 && step < steps) cells[step] = 'x';
        });
        return l.name.padEnd(11) + '|' + cells.join('') + '|';
      }).filter(line => line.includes('x'));
      const count = global.Tabs.countLabels(bar.num, bar.den).slice(Math.round(bar.skip * 4), Math.round(bar.skip * 4) + steps);
      if (lines.length) out.push('Bar ' + bar.bar + '\n' + lines.join('\n') + '\n' + ' '.repeat(12) + count.map(c => c || ' ').join(''));
    });
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
      totalBeats: clip.length, tempo: P().tempoAt(S.project, clip.start), register: low ? 'bass' : 'full', lineWidth: 140,
      bars: P().clipBars(S.project, clip),
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

  // What following the tempo is doing to a recording, in a sentence.
  function stretchNote(clip) {
    if (!clip.stretch) return 'Off: the audio plays at its own speed whatever the tempo, so it will drift if the tempo changes.';
    const rate = P().clipRate(S.project, clip);
    if (rate === 1) return 'The song is at this tempo here, so the audio plays exactly as it is.';
    const gentle = global.Stretch.LIMITS.gentle;
    const limits = global.Stretch.LIMITS;
    if (rate < limits.least || rate > limits.most) return 'The tempos are too far apart to stretch between; the audio plays at its own speed.';
    return `Stretched to ${Math.round(rate * 100)}% of its length to follow ${P().tempoAt(S.project, clip.start)} bpm. The pitch stays the same.` +
      (rate < gentle[0] || rate > gentle[1] ? ' A change this large can sound grainy.' : '');
  }

  // Makes the stretched copies that takes following the tempo need. Until one
  // is ready its take plays as it was recorded.
  function fitTakes() {
    if (S.fitting) return;
    const work = S.engine.unfitted().length > 0;
    S.fitting = true;
    if (work) setStatus('Fitting takes to the tempo…');
    S.engine.prepare(part => {
      setStatus(`Fitting takes to the tempo… ${Math.round(part * 100)}%`);
      return new Promise(resolve => setTimeout(resolve, 0));
    }).catch(() => UI().toast('A take could not be fitted to the tempo; it plays as recorded'))
      .then(() => {
        S.fitting = false;
        if (work) setStatus('');
        S.dirty = true;
        if (S.project && S.engine.unfitted().length) fitTakes();       // an edit came in meanwhile
      });
  }

  // The takes of an audio clip, to choose between, when it has more than one.
  function takesHTML(track, clip) {
    const takes = P().takesOf(clip);
    if (takes.length < 2) return '';
    const regions = P().compRegions(clip);
    const used = k => regions.filter(r => r.take === k).reduce((sum, r) => sum + r.to - r.from, 0);
    const share = k => {
      const beats = used(k);
      if (beats < 1e-6) return 'not in use';
      if (clip.length - beats < 1e-6) return 'in use all through';
      return `in use for ${Math.round(beats * 100) / 100} of ${Math.round(clip.length * 100) / 100} beats`;
    };
    return `
      <div class="daw-takes">
        <div class="daw-takes-head">
          <strong>${takes.length} takes</strong>
          <label class="daw-check"><input type="checkbox" id="dawShowTakes"${track.showTakes ? ' checked' : ''} /> Show them under the track</label>
          <button type="button" class="ghost small" id="dawDropTakes" title="Delete the takes that are not in use anywhere in this clip">Remove unused</button>
        </div>
        <p class="meta">With the takes shown, drag along a take's row to use it there, click a stretch to swap it, or double-click a row to use that take all through.</p>
        <ol class="daw-take-list">
          ${takes.map((t, k) => `
            <li class="${used(k) > 1e-6 ? 'used' : ''}">
              <span class="daw-take-name">Take ${k + 1}</span>
              <span class="meta">${share(k)}</span>
              <button type="button" class="ghost small" data-take-use="${k}" title="Use this take all through the clip">Use all through</button>
              <button type="button" class="ghost small danger" data-take-del="${k}" title="Delete this take">Delete</button>
            </li>`).join('')}
        </ol>
      </div>`;
  }
  function wireTakes(track, clip) {
    const show = $('dawShowTakes');
    if (!show) return;
    show.addEventListener('change', () => { track.showTakes = show.checked; commit({ structure: true }); });
    $('dawDropTakes').addEventListener('click', () => {
      const gone = P().removeUnusedTakes(clip);
      if (!gone) { UI().toast('Every take is in use somewhere'); return; }
      commit({ structure: true });
      UI().toast(`${gone} take${gone === 1 ? '' : 's'} removed. Undo brings ${gone === 1 ? 'it' : 'them'} back.`);
    });
    doc.querySelectorAll('[data-take-use]').forEach(b => b.addEventListener('click', () => {
      P().useTake(clip, parseInt(b.dataset.takeUse, 10));
      commit();
    }));
    doc.querySelectorAll('[data-take-del]').forEach(b => b.addEventListener('click', () => {
      P().removeTake(clip, parseInt(b.dataset.takeDel, 10));
      commit({ structure: true });
    }));
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
    $('dawClipInfo').textContent = clip ? clipInfo(track, clip) : (track ? track.name + ' track' : '');
    $('dawTools').innerHTML = S.panel === 'mixer' ? '' : toolsHTML(track, clip);
    wireTools();

    if (S.panel === 'mixer') {
      S.roll = null; S.rollClipId = null;
      global.DawMixer.render(body, S.project, {
        live: () => { S.engine.sync(S.project); S.dirty = true; },
        done: () => { commit({ keepPanel: true }); },
        plugins: trackId => openPlugins(trackId),
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
      const fadeBox = (id, value, name) => `<label class="daw-field" title="${name} in beats. You can also drag the small square on the clip's top corner.">${name}
        <input type="number" id="${id}" min="0" step="0.25" value="${esc(Math.round(value * 1000) / 1000)}" /> beats</label>`;
      body.innerHTML = `
        <div class="daw-hint daw-audio">
          <p>Recorded audio. Drag it on the timeline to move it, drag either edge to trim it, drag the squares on its top corners to fade it in or out, press S to split it at the playhead.</p>
          <div class="daw-audio-row">
            <label class="daw-field">Clip gain <input type="range" id="dawGain" min="0" max="2" step="0.01" value="${esc(clip.gain)}" /></label>
            ${fadeBox('dawFadeIn', clip.fadeIn, 'Fade in')}
            ${fadeBox('dawFadeOut', clip.fadeOut, 'Fade out')}
          </div>
          <label class="daw-check"><input type="checkbox" id="dawStretch"${clip.stretch ? ' checked' : ''} /> Keep in time when the tempo changes</label>
          <label class="daw-field" title="The tempo the audio was played at. For a loop from elsewhere, type its own tempo.">Played at
            <input type="number" id="dawClipTempo" min="20" max="400" value="${esc(clip.tempo || P().tempoAt(S.project, clip.start))}" /> bpm</label>
          <p class="meta" id="dawStretchNote">${esc(stretchNote(clip))}</p>
          ${takesHTML(track, clip)}
        </div>`;
      wireTakes(track, clip);
      [['dawFadeIn', 'in'], ['dawFadeOut', 'out']].forEach(([id, which]) => $(id).addEventListener('change', () => {
        P().setFade(clip, which, Math.max(0, parseFloat($(id).value) || 0));
        commit();
      }));
      const gain = $('dawGain');
      gain.addEventListener('input', () => { clip.gain = parseFloat(gain.value); S.engine.sync(S.project); S.dirty = true; });
      gain.addEventListener('change', () => commit({ keepPanel: true }));
      $('dawStretch').addEventListener('change', () => {
        P().setStretch(S.project, clip, $('dawStretch').checked);
        commit();
      });
      $('dawClipTempo').addEventListener('change', () => {
        P().setClipTempo(S.project, clip, parseFloat($('dawClipTempo').value));
        commit();
      });
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
        project: S.project, track, clip, sel: S.sel, rollPx: S.rollPx,
        snap: S.snap === BAR && clip ? gridStep(clip.start) : S.snap,
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
    // Round a loop, recording starts in it. Punching in, it starts a bar
    // before the punch range, unless the playhead is already before it.
    const loop = S.project.loop.on && S.project.loop.end > S.project.loop.start ? S.project.loop : null;
    const punch = P().punchRange(S.project);
    const here = S.engine.position();
    if (loop && (here < loop.start || here >= loop.end)) await S.engine.seek(loop.start);
    else if (!loop && punch && here >= punch[0]) await S.engine.seek(P().positionAt(S.project, Math.max(0, punch[0] - 1e-6)).start);
    setStatus('Opening the input…');
    try {
      const opened = await S.engine.startRecording();
      const bars = range => `bar ${P().positionAt(S.project, range[0]).bar} to bar ${P().positionAt(S.project, range[1] - 1e-6).bar}`;
      setStatus(loop ? 'One bar of clicks, then recording round the loop: every pass is kept as a take. Press Stop when done.'
        : punch ? `One bar of clicks, then play along: only ${bars(punch)} is kept.`
          : 'One bar of clicks, then recording. Press Stop when done.');
      heardFrom(opened);
      refreshInputs();                                // their real names are known once recording is allowed
    } catch (e) {
      setStatus('');
      UI().toast('Could not open an input to record from');
    }
    updateBar();
  }

  async function finishRecording() {
    if (S.finishing) return;
    S.finishing = true;
    try { await keepTake(await S.engine.finishTake()); }
    finally { S.finishing = false; }
  }

  // Turns what was recorded into takes on the track it was recorded onto.
  async function keepTake(take) {
    setStatus('');
    const track = P().findTrack(S.project, S.recTrackId);
    const punch = P().punchRange(S.project);
    const audioId = newAudioId();
    const made = take && track ? P().takesFromRecording(S.project, {
      audioId, startBeat: take.startBeat, latency: take.latency, seconds: take.seconds,
      loop: take.loop, punch: punch ? { start: punch[0], end: punch[1] } : null,
    }) : null;
    if (!made) {
      UI().toast(take && punch ? 'Nothing was played inside the punch range' : 'Nothing was recorded');
      updateBar();
      return;
    }
    if (take.dropouts > 0) UI().toast('The sound card could not keep up for a moment while recording. Listen back to check the take.');
    // On the track at once; then onto the disk, and the project saved with it.
    const project = S.project;
    const placed = P().placeTakes(project, track, made, 'Take ' + (track.clips.length + 1));
    if (!placed) { UI().toast('No room on that track for another take'); updateBar(); return; }
    S.engine.setAudio(audioId, take.sampleRate, take.channels);
    const count = P().takesOf(placed.clip).length;
    if (count > 1) track.showTakes = true;            // there is a choice to make, so the takes are shown
    S.sel = { trackId: track.id, clipId: placed.clip.id, noteIds: [] };
    commit({ structure: true });
    if (placed.joined) setStatus(`Kept as take ${placed.take + 1} of ${count}. Drag along a take's row to use it instead.`);
    else if (made.offsets.length > 1) setStatus(`${made.offsets.length} takes, one for each pass. Take ${placed.take + 1} is in use; drag along another's row to use it instead.`);
    try {
      await global.DawStore.putAudio(audioId, project.id, take.sampleRate, take.channels);
    } catch (e) {
      UI().toast('The take could not be saved; it will be lost when the app closes');
    }
    if (S.project === project) flushSave();            // a take is not left waiting on the autosave timer
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
    // As long on the timeline as the audio lasts, at the tempo (or tempos) it will play over.
    const start = snapBeat(S.engine.position());
    const end = P().secondsToBeat(S.project, P().beatToSeconds(S.project, start) + seconds);
    // Nothing is known about the tempo of a file, so it plays at its own speed until told otherwise.
    const clip = P().addClip(track, { start, length: end - start, audioId, name: track.name });
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
    if (S.engine.isRecording()) { UI().toast('Stop recording before exporting'); return; }
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

  // ── Audio: where the sound goes ──────────────────────────────────────────
  // Either the built-in engine, out through whatever Windows plays through,
  // or a sound card held by the audio host, which also plays the plugins.
  // The choice is remembered, and a card chosen before is opened again the
  // next time the DAW is.
  const BUFFERS = [32, 64, 128, 256, 512, 1024, 2048, 4096];
  const RATES = [44100, 48000, 88200, 96000];
  let audioView = null;              // the Audio dialog's state while it is open

  function savedAudio() {
    const a = global.Storage.getSettings().dawAudio;
    return a && typeof a === 'object' ? a : { mode: 'builtin' };
  }
  function cardText(card) {
    if (!card) return 'Playing through this computer\'s sound.';
    const ms = card.bufferFrames / card.sampleRate * 1000;
    return `Playing through ${card.device || 'the default device'} (${card.api === 'asio' ? 'ASIO' : 'Windows'}) at ` +
      `${+(card.sampleRate / 1000).toFixed(1)} kHz, ${card.bufferFrames} samples a buffer (${ms.toFixed(1)} ms).`;
  }
  function markAudio() {
    const card = S.engine.card();
    const btn = $('dawAudio');
    if (btn) {
      btn.classList.toggle('on', !!card);
      btn.title = card ? cardText(card) + ' Click to change.' : 'Where the sound goes: this computer, or a sound card with plugins.';
    }
    const pick = $('dawInput');
    if (pick) {
      pick.disabled = !!card;
      if (card) pick.title = 'Recording uses the sound card\'s inputs, chosen in Audio settings';
      else nameInput();
    }
  }
  // After the engine changes hands: the screen shows what is now true.
  function audioChanged() {
    markAudio();
    refreshInputs();
    if (S.panel === 'mixer') refreshPanel();
    if (plugView && $('plugDialog')) drawPlugins();
    S.dirty = true;
  }

  // A card chosen in an earlier session is opened again, once, quietly.
  function reopenCard() {
    const saved = savedAudio();
    if (S.reopened || saved.mode !== 'card' || S.engine.usingNative()) return;
    S.reopened = true;
    if (!global.NativeAudio || !global.NativeAudio.supported()) return;
    const config = { api: saved.api, device: saved.device, sampleRate: saved.sampleRate || 0, bufferFrames: saved.bufferFrames || 0,
      useInput: saved.useInput !== false, input: saved.input || '' };
    S.engine.useNative(config).then(audioChanged, e => {
      setStatus(`${saved.device || 'The sound card'} could not be opened (${(e && e.message) || e}); playing through this computer.`);
      audioChanged();
    });
  }

  function audioOptions(id, list, chosen) {
    const sel = $(id);
    if (!sel) return;
    sel.innerHTML = list.map(([value, name]) => `<option value="${esc(value)}">${esc(name)}</option>`).join('');
    sel.value = list.some(([value]) => String(value) === String(chosen)) ? String(chosen) : String(list.length ? list[0][0] : '');
  }

  // Fills the card's choices from what the host found, for the driver type chosen.
  function showDevices() {
    const v = audioView;
    if (!v || !v.devices) return;
    const asio = v.api === 'asio';
    const windows = v.devices.windows || [];
    const outs = asio ? (v.devices.asio || []).map(name => [name, name])
      : [['', 'Windows default']].concat(windows.filter(d => d.outputs > 0).map(d => [d.name, d.name]));
    if (asio && !outs.length) outs.push(['', 'No ASIO drivers are installed']);
    audioOptions('audDevice', outs, v.device);
    v.device = $('audDevice').value;
    audioOptions('audInput', [['', 'Windows default']].concat(windows.filter(d => d.inputs > 0).map(d => [d.name, d.name])), v.input);
    $('audInputRow').hidden = asio;
    describeDevice();
  }

  // Sample rates and buffer sizes the device offers. An ASIO driver is asked;
  // a Windows device lists its rates, and any buffer size will do.
  async function describeDevice() {
    const v = audioView;
    if (!v) return;
    let rates = RATES, buffers = BUFFERS.filter(b => b >= 128), own = 0;
    if (v.api === 'asio' && v.device) {
      try {
        const d = await global.NativeAudio.call('describe', v.device);
        if (audioView !== v) return;
        if (d.rates && d.rates.length) rates = d.rates;
        const min = d.minBuffer || 32, max = d.maxBuffer || 4096;
        buffers = BUFFERS.filter(b => b >= min && b <= max);
        if (d.granularity > 0) buffers = buffers.filter(b => (b - min) % d.granularity === 0);
        if (d.preferredBuffer && !buffers.includes(d.preferredBuffer)) buffers = buffers.concat(d.preferredBuffer).sort((a, b) => a - b);
        own = d.preferredBuffer || 0;
      } catch (e) { /* the driver would not say; the usual sizes are offered */ }
    } else if (v.api === 'wasapi') {
      const dev = (v.devices.windows || []).find(d => d.name === v.device);
      if (dev && dev.rates && dev.rates.length) rates = dev.rates;
    }
    if (audioView !== v) return;
    audioOptions('audRate', [[0, 'The device\'s own']].concat(rates.map(r => [r, `${+(r / 1000).toFixed(1)} kHz`])), v.sampleRate);
    audioOptions('audBuffer', [[0, own ? `The driver's own (${own})` : 'The device\'s own']].concat(buffers.map(b => [b, `${b} samples`])), v.bufferFrames);
  }

  function readAudioForm() {
    const v = audioView;
    v.mode = $('audModeCard').checked ? 'card' : 'builtin';
    v.api = $('audApi').value === 'wasapi' ? 'wasapi' : 'asio';
    v.device = $('audDevice').value;
    v.input = $('audInput').value;
    v.sampleRate = parseInt($('audRate').value, 10) || 0;
    v.bufferFrames = parseInt($('audBuffer').value, 10) || 0;
    v.useInput = $('audUseInput').checked;
  }
  function showAudioMode() {
    const card = $('audModeCard').checked;
    ['audApi', 'audDevice', 'audRate', 'audBuffer', 'audInput', 'audUseInput'].forEach(id => { $(id).disabled = !card || !audioView.devices; });
    const open = S.engine.card();
    $('audPanel').hidden = !(open && open.api === 'asio');
  }

  async function openAudio() {
    const N = global.NativeAudio;
    const available = !!(N && N.supported()) && !!(await N.info().catch(() => ({}))).available;
    const card = S.engine.card();
    const base = card ? Object.assign({}, S.engine.nativeConfig || {}) : savedAudio();
    audioView = {
      available, devices: null, mode: card ? 'card' : 'builtin',
      api: base.api === 'wasapi' || base.api === 'asio' ? base.api : '',
      device: base.device || '', input: base.input || '',
      sampleRate: base.sampleRate || 0, bufferFrames: base.bufferFrames || 0, useInput: base.useInput !== false,
    };
    const v = audioView;
    UI().openModal(`
      <div class="daw-audio-set" id="audSettings">
        <h2>Audio</h2>
        <label class="aud-mode"><input type="radio" name="audMode" id="audModeBuiltIn"${v.mode === 'builtin' ? ' checked' : ''} />
          <span><strong>This computer's sound</strong><span class="meta">Plays through whatever Windows plays through. Plugins are not heard.</span></span></label>
        <label class="aud-mode"><input type="radio" name="audMode" id="audModeCard"${v.mode === 'card' ? ' checked' : ''}${available ? '' : ' disabled'} />
          <span><strong>A sound card, with plugins</strong><span class="meta">${available
            ? 'ChordPath\'s audio engine holds the card: a short delay with ASIO, and your VST 3 plugins on the mixer.'
            : 'This copy of ChordPath was built without its audio engine.'}</span></span></label>
        <div class="aud-grid">
          <label>Driver <select id="audApi"><option value="asio">ASIO</option><option value="wasapi">Windows (WASAPI)</option></select></label>
          <label>Device <select id="audDevice"><option value="">Looking…</option></select></label>
          <label>Sample rate <select id="audRate"></select></label>
          <label>Buffer <select id="audBuffer"></select></label>
          <label id="audInputRow">Input <select id="audInput"></select></label>
          <label class="daw-check"><input type="checkbox" id="audUseInput"${v.useInput ? ' checked' : ''} /> Record from this card's inputs</label>
        </div>
        <p class="meta" id="audState" aria-live="polite">${esc(cardText(card))}</p>
        <div class="fd-actions">
          <button type="button" class="ghost" id="audPanel" hidden title="The driver's own settings window">Driver settings…</button>
          <button type="button" class="primary" id="audApply">Apply</button>
          <button type="button" class="ghost" id="audClose">Done</button>
        </div>
      </div>`);
    showAudioMode();
    $('audModeBuiltIn').addEventListener('change', showAudioMode);
    $('audModeCard').addEventListener('change', showAudioMode);
    $('audApi').addEventListener('change', () => { readAudioForm(); v.device = ''; v.sampleRate = 0; v.bufferFrames = 0; showDevices(); });
    $('audDevice').addEventListener('change', () => { readAudioForm(); v.sampleRate = 0; v.bufferFrames = 0; describeDevice(); });
    $('audApply').addEventListener('click', applyAudio);
    $('audClose').addEventListener('click', () => { audioView = null; UI().closeModal(); });
    $('audPanel').addEventListener('click', () => {
      N.call('panel').catch(e => UI().toast('The driver\'s settings could not be opened: ' + ((e && e.message) || e)));
    });
    if (!available) return;
    try {
      await N.connect();
      const devices = await N.call('devices');
      if (audioView !== v) return;
      v.devices = devices || { asio: [], windows: [] };
      if (!v.api) v.api = (v.devices.asio || []).length ? 'asio' : 'wasapi';
      $('audApi').value = v.api;
      showDevices();
      showAudioMode();
    } catch (e) {
      if (audioView === v) $('audState').textContent = 'The audio engine could not start: ' + ((e && e.message) || e);
    }
  }

  async function applyAudio() {
    const v = audioView;
    if (!v) return;
    readAudioForm();
    const state = $('audState');
    $('audApply').disabled = true;
    const config = { api: v.api, device: v.device, sampleRate: v.sampleRate, bufferFrames: v.bufferFrames, useInput: v.useInput, input: v.input };
    try {
      if (S.engine.isRecording()) await finishRecording();
      if (v.mode === 'builtin') {
        if (S.engine.usingNative()) await S.engine.useBuiltIn();
        global.Storage.setSettings({ dawAudio: Object.assign({}, config, { mode: 'builtin' }) });   // the card's details wait for next time
        state.textContent = cardText(null);
      } else {
        state.textContent = `Opening ${v.device || 'the default device'}…`;
        const opened = await S.engine.useNative(config);
        global.Storage.setSettings({ dawAudio: Object.assign({}, config, { mode: 'card' }) });
        if (audioView === v) $('audState').textContent = cardText(opened);
      }
    } catch (e) {
      if (audioView === v) $('audState').textContent = `It could not be opened: ${(e && e.message) || e}. Playing through this computer.`;
    }
    if (audioView === v) { $('audApply').disabled = false; showAudioMode(); }
    audioChanged();
  }

  // ── Plugins on a strip ───────────────────────────────────────────────────
  // A dialog for one strip's chain (a track's, or the master's): its plugins
  // in order, each with its window, bypass, order and removal; below, the
  // plugins installed on this computer, to add.
  let plugView = null;               // { trackId (null: the master), installed, failed, query }

  function plugTrack() { return plugView.trackId ? P().findTrack(S.project, plugView.trackId) : null; }
  function plugList() { const t = plugTrack(); return t ? t.plugins : S.project.masterPlugins; }

  function openPlugins(trackId) {
    plugView = { trackId: trackId || null, installed: null, failed: [], query: '' };
    drawPlugins();
    loadInstalled(false);
  }

  function loadInstalled(rescan) {
    const N = global.NativeAudio;
    const v = plugView;
    v.installed = null;
    drawAvailable();
    const got = N && N.supported() ? N.installed(rescan) : Promise.resolve({ plugins: [], failed: [] });
    got.then(res => { v.installed = (res && res.plugins) || []; v.failed = (res && res.failed) || []; },
      () => { v.installed = []; })
      .then(() => { if (plugView === v) drawAvailable(); });
  }

  function drawPlugins() {
    const track = plugTrack();
    if (plugView.trackId && !track) { plugView = null; UI().closeModal(); return; }
    UI().openModal(`
      <div class="daw-plugins" id="plugDialog">
        <h2>Plugins on ${esc(track ? track.name : 'the Master')}</h2>
        <p class="plug-off" id="plugOff"${S.engine.usingNative() ? ' hidden' : ''}>Plugins are heard when a sound card plays through ChordPath's audio engine.
          <button type="button" class="ghost small" id="plugAudio">Audio settings…</button></p>
        <ol class="plug-chain" id="plugChain"></ol>
        <h3>Add a plugin</h3>
        <input type="search" id="plugSearch" placeholder="Search by name, maker or kind" aria-label="Search the plugins" value="${esc(plugView.query)}" />
        <div class="plug-avail-list" id="plugAvail"></div>
        <div class="fd-actions">
          <button type="button" class="ghost" id="plugRescan" title="Look through the plugin folders again, for plugins installed since">Look for plugins again</button>
          <button type="button" class="primary" id="plugClose">Done</button>
        </div>
      </div>`);
    drawChain();
    drawAvailable();
    $('plugClose').addEventListener('click', () => { plugView = null; UI().closeModal(); });
    $('plugAudio').addEventListener('click', () => { plugView = null; openAudio(); });
    $('plugRescan').addEventListener('click', () => loadInstalled(true));
    $('plugSearch').addEventListener('input', () => { plugView.query = $('plugSearch').value; filterAvailable(); });
    $('plugChain').addEventListener('click', e => {
      const btn = e.target.closest('button[data-act]');
      const row = btn && btn.closest('[data-plugin]');
      if (!row) return;
      chainAction(btn.dataset.act, row.dataset.plugin);
    });
    $('plugAvail').addEventListener('click', e => {
      const btn = e.target.closest('button[data-act="add"]');
      const row = btn && btn.closest('.plug-avail');
      if (row) addPluginFrom(row);
    });
  }

  function drawChain() {
    const host = $('plugChain');
    if (!host || !plugView) return;
    const native = S.engine.usingNative();
    const off = $('plugOff');
    if (off) off.hidden = native;
    const list = plugList();
    host.innerHTML = list.length ? list.map((p, i) => {
      const info = S.engine.pluginInfo(p.id);
      const note = !native ? ''
        : info.state === 'failed' ? `<span class="plug-bad">Could not load: ${esc(info.error)}</span>`
          : info.state === 'ready' ? (info.latency ? `<span class="meta">${esc(info.latency)} samples of delay, made up for</span>` : '')
            : '<span class="meta">loading…</span>';
      const canOpen = native && info.state === 'ready' && info.hasEditor;
      const fixed = p.instrument;                              // an instrument stays first
      return `
        <li class="plug-row${p.bypass ? ' bypassed' : ''}" data-plugin="${esc(p.id)}">
          <span class="plug-name"><strong>${esc(p.name)}</strong>
            <span class="meta">${esc([p.vendor, p.instrument ? 'instrument' : ''].filter(Boolean).join(' · '))}</span> ${note}</span>
          <button type="button" class="ghost small" data-act="window"${canOpen ? '' : ' disabled'}>${info.editorOpen ? 'Close window' : 'Window'}</button>
          <button type="button" class="mx-btn${p.bypass ? ' on' : ''}" data-act="bypass" title="Bypass: the sound passes it by untouched">Bypass</button>
          <button type="button" class="ghost small" data-act="up" title="Earlier in the chain" aria-label="Earlier in the chain"${fixed || i === 0 || list[i - 1].instrument ? ' disabled' : ''}>↑</button>
          <button type="button" class="ghost small" data-act="down" title="Later in the chain" aria-label="Later in the chain"${fixed || i === list.length - 1 ? ' disabled' : ''}>↓</button>
          <button type="button" class="ghost small danger" data-act="remove" title="Take it off" aria-label="Take it off">×</button>
        </li>`;
    }).join('') : '<li class="meta plug-none">No plugins on this strip yet.</li>';
  }

  function chainAction(act, id) {
    const found = P().findPlugin(S.project, id);
    if (!found) return;
    const p = found.plugin;
    if (act === 'window') {
      const info = S.engine.pluginInfo(id);
      const title = `${p.name} — ${found.track ? found.track.name : 'Master'}`;
      (info.editorOpen ? S.engine.closePlugin(id) : S.engine.openPlugin(id, title))
        .then(ok => { if (ok === false) UI().toast(`${p.name} has no window of its own`); },
          e => UI().toast(`${p.name}'s window could not be opened: ${(e && e.message) || e}`))
        .then(drawChain);
      return;
    }
    if (act === 'bypass') p.bypass = !p.bypass;
    else if (act === 'up' || act === 'down') { if (!P().movePlugin(S.project, id, act === 'up' ? -1 : 1)) return; }
    else if (act === 'remove') P().removePlugin(S.project, id);
    else return;
    commit({ keepPanel: S.panel !== 'mixer' });
    drawChain();
  }

  function addPluginFrom(row) {
    const p = (plugView.installed || []).find(x => x.path === row.dataset.path && x.uid === row.dataset.uid);
    if (!p) return;
    const added = P().addPlugin(S.project, plugView.trackId, { path: p.path, uid: p.uid, name: p.name, vendor: p.vendor, instrument: !!p.instrument });
    if (!added) { UI().toast(p.instrument ? 'An instrument plays a note track, not this one' : 'A strip holds up to eight plugins'); return; }
    commit({ keepPanel: S.panel !== 'mixer' });
    drawChain();
  }

  function drawAvailable() {
    const host = $('plugAvail');
    if (!host || !plugView) return;
    if (!plugView.installed) { host.innerHTML = '<p class="meta plug-scanning">Looking for the plugins installed on this computer…</p>'; return; }
    const track = plugTrack();
    const notes = !!track && track.kind !== 'audio';           // instruments play note tracks; effects go anywhere
    const list = plugView.installed.filter(p => !p.instrument || notes);
    const failed = plugView.failed.length
      ? `<p class="meta">${plugView.failed.length === 1 ? 'One plugin' : plugView.failed.length + ' plugins'} could not be read: ${esc(plugView.failed.map(f => f.name).join(', '))}.</p>` : '';
    host.innerHTML = (list.length ? list.map(p => `
      <div class="plug-avail" data-name="${esc(p.name)}" data-path="${esc(p.path)}" data-uid="${esc(p.uid)}">
        <span><strong>${esc(p.name)}</strong> <span class="meta">${esc([p.vendor, p.instrument ? 'Instrument' : kindOf(p.category)].filter(Boolean).join(' · '))}</span></span>
        <button type="button" class="ghost small" data-act="add">Add</button>
      </div>`).join('') : '<p class="meta">No plugins were found. ChordPath plays VST 3 plugins installed in the usual folder for them.</p>') + failed;
    filterAvailable();
  }
  // A VST 3 category ("Fx|EQ", "Fx|Reverb|Delay") as words: "EQ", "Reverb, Delay".
  function kindOf(category) {
    const words = String(category || '').split('|').map(w => w.trim()).filter(w => w && w !== 'Fx');
    return words.length ? words.join(', ') : 'Effect';
  }
  function filterAvailable() {
    const q = ((plugView && plugView.query) || '').trim().toLowerCase();
    doc.querySelectorAll('#plugAvail .plug-avail').forEach(row => { row.hidden = !!q && !row.textContent.toLowerCase().includes(q); });
  }

  // ── Tempo and time signature ─────────────────────────────────────────────
  // One row for every stretch of the song. Each edit is applied at once, and
  // the list is drawn again because a change of time moves the bars after it.
  function openTiming() {
    const p = S.project;
    const playhead = P().positionAt(p, S.engine.position());
    const taken = P().stretches(p).some(s => Math.abs(s.beat - playhead.start) < 1e-9);
    const row = s => `
      <tr data-beat="${esc(s.beat)}">
        <td>${esc(s.bar)}</td>
        <td><input type="number" class="tm-tempo" min="40" max="240" value="${esc(s.tempo)}" aria-label="Tempo from bar ${esc(s.bar)}" /></td>
        <td><input type="number" class="tm-num" min="1" max="16" value="${esc(s.num)}" aria-label="Beats in a bar" />
          <span>/</span>
          <select class="tm-den" aria-label="The note that counts as a beat">${P().DENOMINATORS.map(d =>
            `<option value="${d}"${d === s.den ? ' selected' : ''}>${d}</option>`).join('')}</select></td>
        <td>${s.beat > 0 ? '<button type="button" class="ghost small danger" data-remove>Remove</button>' : ''}</td>
      </tr>`;
    UI().openModal(`
      <div class="daw-timing">
        <h2>Tempo and time signature</h2>
        <p>Each row holds from the start of its bar until the next row takes over. To add one, put the playhead in the bar where it should begin.</p>
        <table>
          <thead><tr><th>From bar</th><th>Tempo</th><th>Time</th><th></th></tr></thead>
          <tbody>${P().stretches(p).map(row).join('')}</tbody>
        </table>
        <div class="fd-actions">
          <button type="button" class="ghost" id="tmAdd"${taken ? ' disabled' : ''}>${taken
            ? `Bar ${esc(playhead.bar)} already has a row` : `Add a change at bar ${esc(playhead.bar)}`}</button>
          <button type="button" class="primary" id="tmDone">Done</button>
        </div>
      </div>`);

    const apply = (beat, patch) => {
      P().setChange(S.project, beat, patch);
      commit();                                       // the editor and the tab are redrawn too: their bar lines may have moved
      openTiming();
    };
    doc.querySelectorAll('#modalContent .daw-timing tbody tr').forEach(tr => {
      const beat = parseFloat(tr.dataset.beat);
      const number = (selector, low, high) => {
        const value = Math.round(parseFloat(tr.querySelector(selector).value));
        return Number.isFinite(value) ? Math.max(low, Math.min(high, value)) : undefined;
      };
      tr.querySelector('.tm-tempo').addEventListener('change', () => apply(beat, { tempo: number('.tm-tempo', 40, 240) }));
      tr.querySelector('.tm-num').addEventListener('change', () => apply(beat, { num: number('.tm-num', 1, 16) }));
      tr.querySelector('.tm-den').addEventListener('change', () => apply(beat, { den: parseInt(tr.querySelector('.tm-den').value, 10) }));
      const remove = tr.querySelector('[data-remove]');
      if (remove) remove.addEventListener('click', () => {
        P().removeChange(S.project, beat);
        commit();
        openTiming();
      });
    });
    $('tmAdd').addEventListener('click', () => apply(playhead.start, {}));
    $('tmDone').addEventListener('click', () => UI().closeModal());
  }

  function rebuild() {
    const sg = song();
    if (!sg) return;
    UI().confirmBox('Bring in the song as it is now in Write? This replaces the note tracks here. Note edits made here are lost (Undo brings them back); recordings are kept, and so are tempo and time-signature changes made here.')
      .then(ok => {
        if (!ok) return;
        const fresh = P().fromSong(sg);
        fresh.id = S.project.id;
        fresh.master = S.project.master;
        fresh.punch = S.project.punch;
        // Timing that was shaped here stays; otherwise the song's own tempo comes across.
        const now = S.project;
        if (now.changes.length || now.meter.num !== 4 || now.meter.den !== 4) {
          fresh.tempo = now.tempo;
          fresh.meter = now.meter;
          fresh.changes = now.changes;
        }
        S.project.tracks.filter(t => t.kind === 'audio').forEach(t => fresh.tracks.push(t));
        S.project = P().sanitize(fresh);
        S.sel = { trackId: S.project.tracks[0] ? S.project.tracks[0].id : null, clipId: null, noteIds: [] };
        commit({ structure: true });
        UI().toast('Updated from the song. Undo puts your note edits back.');
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
    // Plugins loading, failing, or opening and closing their windows.
    S.engine.watchPlugins(() => { if (plugView && $('plugDialog')) drawChain(); });
    // The audio host stopped (a plugin crashed, most likely): the built-in engine carries on.
    S.engine.onLost = () => {
      setStatus('The audio engine stopped, perhaps a plugin crashed. Playing through this computer; choose the card again in Audio settings.');
      UI().toast('The audio engine stopped. Playing through this computer.');
      audioChanged();
    };
    // An ASIO driver whose settings were changed in its own window asks to be
    // opened again; it is, at the buffer size it now prefers.
    if (global.NativeAudio && global.NativeAudio.supported()) {
      global.NativeAudio.on('status', m => {
        if (!m.status || !m.status.reset || S.resetting || !S.engine.usingNative()) return;
        S.resetting = true;
        const config = Object.assign({}, S.engine.nativeConfig, { bufferFrames: 0 });
        const done = () => { S.resetting = false; audioChanged(); };
        S.engine.useNative(config).then(() => {
          global.Storage.setSettings({ dawAudio: Object.assign({}, config, { mode: 'card' }) });
          if (audioView && $('audState')) $('audState').textContent = cardText(S.engine.card());
          done();
        }, e => { setStatus(`The sound card could not be opened again (${(e && e.message) || e}); playing through this computer.`); done(); });
      });
    }
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
    press('dawLoop', toggleLoop);
    press('dawPunch', togglePunch);
    press('dawClick', () => { S.click = !S.click; S.engine.setClick(S.click); updateBar(); });
    press('dawUndo', () => undo(true));
    press('dawRedo', () => undo(false));
    press('dawZoomIn', () => zoom(1.3, S.engine.position()));
    press('dawZoomOut', () => zoom(1 / 1.3, S.engine.position()));
    press('dawRebuild', rebuild);
    press('dawExport', openExport);
    press('dawAudio', openAudio);
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
      // The tempo typed here is for the stretch of the song the playhead is in.
      const here = P().stretchAt(S.project, S.engine.position());
      const tempo = Math.max(40, Math.min(240, Math.round(parseFloat(input.value) || here.tempo)));
      input.value = tempo;
      input.blur();
      if (tempo !== here.tempo) { P().setChange(S.project, here.beat, { tempo }); commit(); }   // the panel may describe a take that now needs fitting
    });
    on('dawSnap', 'change', () => {
      S.snap = parseFloat($('dawSnap').value) || 0;
      $('dawSnap').blur();
      if (S.roll) S.roll.draw();
    });
    on('dawInput', 'change', () => {
      S.input = $('dawInput').value;
      $('dawInput').blur();
      nameInput();
      global.Storage.setSettings({ dawInput: S.input });
      S.engine.setInput(S.input).then(heardFrom, () => {
        UI().toast('Could not open that input');
        updateBar();
      });
    });
    press('dawMonitor', toggleMonitor);
    press('dawMeter', openTiming);
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
    doc.querySelectorAll('#dawHeads .daw-head[data-track]').forEach(node => {
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
        } else if (act === 'takes') {
          e.target.blur();
          track.showTakes = !track.showTakes;
          commit({ structure: true });
        } else if (act === 'auto') {
          e.target.blur();
          track.showAuto = !track.showAuto;
          commit({ structure: true });
        } else if (act === 'laneAdd' || act === 'laneRemove' || act === 'laneOn') {
          // The automation rows look after themselves (wireAutoRows).
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
    doc.querySelectorAll('#dawHeads .daw-head').forEach(node => wireAutoRows(node, node.dataset.master ? null : node.dataset.track));
    press('dawMasterAuto', () => {
      S.project.showMaster = !S.project.showMaster;
      commit({ structure: true });
    });
  }

  // ── Automation ───────────────────────────────────────────────────────────
  // The rows beside a track's lanes (trackId null: the master's).
  function wireAutoRows(node, trackId) {
    node.querySelectorAll('.daw-auto-row').forEach(row => {
      const lane = row.dataset.lane ? (P().findLane(S.project, row.dataset.lane) || {}).lane : null;
      row.querySelectorAll('[data-act="laneAdd"]').forEach(btn => btn.addEventListener('click', e => {
        e.stopPropagation();
        btn.blur();
        addLaneFor(trackId, btn.dataset.target);
      }));
      const remove = row.querySelector('[data-act="laneRemove"]');
      if (remove && lane) remove.addEventListener('click', e => {
        e.stopPropagation();
        P().removeLane(S.project, lane.id);
        commit({ structure: true });
        UI().toast(`${lane.name} automation removed. Undo brings it back.`);
      });
      const use = row.querySelector('[data-act="laneOn"]');
      if (use && lane) use.addEventListener('change', () => {
        use.blur();
        lane.on = use.checked;
        commit({ keepPanel: S.panel !== 'mixer' });
      });
    });
  }

  // A new lane for a track's (or the master's) volume or pan, starting where
  // the mixer has it; for a plugin's setting, the setting is chosen first.
  function addLaneFor(trackId, target) {
    if (target === 'param') { openLanePicker(trackId); return; }
    const track = trackId == null ? null : P().findTrack(S.project, trackId);
    if (trackId != null && !track) return;
    const value = target === 'pan' ? track.pan : track ? track.volume : S.project.master;
    const lane = P().addLane(S.project, trackId, { target, value });
    if (!lane) { UI().toast('No room for another lane'); return; }
    if (track) track.showAuto = true; else S.project.showMaster = true;
    commit({ structure: true });
    setStatus(`${lane.name}: click in its row to put a point down, drag one to move it, right-click one to take it away.`);
  }

  // Chooses a plugin's setting to automate, from the plugins on the track (or master).
  async function openLanePicker(trackId) {
    const track = trackId == null ? null : P().findTrack(S.project, trackId);
    const plugins = track ? track.plugins : S.project.masterPlugins;
    if (!plugins.length) { UI().toast(`There are no plugins on ${track ? 'this track' : 'the master'} yet. Add one with FX in the mixer.`); return; }
    if (!S.engine.usingNative()) { UI().toast('Plugin settings can be automated while a sound card is in use: choose one with Audio…'); return; }
    UI().openModal(`
      <div class="daw-lanepick" id="lanePick">
        <h2>Automate a plugin setting</h2>
        <p class="meta">On ${esc(track ? track.name : 'the master')}. The setting then follows its lane as the song plays.</p>
        <input type="search" id="lpFind" placeholder="Find a setting" aria-label="Find a setting" />
        <div id="lpList" class="lp-list"><p class="meta">Asking the plugins what they have…</p></div>
      </div>`);
    const groups = await Promise.all(plugins.map(async p => ({ plugin: p, params: await S.engine.pluginParams(p.id).catch(() => []) })));
    if (!$('lanePick')) return;                        // closed meanwhile
    const draw = () => {
      const find = ($('lpFind').value || '').trim().toLowerCase();
      const html = groups.map((grp, gi) => {
        const shown = grp.params.map((q, qi) => ({ q, qi })).filter(({ q }) => !find || q.title.toLowerCase().includes(find) || grp.plugin.name.toLowerCase().includes(find));
        if (!shown.length) return '';
        return `<h3>${esc(grp.plugin.name)}</h3><div class="lp-group">${shown.slice(0, 300).map(({ q, qi }) =>
          `<button type="button" class="ghost small" data-g="${gi}" data-q="${qi}">${esc(q.title)}${q.units ? ` <span class="meta">${esc(q.units)}</span>` : ''}</button>`).join('')}</div>`;
      }).join('');
      $('lpList').innerHTML = html || '<p class="meta">No setting by that name. (A plugin that is still loading, or failed to, lists none.)</p>';
      $('lpList').querySelectorAll('[data-g]').forEach(btn => btn.addEventListener('click', () => {
        const grp = groups[+btn.dataset.g], q = grp.params[+btn.dataset.q];
        const lane = P().addLane(S.project, trackId, { target: 'param', plugin: grp.plugin.id, param: q.id, name: `${grp.plugin.name}: ${q.title}`, value: q.value });
        UI().closeModal();
        if (!lane) { UI().toast('No room for another lane'); return; }
        if (track) track.showAuto = true; else S.project.showMaster = true;
        commit({ structure: true });
      }));
    };
    $('lpFind').addEventListener('input', draw);
    draw();
    $('lpFind').focus();
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
    // Punching in without a loop, recording stops a bar after the punch range.
    const punch = S.engine.isRecording() && !S.engine.recording.loop ? P().punchRange(S.project) : null;
    if (punch && !S.finishing && pos >= punch[1] + P().positionAt(S.project, punch[1]).length) finishRecording();

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
      // Bar and beat in the time signature at that point, and the time by the tempo map.
      const at = P().positionAt(S.project, pos + 1e-6);
      $('dawBars').textContent = at.bar + '.' + Math.floor(at.beat + 1e-6);
      const sec = P().beatToSeconds(S.project, pos);
      $('dawClock').textContent = Math.floor(sec / 60) + ':' + (sec % 60).toFixed(1).padStart(4, '0');
      const here = P().stretchAt(S.project, pos);
      if (here.beat + ':' + here.tempo + ':' + here.num + '/' + here.den !== S.shownStretch) showTimingAt(pos);
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
    else if (mod && k === 'z') { e.preventDefault(); undo(!e.shiftKey); }
    else if (mod && k === 'y') { e.preventDefault(); undo(false); }
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
    else if (k === 'l') toggleLoop();
    else if (k === 'p') togglePunch();
    else if (k === 's') splitSelected();
    else if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); deleteSelected(); }
    else if (k === '+' || k === '=') zoom(1.3, S.engine.position());
    else if (k === '-') zoom(1 / 1.3, S.engine.position());
  }

  global.Views = global.Views || {};
  global.Views.Daw = { enter, leave, handleKey, forget };
})(typeof window !== 'undefined' ? window : globalThis);
