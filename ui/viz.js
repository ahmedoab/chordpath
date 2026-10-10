/* ChordPath — ui/viz.js
 * Visualizers for the section editor: piano keyboard, scale fretboard,
 * chord-shape SVG diagram (uses Tabs.findChordShape), and the tension chart.
 * Ported from the old app.js; same element ids, same behaviour.
 */
(function (global) {
  'use strict';

  const S = global.Scales;
  const doc = global.document;
  const $ = id => doc.getElementById(id);

  const WHITE_PCS = [0, 2, 4, 5, 7, 9, 11];
  const GUITAR_TUNING = [4, 11, 7, 2, 9, 4]; // high E, B, G, D, A, E (top → bottom rows)
  const FRET_COUNT = 12;

  // ── Piano ────────────────────────────────────────────────────────────────
  function buildPiano(previewNote) {
    const host = $('pianoKeys');
    if (!host) return;
    const startOct = 3, endOct = 5;
    const whiteList = [];
    for (let o = startOct; o <= endOct; o++) {
      WHITE_PCS.forEach(pc => whiteList.push({ pc, oct: o }));
    }
    host.innerHTML = '';
    whiteList.forEach(({ pc, oct }) => {
      const k = doc.createElement('div');
      k.className = 'piano-key white';
      k.dataset.pc = pc; k.dataset.oct = oct;
      const noteName = ['C', 'D', 'E', 'F', 'G', 'A', 'B'][WHITE_PCS.indexOf(pc)];
      k.innerHTML = `<span class="name">${noteName}${oct}</span>`;
      k.addEventListener('click', () => {
        if (previewNote) previewNote(noteName + oct);
        k.classList.add('preview');
        setTimeout(() => k.classList.remove('preview'), 400);
      });
      host.appendChild(k);
    });
    const totalWhites = whiteList.length;
    const whiteWidthPct = 100 / totalWhites;
    let whiteIdx = 0;
    for (let o = startOct; o <= endOct; o++) {
      WHITE_PCS.forEach(pc => {
        const nextHasBlack = [0, 2, 5, 7, 9].includes(pc);
        if (nextHasBlack) {
          const blackPc = pc + 1;
          const b = doc.createElement('div');
          b.className = 'piano-key black';
          b.dataset.pc = blackPc; b.dataset.oct = o;
          b.style.left = ((whiteIdx + 1) * whiteWidthPct - whiteWidthPct * 0.28) + '%';
          b.addEventListener('click', (e) => {
            e.stopPropagation();
            if (previewNote) previewNote(S.noteName(blackPc, false) + o);
            b.classList.add('preview');
            setTimeout(() => b.classList.remove('preview'), 400);
          });
          host.appendChild(b);
        }
        whiteIdx++;
      });
    }
  }

  function renderPiano(chord) {
    const host = $('pianoKeys');
    if (!host) return;
    [...host.children].forEach(k => k.classList.remove('active', 'root'));
    if (!chord) return;
    const chordPcs = new Set(chord.intervals.map(iv => (chord.rootPc + iv) % 12));
    [...host.children].forEach(k => {
      const pc = parseInt(k.dataset.pc, 10);
      if (chordPcs.has(pc)) k.classList.add('active');
      if (pc === chord.rootPc) k.classList.add('root');
    });
  }

  // ── Fretboard ────────────────────────────────────────────────────────────
  function buildFretboard() {
    const host = $('fretGrid');
    if (!host) return;
    host.innerHTML = '';
    for (let s = 0; s < 6; s++) {
      const lbl = doc.createElement('div');
      lbl.className = 'fret-cell open-label';
      lbl.textContent = S.noteName(GUITAR_TUNING[s], false);
      host.appendChild(lbl);
      for (let f = 0; f <= FRET_COUNT; f++) {
        const cell = doc.createElement('div');
        cell.className = 'fret-cell' + (f === 0 ? ' head' : '');
        cell.dataset.string = s;
        cell.dataset.fret = f;
        if (s === 2 && [3, 5, 7, 9].includes(f)) {
          const m = doc.createElement('span'); m.className = 'fret-marker';
          cell.appendChild(m);
        }
        if (s === 2 && f === 12) {
          const m1 = doc.createElement('span'); m1.className = 'fret-marker'; m1.style.left = '35%';
          const m2 = doc.createElement('span'); m2.className = 'fret-marker'; m2.style.left = '65%';
          cell.appendChild(m1); cell.appendChild(m2);
        }
        const dot = doc.createElement('span'); dot.className = 'dot';
        cell.appendChild(dot);
        host.appendChild(cell);
      }
    }
  }

  function renderFretboard(chord) {
    const host = $('fretGrid');
    if (!host) return;
    [...host.children].forEach(c => c.classList.remove('lit', 'root'));
    if (!chord) return;
    const chordPcs = new Set(chord.intervals.map(iv => (chord.rootPc + iv) % 12));
    for (let s = 0; s < 6; s++) {
      for (let f = 0; f <= FRET_COUNT; f++) {
        const pc = (GUITAR_TUNING[s] + f) % 12;
        const cell = host.querySelector(`[data-string="${s}"][data-fret="${f}"]`);
        if (!cell) continue;
        if (chordPcs.has(pc)) {
          cell.classList.add('lit');
          cell.querySelector('.dot').textContent = S.noteName(pc, chord.preferFlats);
          if (pc === chord.rootPc) cell.classList.add('root');
        }
      }
    }
  }

  // ── Chord-shape diagram ──────────────────────────────────────────────────
  function renderChordShape(chord, opts) {
    opts = opts || {};
    const svg = $('chordShape');
    const nameEl = $('chordShapeName');
    const infoEl = $('chordShapeInfo');
    if (!svg || !nameEl) return;

    if (!chord) {
      nameEl.textContent = '—';
      svg.innerHTML = '<text x="100" y="68" class="empty-note">add a chord to see how to play it</text>';
      if (infoEl) infoEl.textContent = 'Pick a chord to see the frets.';
      return;
    }

    nameEl.textContent = (opts.preview ? 'Preview: ' : '') + chord.shortName +
      (chord.fullName && chord.fullName !== chord.shortName ? ' - ' + chord.fullName : '');
    const shape = global.Tabs.findChordShape(chord.rootPc, chord.intervals);
    if (!shape) {
      svg.innerHTML = '<text x="100" y="68" class="empty-note">no comfortable shape in the low frets</text>';
      if (infoEl) infoEl.textContent = 'No easy low-fret shape found. Try a simpler chord color or a higher voicing.';
      return;
    }

    const stringX = [25, 55, 85, 115, 145, 175];
    const fretY = [22, 46, 70, 94, 118];
    const stringNames = ['E', 'A', 'D', 'G', 'B', 'E'];
    const parts = [];

    const topClass = shape.base === 0 ? 'nut' : 'grid-line';
    parts.push(`<line class="${topClass}" x1="${stringX[0]}" y1="${fretY[0]}" x2="${stringX[5]}" y2="${fretY[0]}"/>`);
    for (let i = 1; i < fretY.length; i++) {
      parts.push(`<line class="grid-line" x1="${stringX[0]}" y1="${fretY[i]}" x2="${stringX[5]}" y2="${fretY[i]}"/>`);
    }
    for (let s = 0; s < 6; s++) {
      parts.push(`<line class="grid-line" x1="${stringX[s]}" y1="${fretY[0]}" x2="${stringX[s]}" y2="${fretY[fretY.length - 1]}"/>`);
    }
    if (shape.base > 0) {
      parts.push(`<text class="fret-num" x="${stringX[5] + 6}" y="${fretY[0] + 12}">${shape.base}fr</text>`);
    }
    for (let s = 0; s < 6; s++) {
      const pick = shape.shape[s];
      if (!pick) {
        parts.push(`<text class="muted-x" x="${stringX[s]}" y="14">×</text>`);
      } else if (pick.fret === 0) {
        parts.push(`<circle data-pc="${pick.pc}" cx="${stringX[s]}" cy="11" r="5" fill="none" stroke="currentColor" stroke-width="1.4" class="finger${pick.pc === chord.rootPc ? ' root' : ''}" fill-opacity="0"/>`);
      }
    }
    for (let s = 0; s < 6; s++) {
      const pick = shape.shape[s];
      if (!pick || pick.fret === 0) continue;
      const cellIdx = shape.base === 0 ? pick.fret : pick.fret - shape.base + 1;
      if (cellIdx < 1 || cellIdx >= fretY.length) continue;
      const y = (fretY[cellIdx - 1] + fretY[cellIdx]) / 2;
      const isRoot = pick.pc === chord.rootPc;
      parts.push(`<circle data-pc="${pick.pc}" class="finger${isRoot ? ' root' : ''}" cx="${stringX[s]}" cy="${y}" r="7"/>`);
      parts.push(`<text data-pc="${pick.pc}" class="finger-label" x="${stringX[s]}" y="${y}">${pick.fret}</text>`);
    }
    for (let s = 0; s < 6; s++) {
      parts.push(`<text class="string-label" x="${stringX[s]}" y="${fretY[fretY.length - 1] + 10}">${stringNames[s]}</text>`);
    }
    svg.innerHTML = parts.join('');
    if (infoEl) {
      const frets = shape.shape.map(p => !p ? 'x' : String(p.fret)).join(' ');
      const pos = shape.base > 0 ? `Start around fret ${shape.base}. ` : 'Open-position shape. ';
      infoEl.textContent = `${pos}Frets low E to high E: ${frets}. Orange dots are the root note.`;
    }
  }

  // ── Tension chart ────────────────────────────────────────────────────────
  function renderTensionChart(arc) {
    const svg = $('tensionChart');
    if (!svg) return;
    svg.innerHTML = '';
    if (!arc || arc.length === 0) {
      svg.innerHTML = '<text x="100" y="24" text-anchor="middle" fill="rgba(241,236,220,0.35)" font-size="10" font-family="JetBrains Mono">— no data yet —</text>';
      return;
    }
    const W = 200, H = 40, pad = 6;
    const stepX = arc.length > 1 ? (W - 2 * pad) / (arc.length - 1) : 0;
    const pts = arc.map((v, i) => [pad + i * stepX, H - pad - (v / 10) * (H - 2 * pad)]);
    const areaPath = (pts.length >= 2 ? `M ${pad} ${H - pad} ` + pts.map(p => `L ${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ') + ` L ${W - pad} ${H - pad} Z` : '');
    const linePath = pts.map((p, i) => (i === 0 ? 'M' : 'L') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
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

  global.Viz = {
    GUITAR_TUNING,
    buildPiano, renderPiano,
    buildFretboard, renderFretboard,
    renderChordShape,
    renderTensionChart,
  };
})(typeof window !== 'undefined' ? window : globalThis);
