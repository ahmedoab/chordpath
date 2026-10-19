/* ChordPath — melody.js
 * Generates a melodic line over a chord progression using chord tones on
 * strong beats and scale tones on weak beats, with a simple arching shape.
 */
(function (global) {
  'use strict';

  const S = global.Scales;
  const C = global.Chords;

  // Convert pitch class + octave to MIDI number
  function pcToMidi(pc, oct) { return pc + (oct + 1) * 12; }
  function midiToName(midi, preferFlats) {
    const pc = ((midi % 12) + 12) % 12;
    const oct = Math.floor(midi / 12) - 1;
    return S.noteName(pc, preferFlats) + oct;
  }

  // Deterministic pseudo-random in [0, 1) based on a seed.
  // (The old version masked with & 0xffffffff, which yields a SIGNED 32-bit
  // value in JS — half of all outputs were negative.)
  function rng(seed) {
    let s = seed >>> 0;
    return function () {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 0x100000000;
    };
  }

  // Generate a melody over `chords`. Each chord occupies `beatsPerChord` beats.
  // Returns array of { midi, name, beatStart, beats }.
  function generateMelody(chords, scaleId, key, opts) {
    opts = opts || {};
    const beatsPerChord = opts.beatsPerChord || 2;
    const subdiv = opts.subdiv || 2;              // 2 = 8th notes, 4 = 16th
    const preferFlats = S.FLAT_KEYS.has(key) || key.includes('b');
    const scaleIntervals = S.getIntervals(scaleId);
    const keyPc = S.noteIndex(key);
    const scalePcs = scaleIntervals.map(iv => (keyPc + iv) % 12);
    const seed = opts.seed != null ? opts.seed : hashProg(chords);
    const rand = rng(seed);

    const out = [];
    const totalChords = chords.length;
    let lastMidi = null;

    for (let ci = 0; ci < totalChords; ci++) {
      const ch = chords[ci];
      // Chord-tone candidates in octaves 4-5
      const chordTonesMidi = ch.intervals.map(iv => {
        const pc = (ch.rootPc + iv) % 12;
        return pcToMidi(pc, 4 + (iv >= 12 ? 1 : 0));
      });

      // Pick the "anchor" tone for beat 1 of this chord — prefer 3rd (color),
      // else 7th, else root
      let anchor;
      if (chordTonesMidi.length >= 2) anchor = chordTonesMidi[1]; // 3rd
      else anchor = chordTonesMidi[0];

      // Shape contour: rise across first half of progression, fall in second half
      const half = totalChords / 2;
      const shape = ci < half ? +1 : -1;

      // Re-octave anchor to be near lastMidi (smooth voice leading) or in 4-5
      if (lastMidi != null) {
        while (anchor - lastMidi > 7)  anchor -= 12;
        while (lastMidi - anchor > 7)  anchor += 12;
        // Apply contour bias
        if (shape > 0 && anchor < lastMidi) anchor += 12 * (rand() > 0.6 ? 1 : 0);
        if (shape < 0 && anchor > lastMidi) anchor -= 12 * (rand() > 0.6 ? 1 : 0);
      } else {
        anchor = pcToMidi(((anchor % 12) + 12) % 12, 5); // start at octave 5
      }

      // Emit beat 1: anchor (quarter note)
      const baseBeat = ci * beatsPerChord;
      out.push({ midi: anchor, name: midiToName(anchor, preferFlats), beatStart: baseBeat, beats: 1 });
      lastMidi = anchor;

      // Fill remaining (beatsPerChord - 1) beats with scale-tone motion
      const stepsLeft = (beatsPerChord - 1) * subdiv;
      let current = anchor;
      for (let s = 0; s < stepsLeft; s++) {
        // Move by ±1 scale step, occasionally leap to nearest chord tone
        const doLeap = rand() < 0.18 && s !== stepsLeft - 1;
        let next;
        if (doLeap) {
          // Nearest chord tone within ±7 semitones
          let best = current, bestDist = 99;
          for (const t of chordTonesMidi) {
            for (const oct of [-12, 0, 12]) {
              const cand = t + oct;
              const d = Math.abs(cand - current);
              if (d > 0 && d <= 7 && d < bestDist) { best = cand; bestDist = d; }
            }
          }
          next = best;
        } else {
          // Step by one scale degree in shape direction
          next = stepInScale(current, scalePcs, shape > 0 ? +1 : (rand() < 0.5 ? +1 : -1));
        }
        // Clamp to reasonable range
        if (next < 62) next += 12;
        if (next > 84) next -= 12;
        const dur = 1 / subdiv;
        out.push({ midi: next, name: midiToName(next, preferFlats), beatStart: baseBeat + 1 + s * dur, beats: dur });
        current = next;
        lastMidi = next;
      }
    }

    return out;
  }

  // Move by one scale step from `midi` in scale pitch-classes
  function stepInScale(midi, scalePcs, direction) {
    const pc = ((midi % 12) + 12) % 12;
    const sorted = scalePcs.slice().sort((a, b) => a - b);
    const idx = sorted.indexOf(pc);
    if (idx >= 0) {
      const nextIdx = (idx + direction + sorted.length) % sorted.length;
      const nextPc = sorted[nextIdx];
      let next = midi - pc + nextPc;
      if (direction > 0 && next <= midi) next += 12;
      if (direction < 0 && next >= midi) next -= 12;
      return next;
    }
    // Off-scale: move to nearest scale tone in direction
    let try1 = midi + direction;
    while (!scalePcs.includes(((try1 % 12) + 12) % 12)) {
      try1 += direction;
      if (Math.abs(try1 - midi) > 6) return midi + direction;
    }
    return try1;
  }

  function hashProg(chords) {
    let h = 0;
    for (const c of chords) {
      for (let i = 0; i < c.shortName.length; i++) {
        h = ((h << 5) - h + c.shortName.charCodeAt(i)) | 0;
      }
    }
    return Math.abs(h) || 1;
  }

  function moveScaleSteps(midi, scalePcs, steps) {
    let out = midi;
    const dir = steps >= 0 ? 1 : -1;
    for (let i = 0; i < Math.abs(steps); i++) out = stepInScale(out, scalePcs, dir);
    return out;
  }

  function clampMidiToRange(midi, range) {
    if (!range || range.length < 2) return midi;
    let out = midi;
    while (out < range[0]) out += 12;
    while (out > range[1]) out -= 12;
    if (out < range[0]) out = range[0];
    if (out > range[1]) out = range[1];
    return out;
  }

  function nearestOctave(pc, target, range) {
    let best = pc + 60, bestDist = Infinity;
    for (let oct = 2; oct <= 6; oct++) {
      const midi = pcToMidi(pc, oct);
      const d = Math.abs(midi - target);
      if (d < bestDist) { best = midi; bestDist = d; }
    }
    return clampMidiToRange(best, range);
  }

  function anchorPc(chord, anchor) {
    if (!chord) return 0;
    if (anchor === 'third') return (chord.rootPc + (chord.intervals.includes(3) ? 3 : 4)) % 12;
    if (anchor === 'fifth') return (chord.rootPc + 7) % 12;
    if (anchor === 'seventh') return (chord.rootPc + (chord.intervals.includes(10) ? 10 : 11)) % 12;
    return chord.rootPc;
  }

  function makeScalePcs(scaleId, key) {
    const keyPc = S.noteIndex(key);
    return S.getIntervals(scaleId).map(iv => (keyPc + iv) % 12);
  }

  function generatePatternMelody(chords, scaleId, key, pattern, opts) {
    opts = opts || {};
    pattern = pattern || {};
    const beatsPerChord = opts.beatsPerChord || 4;
    // Patterns are written for a chord of four beats; under a shorter one
    // (a bar of 3/4 or 6/8) the same shape is squeezed to fit it.
    const fit = Math.min(1, beatsPerChord / 4);
    const preferFlats = S.FLAT_KEYS.has(key) || key.includes('b');
    const scalePcs = makeScalePcs(scaleId, key);
    const range = pattern.range || [60, 76];
    const cells = pattern.cells || [0, 1, 2, 3];
    const durations = pattern.durations || [0.75, 0.75, 0.75, 0.75];
    const contour = pattern.contour || [0, 1, 0, -1];
    // A seed makes rerolls give a different (but repeatable) take on the same
    // pattern: small contour detours, never a different structure.
    const rand = opts.seed != null ? rng(opts.seed) : null;
    const out = [];
    let lastMidi = null;

    chords.forEach((ch, ci) => {
      const target = lastMidi == null ? (range[0] + range[1]) / 2 : lastMidi;
      let base = nearestOctave(anchorPc(ch, pattern.anchor || 'third'), target, range);

      if (opts.section === 'chorus' || pattern.id === 'chorus_lift') base = clampMidiToRange(base + 2, range);
      if (opts.section === 'verse' && ci % 2 === 1) base = clampMidiToRange(base - 1, range);
      if (opts.section === 'bridge') base = clampMidiToRange(base + (ci % 2 ? -2 : 2), range);

      cells.forEach((cell, j) => {
        let steps = contour[(j + ci) % contour.length] || 0;
        if (rand && rand() < 0.28) steps += rand() < 0.5 ? 1 : -1;
        const midi = clampMidiToRange(moveScaleSteps(base, scalePcs, steps), range);
        out.push({
          midi,
          name: midiToName(midi, preferFlats),
          beatStart: ci * beatsPerChord + cell * fit,
          beats: (durations[j] || 0.5) * fit,
          layer: 'vocal',
        });
        lastMidi = midi;
      });
    });
    return out;
  }

  function keyPedalPc(key, degree) {
    const keyPc = S.noteIndex(key);
    if (degree === 'fifth') return (keyPc + 7) % 12;
    if (degree === 'third') return (keyPc + 4) % 12;
    return keyPc;
  }

  function chordTonePc(chord, tone) {
    if (tone === 'third') return anchorPc(chord, 'third');
    if (tone === 'fifth') return anchorPc(chord, 'fifth');
    if (tone === 'seventh') return anchorPc(chord, 'seventh');
    return chord.rootPc;
  }

  function generateUnderMelody(chords, scaleId, key, pattern, opts) {
    opts = opts || {};
    pattern = pattern || {};
    if (!pattern || pattern.type === 'none') return [];
    const beatsPerChord = opts.beatsPerChord || 4;
    const fit = Math.min(1, beatsPerChord / 4);
    const preferFlats = S.FLAT_KEYS.has(key) || key.includes('b');
    const scalePcs = makeScalePcs(scaleId, key);
    const out = [];

    if (pattern.type === 'drone') {
      const pc = keyPedalPc(key, pattern.degree || 'root');
      const midi = pcToMidi(pc, pattern.octave == null ? 5 : pattern.octave);
      chords.forEach((ch, ci) => {
        out.push({
          midi,
          name: midiToName(midi, preferFlats),
          beatStart: ci * beatsPerChord,
          beats: Math.max(0.5, beatsPerChord - 0.15),
          layer: 'under',
        });
      });
      return out;
    }

    if (pattern.type === 'chime') {
      const cells = pattern.cells || [2];
      chords.forEach((ch, ci) => {
        const pc = pattern.degree ? keyPedalPc(key, pattern.degree) : chordTonePc(ch, 'root');
        const midi = pcToMidi(pc, pattern.octave == null ? 5 : pattern.octave);
        cells.forEach(cell => out.push({
          midi,
          name: midiToName(midi, preferFlats),
          beatStart: ci * beatsPerChord + cell * fit,
          beats: 0.65 * fit,
          layer: 'under',
        }));
      });
      return out;
    }

    if (pattern.type === 'chord-tone') {
      const cells = pattern.cells || [1, 3];
      chords.forEach((ch, ci) => {
        const pc = chordTonePc(ch, pattern.tone || 'third');
        const midi = pcToMidi(pc, pattern.octave == null ? 4 : pattern.octave);
        cells.forEach((cell, j) => {
          const shifted = j % 2 ? moveScaleSteps(midi, scalePcs, -1) : midi;
          out.push({
            midi: shifted,
            name: midiToName(shifted, preferFlats),
            beatStart: ci * beatsPerChord + cell * fit,
            beats: 0.6 * fit,
            layer: 'under',
          });
        });
      });
      return out;
    }

    if (pattern.type === 'counter') {
      const cells = pattern.cells || [0, 2];
      chords.forEach((ch, ci) => {
        const start = pcToMidi(anchorPc(ch, 'fifth'), pattern.octave == null ? 3 : pattern.octave);
        cells.forEach((cell, j) => {
          const midi = moveScaleSteps(start, scalePcs, -ci - j);
          out.push({
            midi,
            name: midiToName(midi, preferFlats),
            beatStart: ci * beatsPerChord + cell * fit,
            beats: 0.8 * fit,
            layer: 'under',
          });
        });
      });
    }
    return out;
  }

  global.Melody = { generateMelody, generatePatternMelody, generateUnderMelody, rng };
})(typeof window !== 'undefined' ? window : globalThis);
