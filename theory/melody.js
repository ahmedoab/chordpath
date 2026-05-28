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

  // Deterministic-ish pseudo-random based on a seed
  function rng(seed) {
    let s = seed >>> 0;
    return function () {
      s = (s * 1664525 + 1013904223) >>> 0;
      return (s & 0xffffffff) / 0xffffffff;
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

  global.Melody = { generateMelody };
})(typeof window !== 'undefined' ? window : globalThis);
