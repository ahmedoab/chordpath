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

  // ── Tab of any notes, chords included ────────────────────────────────────
  const HAND_SPAN = 3;            // frets between the lowest and the highest fretted finger

  // Finds where one hand can play pitches that sound together: each on its
  // own string, lower notes on lower strings, all within a hand's span. When
  // that cannot be done the bass note stays, with as many of the others as fit.
  // opts: { register, maxFret, near } — near is the fret the hand is at now.
  // Returns { notes: [{ string, fret, midi }], dropped, shifted, folded,
  // position }: dropped counts what could not be played, shifted the notes
  // outside the guitar's range, folded says a chord was written an octave down.
  function placeNotes(pitches, opts) {
    opts = opts || {};
    const maxFret = opts.maxFret || 15;
    const strings = REGISTERS[opts.register || 'full'] || REGISTERS.full;
    const lowest = TUNING_MIDI[strings[0]];
    const highest = TUNING_MIDI[strings[strings.length - 1]] + maxFret;
    const near = typeof opts.near === 'number' ? opts.near : null;

    let shifted = 0;
    const distinct = new Set();
    (pitches || []).forEach(p => {
      if (typeof p !== 'number' || !Number.isFinite(p)) return;
      let midi = Math.round(p);
      const asGiven = midi;
      while (midi < lowest) midi += 12;
      while (midi > highest) midi -= 12;
      if (midi !== asGiven) shifted++;
      distinct.add(midi);
    });
    const wanted = Array.from(distinct).sort((a, b) => a - b);
    if (!wanted.length) return { notes: [], dropped: 0, shifted, folded: false, position: near };
    const classes = list => new Set(list.map(p => p % 12)).size;

    // A note on its own is part of a line: it goes where it is written, and
    // the hand stays near where it was.
    if (wanted.length === 1) {
      const line = bestShape(wanted, strings, maxFret, near);
      return {
        notes: line ? line.picks : [], dropped: line ? 0 : 1,
        shifted, folded: false, position: line ? line.position : near,
      };
    }
    // Notes that sound together are a chord. What matters is which notes it
    // holds and which is in the bass, so it is tried as written and an octave
    // or two lower, and written where it is easiest to hold. The same chord
    // then always gets the same shape, whatever came before it.
    let chord = null, folded = false;
    for (let octaves = 0; octaves <= 2; octaves++) {
      const moved = Array.from(new Set(wanted.map(p => {
        let midi = p - 12 * octaves;
        while (midi < lowest) midi += 12;
        return midi;
      }))).sort((a, b) => a - b);
      if (moved[0] % 12 !== wanted[0] % 12) continue;          // the bass note stays the bass
      const shape = bestShape(moved.length > strings.length
        ? [moved[0]].concat(moved.slice(moved.length - (strings.length - 1))) : moved, strings, maxFret, null);
      if (shape && (!chord || shape.score > chord.score)) { chord = shape; folded = octaves > 0; }
    }
    if (!chord) return { notes: [], dropped: classes(wanted), shifted, folded: false, position: near };
    return {
      notes: chord.picks, dropped: classes(wanted) - classes(chord.picks.map(p => p.midi)),
      shifted, folded, position: chord.position,
    };
  }

  // The best way for one hand to hold as many of the given pitches as it can,
  // always including the lowest. Pitches are sorted, distinct and in range.
  // Returns { picks: [{ string, fret, midi }], score, position } or null.
  function bestShape(wanted, strings, maxFret, near) {
    const top = wanted[wanted.length - 1];
    const chordal = wanted.length > 1;
    let best = null;
    const weigh = picks => {
      const fretted = picks.filter(p => p.fret > 0);
      const frets = fretted.map(p => p.fret);
      const low = frets.length ? Math.min.apply(null, frets) : 0;
      if (frets.length && Math.max.apply(null, frets) - low > HAND_SPAN) return;
      if (fretted.length > 4) {
        // More notes than fingers: the first finger lies across the strings at
        // the lowest fret, which rules out an open string under it.
        const barreFrom = Math.min.apply(null, fretted.filter(p => p.fret === low).map(p => p.string));
        if (picks.some(p => p.fret === 0 && p.string > barreFrom)) return;
        if (fretted.filter(p => p.fret > low).length > 3) return;
      }
      const mean = frets.length ? frets.reduce((a, b) => a + b, 0) / frets.length : 0;
      let score = new Set(picks.map(p => p.midi % 12)).size * 10    // every note of the chord, in some octave
        + picks.length * 2                                          // then as many strings as will ring
        + (picks[picks.length - 1].midi === top ? 1 : 0)            // the top note is the tune
        + (picks.length - fretted.length) * 0.5                     // open strings are free
        - (frets.length ? Math.max.apply(null, frets) - low : 0)    // small shapes
        - (chordal ? 0.6 : 0.15) * mean;                            // low on the neck, chords above all
      if (near !== null && frets.length) score -= 0.4 * Math.abs(mean - near);
      if (!best || score > best.score) best = { score, picks: picks.slice(), position: frets.length ? mean : near };
    };
    // Gives the chosen notes strings from low to high, trying every way.
    const assign = (chosen, i, fromString, picks) => {
      if (i === chosen.length) { weigh(picks); return; }
      for (let s = fromString; s <= strings.length - (chosen.length - i); s++) {
        const fret = chosen[i] - TUNING_MIDI[strings[s]];
        if (fret < 0 || fret > maxFret) continue;
        picks.push({ string: strings[s], fret, midi: chosen[i] });
        assign(chosen, i + 1, s + 1, picks);
        picks.pop();
      }
    };
    // Every choice of notes that includes the lowest one.
    for (let mask = 1; mask < (1 << wanted.length); mask += 2) {
      const chosen = wanted.filter((p, i) => mask & (1 << i));
      if (chosen.length <= strings.length) assign(chosen, 0, 0, []);
    }
    return best;
  }

  // What to count under each sixteenth of a bar: "1 e + a" in quarters,
  // "1 +" in eighths, and so on for whatever the time signature counts in.
  function countLabels(beats, counts) {
    const perBeat = Math.max(1, Math.round(16 / counts));
    const within = perBeat === 4 ? ['', 'e', '+', 'a'] : Array.from({ length: perBeat }, (unused, i) => (i && i * 2 === perBeat ? '+' : ''));
    const out = [];
    for (let beat = 1; beat <= beats; beat++) within.forEach((label, i) => out.push(i ? label : String(beat)));
    return out;
  }

  // Six-line tab of any notes: single lines, chords, or both. Notes struck
  // one after another within a strum's breath are written as one chord, and
  // every step is wide enough that fret numbers never run together.
  // events: [{ midi, beatStart }]. opts: { totalBeats, tempo, register,
  // maxFret, near, lineWidth, bars }. Without `bars` the music is taken to be
  // in 4/4 from beat 0; with it, each entry is one bar (or the part of one
  // that the notes cover): { start, length, num, den, skip }, start and
  // length in beats and skip the beats of that bar which come before `start`.
  function renderNotesTab(events, opts) {
    opts = opts || {};
    const sorted = (events || [])
      .filter(e => e && Number.isFinite(e.midi) && Number.isFinite(e.beatStart) && e.beatStart >= 0)
      .sort((a, b) => a.beatStart - b.beatStart);
    if (!sorted.length) return '(no notes)';

    const subdiv = 4;                                         // steps to a beat: sixteenths
    const totalBeats = opts.totalBeats > 0 ? opts.totalBeats : sorted[sorted.length - 1].beatStart + 1;
    let given = Array.isArray(opts.bars) ? opts.bars.filter(b => b && b.length > 0) : [];
    if (!given.length) {
      for (let start = 0; start < Math.max(1, Math.ceil((totalBeats - 1e-6) / 4)) * 4; start += 4) given.push({ start, length: 4, num: 4, den: 4 });
    }
    let steps = 0;
    const bars = given.map(b => {
      const cells = Math.max(1, Math.round(b.length * subdiv));
      const labels = countLabels(b.num || 4, b.den || 4).slice(Math.round((b.skip || 0) * subdiv));
      const bar = { start: b.start, first: steps, cells, labels };
      steps += cells;
      return bar;
    });
    // The step a beat falls on: found in its own bar, so bars of any length line up.
    const stepOf = beat => {
      let bar = bars[0];
      for (let i = 1; i < bars.length && bars[i].start <= beat + 1e-9; i++) bar = bars[i];
      return bar.first + (beat - bar.start) * subdiv;
    };

    // A strum spreads its notes over a few hundredths of a second.
    const breath = Math.min(0.05 * (opts.tempo || 100) / 60, 0.12);
    const groups = [];
    sorted.forEach(e => {
      const g = groups[groups.length - 1];
      if (g && e.beatStart - g.last <= breath) { g.pitches.push(e.midi); g.last = e.beatStart; }
      else groups.push({ start: e.beatStart, last: e.beatStart, pitches: [e.midi] });
    });
    const byStep = new Map();
    let rounded = 0;
    groups.forEach(g => {
      const exact = stepOf(g.start);
      const step = Math.max(0, Math.min(steps - 1, Math.round(exact)));
      if (Math.abs(exact - step) > 0.16) rounded++;
      byStep.set(step, (byStep.get(step) || []).concat(g.pitches));
    });

    let near = typeof opts.near === 'number' ? opts.near : null;
    let dropped = 0, shifted = 0, folded = false, digits = 1;
    const placed = Array.from(byStep.keys()).sort((a, b) => a - b).map(step => {
      const p = placeNotes(byStep.get(step), { register: opts.register, maxFret: opts.maxFret, near });
      near = p.position;
      dropped += p.dropped;
      shifted += p.shifted;
      folded = folded || p.folded;
      if (p.notes.some(n => n.fret > 9)) digits = 2;
      return { step, notes: p.notes };
    });

    const w = digits + 1;                                     // room for the number and a dash after it
    const rows = TUNING_MIDI.map(() => Array(steps).fill('-'.repeat(w)));
    placed.forEach(m => m.notes.forEach(n => { rows[n.string][m.step] = String(n.fret).padEnd(w, '-'); }));

    // As many bars to a line as the width allows, and always at least one.
    const room = (opts.lineWidth || 80) - 3;
    const systems = [];
    for (let from = 0; from < bars.length;) {
      let to = from, used = 0;
      while (to < bars.length && (to === from || used + bars[to].cells * w + 1 <= room)) used += bars[to++].cells * w + 1;
      const lines = [];
      for (let s = 5; s >= 0; s--) {
        let line = STRING_LABELS[s] + ' |';
        for (let b = from; b < to; b++) line += rows[s].slice(bars[b].first, bars[b].first + bars[b].cells).join('') + '|';
        lines.push(line);
      }
      let count = '   ';
      for (let b = from; b < to; b++) {
        for (let i = 0; i < bars[b].cells; i++) count += (bars[b].labels[i] || '').padEnd(w, ' ');
        count += ' ';
      }
      lines.push(count.replace(/\s+$/, ''));
      systems.push(lines.join('\n'));
      from = to;
    }

    const remarks = [];
    if (folded) remarks.push('Chords are written in the octave where they are easiest to hold.');
    if (dropped) remarks.push(`${dropped} note${dropped > 1 ? 's' : ''} left out, beyond one hand's reach.`);
    if (shifted) remarks.push(`${shifted} note${shifted > 1 ? 's' : ''} moved an octave to fit the guitar's range.`);
    if (rounded) remarks.push('Timing is shown to the nearest sixteenth note.');
    return systems.join('\n\n') + (remarks.length ? '\n\n' + remarks.join('\n') : '');
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

  // The style's bar is played again in every bar a chord lasts, and nothing
  // sounds past the chord's end; only its last bar leads into the next chord.
  function bassEvents(chords, bassStyle, beatsPerChord) {
    beatsPerChord = beatsPerChord || 4;
    const out = [];
    chords.forEach((ch, ci) => {
      const end = (ci + 1) * beatsPerChord;
      const push = (midi, beatStart, beats) => {
        if (beatStart >= end - 1e-9) return;
        out.push({ midi, beatStart, beats: Math.min(beats, end - beatStart), layer: 'bass' });
      };
      const root = bassRootMidi(ch);
      const fifth = root + 7;
      const next = chords[(ci + 1) % chords.length];
      for (let from = 0; from < beatsPerChord; from += 4) {
        const base = ci * beatsPerChord + from;
        const span = Math.min(4, beatsPerChord - from);
        const last = from + 4 >= beatsPerChord;
        switch (bassStyle) {
          case 'root-fifth':
            push(root, base, 2); push(fifth - (fifth > 51 ? 12 : 0), base + 2, 2);
            break;
          case 'walking': {
            const third = root + (ch.intervals.includes(3) ? 3 : 4);
            push(root, base, 1); push(third, base + 1, 1);
            push(fifth, base + 2, 1); push(last ? bassRootMidi(next) - 1 : root + 12, base + 3, 1);
            break;
          }
          case 'pumping':
            for (let b = 0; b < span; b += 0.5) push(root, base + b, 0.5);
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
            push(root, base, span);
            break;
          case 'root':
          default:
            push(root, base, span - 0.5);
            break;
        }
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
  // A drum grid, one column per sixteenth. Takes a 4/4 kit (lists of steps)
  // or a groove chart for any time (theory/meters.js), with its time.
  function renderDrumGrid(drumPattern, meter) {
    if (!drumPattern) return '(no drum pattern)';
    const Mt = global.Meters;
    const charted = typeof drumPattern.kick === 'string';
    const lane = (list, chart) => (charted ? (Mt ? Mt.laneSteps(drumPattern[chart]) : []) : (list || []));
    const kit = {
      kick: lane(drumPattern.kick, 'kick'), snare: lane(drumPattern.snare, 'snare'),
      hhClosed: lane(drumPattern.hhClosed, 'hat'), hhOpen: lane(drumPattern.hhOpen, 'open'),
    };
    if (!kit.kick.length && !kit.snare.length && !kit.hhClosed.length && !kit.hhOpen.length) {
      return '(no drums in this section)';
    }
    const time = meter || (charted ? drumPattern.meter : null);
    const steps = Mt && time ? Mt.stepsPerBar(time) : 16;
    const rows = [
      { label: 'OH', steps: kit.hhOpen, mark: 'o' },
      { label: 'HH', steps: kit.hhClosed, mark: 'x' },
      { label: 'SN', steps: kit.snare, mark: 'x' },
      { label: 'KK', steps: kit.kick, mark: 'x' },
    ];
    const lines = rows.map(r => {
      const cells = Array(steps).fill('-');
      (r.steps || []).forEach(s => { if (s >= 0 && s < steps) cells[s] = r.mark; });
      return r.label + '|' + cells.join('') + '|';
    });
    if (steps === 16 && (!time || !Mt || Mt.id(time) === '4/4')) lines.push('   1e+a2e+a3e+a4e+a');
    else if (Mt) lines.push('   ' + Mt.countRow(time).map(c => (c || ' ').slice(-1)).join(''));
    return lines.join('\n');
  }

  // A strum chart: the count, the strokes and the bass under it, two columns
  // to a sixteenth so it reads at a glance.
  function renderStrumChart(rhythm, meter) {
    const Mt = global.Meters;
    if (!rhythm || !Mt || typeof rhythm.chords !== 'string') return '(no rhythm chosen)';
    const time = meter || rhythm.meter;
    const cell = text => (String(text || '') + '  ').slice(0, 2);
    const row = (label, cells) => (label + '       ').slice(0, 7) + cells.map(cell).join('').replace(/\s+$/, '');
    const strokes = rhythm.chords.split('');
    const lines = [
      row('Count', Mt.countRow(time)),
      row('Strum', Mt.arrows(rhythm.chords).split('')),
    ];
    const hard = strokes.map(c => (c === 'D' || c === 'U' ? '>' : ''));
    if (hard.some(Boolean) && strokes.some(c => c === 'd' || c === 'u')) lines.push(row('Hard', hard));
    lines.push(row('Bass', rhythm.bass.split('').map(c => (c === '.' || c === '-' ? '' : c === '>' ? '↗' : c))));
    return lines.join('\n');
  }

  // ── A section of a song, as tab ──────────────────────────────────────────
  // part: 'chords' | 'melody' | 'bass' | 'under' | 'drums'. Written in the
  // section's own time and chord lengths, from what it actually plays: the
  // strum chart over the chord shapes, the chart's own bass notes, the drums
  // that sound (a 4/4 kit asked to play in another time gives way to that
  // time's groove, and so does its tab).
  function sectionTab(song, section, part) {
    const item = global.Song.playbackItem(song, section);
    const chords = item.chords;
    if (!chords.length) return '(no chords yet)';
    const grid = { beatsPerChord: item.beatsPerChord, beatsPerBar: global.Song.barQuarters(item.meter) };
    if (part === 'melody') {
      return item.melody.length ? renderMelodyTab(item.melody, Object.assign({ chords, register: 'lead' }, grid)) : '(no vocal melody chosen)';
    }
    if (part === 'under') {
      return item.under.length ? renderMelodyTab(item.under, Object.assign({ chords, register: 'mid' }, grid)) : '(no under-melody chosen)';
    }
    if (part === 'bass') {
      const notes = global.Parts.fromItem(item).bass.map(n => ({ midi: n.n, beatStart: n.t, beats: n.d }));
      return notes.length ? renderMelodyTab(notes, Object.assign({ chords, register: 'bass', names: false }, grid)) : '(no bass)';
    }
    if (part === 'drums') return item.pattern.drum ? renderDrumGrid(item.pattern.drum, item.meter) : '(no drums chosen)';
    const tab = renderChordTab(chords, grid);
    return item.pattern.steps ? renderStrumChart(item.pattern.rhythm, item.meter) + '\n\n' + tab : tab;
  }

  global.Tabs = {
    TUNING_MIDI, STRING_LABELS, OPEN_PCS, REGISTERS,
    findChordShape,
    mapEventsToFrets, placeNotes, countLabels,
    renderMelodyTab, renderNotesTab, renderChordTab, renderBassTab, renderDrumGrid, renderStrumChart,
    bassEvents, sectionTab,
  };
})(typeof window !== 'undefined' ? window : globalThis);
