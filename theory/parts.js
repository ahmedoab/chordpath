/* ChordPath — parts.js
 * Turns a song into the notes each part plays: chords in the section's
 * rhythm pattern, the bass line, the drum grid, and the two melodies. Times
 * are in beats from the start of the section, pitches are MIDI numbers.
 * The DAW builds its tracks from this.
 *
 * The chord rhythms mirror the ones audio.js performs in the section editor,
 * so a song sounds the same in the DAW as it did while it was being written.
 */
(function (global) {
  'use strict';

  const DRUM_NOTES = { kick: 36, snare: 38, hhClosed: 42, hhOpen: 46 };
  const DRUM_LENGTHS = { kick: 0.5, snare: 0.25, hhClosed: 0.125, hhOpen: 0.5 };

  function seededUnit(seed) {
    const x = Math.sin(seed * 999.73) * 43758.5453;
    return x - Math.floor(x);
  }
  function humanVelocity(base, seed, depth) {
    return Math.max(0.15, Math.min(1, base + (seededUnit(seed) - 0.5) * depth));
  }
  function round(x) { return Math.round(x * 10000) / 10000; }

  // Six notes spread the way a guitarist or pianist would actually play the
  // chord: low root, the voiced chord, then colour tones above it.
  function performanceVoicing(chord, voiced) {
    const V = global.Voicings;
    const third = chord.intervals[1] == null ? 4 : chord.intervals[1];
    const fifth = chord.intervals.find(iv => iv === 6 || iv === 7 || iv === 8);
    const colour = chord.intervals.length > 3 ? chord.intervals[chord.intervals.length - 1] : third;
    const at = (iv, octave) => ((chord.rootPc + iv) % 12) + (octave + 1) * 12;
    const expanded = [at(0, 3)].concat(voiced.map(V.midiOf),
      [at(third, 4), at(fifth == null ? 7 : fifth, 4), at(colour, 5), at(0, 5)]);
    return expanded.filter((n, i) => expanded.indexOf(n) === i).slice(0, 6);
  }

  const ARP_SHAPES = [
    [0, 2, 4, 1, 3, 5, 4, 2], [0, 1, 3, 5, 2, 4, 5, 3],
    [0, 3, 2, 4, 1, 5, 3, 2], [0, 4, 2, 5, 3, 1, 4, 5],
  ];
  const JANGLE_SHAPES = [
    [0, 2, 4, 5, 3, 1, 4, 2, 0, 3, 5, 4, 2, 1, 3, 5],
    [0, 1, 3, 5, 4, 2, 5, 3, 0, 2, 4, 1, 3, 5, 2, 4],
    [0, 3, 1, 4, 2, 5, 4, 1, 0, 2, 5, 3, 1, 4, 2, 5],
  ];

  // One 4-beat bar of a chord in the given rhythm style.
  function chordBar(style, voicing, ci, swing, beatMs) {
    const out = [];
    const top = n => voicing.slice(-Math.min(n, voicing.length));
    const low = n => voicing.slice(0, Math.min(n, voicing.length));
    const pick = idx => voicing[((idx % voicing.length) + voicing.length) % voicing.length];
    const hit = (notes, at, dur, vel) => {
      (Array.isArray(notes) ? notes : [notes]).forEach(n =>
        out.push({ t: at, d: dur, n, v: vel == null ? 0.72 : vel }));
    };
    const strum = (at, notes, spreadMs, dur, vel, reverse) => {
      (reverse ? notes.slice().reverse() : notes).forEach((n, j) =>
        out.push({ t: at + (j * spreadMs) / beatMs, d: dur, n, v: humanVelocity(vel, ci * 31 + j, 0.14) }));
    };
    const lean = swing ? 0.1 : 0;

    switch (style) {
      case 'strum':
        strum(0, voicing, 24, 2, 0.78);
        hit(top(3), 1.5, 0.5, 0.42);
        strum(2, voicing, 20, 2, 0.68);
        strum(3.5, top(4), 16, 0.5, 0.46, true);
        break;
      case 'comp':
        hit(voicing, 1.5 + lean, 1);
        hit(voicing, 3.5 + lean, 0.5);
        break;
      case 'four-floor':
      case 'skank':
        for (let i = 0; i < 4; i++) hit(voicing, i + 0.5, 0.5);
        break;
      case 'arp':
        ARP_SHAPES[ci % 4].forEach((idx, i) => hit(pick(idx), i * 0.5, 0.5, i % 2 ? 0.62 : 0.76));
        break;
      case 'sustained':
      case 'slowcore-swell':
        hit(voicing, 0, 4);
        break;
      case 'travis':
        hit(voicing[0], 0, 1); hit(voicing.slice(1), 1, 1);
        hit(voicing[0], 2, 1); hit(voicing.slice(1), 3, 1);
        break;
      case 'shoegaze-wash':
        strum(0, voicing, 36, 4, 0.72);
        hit(ci % 2 ? top(4) : low(1).concat(top(3)), 2.5, 1, 0.42);
        hit(top(2), 3.25, 0.5, 0.3);
        break;
      case 'tremolo-wash':
        strum(0, voicing, 30, 2, 0.66);
        for (let i = 2; i < 16; i += 2) {
          hit(i % 4 === 0 ? top(3) : pick(ci + i), i * 0.25, 0.25, i % 4 === 0 ? 0.42 : 0.32);
        }
        break;
      case 'half-wash':
        strum(0, voicing, 42, 4, 0.72);
        hit(ci % 2 ? top(4) : voicing, 3, 1, 0.45);
        break;
      case 'reverse-swell':
        hit(top(3), 1.5, 0.5, 0.28);
        strum(2.5, voicing, 38, 1.5, 0.68, true);
        break;
      case 'noise-pop-drive':
        for (let i = 0; i < 8; i++) strum(i * 0.5, voicing, 12, 0.5, i % 2 ? 0.46 : 0.64);
        break;
      case 'glide-strum':
        strum(0, voicing, 26, 1, 0.72);
        hit(ci % 2 ? top(4) : voicing.slice(1), 1.5, 0.5, 0.48);
        strum(2, voicing, 24, 1, 0.68);
        strum(3.5, top(4), 16, 0.5, 0.44, true);
        break;
      case 'postpunk-chime':
        hit(voicing.slice(-2), 1, 0.5); hit(voicing, 1.5, 0.5);
        hit(voicing.slice(-2), 3, 0.5); hit(voicing, 3.5, 0.5);
        break;
      case 'cold-pulse':
        hit(top(3), 0, 0.5, 0.55);
        hit([pick(ci + 2), pick(ci + 4)], 1, 0.5, 0.42);
        hit(voicing, 2, 0.5, 0.58);
        hit(top(3), 3, 0.5, 0.42);
        break;
      case 'chorus-chop':
        [0, 3, 6, 8, 11, 14].forEach((step, i) =>
          hit(i % 2 ? voicing.slice(-2) : voicing, step * 0.25, 0.25, i % 2 ? 0.42 : 0.58));
        break;
      case 'jangle-arp':
        JANGLE_SHAPES[ci % 3].forEach((idx, i) => hit(pick(idx), i * 0.25, 0.25, i % 4 === 0 ? 0.66 : 0.5));
        break;
      case 'dream-pulse':
        hit(voicing, 0, 1);
        hit(ci % 2 ? top(4) : low(1).concat(top(2)), 1.5, 0.5);
        hit(voicing, 2, 1);
        hit(top(3), 3.5, 0.5, 0.44);
        break;
      case 'slow-pick':
        hit(voicing[0], 0, 1, 0.5);
        hit(ci % 2 ? top(3) : [pick(2), pick(4)], 1.5, 1, 0.42);
        hit(pick(ci + 1), 3, 1, 0.36);
        break;
      case 'folk-pick':
        for (let b = 0; b < 4; b++) {
          hit(voicing[0], b, 0.5);
          hit(b % 2 ? voicing.slice(-2) : voicing.slice(1), b + 0.5, 0.5);
        }
        break;
      case 'drone-strum':
        strum(0, voicing, 24, 2, 0.64);
        hit(top(2), 1.5, 0.5, 0.35);
        hit(pick(ci + voicing.length - 1), 3.5, 0.5, 0.35);
        break;
      case 'block':
      default:
        hit(voicing, 0, 2);
        hit(top(4), 2, 2, 0.54);
    }
    return out;
  }

  // The small fills each kit family adds so a loop does not sound stamped.
  function varyKit(drums, bar, bars, family) {
    const steps = list => Array.from(new Set((list || []).filter(s => Number.isFinite(s) && s >= 0 && s < 16)));
    const d = { kick: steps(drums.kick), snare: steps(drums.snare), hhClosed: steps(drums.hhClosed), hhOpen: steps(drums.hhOpen) };
    if (!d.kick.length && !d.snare.length && !d.hhClosed.length && !d.hhOpen.length) return d;
    const last = bar === bars - 1;
    const odd = bar % 2 === 1;
    if (family === 'Shoegaze') {
      if (odd) d.kick.push(15);
      if (bar % 3 === 2) d.snare.push(11);
      if (last) d.hhOpen.push(15);
    } else if (family === 'Post-Punk') {
      if (!odd) d.kick.push(10);
      if (odd) d.hhClosed.push(3, 7, 11, 15);
      if (last) d.snare.push(14);
    } else if (family === 'Jangle') {
      if (odd) d.kick.push(6);
      d.hhClosed.push(odd ? 2 : 10);
      if (last) d.hhOpen.push(14);
    } else if (family === 'Dream Pop') {
      if (odd) d.kick.push(10);
      d.hhClosed.push(3, 11);
      if (last) d.hhOpen.push(15);
    } else if (family === 'Slowcore') {
      if (last) d.kick.push(10);
      if (last && d.snare.length) d.snare.push(14);
    } else if (family === 'Folk') {
      if (odd) d.kick.push(10);
      if (last) d.snare.push(14);
    } else if (family === 'Indie Rock') {
      if (!odd) d.kick.push(6);
      if (odd) d.hhOpen.push(15);
      if (last) d.snare.push(14, 15);
    } else if (family === 'Electronic') {
      if (odd) d.hhClosed.push(1, 9);
      if (last) { d.hhOpen.push(14); d.kick.push(15); }
    }
    for (const lane of Object.keys(d)) d[lane] = steps(d[lane]).sort((a, b) => a - b);
    return d;
  }

  function byTime(a, b) { return a.t - b.t || a.n - b.n; }

  // item: one entry of Song.buildPlayback(song).
  function fromItem(item) {
    const V = global.Voicings;
    const bpc = item.beatsPerChord || 4;
    const beats = item.chords.length * bpc;
    const pattern = item.pattern || {};
    const swing = typeof pattern.swing === 'number' ? pattern.swing : (pattern.swing ? 0.18 : 0);
    const beatMs = 60000 / (item.tempo || 100);

    const chords = [];
    let previous = null;
    item.chords.forEach((chord, ci) => {
      const voiced = V.voice(chord, 'smart', { previous });
      previous = voiced;
      const voicing = performanceVoicing(chord, voiced);
      for (let bar = 0; bar < bpc; bar += 4) {
        chordBar(pattern.chords, voicing, ci, swing, beatMs).forEach(ev => {
          if (ev.t + bar >= bpc) return;
          const t = ci * bpc + bar + ev.t;
          chords.push({ t: round(t), d: round(Math.min(ev.d, beats - t)), n: ev.n, v: round(ev.v) });
        });
      }
    });

    const bass = global.Tabs.bassEvents(item.chords, pattern.bass || 'root', bpc)
      .filter(ev => ev.beatStart < beats)
      .map(ev => ({ t: round(ev.beatStart), d: round(Math.min(ev.beats, beats - ev.beatStart)), n: ev.midi, v: 0.85 }));

    const drums = [];
    const kit = pattern.drums || {};
    const bars = Math.ceil(beats / 4);
    const family = pattern.drum && pattern.drum.family;
    for (let bar = 0; bar < bars; bar++) {
      const d = varyKit(kit, bar, bars, family);
      for (const lane of Object.keys(DRUM_NOTES)) {
        d[lane].forEach(step => {
          const t = bar * 4 + step * 0.25 + (swing > 0 && step % 2 === 1 ? 0.25 * swing : 0);
          if (t >= beats) return;
          const ghost = lane === 'snare' && step !== 4 && step !== 12;
          const base = lane === 'kick' ? 0.82 : ghost ? 0.32 : lane === 'snare' ? 0.68 : lane === 'hhOpen' ? 0.38 : 0.28;
          drums.push({
            t: round(t), d: DRUM_LENGTHS[lane], n: DRUM_NOTES[lane],
            v: round(humanVelocity(base, (bar + 1) * 101 + step * 7 + lane.length * 13, lane === 'kick' ? 0.18 : 0.14)),
          });
        });
      }
    }

    const line = (events, vel) => (events || [])
      .filter(ev => ev.beatStart < beats)
      .map(ev => ({ t: round(ev.beatStart), d: round(Math.min(ev.beats, beats - ev.beatStart)), n: ev.midi, v: vel }));

    return {
      beats,
      chords: chords.sort(byTime), bass: bass.sort(byTime), drums: drums.sort(byTime),
      vocal: line(item.melody, 0.85).sort(byTime), under: line(item.under, 0.55).sort(byTime),
    };
  }

  // The whole song laid end to end, repeats written out.
  function fromSong(song) {
    const sections = [];
    let start = 0;
    global.Song.buildPlayback(song).forEach(item => {
      const parts = fromItem(Object.assign({}, item, { tempo: song.tempo }));
      const reps = Math.max(1, item.repeat || 1);
      for (let r = 0; r < reps; r++) {
        sections.push({ id: item.sectionId, name: item.name, role: item.role, start, beats: parts.beats, repeat: r, parts });
        start += parts.beats;
      }
    });
    return { tempo: song.tempo, totalBeats: start, sections };
  }

  global.Parts = { DRUM_NOTES, fromItem, fromSong };
})(typeof window !== 'undefined' ? window : globalThis);
