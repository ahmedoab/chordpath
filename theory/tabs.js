/* ChordPath — tabs.js
 * Guitar tablature for everything: any note-event array ({midi, beatStart,
 * beats}) renders as monospace 6-line tab in standard tuning, so vocal
 * melodies, bass lines, keys, and synth parts all read like guitar.
 * Bass parts sit on the low strings; drums render as a 16-step grid.
 *
 * Also home of findChordShape (moved from app.js): the playable-chord-shape
 * solver used by the chord diagram and the strummed-chord tab.
 */
(function (global) {
  'use strict';

  // Standard tuning, low E to high e.
  const TUNING_MIDI = [40, 45, 50, 55, 59, 64];   // E2 A2 D3 G3 B3 E4
  const STRING_LABELS = ['E', 'A', 'D', 'G', 'B', 'e'];  // index 0 = low E
  const OPEN_PCS = [4, 9, 2, 7, 11, 4];

  // Which strings each register may use (indices into TUNING_MIDI).
  const REGISTERS = {
    bass: [0, 1, 2],
    mid:  [1, 2, 3, 4],
    lead: [2, 3, 4, 5],
    full: [0, 1, 2, 3, 4, 5],
  };

  // ── Chord-shape solver (verbatim behaviour from the old app.js) ──────────
  function findChordShape(rootPc, intervals) {
    const chordPcs = new Set(intervals.map(iv => (rootPc + iv) % 12));
    let best = null;
    for (let base = 0; base <= 11; base++) {
      const candidateFrets = base === 0 ? [0, 1, 2, 3, 4] : [0, base, base + 1, base + 2, base + 3];
      const shape = [];
      let played = 0, lowestSounding = -1, lowestRoot = -1, span = 0;
      const fretted = [];
      const covered = new Set();
      for (let s = 0; s < 6; s++) {
        // Candidates on this string, lowest fret first.
        const cands = [];
        for (const f of candidateFrets) {
          const pc = (OPEN_PCS[s] + f) % 12;
          if (chordPcs.has(pc)) cands.push({ fret: f, pc });
        }
        let pick = null;
        if (cands.length) {
          if (lowestSounding < 0) {
            // Bass string: prefer the root if reachable.
            pick = cands.find(c => c.pc === rootPc) || cands[0];
          } else {
            // Prefer a chord tone not yet covered so colour tones (7ths,
            // 9ths) survive — the old root-per-string rule erased them.
            pick = cands.find(c => !covered.has(c.pc)) || cands[0];
          }
        }
        shape.push(pick);
        if (pick) {
          played++;
          covered.add(pick.pc);
          if (lowestSounding < 0) lowestSounding = s;
          if (pick.pc === rootPc && lowestRoot < 0) lowestRoot = s;
          if (pick.fret > 0) fretted.push(pick.fret);
        }
      }
      if (played < 4) continue;
      if (fretted.length > 1) span = Math.max(...fretted) - Math.min(...fretted);
      if (span > 3) continue;
      let score = played * 2;
      score += covered.size * 1.5;                    // reward full chord coverage
      score -= (chordPcs.size - covered.size) * 2;    // punish missing chord tones
      if (lowestRoot === lowestSounding && lowestRoot >= 0) score += 3;
      if (lowestRoot >= 0 && lowestRoot <= 2) score += 4;
      score -= base * 1.0;   // strongly prefer open/low positions over barres
      score -= span * 0.5;
      if (!best || score > best.score) best = { base, shape, played, score };
    }
    return best;
  }

  // ── Note events → string/fret placement ──────────────────────────────────
  // Greedy left-to-right mapping that prefers position continuity, low
  // positions, and open strings. Out-of-range notes are octave-shifted and
  // flagged so the caption can say so.
  function mapEventsToFrets(events, opts) {
    opts = opts || {};
    const maxFret = opts.maxFret || 15;
    const strings = REGISTERS[opts.register || 'lead'] || REGISTERS.lead;
    const lowest = TUNING_MIDI[strings[0]];
    const highest = TUNING_MIDI[strings[strings.length - 1]] + maxFret;

    let prev = null;
    let shifted = 0;
    const out = [];
    for (const ev of events) {
      let midi = ev.midi;
      let shift = 0;
      while (midi < lowest) { midi += 12; shift++; }
      while (midi > highest) { midi -= 12; shift--; }
      if (shift !== 0) shifted++;

      let best = null, bestCost = Infinity;
      for (const s of strings) {
        const fret = midi - TUNING_MIDI[s];
        if (fret < 0 || fret > maxFret) continue;
        let cost;
        if (prev) {
          cost = 1.5 * Math.abs(fret - prev.fret) + 1.0 * Math.abs(s - prev.string) +
                 0.3 * fret - (fret === 0 ? 1.2 : 0);
        } else {
          cost = 0.4 * fret - (fret === 0 ? 1.2 : 0);
        }
        if (cost < bestCost) { bestCost = cost; best = { string: s, fret }; }
      }
      if (!best) continue;   // truly unplayable even after octave shifts
      out.push({
        string: best.string, fret: best.fret,
        beatStart: ev.beatStart, beats: ev.beats,
        midi, name: ev.name || '', shifted: shift,
      });
      prev = best;
    }
    out.shiftedCount = shifted;
    return out;
  }

  // ── Grid rendering ───────────────────────────────────────────────────────
  // Time-proportional: subdiv 4 (16th-note resolution), 2 chars per step,
  // so a 4/4 bar is 32 chars wide plus its bar line.
  function makeGrid(totalBeats, opts) {
    const beatsPerBar = opts.beatsPerBar || 4;
    const subdiv = opts.subdiv || 4;
    const bars = Math.max(1, Math.ceil((totalBeats - 1e-6) / beatsPerBar));
    const cellsPerBar = beatsPerBar * subdiv;
    const charsPerBar = cellsPerBar * 2;
    return { beatsPerBar, subdiv, bars, cellsPerBar, charsPerBar };
  }

  function beatToCol(beat, grid) {
    const bar = Math.floor(beat / grid.beatsPerBar + 1e-6);
    const local = beat - bar * grid.beatsPerBar;
    const cell = Math.round(local * grid.subdiv);
    // +1 per preceding bar line
    return bar * (grid.charsPerBar + 1) + cell * 2;
  }

  function blankRow(grid, fillChar) {
    const parts = [];
    for (let b = 0; b < grid.bars; b++) {
      parts.push(fillChar.repeat(grid.charsPerBar));
      parts.push('|');
    }
    return parts.join('').split('');
  }

  function writeAt(row, col, text, overwriteOnly) {
    for (let i = 0; i < text.length; i++) {
      const c = col + i;
      if (c < 0 || c >= row.length) return;
      if (row[c] === '|') return;                       // never cross bar lines
      if (overwriteOnly && row[c] !== overwriteOnly) return;  // don't clobber
      row[c] = text[i];
    }
  }

  function chordSymbolRow(chords, beatsPerChord, grid) {
    if (!chords || !chords.length) return null;
    const row = blankRow(grid, ' ').map(ch => (ch === '|' ? ' ' : ch));
    chords.forEach((c, i) => {
      writeAt(row, beatToCol(i * beatsPerChord, grid), c.shortName);
    });
    return row.join('').replace(/\s+$/, '');
  }

  // ── Melody tab (any pitched event array) ─────────────────────────────────
  function renderMelodyTab(events, opts) {
    opts = opts || {};
    if (!events || !events.length) return '(no notes)';
    const beatsPerChord = opts.beatsPerChord || 4;
    const totalBeats = opts.totalBeats ||
      Math.max(
        (opts.chords ? opts.chords.length * beatsPerChord : 0),
        Math.max.apply(null, events.map(e => e.beatStart + e.beats)));
    const grid = makeGrid(totalBeats, opts);
    const mapped = mapEventsToFrets(events, opts);
    if (!mapped.length) return '(out of guitar range)';

    // 6 string rows, high e on top.
    const stringRows = [];
    for (let s = 5; s >= 0; s--) {
      stringRows.push({ label: STRING_LABELS[s], stringIdx: s, row: blankRow(grid, '-') });
    }
    for (const ev of mapped) {
      const rowObj = stringRows.find(r => r.stringIdx === ev.string);
      writeAt(rowObj.row, beatToCol(ev.beatStart, grid), String(ev.fret));
    }

    // Chord symbols travel above each system, note names below it.
    const barsPerLine = opts.barsPerLine || 2;
    const width = grid.charsPerBar + 1;
    const nameRow = blankRow(grid, ' ');
    if (opts.names !== false) {
      for (const ev of mapped) {
        writeAt(nameRow, beatToCol(ev.beatStart, grid), ev.name, ' ');
      }
    }
    const symRowStr = opts.chords && opts.chords.length
      ? chordSymbolRow(opts.chords, beatsPerChord, grid) : null;

    const systems = [];
    for (let start = 0; start < grid.bars; start += barsPerLine) {
      const from = start * width;
      const to = Math.min(grid.bars, start + barsPerLine) * width;
      const lines = [];
      if (symRowStr) {
        const seg = (symRowStr + ' '.repeat(grid.bars * width)).slice(from, to).replace(/\s+$/, '');
        if (seg) lines.push('   ' + seg);
      }
      for (const r of stringRows) {
        lines.push(r.label + ' |' + r.row.join('').slice(from, to));
      }
      if (opts.names !== false) {
        const seg = nameRow.join('').slice(from, to).replace(/[\s|]+$/, '');
        if (seg.trim()) lines.push('   ' + seg.replace(/\|/g, ' '));
      }
      systems.push(lines.join('\n'));
    }

    let out = systems.join('\n\n');
    if (mapped.shiftedCount > 0) {
      out += `\n(${mapped.shiftedCount} note${mapped.shiftedCount > 1 ? 's' : ''} octave-shifted to fit the fretboard)`;
    }
    return out;
  }

  // ── Strummed chord tab ───────────────────────────────────────────────────
  function renderChordTab(chords, opts) {
    opts = opts || {};
    if (!chords || !chords.length) return '(no chords)';
    const beatsPerChord = opts.beatsPerChord || 4;
    const grid = makeGrid(chords.length * beatsPerChord, opts);

    const stringRows = [];
    for (let s = 5; s >= 0; s--) {
      stringRows.push({ label: STRING_LABELS[s], stringIdx: s, row: blankRow(grid, '-') });
    }

    const captions = [];
    chords.forEach((chord, i) => {
      const col = beatToCol(i * beatsPerChord, grid);
      const shape = findChordShape(chord.rootPc, chord.intervals);
      if (!shape) {
        stringRows.forEach(r => writeAt(r.row, col, '?'));
        captions.push(`${chord.shortName}: no easy low-fret shape — play it as an arpeggio instead`);
        return;
      }
      for (let s = 0; s < 6; s++) {
        const pick = shape.shape[s];
        const rowObj = stringRows.find(r => r.stringIdx === s);
        writeAt(rowObj.row, col, pick ? String(pick.fret) : 'x');
      }
    });

    const barsPerLine = opts.barsPerLine || 2;
    const width = grid.charsPerBar + 1;
    const symRowStr = chordSymbolRow(chords, beatsPerChord, grid);
    const systems = [];
    for (let start = 0; start < grid.bars; start += barsPerLine) {
      const from = start * width;
      const to = Math.min(grid.bars, start + barsPerLine) * width;
      const lines = [];
      const seg = (symRowStr + ' '.repeat(grid.bars * width)).slice(from, to).replace(/\s+$/, '');
      if (seg) lines.push('   ' + seg);
      for (const r of stringRows) {
        lines.push(r.label + ' |' + r.row.join('').slice(from, to));
      }
      systems.push(lines.join('\n'));
    }
    let out = systems.join('\n\n');
    if (captions.length) out += '\n' + captions.join('\n');
    return out;
  }

  // ── Bass line synthesis (shared with the MIDI exporter) ──────────────────
  // Mirrors what audio.js schedulesBass plays, in note-event form.
  function bassRootMidi(chord) {
    // Place the root between E2 (40) and D#3 (51).
    return 40 + ((chord.rootPc - 4 + 12) % 12);
  }

  function bassEvents(chords, bassStyle, beatsPerChord) {
    beatsPerChord = beatsPerChord || 4;
    const out = [];
    const push = (midi, beatStart, beats) => out.push({ midi, beatStart, beats, layer: 'bass' });
    chords.forEach((ch, ci) => {
      const base = ci * beatsPerChord;
      const root = bassRootMidi(ch);
      const fifth = root + 7;
      const next = chords[(ci + 1) % chords.length];
      switch (bassStyle) {
        case 'root-fifth':
          push(root, base, 2); push(fifth - (fifth > 51 ? 12 : 0), base + 2, 2);
          break;
        case 'walking': {
          const third = root + (ch.intervals.includes(3) ? 3 : 4);
          const approach = bassRootMidi(next) - 1;
          push(root, base, 1); push(third, base + 1, 1);
          push(fifth, base + 2, 1); push(approach, base + 3, 1);
          break;
        }
        case 'pumping':
          for (let b = 0; b < beatsPerChord; b += 0.5) push(root, base + b, 0.5);
          break;
        case 'funk-16th':
          [0, 0.75, 1.5, 2.5, 3.25].forEach((b, i) =>
            push(i === 3 ? fifth - 12 + (fifth - 12 < 28 ? 12 : 0) : root, base + b, 0.4));
          break;
        case 'tumbao':
          push(root, base, 1.5); push(fifth - (fifth > 51 ? 12 : 0), base + 1.5, 0.5);
          push(root, base + 2, 1.5); push(fifth - (fifth > 51 ? 12 : 0), base + 3.5, 0.5);
          break;
        case 'reggae':
          push(root, base + 1, 1); push(root, base + 2.5, 1);
          break;
        case 'sustained':
          push(root, base, beatsPerChord);
          break;
        case 'root':
        default:
          push(root, base, beatsPerChord - 0.5);
          break;
      }
    });
    return out;
  }

  function renderBassTab(chords, bassStyle, opts) {
    opts = Object.assign({}, opts, { register: 'bass', names: false, chords });
    const events = bassEvents(chords, bassStyle, opts.beatsPerChord || 4);
    return renderMelodyTab(events, opts);
  }

  // ── Drum grid ────────────────────────────────────────────────────────────
  function renderDrumGrid(drumPattern, opts) {
    if (!drumPattern) return '(no drum pattern)';
    if (!drumPattern.kick.length && !drumPattern.snare.length &&
        !drumPattern.hhClosed.length && !drumPattern.hhOpen.length) {
      return '(no drums in this section)';
    }
    const rows = [
      { label: 'OH', steps: drumPattern.hhOpen, mark: 'o' },
      { label: 'HH', steps: drumPattern.hhClosed, mark: 'x' },
      { label: 'SN', steps: drumPattern.snare, mark: 'x' },
      { label: 'KK', steps: drumPattern.kick, mark: 'x' },
    ];
    const lines = rows.map(r => {
      const cells = Array(16).fill('-');
      (r.steps || []).forEach(s => { if (s >= 0 && s <= 15) cells[s] = r.mark; });
      return r.label + '|' + cells.join('') + '|';
    });
    lines.push('   1e+a2e+a3e+a4e+a');
    return lines.join('\n');
  }

  global.Tabs = {
    TUNING_MIDI, STRING_LABELS, OPEN_PCS, REGISTERS,
    findChordShape,
    mapEventsToFrets,
    renderMelodyTab, renderChordTab, renderBassTab, renderDrumGrid,
    bassEvents,
  };
})(typeof window !== 'undefined' ? window : globalThis);
