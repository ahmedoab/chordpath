/* ChordPath — ui/views/wizard.js
 * New-song wizard: 1) feeling + energy, 2) genre, 3) generated preview with
 * rerolls, then create. Every choice regenerates a full draft song.
 */
(function (global) {
  'use strict';

  const doc = global.document;
  const UI = () => global.UI;
  const F = () => global.Feelings;
  const G = () => global.Genres;
  const Song = () => global.Song;

  const state = { step: 0, feelingId: null, energy: 'mid', genreId: null, seed: 1, draft: null };

  function root() { return doc.getElementById('wizardRoot'); }

  function reset() {
    state.step = 0;
    state.feelingId = null;
    state.energy = 'mid';
    state.genreId = null;
    state.seed = Date.now() & 0xffff;
    state.draft = null;
  }

  function dots() {
    return `<div class="wizard-dots">${[0, 1, 2].map(i =>
      `<span class="wdot${i === state.step ? ' active' : ''}"></span>`).join('')}</div>`;
  }

  function render() {
    if (state.step === 0) renderFeelingStep();
    else if (state.step === 1) renderGenreStep();
    else renderPreviewStep();
  }

  // ── Step 1: feeling + energy ─────────────────────────────────────────────
  function renderFeelingStep() {
    const ui = UI();
    const groups = F().groupedFeelings();
    const cards = Object.entries(groups).map(([group, list]) => `
      <div class="feel-group">
        <h4>${ui.esc(group)}</h4>
        <div class="feel-cards">
          ${list.map(f => `
            <button type="button" class="feel-card${state.feelingId === f.id ? ' selected' : ''}" data-feel="${f.id}">
              <span class="feel-name">${ui.esc(f.name)}</span>
              <span class="feel-vibe">${ui.esc(f.vibe)}</span>
            </button>`).join('')}
        </div>
      </div>`).join('');

    root().innerHTML = `
      <div class="wizard">
        ${dots()}
        <h3>What do you want people to feel?</h3>
        <p class="meta">This drives everything: key, chords, tempo, structure, arrangement. Each section can get its own feeling later.</p>
        ${cards}
        <div class="wizard-row">
          <span class="label">Energy</span>
          <div class="seg" id="energySeg">
            <button type="button" data-energy="low"${state.energy === 'low' ? ' class="active"' : ''}>Low — slow burn</button>
            <button type="button" data-energy="mid"${state.energy === 'mid' ? ' class="active"' : ''}>Mid — steady</button>
            <button type="button" data-energy="high"${state.energy === 'high' ? ' class="active"' : ''}>High — driving</button>
          </div>
        </div>
        <div class="wizard-nav">
          <button type="button" class="ghost" id="wzCancel">Cancel</button>
          <button type="button" class="primary" id="wzNext" ${state.feelingId ? '' : 'disabled'}>Next: pick a genre →</button>
        </div>
      </div>`;

    root().querySelectorAll('[data-feel]').forEach(b => {
      b.addEventListener('click', () => { state.feelingId = b.dataset.feel; render(); });
    });
    root().querySelectorAll('#energySeg [data-energy]').forEach(b => {
      b.addEventListener('click', () => { state.energy = b.dataset.energy; render(); });
    });
    doc.getElementById('wzCancel').addEventListener('click', () => global.Nav.go('songs'));
    doc.getElementById('wzNext').addEventListener('click', () => { state.step = 1; render(); });
  }

  // ── Step 2: genre ────────────────────────────────────────────────────────
  function renderGenreStep() {
    const ui = UI();
    const focused = G().FOCUSED_GENRES;
    const broad = G().BROAD_GENRES;
    const groupsDef = [
      ['Pop & Rock', ['pop', 'indie', 'classic_rock', 'hardrock', 'metal', 'synthwave']],
      ['Soul, Jazz & Blues', ['soul', 'gospel', 'jazz', 'blues', 'funk', 'bossa']],
      ['Folk & Country', ['folk', 'country', 'celtic', 'flamenco']],
      ['Electronic & Cinematic', ['house', 'lofi', 'cinematic', 'baroque', 'impressionist', 'reggae']],
    ];
    const card = g => `
      <button type="button" class="genre-card${state.genreId === g.id ? ' selected' : ''}" data-genre="${g.id}">
        <span class="genre-name">${ui.esc(g.name)}</span>
        <span class="genre-tip">${ui.esc((g.rhythm && g.rhythm.tip ? g.rhythm.tip.split('.')[0] : '') + '.')}</span>
      </button>`;

    root().innerHTML = `
      <div class="wizard">
        ${dots()}
        <h3>What world does it live in?</h3>
        <p class="meta">Feeling: <strong>${ui.esc((F().getFeeling(state.feelingId) || {}).name || '')}</strong> · ${ui.esc(state.energy)} energy</p>
        <div class="feel-group"><h4>Your styles</h4>
          <div class="genre-cards">${focused.map(card).join('')}</div></div>
        ${groupsDef.map(([label, ids]) => `
          <div class="feel-group"><h4>${label}</h4>
            <div class="genre-cards">${ids.map(id => broad.find(g => g.id === id)).filter(Boolean).map(card).join('')}</div></div>`).join('')}
        <div class="wizard-nav">
          <button type="button" class="ghost" id="wzBack">← Back</button>
          <button type="button" class="primary" id="wzNext" ${state.genreId ? '' : 'disabled'}>Next: hear the draft →</button>
        </div>
      </div>`;

    root().querySelectorAll('[data-genre]').forEach(b => {
      b.addEventListener('click', () => { state.genreId = b.dataset.genre; render(); });
    });
    doc.getElementById('wzBack').addEventListener('click', () => { state.step = 0; render(); });
    doc.getElementById('wzNext').addEventListener('click', () => {
      state.step = 2;
      generateDraft();
      render();
    });
  }

  // ── Step 3: preview ──────────────────────────────────────────────────────
  function generateDraft(sectionSeedOverrides) {
    state.draft = F().generateSongSpec({
      feelingId: state.feelingId,
      genreId: state.genreId,
      energy: state.energy,
      seed: state.seed,
    });
  }

  function renderPreviewStep() {
    const ui = UI();
    const s = state.draft;
    const rows = s.sections.map((sec, i) => {
      const chordNames = Song().chordsOf(s, sec).map(c => c.shortName).join(' · ');
      const fid = Song().sectionFeeling(s, sec);
      return `
        <div class="wz-section-row">
          <span class="wz-sec-name">${ui.esc(sec.name)}</span>
          ${ui.feelingChipHTML(fid)}
          <span class="wz-sec-chords">${ui.esc(chordNames)}</span>
          <span class="meta">${ui.esc((global.Arrangements.byId(global.Arrangements.RHYTHMS, sec.rhythmPattern) || {}).name || '')}</span>
          <button type="button" class="ghost small" data-reroll="${i}" title="Reroll this section">↻</button>
        </div>`;
    }).join('');

    root().innerHTML = `
      <div class="wizard">
        ${dots()}
        <h3>Your draft song</h3>
        <div class="wz-summary">
          <input id="wzTitle" type="text" placeholder="Song title…" maxlength="60" value="${ui.esc(s.title === 'Untitled song' ? '' : s.title)}" />
          <span class="chip">${ui.esc(s.key)} ${ui.esc((global.Scales.getScaleMeta(s.scale) || {}).name || s.scale)}</span>
          <span class="chip">${ui.esc(s.tempo)} BPM</span>
          ${ui.genreChipHTML(s.genreId)}${ui.feelingChipHTML(s.feelingId)}
        </div>
        <div class="wz-sections">${rows}</div>
        <div class="wizard-nav">
          <button type="button" class="ghost" id="wzBack">← Back</button>
          <button type="button" class="ghost" id="wzReroll">↻ Reroll everything</button>
          <button type="button" class="primary" id="wzCreate">Create song</button>
        </div>
      </div>`;

    doc.getElementById('wzBack').addEventListener('click', () => { state.step = 1; render(); });
    doc.getElementById('wzReroll').addEventListener('click', () => {
      state.seed = (state.seed * 31 + 7) & 0xffff;
      generateDraft();
      render();
    });
    root().querySelectorAll('[data-reroll]').forEach(b => {
      b.addEventListener('click', () => {
        const i = parseInt(b.dataset.reroll, 10);
        const sec = state.draft.sections[i];
        const fid = Song().sectionFeeling(state.draft, sec);
        const fresh = F().generateSectionSpec(state.draft, sec.role, fid, Date.now() & 0xffff);
        state.draft.sections[i] = Object.assign(fresh, { id: sec.id, name: sec.name });
        render();
      });
    });
    doc.getElementById('wzCreate').addEventListener('click', () => {
      const title = doc.getElementById('wzTitle').value.trim();
      state.draft.title = title || suggestTitle();
      global.Storage.saveProject(state.draft);
      const id = state.draft.id;
      UI().toast(`"${state.draft.title}" created`);
      reset();
      global.Nav.go('overview', id);
    });
  }

  function suggestTitle() {
    const f = F().getFeeling(state.feelingId);
    return (f ? f.name : 'New') + ' sketch';
  }

  function enter() {
    reset();
    render();
  }

  global.Views = global.Views || {};
  global.Views.Wizard = { enter };
})(typeof window !== 'undefined' ? window : globalThis);
