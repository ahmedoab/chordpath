/* ChordPath — ui/views/studio.js
 * Studio guide: per-section instrument roster, frequency-density meter with
 * verdicts, per-instrument cards (free plugins, mix chain, recording guide),
 * pair-clash warnings, and the vocal range/session block.
 */
(function (global) {
  'use strict';

  const doc = global.document;
  const UI = () => global.UI;
  const I = () => global.Instruments;
  const P = () => global.Plugins;
  const Mx = () => global.Mixing;
  const Rec = () => global.Recording;
  const R = () => global.Arrangements;
  const F = () => global.Feelings;
  const Song = () => global.Song;
  const St = () => global.Storage;
  const App = () => global.App;

  let currentSectionId = null;
  let openCard = null;

  function root() { return doc.getElementById('studioRoot'); }
  function song() { return App().state.song; }
  function section() {
    const s = song();
    return Song().getSection(s, currentSectionId) || s.sections[0];
  }

  // ── Note helpers for the vocal block ─────────────────────────────────────
  function noteToMidi(name) {
    const m = String(name || '').trim().match(/^([A-Ga-g])([#b]?)(-?\d)$/);
    if (!m) return null;
    const base = { C:0, D:2, E:4, F:5, G:7, A:9, B:11 }[m[1].toUpperCase()];
    const acc = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
    return base + acc + (parseInt(m[3], 10) + 1) * 12;
  }
  function midiToNote(midi) {
    const names = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
    return names[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1);
  }

  // ── Render ───────────────────────────────────────────────────────────────
  function render() {
    const s = song();
    if (!s) { root().innerHTML = '<p class="meta">No song open.</p>'; return; }
    if (!Song().getSection(s, currentSectionId)) currentSectionId = s.sections[0].id;
    const sec = section();
    const ui = UI();
    const roster = sec.roster || [];
    const report = I().analyzeRoster(roster, { role: sec.role, energy: s.energy });

    const secTabs = s.sections.map(x => `
      <button type="button" class="sec-chip${x.id === sec.id ? ' active' : ''}" data-sec="${ui.esc(x.id)}">${ui.esc(x.name)}</button>`).join('');

    // Roster checkboxes grouped by role.
    const groups = I().grouped();
    const rosterHTML = I().ROLES.map(role => {
      const list = groups[role.id] || [];
      if (!list.length) return '';
      return `
        <div class="roster-group">
          <h4>${ui.esc(role.name)}</h4>
          ${list.map(inst => `
            <label class="roster-item${roster.includes(inst.id) ? ' on' : ''}">
              <input type="checkbox" data-inst="${inst.id}"${roster.includes(inst.id) ? ' checked' : ''} />
              ${ui.esc(inst.name)}
            </label>`).join('')}
        </div>`;
    }).join('');

    // Density meter.
    const meterHTML = I().SLOTS.map(slot => {
      const load = report.slotLoad[slot.id] || 0;
      const pct = Math.min(100, load / 4 * 100);
      const cls = load >= 3.2 ? 'hot' : load >= 2.2 ? 'warm' : 'ok';
      return `
        <div class="meter-row" title="${ui.esc(slot.range)}">
          <span class="meter-label">${ui.esc(slot.name)}</span>
          <span class="meter-bar"><span class="meter-fill ${cls}" style="width:${pct}%"></span></span>
          <span class="meter-val meta">${load.toFixed(1)}</span>
        </div>`;
    }).join('');

    const verdictCls = { balanced: 'good', sparse: 'warn', crowded: 'hot' }[report.verdict] || '';
    const verdictText = {
      balanced: 'Balanced — this arrangement has room to breathe.',
      sparse: 'Sparse — deliberate emptiness or missing foundations?',
      crowded: 'Crowded — instruments are fighting for the same space.',
    }[report.verdict];

    const adviceHTML = report.advice.map(a => `<li>${ui.esc(a)}</li>`).join('');

    const clashHTML = report.clashes.slice(0, 5).map(c => {
      const a = I().byId(c.a), b = I().byId(c.b);
      const slot = I().SLOTS.find(x => x.id === c.slot);
      const tip = Mx().pairTip(c.a, c.b) ||
        `Both crowd the ${slot.name.toLowerCase()} band (${slot.range}): pan them apart 30/30 and high-pass or EQ-dip the less important one.`;
      return `<div class="clash-row"><strong>${ui.esc(a.name)} + ${ui.esc(b.name)}</strong> <span class="meta">(${ui.esc(slot.name.toLowerCase())})</span><br/>${ui.esc(tip)}</div>`;
    }).join('') || '<p class="meta">No frequency clashes between the current instruments.</p>';

    // Instrument cards.
    const cardsHTML = roster.map(id => {
      const inst = I().byId(id);
      if (!inst) return '';
      const open = openCard === id;
      return `
        <div class="inst-card${open ? ' open' : ''}" data-card="${inst.id}">
          <button type="button" class="inst-card-head" data-toggle="${inst.id}">
            <span>${ui.esc(inst.name)}</span>
            <span class="meta">${open ? '▾' : '▸'}</span>
          </button>
          ${open ? instCardBody(inst) : ''}
        </div>`;
    }).join('');

    // Vocal block.
    const vocalHTML = roster.includes('lead_vocal') ? vocalBlock(sec) : '';

    const levelSteps = Mx().levelOrder().map(x => `<li>${ui.esc(x)}</li>`).join('');

    root().innerHTML = `
      <div class="studio">
        <div class="studio-head">
          <h3>Studio guide</h3>
          <p class="meta">Pick instruments per section, keep the density meter out of the red, then follow each instrument's plugin / mix / recording card in your DAW.</p>
          <div class="section-switch">${secTabs}</div>
        </div>
        <div class="studio-grid">
          <div class="studio-col">
            <div class="studio-panel">
              <h4>Instruments in ${ui.esc(sec.name)}</h4>
              ${rosterHTML}
            </div>
          </div>
          <div class="studio-col">
            <div class="studio-panel">
              <h4>Density meter</h4>
              <div class="verdict ${verdictCls}">${ui.esc(verdictText)}</div>
              ${meterHTML}
              <ul class="advice-list">${adviceHTML}</ul>
            </div>
            <div class="studio-panel">
              <h4>Instrument pairs to watch</h4>
              ${clashHTML}
            </div>
            <div class="studio-panel">
              <h4>Rough-balance order</h4>
              <ol class="advice-list">${levelSteps}</ol>
            </div>
          </div>
        </div>
        ${vocalHTML}
        <div class="studio-panel">
          <h4>Instrument cards — plugins, mix chain, recording</h4>
          <div class="inst-cards">${cardsHTML || '<p class="meta">Add instruments to the roster to see their guides.</p>'}</div>
        </div>
      </div>`;

    wire();
  }

  function instCardBody(inst) {
    const ui = UI();
    const plugs = P().forInstrument(inst.id);
    const mix = Mx().guideFor(inst.id);
    const rec = Rec().guideFor(inst.id);

    const soundHTML = plugs.sound.length ? `
      <h5>Free sound sources</h5>
      ${plugs.sound.map(p => `<div class="plug-row"><strong>${ui.esc(p.name)}</strong> <span class="meta">${p.freeTier === 'free' ? 'free' : 'free tier'}</span><br/><span class="meta">${ui.esc(p.why)}</span><br/>${ui.esc(p.tip)}</div>`).join('')}` : '';

    const fxHTML = plugs.effects.length ? `
      <h5>Free effects that suit it</h5>
      <p class="meta">${plugs.effects.map(p => ui.esc(p.name)).join(' · ')}</p>` : '';

    const mixHTML = mix ? `
      <h5>Mix chain <span class="meta">(top to bottom)</span></h5>
      <ol class="chain-list">
        ${mix.chain.map(st => `<li><strong>${ui.esc(st.fx)}</strong> — ${ui.esc(st.setting)}<br/><span class="meta">${ui.esc(st.why)}</span></li>`).join('')}
      </ol>
      <p class="meta"><strong>Pan:</strong> ${ui.esc(mix.pan)} · <strong>Level:</strong> ${ui.esc(mix.levelHint)}</p>
      <p>${ui.esc(mix.tip)}</p>` : '';

    const recHTML = rec ? `
      <h5>How to record it</h5>
      ${rec.methods.map(m => `<p><strong>${ui.esc(m.name)}</strong></p><ul class="advice-list">${m.steps.map(st => `<li>${ui.esc(st)}</li>`).join('')}</ul>`).join('')}
      <p class="meta"><strong>Takes:</strong> ${ui.esc(rec.takes)}</p>
      <p>${ui.esc(rec.tip)}</p>` : '';

    return `<div class="inst-card-body">
      <p class="meta">${ui.esc(inst.tip)}</p>
      ${soundHTML}${fxHTML}${mixHTML}${recHTML}
    </div>`;
  }

  function vocalBlock(sec) {
    const ui = UI();
    const s = song();
    const settings = St().getSettings();
    const range = (settings.singerRange || { low: 'A2', high: 'E4' });
    const pattern = R().byId(R().VOCAL_MELODIES, sec.vocalPattern);
    const pRange = pattern && pattern.range ? pattern.range : [60, 76];
    const singerLo = noteToMidi(range.low) != null ? noteToMidi(range.low) : 45;
    const singerHi = noteToMidi(range.high) != null ? noteToMidi(range.high) : 64;

    // The pattern range is written for a generic voice; compare octave-agnostically:
    // find the octave shift that best fits the singer, then report what remains.
    let bestShift = 0, bestFit = -Infinity;
    for (let shift = -24; shift <= 24; shift += 12) {
      const lo = pRange[0] + shift, hi = pRange[1] + shift;
      const fit = Math.min(hi, singerHi) - Math.max(lo, singerLo);
      if (fit > bestFit) { bestFit = fit; bestShift = shift; }
    }
    const lo = pRange[0] + bestShift, hi = pRange[1] + bestShift;
    let verdictText, cls;
    if (lo >= singerLo && hi <= singerHi) {
      verdictText = `Comfortable: the melody sits at ${midiToNote(lo)}–${midiToNote(hi)}${bestShift ? ` (sing it ${Math.abs(bestShift) / 12} octave${Math.abs(bestShift) > 12 ? 's' : ''} ${bestShift > 0 ? 'up' : 'down'} from the tab)` : ''}, inside your ${ui.esc(range.low)}–${ui.esc(range.high)}.`;
      cls = 'good';
    } else if (hi > singerHi) {
      verdictText = `The top of this melody (${midiToNote(hi)}) sits above your ${ui.esc(range.high)} — take the highest phrases into head voice / falsetto, drop the melody seed an octave, or transpose the song down ${hi - singerHi} semitone${hi - singerHi > 1 ? 's' : ''}.`;
      cls = 'warn';
    } else {
      verdictText = `This melody reaches below your ${ui.esc(range.low)} (${midiToNote(lo)}) — take it up an octave or raise the song's key.`;
      cls = 'warn';
    }

    const vg = Rec().VOCAL_GUIDE;
    const vgBlock = (title, list) =>
      `<p><strong>${title}</strong></p><ul class="advice-list">${list.map(x => `<li>${ui.esc(x)}</li>`).join('')}</ul>`;

    return `
      <div class="studio-panel vocal-panel">
        <h4>Vocals in ${ui.esc(sec.name)}</h4>
        <div class="verdict ${cls}">${verdictText}</div>
        <p class="meta">Vocal pattern: <strong>${ui.esc(pattern ? pattern.name : '')}</strong> — ${ui.esc(pattern ? pattern.tip : '')}</p>
        <label class="meta">Your range:
          <input id="singerLow" type="text" size="4" value="${ui.esc(range.low)}" aria-label="Lowest comfortable note" /> to
          <input id="singerHigh" type="text" size="4" value="${ui.esc(range.high)}" aria-label="Highest comfortable note" />
          <span class="meta">(e.g. A2 to E4 — sing your lowest and highest comfortable note against a piano app to find them)</span>
        </label>
        <div class="vocal-guide-grid">
          ${vgBlock('Warm up', vg.warmup)}
          ${vgBlock('Setup', vg.setup)}
          ${vgBlock('Takes', vg.takes)}
          ${vgBlock('Comping & tuning', vg.comping)}
        </div>
      </div>`;
  }

  function wire() {
    const s = song();
    root().querySelectorAll('.section-switch [data-sec]').forEach(b => {
      b.addEventListener('click', () => { currentSectionId = b.dataset.sec; render(); });
    });
    root().querySelectorAll('[data-inst]').forEach(cb => {
      cb.addEventListener('change', () => {
        App().mutate(() => {
          const sec = section();
          const set = new Set(sec.roster || []);
          if (cb.checked) set.add(cb.dataset.inst);
          else set.delete(cb.dataset.inst);
          sec.roster = Array.from(set);
        });
        render();
      });
    });
    root().querySelectorAll('[data-toggle]').forEach(b => {
      b.addEventListener('click', () => {
        openCard = openCard === b.dataset.toggle ? null : b.dataset.toggle;
        render();
      });
    });
    ['singerLow', 'singerHigh'].forEach(id => {
      const el = doc.getElementById(id);
      if (!el) return;
      el.addEventListener('change', () => {
        const lo = doc.getElementById('singerLow').value.trim();
        const hi = doc.getElementById('singerHigh').value.trim();
        if (noteToMidi(lo) == null || noteToMidi(hi) == null) {
          UI().toast('Use note names like A2 or E4');
          return;
        }
        St().setSettings({ singerRange: { low: lo, high: hi } });
        render();
      });
    });
  }

  function enter() {
    const s = song();
    if (s && !Song().getSection(s, currentSectionId)) currentSectionId = s.sections[0] && s.sections[0].id;
    render();
  }

  global.Views = global.Views || {};
  global.Views.Studio = { enter, render };
})(typeof window !== 'undefined' ? window : globalThis);
