/* ChordPath — ui/views/handoff.js
 * The DAW handoff pack: one printable page with everything needed to
 * produce the song — per-section tabs for every part, arrangement notes,
 * the instrument roster with plugin picks and mix-chain summaries, the
 * recording checklist, and export buttons.
 */
(function (global) {
  'use strict';

  const doc = global.document;
  const UI = () => global.UI;
  const R = () => global.Arrangements;
  const F = () => global.Feelings;
  const T = () => global.Tabs;
  const M = () => global.Melody;
  const I = () => global.Instruments;
  const P = () => global.Plugins;
  const Mx = () => global.Mixing;
  const Song = () => global.Song;
  const App = () => global.App;

  function root() { return doc.getElementById('handoffRoot'); }
  function song() { return App().state.song; }

  function sectionBlock(s, sec) {
    const ui = UI();
    const chords = Song().chordsOf(s, sec);
    if (!chords.length) return '';
    const bpc = sec.beatsPerChord || 4;
    const fid = Song().sectionFeeling(s, sec);
    const feeling = F().getFeeling(fid);
    const rhythm = R().byId(R().RHYTHMS, sec.rhythmPattern);
    const drum = R().byId(R().DRUMS, sec.drumPattern);
    const vocalPat = R().byId(R().VOCAL_MELODIES, sec.vocalPattern);
    const underPat = R().byId(R().UNDER_MELODIES, sec.underPattern);

    const melody = M().generatePatternMelody(chords, s.scale, Song().sectionKey(s, sec), vocalPat,
      { beatsPerChord: bpc, section: sec.role, seed: sec.melodySeed });
    const under = underPat && underPat.type !== 'none'
      ? M().generateUnderMelody(chords, s.scale, Song().sectionKey(s, sec), underPat,
          { beatsPerChord: bpc, seed: sec.underSeed })
      : [];

    const tabBlock = (title, text, tip) => `
      <div class="ho-tab">
        <h5>${ui.esc(title)}${tip ? ` <span class="meta">— ${ui.esc(tip)}</span>` : ''}</h5>
        <pre class="tab-pre">${ui.esc(text)}</pre>
      </div>`;

    let parts = tabBlock('Chords (guitar)', T().renderChordTab(chords, { beatsPerChord: bpc }), rhythm ? rhythm.tip : '');
    parts += tabBlock('Vocal melody', T().renderMelodyTab(melody, { chords, beatsPerChord: bpc, register: 'lead' }), vocalPat ? vocalPat.tip : '');
    parts += tabBlock('Bass', T().renderBassTab(chords, rhythm ? rhythm.bass : 'root', { beatsPerChord: bpc }), 'Shown on the low guitar strings — same frets work on a bass.');
    if (under.length) {
      parts += tabBlock('Under melody', T().renderMelodyTab(under, { chords, beatsPerChord: bpc, register: 'mid' }), underPat ? underPat.tip : '');
    }
    parts += tabBlock('Drums (16 steps per bar)', T().renderDrumGrid(drum), drum ? drum.tip : '');

    return `
      <section class="ho-section">
        <h4>${ui.esc(sec.name)}
          <span class="chip chip-feeling">${ui.esc(feeling ? feeling.name : '')}</span>
          <span class="meta">${ui.esc(Song().sectionBars(sec))} bars · ${ui.esc(Song().sectionTempo(s, sec))} BPM · ${ui.esc(rhythm ? rhythm.name : '')} / ${ui.esc(drum ? drum.name : '')}</span>
        </h4>
        ${feeling ? `<p class="meta">${ui.esc(feeling.tip)}</p>` : ''}
        ${parts}
      </section>`;
  }

  function rosterBlock(s) {
    const ui = UI();
    const union = new Set();
    s.sections.forEach(sec => (sec.roster || []).forEach(id => union.add(id)));
    if (!union.size) return '';
    const rows = Array.from(union).map(id => {
      const inst = I().byId(id);
      if (!inst) return '';
      const plugs = P().forInstrument(id);
      const mix = Mx().guideFor(id);
      const soundNames = plugs.sound.map(p => p.name).join(', ') || '—';
      const chainShort = mix ? mix.chain.map(c => c.fx).join(' → ') : '—';
      const usedIn = s.sections.filter(sec => (sec.roster || []).includes(id)).map(sec => sec.name).join(', ');
      return `
        <tr>
          <td><strong>${ui.esc(inst.name)}</strong><br/><span class="meta">${ui.esc(usedIn)}</span></td>
          <td>${ui.esc(soundNames)}</td>
          <td>${ui.esc(chainShort)}${mix ? `<br/><span class="meta">Pan: ${ui.esc(mix.pan)}</span>` : ''}</td>
        </tr>`;
    }).join('');
    return `
      <section class="ho-section">
        <h4>Instrument roster — free plugins & mix chains</h4>
        <table class="ho-table">
          <thead><tr><th>Instrument</th><th>Free sound source</th><th>Mix chain (details in the Studio view)</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </section>`;
  }

  function checklistBlock(s) {
    const ui = UI();
    const steps = Mx().levelOrder().map(x => `<li>${ui.esc(x)}</li>`).join('');
    const rec = [
      'Set your DAW project to ' + s.tempo + ' BPM and import the multi-track MIDI (each part lands on its own track; sections appear as markers).',
      'Load a free instrument on each MIDI track (see the roster table above).',
      'Record real parts (guitar/vocals) against the MIDI sketch, then mute the sketch track it replaces.',
      'Gain rule everywhere: loudest moment peaks around −12 dBFS.',
      'Vocals last, once the band feels right — see the Studio view for the full vocal session guide.',
    ].map(x => `<li>${ui.esc(x)}</li>`).join('');
    return `
      <section class="ho-section">
        <h4>Production checklist</h4>
        <ol class="advice-list">${rec}</ol>
        <h4>Rough-balance order (when mixing)</h4>
        <ol class="advice-list">${steps}</ol>
      </section>`;
  }

  function render() {
    const s = song();
    if (!s) { root().innerHTML = '<p class="meta">No song open.</p>'; return; }
    const ui = UI();
    const feeling = F().getFeeling(s.feelingId);
    const genre = global.Genres.byId(s.genreId);
    const dur = Math.round(Song().songDurationSec(s));
    const progress = Song().PROGRESS_STEPS.map(st =>
      `<span class="chip">${s.progress[st.id] ? '✓' : '○'} ${ui.esc(st.name)}</span>`).join(' ');

    root().innerHTML = `
      <div class="handoff">
        <div class="ho-actions no-print">
          <button type="button" class="primary" id="hoPrint">Print / Save as PDF</button>
          <button type="button" class="ghost" id="hoMidi">Export MIDI (all tracks)</button>
          <button type="button" class="ghost" id="hoJson">Export JSON</button>
        </div>
        <header class="ho-head">
          <h2>${ui.esc(s.title)}</h2>
          <p class="meta">
            ${ui.esc(s.key)} ${ui.esc((global.Scales.getScaleMeta(s.scale) || {}).name || s.scale)} ·
            ${ui.esc(s.tempo)} BPM · ${ui.esc(genre ? genre.name : '')} ·
            feeling: ${ui.esc(feeling ? feeling.name : '')} ·
            ~${Math.floor(dur / 60)}:${String(dur % 60).padStart(2, '0')}
          </p>
          <p>${progress}</p>
          ${s.notes ? `<p class="meta">${ui.esc(s.notes)}</p>` : ''}
        </header>
        ${s.sections.map(sec => sectionBlock(s, sec)).join('')}
        ${rosterBlock(s)}
        ${checklistBlock(s)}
        <p class="meta ho-footer">Made with ChordPath — tabs are in standard tuning (EADGBe); bass parts shown on the low strings.</p>
      </div>`;

    doc.getElementById('hoPrint').addEventListener('click', () => global.print());
    doc.getElementById('hoMidi').addEventListener('click', () => {
      App().flushSave();
      if (global.Midi.downloadSong(s)) ui.toast('Multi-track MIDI downloaded');
    });
    doc.getElementById('hoJson').addEventListener('click', () => {
      App().flushSave();
      global.Views.Songs.exportSong(s.id);
    });
  }

  function enter() { render(); }

  global.Views = global.Views || {};
  global.Views.Handoff = { enter, render };
})(typeof window !== 'undefined' ? window : globalThis);
