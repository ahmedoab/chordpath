/* ChordPath — ui/components.js
 * Shared DOM helpers: escaping, toast, modal, confirm, theory-term tooltips,
 * and small render utilities used by every view.
 * UI.esc is the ONLY sanctioned HTML escaper — all user-originated strings
 * (titles, names, notes, imported JSON) must pass through it.
 */
(function (global) {
  'use strict';

  const doc = global.document;

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function el(id) { return doc.getElementById(id); }

  // ── Toast ────────────────────────────────────────────────────────────────
  let toastTimer = null;
  function toast(message) {
    const t = el('toast');
    if (!t) return;
    t.textContent = message;
    t.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add('hidden'), 2200);
  }

  // ── Modal ────────────────────────────────────────────────────────────────
  function openModal(html) {
    doc.querySelectorAll('[popover]').forEach(p => { try { p.hidePopover(); } catch (e) {} });
    el('modalContent').innerHTML = html;
    el('scrim').classList.add('open');
  }

  function closeModal() {
    el('scrim').classList.remove('open');
    if (global.UI.onModalClose) global.UI.onModalClose();
  }

  function confirmBox(message) {
    return new Promise(resolve => {
      openModal(`
        <div class="confirm-box">
          <p>${esc(message)}</p>
          <div class="fd-actions">
            <button type="button" class="ghost" id="cbCancel">Cancel</button>
            <button type="button" class="primary" id="cbOk">Confirm</button>
          </div>
        </div>`);
      el('cbOk').addEventListener('click', () => { closeModal(); resolve(true); });
      el('cbCancel').addEventListener('click', () => { closeModal(); resolve(false); });
    });
  }

  // Modal text prompt (replaces window.prompt — non-blocking, styleable).
  function promptBox(message, defaultValue) {
    return new Promise(resolve => {
      openModal(`
        <div class="confirm-box">
          <p>${esc(message)}</p>
          <input type="text" id="pbInput" maxlength="60" value="${esc(defaultValue || '')}" style="width:100%;font:inherit;padding:0.4rem;margin:0.5rem 0;" />
          <div class="fd-actions">
            <button type="button" class="ghost" id="pbCancel">Cancel</button>
            <button type="button" class="primary" id="pbOk">OK</button>
          </div>
        </div>`);
      const input = el('pbInput');
      input.focus();
      input.select();
      const done = ok => { const v = input.value; closeModal(); resolve(ok ? v : null); };
      el('pbOk').addEventListener('click', () => done(true));
      el('pbCancel').addEventListener('click', () => done(false));
      input.addEventListener('keydown', e => { if (e.key === 'Enter') done(true); });
    });
  }

  // ── Theory-term tooltips ─────────────────────────────────────────────────
  const THEORY_TERMS = {
    diatonic: 'Diatonic chord',
    borrowed: 'Borrowed chord / modal interchange',
    secondary: 'Secondary dominant',
    'tt-sub': 'Tritone substitution',
    'dim-passing': 'Diminished passing chord',
    neapolitan: 'Neapolitan chord',
    chromatic: 'Chromatic mediant',
    aug6: 'Augmented-sixth chord',
    half: 'Half cadence',
    authentic: 'Authentic cadence',
    plagal: 'Plagal cadence',
    deceptive: 'Deceptive cadence',
    backdoor: 'Backdoor cadence',
    'phrygian-half': 'Phrygian half cadence',
    picardy: 'Picardy third',
  };

  function theoryTerm(label, theoryName) {
    if (!theoryName) return esc(label);
    return `<span class="term-tip" tabindex="0" title="Theory: ${esc(theoryName)}" data-theory="${esc(theoryName)}">${esc(label)}</span>`;
  }

  function addTheoryHints(text) {
    let out = esc(text);
    [
      ['unfinished ending', 'Half cadence'],
      ['borrowed color', 'Borrowed chord / modal interchange'],
      ['push-to chord', 'Secondary dominant'],
      ['sliding dominant', 'Tritone substitution'],
      ['passing shadow', 'Diminished passing chord'],
      ['flat-II shadow', 'Neapolitan chord'],
      ['sideways jump', 'Chromatic mediant'],
      ['big pull', 'Augmented-sixth chord'],
    ].forEach(([label, theory]) => {
      out = out.replace(new RegExp(label, 'gi'), match => theoryTerm(match, theory));
    });
    return out;
  }

  function prettyCat(c) {
    return {
      diatonic: 'In key', borrowed: 'Borrowed color', secondary: 'Push-to chord',
      'tt-sub': 'Sliding dominant', 'dim-passing': 'Passing shadow',
      neapolitan: 'Flat-II shadow', chromatic: 'Sideways jump', aug6: 'Big pull',
    }[c] || c;
  }

  // ── Select helpers ───────────────────────────────────────────────────────
  function addOptions(selectEl, items, selectedId, labelFn) {
    if (!selectEl) return;
    selectEl.innerHTML = '';
    const groups = {};
    items.forEach(item => {
      const group = item.family || item.target || '';
      (groups[group] = groups[group] || []).push(item);
    });
    Object.entries(groups).forEach(([group, list]) => {
      const parent = group ? doc.createElement('optgroup') : selectEl;
      if (group) parent.label = group;
      list.forEach(item => {
        const opt = doc.createElement('option');
        opt.value = item.id;
        opt.textContent = labelFn ? labelFn(item) : item.name;
        parent.appendChild(opt);
      });
      if (group) selectEl.appendChild(parent);
    });
    selectEl.value = selectedId;
  }

  // ── Chips ────────────────────────────────────────────────────────────────
  function feelingChipHTML(feelingId) {
    const F = global.Feelings;
    const f = F ? F.getFeeling(feelingId) : null;
    if (!f) return '';
    return `<span class="chip chip-feeling" title="${esc(f.vibe)}">${esc(f.name)}</span>`;
  }

  function genreChipHTML(genreId) {
    const g = global.Genres ? global.Genres.byId(genreId) : null;
    if (!g) return '';
    return `<span class="chip chip-genre">${esc(g.name)}</span>`;
  }

  function timeAgo(iso) {
    if (!iso) return '';
    const ms = Date.now() - new Date(iso).getTime();
    const min = Math.floor(ms / 60000);
    if (min < 1) return 'just now';
    if (min < 60) return min + 'm ago';
    const h = Math.floor(min / 60);
    if (h < 24) return h + 'h ago';
    const d = Math.floor(h / 24);
    return d + 'd ago';
  }

  global.UI = {
    esc, el, toast, openModal, closeModal, confirmBox, promptBox,
    THEORY_TERMS, theoryTerm, addTheoryHints, prettyCat,
    addOptions, feelingChipHTML, genreChipHTML, timeAgo,
    onModalClose: null,
  };
})(typeof window !== 'undefined' ? window : globalThis);
