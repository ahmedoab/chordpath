/* ChordPath — voicings.js
 * Chord voicing strategies. Each function returns an array of NoteName+Octave
 * strings (e.g. ["C3","E4","G4","B4"]).
 *
 *   - root:     stacked in root position from octave 4
 *   - smart:    minimum voice-leading distance from previous voicing
 *   - shell:    root + 3rd + 7th (no 5th, no extensions doubled)
 *   - rootless: 3-5-7-9 or 3-5-7 — no root, ideal over a bass
 *   - drop2:    take the second-highest voice and drop it an octave
 *   - drop3:    take the third-highest voice and drop it an octave
 *   - spread:   one voice per octave 3..5, widely spaced
 *   - close:    all voices within a single octave (smallest interval span)
 *   - guitar:   common guitar voicings (root on string 5 or 6) per quality
 *   - piano:    LH root, RH 3-5-7 split
 */
(function (global) {
  'use strict';

  const S = global.Scales;
  const C = global.Chords;

  function pcToName(pc, preferFlats) { return S.noteName(pc, preferFlats); }
  function midiOf(noteOct) {
    const m = noteOct.match(/^([A-G][#b]?)(-?\d+)$/);
    if (!m) return 60;
    return S.noteIndex(m[1]) + (parseInt(m[2], 10) + 1) * 12;
  }
  function midiToName(midi, preferFlats) {
    const pc = ((midi % 12) + 12) % 12;
    const oct = Math.floor(midi / 12) - 1;
    return S.noteName(pc, preferFlats) + oct;
  }

  // Place each chord-tone in an octave that yields a tight close voicing
  // starting from `startOct`. Returns sorted-low-to-high.
  function rootPosition(chord, startOct) {
    startOct = startOct == null ? 4 : startOct;
    const rootMidi = chord.rootPc + (startOct + 1) * 12;
    let last = rootMidi;
    const out = [rootMidi];
    for (let i = 1; i < chord.intervals.length; i++) {
      const pc = (chord.rootPc + chord.intervals[i]) % 12;
      let m = pc + (startOct + 1) * 12;
      while (m <= last) m += 12;
      out.push(m);
      last = m;
    }
    return out.map(m => midiToName(m, chord.preferFlats));
  }

  // Smart voice leading: for each pitch class in the new chord, pick the octave
  // closest to ANY note in the previous voicing.
  function smart(chord, prevVoicing, startOct) {
    startOct = startOct == null ? 4 : startOct;
    if (!prevVoicing || prevVoicing.length === 0) return rootPosition(chord, startOct);
    const prevMidi = prevVoicing.map(midiOf);
    const out = [];
    for (const iv of chord.intervals) {
      const pc = (chord.rootPc + iv) % 12;
      let best = 0, bestDist = Infinity;
      for (let oct = 2; oct <= 6; oct++) {
        const m = pc + (oct + 1) * 12;
        const d = Math.min(...prevMidi.map(p => Math.abs(p - m)));
        if (d < bestDist) { bestDist = d; best = m; }
      }
      out.push(best);
    }
    out.sort((a,b) => a - b);
    return out.map(m => midiToName(m, chord.preferFlats));
  }

  // Shell: root + 3rd + 7th. For triads, root + 3rd + 5th.
  function shell(chord) {
    const pcs = [chord.rootPc];
    // 3rd: scan intervals for first major-3rd-like or minor-3rd-like
    const has = iv => chord.intervals.includes(iv);
    if (has(3)) pcs.push((chord.rootPc + 3) % 12);
    else if (has(4)) pcs.push((chord.rootPc + 4) % 12);
    // 7th: scan for 10 or 11
    if (has(10)) pcs.push((chord.rootPc + 10) % 12);
    else if (has(11)) pcs.push((chord.rootPc + 11) % 12);
    else if (has(7)) pcs.push((chord.rootPc + 7) % 12);
    // Voice them
    const out = []; let prev = -1;
    pcs.forEach((pc, i) => {
      let m = pc + (i === 0 ? 3 : 4) * 12 + 12; // root octave 3, others octave 4
      while (m <= prev) m += 12;
      out.push(m); prev = m;
    });
    return out.map(m => midiToName(m, chord.preferFlats));
  }

  // Rootless A-form: 3-5-7-9 from root octave 4 (no root)
  function rootless(chord, prevVoicing) {
    const wantedOffsets = [];
    const has = iv => chord.intervals.includes(iv);
    if (has(3))  wantedOffsets.push(3);
    if (has(4))  wantedOffsets.push(4);
    if (has(6))  wantedOffsets.push(6);
    if (has(7))  wantedOffsets.push(7);
    if (has(8))  wantedOffsets.push(8);
    if (has(10)) wantedOffsets.push(10);
    if (has(11)) wantedOffsets.push(11);
    if (has(14)) wantedOffsets.push(14);
    if (has(15)) wantedOffsets.push(15);
    if (has(17)) wantedOffsets.push(17);
    if (has(21)) wantedOffsets.push(21);
    // Drop 5th if we have a 9 or 13 (typical bebop omission)
    const stripped = (has(14) || has(21)) ? wantedOffsets.filter(o => o !== 7) : wantedOffsets;
    if (stripped.length === 0) return rootPosition(chord);
    // Build a "phantom" chord, then either use smart or root-position around C4
    const phantom = {
      rootPc: chord.rootPc, preferFlats: chord.preferFlats,
      intervals: stripped,
    };
    if (prevVoicing) return smart(phantom, prevVoicing, 4);
    return rootPosition(phantom, 4);
  }

  // Drop the second-highest voice down an octave
  function dropN(chord, n, startOct) {
    const close = rootPosition(chord, startOct == null ? 4 : startOct);
    if (close.length <= n) return close;
    const midis = close.map(midiOf);
    const sorted = midis.slice().sort((a,b) => a - b);
    const targetIdx = sorted.length - 1 - n;
    const targetMidi = sorted[targetIdx];
    const idx = midis.indexOf(targetMidi);
    midis[idx] -= 12;
    midis.sort((a,b) => a - b);
    return midis.map(m => midiToName(m, chord.preferFlats));
  }

  function drop2(chord, startOct) { return dropN(chord, 1, startOct); }
  function drop3(chord, startOct) { return dropN(chord, 2, startOct); }

  // Spread voicing: one tone per octave, root low, top tones up high
  function spread(chord) {
    const ivs = chord.intervals;
    const startOct = 2;
    const out = [];
    ivs.forEach((iv, i) => {
      const pc = (chord.rootPc + iv) % 12;
      out.push(pc + (startOct + i + 1) * 12);
    });
    return out.map(m => midiToName(m, chord.preferFlats));
  }

  // Close voicing — all within ~ an octave around C4
  function close(chord) {
    const baseOct = 4;
    const out = [];
    const used = new Set();
    chord.intervals.forEach(iv => {
      const pc = (chord.rootPc + iv) % 12;
      let m = pc + (baseOct + 1) * 12;
      while (used.has(m)) m -= 12;
      out.push(m); used.add(m);
    });
    out.sort((a,b) => a - b);
    return out.map(m => midiToName(m, chord.preferFlats));
  }

  // Inversion N: rotate the bass up by N positions
  function inversion(chord, n) {
    n = n || 0;
    const rp = rootPosition(chord, 4);
    if (n <= 0 || n >= rp.length) return rp;
    const midis = rp.map(midiOf);
    for (let i = 0; i < n; i++) {
      midis[0] += 12;
      midis.push(midis.shift());
    }
    midis.sort((a,b) => a - b);
    return midis.map(m => midiToName(m, chord.preferFlats));
  }

  // Guitar-friendly voicing: common open or movable shape per quality
  function guitar(chord) {
    // Provide simple movable shapes:
    //   maj  →  Root(5th-string) - 5 - oct - 3 - 5 - oct
    //   m    →  Root - 5 - oct - b3 - 5 - oct
    //   7    →  Root - 3 - b7 - oct - 3 - 5
    //   m7   →  Root - b3 - b7 - 5 - b3 - oct
    //   maj7 →  Root - 3 - 7 - 3 - 5 - 7
    const ivMap = {
      maj:    [0, 7, 12, 16, 19, 24],
      m:      [0, 7, 12, 15, 19, 24],
      '7':    [0, 10, 16, 19, 24, 28],
      m7:     [0, 10, 15, 19, 22, 27],
      maj7:   [0, 11, 16, 19, 23, 28],
      m7b5:   [0, 10, 15, 18, 22, 27],
      dim7:   [0, 9, 15, 18, 21, 27],
      sus4:   [0, 7, 12, 17, 19, 24],
      sus2:   [0, 7, 12, 14, 19, 24],
      '6':    [0, 7, 12, 16, 21, 24],
      m6:     [0, 7, 12, 15, 21, 24],
      '9':    [0, 10, 16, 19, 26, 28],
      m9:     [0, 10, 15, 19, 26, 27],
      maj9:   [0, 11, 16, 19, 26, 28],
      pow:    [0, 7, 12, -1, -1, -1],
      aug:    [0, 8, 12, 16, 20, 24],
    };
    const tmpl = ivMap[chord.quality] || ivMap.maj;
    const baseOct = 2;
    const out = [];
    tmpl.forEach(iv => {
      if (iv < 0) return;
      const m = chord.rootPc + iv + (baseOct + 1) * 12;
      out.push(m);
    });
    out.sort((a,b)=>a-b);
    return out.map(m => midiToName(m, chord.preferFlats));
  }

  // Piano split-hand: LH root (oct 2), RH 3rd/5th/7th close (oct 4)
  function pianoSplit(chord) {
    const root = chord.rootPc + 3 * 12; // root in oct 2
    const rh = [];
    chord.intervals.slice(1).forEach((iv, i) => {
      const pc = (chord.rootPc + iv) % 12;
      let m = pc + 5 * 12; // oct 4 start
      while (rh.length && m <= rh[rh.length - 1]) m += 12;
      rh.push(m);
    });
    return [midiToName(root, chord.preferFlats), ...rh.map(m => midiToName(m, chord.preferFlats))];
  }

  // Master dispatcher
  function voice(chord, kind, opts) {
    opts = opts || {};
    switch (kind) {
      case 'root':     return rootPosition(chord, opts.startOct);
      case 'smart':    return smart(chord, opts.previous, opts.startOct);
      case 'shell':    return shell(chord);
      case 'rootless': return rootless(chord, opts.previous);
      case 'drop2':    return drop2(chord, opts.startOct);
      case 'drop3':    return drop3(chord, opts.startOct);
      case 'spread':   return spread(chord);
      case 'close':    return close(chord);
      case 'guitar':   return guitar(chord);
      case 'piano':    return pianoSplit(chord);
      case 'inv1':     return inversion(chord, 1);
      case 'inv2':     return inversion(chord, 2);
      case 'inv3':     return inversion(chord, 3);
      default:         return rootPosition(chord, opts.startOct);
    }
  }

  // Apply a slash chord bass override: set bass to a specific pitch class
  // (a note name). Result: voiced chord with bass note prepended at oct 2.
  function withBass(voicing, chord, bassNoteName) {
    const bassPc = S.noteIndex(bassNoteName);
    const midis = voicing.map(midiOf);
    // Drop the lowest voice if it's the root and add explicit bass
    const newBass = bassPc + 3 * 12; // octave 2
    return [midiToName(newBass, chord.preferFlats), ...midis.filter(m => m > newBass).map(m => midiToName(m, chord.preferFlats))];
  }

  global.Voicings = {
    rootPosition, smart, shell, rootless, drop2, drop3, spread, close,
    guitar, pianoSplit, inversion, voice, withBass, midiOf, midiToName,
  };
})(typeof window !== 'undefined' ? window : globalThis);
