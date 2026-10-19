/* ChordPath — ui/views/wizard.js
 * Starting a song. Nothing is written for the writer here: they choose the
 * key (that comes first, and it is the one thing that must be chosen), the
 * time signature, the tempo and a title, and if they like a feeling for the
 * ideas to lean towards. The song starts empty, and they go straight to
 * writing its first section.
 */
(function (global) {
  'use strict';

  const doc = global.document;
  const UI = () => global.UI;
  const F = () => global.Feelings;
  const Song = () => global.Song;
  const M = () => global.Meters;

  const TONICS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const SHOWN = { 'C#': 'C♯ / D♭', 'D#': 'D♯ / E♭', 'F#': 'F♯ / G♭', 'G#': 'G♯ / A♭', 'A#': 'A♯ / B♭' };
  // Chords a guitarist can play without a barre.
  const OPEN = new Set(['C', 'D', 'E', 'G', 'A', 'Am', 'Dm', 'Em']);
  const STARTS = [
    { id: 'verse', name: 'One verse', roles: ['verse'] },
    { id: 'pair', name: 'Verse and chorus', roles: ['verse', 'chorus'] },
    { id: 'three', name: 'Verse, chorus, bridge', roles: ['verse', 'chorus', 'bridge'] },
  ];
  const TEMPOS = [[66, 'Slow'], [84, 'Easy'], [100, 'Walking'], [120, 'Up'], [144, 'Fast']];

  const state = {};
  function reset() {
    Object.assign(state, { key: null, scale: 'major', meter: '4/4', tempo: 100, title: '', feelingId: null, start: 'verse' });
  }
  reset();

  function root() { return doc.getElementById('wizardRoot'); }
  function esc(v) { return UI().esc(v); }

  function keyChords() {
    if (!state.key) return [];
    return global.Chords.diatonicChords(state.key, state.scale, { sevenths: false });
  }

  function keyPanel() {
    if (!state.key) {
      return '<p class="meta start-wait">Choose a key to see the chords that live in it.</p>';
    }
    const chords = keyChords();
    const open = chords.filter(c => OPEN.has(c.shortName)).map(c => c.shortName);
    const scaleName = (global.Scales.getScaleMeta(state.scale) || {}).name || state.scale;
    return `
      <div class="start-key-info">
        <p><strong>${esc(state.key)} ${esc(scaleName)}</strong> — the chords that live in it:</p>
        <div class="start-chords">${chords.map(c => `
          <span class="start-chord"><span class="name">${esc(c.shortName)}</span><span class="roman">${esc(c.roman || '')}</span></span>`).join('')}</div>
        <p class="meta">${open.length >= 4
          ? `Good on guitar: ${esc(open.join(', '))} need no barre.`
          : open.length ? `On guitar, ${esc(open.join(', '))} ${open.length === 1 ? 'is' : 'are'} open; the rest want a barre or a capo.`
          : 'On guitar this key is all barre chords; a capo can bring it to open shapes.'}</p>
        <button type="button" class="ghost small" id="startHearKey">▶ Hear the key</button>
      </div>`;
  }

  function render() {
    const meter = M().get(state.meter);
    const scaleOptions = global.Scales.SCALE_GROUPS.slice(0, 3).map(group => `
      <optgroup label="${esc(group.label)}">${group.ids.map(id => {
        const meta = global.Scales.getScaleMeta(id);
        return meta ? `<option value="${id}"${id === state.scale ? ' selected' : ''}>${esc(meta.name)}</option>` : '';
      }).join('')}</optgroup>`).join('');
    const feelings = Object.entries(F().groupedFeelings()).map(([group, list]) => `
      <div class="feel-group"><h4>${esc(group)}</h4>
        <div class="start-feelings">${list.map(f => `
          <button type="button" class="chip clickable${state.feelingId === f.id ? ' chosen' : ''}" data-feel="${f.id}" title="${esc(f.vibe)}">${esc(f.name)}</button>`).join('')}</div>
      </div>`).join('');

    root().innerHTML = `
      <div class="wizard start">
        <h3>Start a song</h3>
        <p class="meta">Choose the key first. Everything you write is yours: ChordPath plays it back, and offers ideas when you ask for them.</p>

        <section class="start-block" aria-labelledby="startKeyLabel">
          <h4 id="startKeyLabel">Key</h4>
          <div class="start-tonics" role="group" aria-label="Key">
            ${TONICS.map(k => `<button type="button" class="start-tonic${state.key === k ? ' chosen' : ''}" data-key="${k}">${esc(SHOWN[k] || k)}</button>`).join('')}
          </div>
          <div class="start-row">
            <div class="seg" id="startMode">
              <button type="button" data-scale="major"${state.scale === 'major' ? ' class="active"' : ''}>Major</button>
              <button type="button" data-scale="natural_minor"${state.scale === 'natural_minor' ? ' class="active"' : ''}>Minor</button>
            </div>
            <label class="meta">or another colour <select id="startScale">${scaleOptions}</select></label>
          </div>
          <div id="startKeyInfo">${keyPanel()}</div>
        </section>

        <section class="start-block" aria-labelledby="startTimeLabel">
          <h4 id="startTimeLabel">Time signature</h4>
          <div class="start-meters" role="group" aria-label="Time signature">
            ${M().LIST.map(m => `<button type="button" class="start-meter${state.meter === m.id ? ' chosen' : ''}" data-meter="${m.id}" title="${esc(m.name)}">${esc(m.id)}</button>`).join('')}
          </div>
          <p class="start-feel">${esc(meter.feel)} <span class="meta">Count it: ${esc(meter.count)}.${meter.examples.length ? ' Heard in ' + esc(meter.examples.join(', ')) + '.' : ''}</span></p>
          <button type="button" class="ghost small" id="startHearTime">▶ Hear it</button>
        </section>

        <section class="start-block start-two">
          <div>
            <h4>Tempo</h4>
            <div class="start-row">
              <label class="chip chip-input">♩ <input id="startTempo" type="number" min="40" max="240" value="${esc(state.tempo)}" /> BPM</label>
              <span class="start-tempos">${TEMPOS.map(([bpm, name]) => `<button type="button" class="ghost small" data-tempo="${bpm}">${esc(name)}</button>`).join('')}</span>
            </div>
          </div>
          <div>
            <h4>Title</h4>
            <input id="startTitle" type="text" maxlength="60" placeholder="Untitled song" value="${esc(state.title)}" />
          </div>
        </section>

        <section class="start-block">
          <h4>Start with</h4>
          <div class="seg" id="startShape">
            ${STARTS.map(s => `<button type="button" data-start="${s.id}"${state.start === s.id ? ' class="active"' : ''}>${esc(s.name)}</button>`).join('')}
          </div>
          <p class="meta">Empty sections, for you to fill. You can add, move and remove sections any time.</p>
        </section>

        <details class="start-block start-feeling"${state.feelingId ? ' open' : ''}>
          <summary><h4>A feeling to aim for <span class="meta">(if you have one)</span></h4></summary>
          <p class="meta">Chord ideas will lean towards it. Nothing is written for you.</p>
          ${feelings}
        </details>

        <div class="wizard-nav">
          <button type="button" class="ghost" id="wzCancel">Cancel</button>
          <button type="button" class="primary" id="wzCreate"${state.key ? '' : ' disabled title="Choose a key first"'}>Start writing</button>
        </div>
      </div>`;
    wire();
  }

  function wire() {
    const r = root();
    r.querySelectorAll('[data-key]').forEach(b => b.addEventListener('click', () => { state.key = b.dataset.key; render(); }));
    r.querySelectorAll('#startMode [data-scale]').forEach(b => b.addEventListener('click', () => { state.scale = b.dataset.scale; render(); }));
    doc.getElementById('startScale').addEventListener('change', e => { state.scale = e.target.value; render(); });
    r.querySelectorAll('[data-meter]').forEach(b => b.addEventListener('click', () => { state.meter = b.dataset.meter; render(); }));
    r.querySelectorAll('[data-tempo]').forEach(b => b.addEventListener('click', () => { state.tempo = parseInt(b.dataset.tempo, 10); render(); }));
    doc.getElementById('startTempo').addEventListener('change', e => {
      const v = parseInt(e.target.value, 10);
      state.tempo = Number.isFinite(v) ? Math.max(40, Math.min(240, v)) : state.tempo;
      e.target.value = state.tempo;
    });
    doc.getElementById('startTitle').addEventListener('input', e => { state.title = e.target.value; });
    r.querySelectorAll('#startShape [data-start]').forEach(b => b.addEventListener('click', () => { state.start = b.dataset.start; render(); }));
    r.querySelectorAll('[data-feel]').forEach(b => b.addEventListener('click', () => {
      state.feelingId = state.feelingId === b.dataset.feel ? null : b.dataset.feel;
      render();
    }));
    const hearKey = doc.getElementById('startHearKey');
    if (hearKey) hearKey.addEventListener('click', hearTheKey);
    doc.getElementById('startHearTime').addEventListener('click', hearTheTime);
    doc.getElementById('wzCancel').addEventListener('click', () => { stop(); global.Nav.go('songs'); });
    doc.getElementById('wzCreate').addEventListener('click', create);
  }

  function stop() { if (global.Audio) global.Audio.stop(); }

  // I, IV, V and home again, in the key and time chosen.
  function hearTheKey() {
    const chords = keyChords();
    if (!chords.length || !global.Audio) return;
    const pick = degree => chords.find(c => c.scaleDegree === degree) || chords[0];
    const meter = M().parse(state.meter);
    global.Audio.playProgression([pick(1), pick(4), pick(5), pick(1)], {
      tempo: state.tempo, style: 'strum', voicing: 'smart', withBass: true,
      meter, beatsPerChord: M().barQuarters(meter),
    }).catch(() => UI().toast('Audio could not start'));
  }

  // Two bars of the time signature: its plainest strum and groove, on the home chord.
  function hearTheTime() {
    if (!global.Audio) return;
    const meter = M().parse(state.meter);
    const home = global.Chords.buildChord(state.key || 'C', state.scale === 'major' || !/minor|dorian|phrygian|aeolian|locrian/.test(state.scale) ? 'maj' : 'm');
    const pattern = global.Arrangements.makePlaybackPattern(M().defaultRhythm(meter), M().defaultGroove(meter), meter);
    global.Audio.playBacking([home, home], {
      tempo: state.tempo, voicing: 'smart', withBass: true, pattern, stepsPerChord: M().stepsPerBar(meter), metronome: false,
    }).catch(() => UI().toast('Audio could not start'));
  }

  function create() {
    if (!state.key) { UI().toast('Choose a key first'); return; }
    stop();
    const S = Song();
    const shape = STARTS.find(s => s.id === state.start) || STARTS[0];
    const song = S.createSong({
      title: state.title.trim() || 'Untitled song',
      key: state.key, scale: state.scale, tempo: state.tempo,
      meter: M().parse(state.meter), feelingId: state.feelingId,
    });
    shape.roles.forEach(role => song.sections.push(S.createSection({ role })));
    S.autoNameSections(song);
    if (!global.Storage.saveProject(song)) { UI().toast('Could not save the song'); return; }
    UI().toast(`"${song.title}" started in ${song.key} ${(global.Scales.getScaleMeta(song.scale) || {}).name || ''}`);
    reset();
    global.Nav.go('section', song.id, song.sections[0].id);
  }

  function enter() {
    reset();
    render();
  }

  global.Views = global.Views || {};
  global.Views.Wizard = { enter };
})(typeof window !== 'undefined' ? window : globalThis);
