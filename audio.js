/* ChordPath — audio.js (masterpiece edition)
 * Tone.js playback engine.
 *   - playProgression: simple chord-by-chord (block / arp / strum)
 *   - playBacking:     full arrangement with drums, bass, chord groove
 *   - playWithMelody:  chord backing + a generated melodic line
 *   - previewChord:    one-shot for hover/click previews
 *
 * Improvements over the original:
 *   - 7 instrument timbres (added Organ + Harp)
 *   - Multiple voicing modes via the Voicings module
 *   - Optional metronome click + count-in
 *   - Swing-amount slider
 *   - Beat callback (for the on-screen LED indicator)
 *   - Sidechain-style pad ducking on Synth Pad
 *   - Master limiter
 */
(function (global) {
  'use strict';

  const V = global.Voicings;

  let started = false;
  let chordInst = null, bassInst = null, leadInst = null, underInst = null, clickInst = null;
  let kickDrum = null, snareDrum = null, hatClosed = null, hatOpen = null;
  let reverb = null, master = null;
  let stopFlag = false;
  let timers = [];
  let previewTimers = [];
  let previewToken = 0;
  let currentInstrument = 'piano';
  const bandOptions = {
    texture: 'wash',
    drums: 'hazy',
    melody: 'soft',
    levels: {
      chords: 100,
      bass: 100,
      drums: 100,
      melody: 100,
    },
  };

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function seededUnit(seed) {
    const x = Math.sin(seed * 999.73) * 43758.5453;
    return x - Math.floor(x);
  }

  function humanOffset(amountMs, seed) {
    return (seededUnit(seed) - 0.5) * amountMs;
  }

  function humanVelocity(base, seed, depth) {
    return clamp(base + (seededUnit(seed) - 0.5) * depth, 0.15, 1);
  }

  function levelToDb(value) {
    const n = clamp(Number(value == null ? 100 : value), 0, 100);
    if (n <= 0) return -80;
    return 20 * Math.log10(n / 100);
  }

  function setBaseVolume(inst, db, group) {
    if (!inst) return;
    inst._baseVolumeDb = db;
    inst._mixGroup = group;
    applyInstVolume(inst);
  }

  function applyInstVolume(inst) {
    if (!inst || !inst.volume) return;
    const group = inst._mixGroup || 'chords';
    const level = bandOptions.levels[group] == null ? 100 : bandOptions.levels[group];
    try { inst.volume.value = (inst._baseVolumeDb || 0) + levelToDb(level); } catch(e) {}
  }

  function applyMix() {
    [chordInst, bassInst, leadInst, underInst, kickDrum, snareDrum, hatClosed, hatOpen]
      .forEach(applyInstVolume);
  }

  function setBandOptions(opts) {
    opts = opts || {};
    if (opts.texture) bandOptions.texture = opts.texture;
    if (opts.drums) bandOptions.drums = opts.drums;
    if (opts.melody) bandOptions.melody = opts.melody;
    if (opts.levels) {
      ['chords','bass','drums','melody'].forEach(k => {
        if (opts.levels[k] != null) bandOptions.levels[k] = clamp(Number(opts.levels[k]), 0, 100);
      });
    }
    if (!started) return;
    applySpaceTone();
    applyDrumTone();
    buildLead();
    buildUnder();
    setInstrument(currentInstrument);
    applyMix();
  }

  async function start() {
    if (started) return;
    await Tone.start();
    master = new Tone.Limiter(-1).toDestination();
    reverb = new Tone.Reverb({ decay: 2.6, wet: 0.20 }).connect(master);
    applySpaceTone();
    setInstrument(currentInstrument);
    buildBass();
    buildDrums();
    buildLead();
    buildUnder();
    buildClick();
    started = true;
  }

  function applySpaceTone() {
    if (!reverb) return;
    const wet = {
      clean: 0.12,
      wash: 0.34,
      fuzz: 0.28,
      dark: 0.42,
    }[bandOptions.texture] ?? 0.24;
    try { reverb.wet.value = wet; } catch(e) {}
  }

  function buildBass() {
    bassInst = new Tone.MonoSynth({
      oscillator:{ type:'fmtriangle', modulationType:'sine', harmonicity:0.5 },
      envelope:{ attack:0.012, decay:0.25, sustain:0.45, release:0.6 },
      filter:{ Q:1.2, type:'lowpass', rolloff:-24 },
      filterEnvelope:{ attack:0.01, decay:0.4, sustain:0.4, release:0.5, baseFrequency:90, octaves:2.4 },
    }).connect(master);
    setBaseVolume(bassInst, -6, 'bass');
  }

  function disposeLead() {
    if (leadInst && leadInst.dispose) { try { leadInst.dispose(); } catch(e){} }
  }

  function disposeUnder() {
    if (underInst && underInst.dispose) { try { underInst.dispose(); } catch(e){} }
  }

  function buildLead() {
    disposeLead();
    switch (bandOptions.melody) {
      case 'bell':
        leadInst = new Tone.FMSynth({
          harmonicity: 3,
          modulationIndex: 8,
          oscillator:{ type:'sine' },
          envelope:{ attack:0.006, decay:0.5, sustain:0.15, release:1.1 },
          modulationEnvelope:{ attack:0.006, decay:0.35, sustain:0.05, release:0.8 },
        }).connect(reverb);
        setBaseVolume(leadInst, -12, 'melody');
        break;
      case 'airy':
        leadInst = new Tone.Synth({
          oscillator:{ type:'fatsine', count:3, spread:18 },
          envelope:{ attack:0.08, decay:0.4, sustain:0.55, release:1.4 },
        }).connect(reverb);
        setBaseVolume(leadInst, -13, 'melody');
        break;
      case 'grit':
        leadInst = new Tone.AMSynth({
          harmonicity: 1.5,
          oscillator:{ type:'sawtooth' },
          envelope:{ attack:0.01, decay:0.25, sustain:0.45, release:0.55 },
          modulation:{ type:'square' },
          modulationEnvelope:{ attack:0.01, decay:0.18, sustain:0.35, release:0.35 },
        }).connect(reverb);
        setBaseVolume(leadInst, -11, 'melody');
        break;
      case 'soft':
      default:
        leadInst = new Tone.AMSynth({
          harmonicity: 2,
          oscillator:{ type:'sine' },
          envelope:{ attack:0.025, decay:0.32, sustain:0.5, release:0.7 },
          modulation:{ type:'square' },
          modulationEnvelope:{ attack:0.02, decay:0.2, sustain:0.4, release:0.35 },
        }).connect(reverb);
        setBaseVolume(leadInst, -9, 'melody');
        break;
    }
  }

  function buildUnder() {
    disposeUnder();
    const airy = bandOptions.melody === 'airy' || bandOptions.texture === 'wash';
    underInst = new Tone.Synth({
      oscillator:{ type: airy ? 'fatsine' : 'triangle', count: airy ? 3 : undefined, spread: airy ? 16 : undefined },
      envelope:{ attack: airy ? 0.08 : 0.03, decay:0.4, sustain:0.35, release: airy ? 1.8 : 1.2 },
    }).connect(reverb);
    setBaseVolume(underInst, airy ? -17 : -15, 'melody');
  }

  function buildDrums() {
    kickDrum = new Tone.MembraneSynth({
      pitchDecay: 0.05, octaves: 6,
      oscillator:{ type:'sine' },
      envelope:{ attack:0.001, decay:0.42, sustain:0.0, release:1.4 },
    }).connect(master);
    setBaseVolume(kickDrum, -3, 'drums');

    snareDrum = new Tone.NoiseSynth({
      noise:{ type:'white' },
      envelope:{ attack:0.001, decay:0.16, sustain:0 },
    }).connect(master);
    setBaseVolume(snareDrum, -12, 'drums');

    hatClosed = new Tone.MetalSynth({
      frequency: 250, envelope:{ attack:0.001, decay:0.06, release:0.02 },
      harmonicity: 5.1, modulationIndex: 32, resonance: 4000, octaves: 1.5,
    }).connect(master);
    setBaseVolume(hatClosed, -24, 'drums');

    hatOpen = new Tone.MetalSynth({
      frequency: 250, envelope:{ attack:0.001, decay:0.3, release:0.1 },
      harmonicity: 5.1, modulationIndex: 32, resonance: 4000, octaves: 1.5,
    }).connect(master);
    setBaseVolume(hatOpen, -20, 'drums');
    applyDrumTone();
  }

  function reconnect(inst, dest) {
    if (!inst || !dest) return;
    try { inst.disconnect(); } catch(e) {}
    try { inst.connect(dest); } catch(e) {}
  }

  function applyDrumTone() {
    if (!kickDrum || !snareDrum || !hatClosed || !hatOpen || !master) return;
    const tone = bandOptions.drums;
    reconnect(kickDrum, master);
    reconnect(snareDrum, tone === 'dry' ? master : reverb);
    reconnect(hatClosed, tone === 'dry' ? master : reverb);
    reconnect(hatOpen, tone === 'dry' ? master : reverb);

    if (tone === 'dry') {
      setBaseVolume(kickDrum, -3, 'drums');
      setBaseVolume(snareDrum, -11, 'drums');
      setBaseVolume(hatClosed, -24, 'drums');
      setBaseVolume(hatOpen, -22, 'drums');
      try { snareDrum.envelope.decay = 0.13; } catch(e) {}
    } else if (tone === 'soft') {
      setBaseVolume(kickDrum, -8, 'drums');
      setBaseVolume(snareDrum, -18, 'drums');
      setBaseVolume(hatClosed, -30, 'drums');
      setBaseVolume(hatOpen, -28, 'drums');
      try { snareDrum.envelope.decay = 0.22; } catch(e) {}
    } else if (tone === 'distant') {
      setBaseVolume(kickDrum, -8, 'drums');
      setBaseVolume(snareDrum, -20, 'drums');
      setBaseVolume(hatClosed, -32, 'drums');
      setBaseVolume(hatOpen, -30, 'drums');
      try { snareDrum.envelope.decay = 0.34; } catch(e) {}
    } else {
      setBaseVolume(kickDrum, -5, 'drums');
      setBaseVolume(snareDrum, -16, 'drums');
      setBaseVolume(hatClosed, -29, 'drums');
      setBaseVolume(hatOpen, -26, 'drums');
      try { snareDrum.envelope.decay = 0.28; } catch(e) {}
    }
  }

  function buildClick() {
    clickInst = new Tone.MembraneSynth({
      pitchDecay: 0.01, octaves: 2,
      envelope:{ attack:0.001, decay:0.06, sustain:0.0, release:0.05 },
    }).connect(master);
    clickInst.volume.value = -14;
  }

  function disposeChordInst() {
    if (chordInst && chordInst.dispose) { try { chordInst.dispose(); } catch(e){} }
  }

  function setInstrument(name) {
    currentInstrument = name;
    if (!reverb) return; // wait for start()
    applySpaceTone();
    disposeChordInst();
    const texture = bandOptions.texture;
    let chordBaseDb = -8;
    switch (name) {
      case 'epiano':
        chordInst = new Tone.PolySynth(Tone.FMSynth, {
          harmonicity:2.5, modulationIndex:9,
          oscillator:{ type:'sine' },
          envelope:{ attack:0.01, decay:0.4, sustain:0.4, release:1.4 },
          modulation:{ type:'square' },
          modulationEnvelope:{ attack:0.02, decay:0.5, sustain:0, release:0.5 },
        }).connect(reverb);
        chordBaseDb = -10;
        break;
      case 'guitar':
        chordInst = new Tone.PolySynth(Tone.Synth, {
          oscillator:{
            type: texture === 'clean' ? 'triangle' : texture === 'dark' ? 'fatsine' : 'fmsawtooth',
            modulationType:'sine',
            harmonicity: texture === 'fuzz' ? 0.55 : 1,
            count: texture === 'dark' ? 3 : undefined,
            spread: texture === 'dark' ? 14 : undefined,
          },
          envelope:{
            attack: texture === 'wash' ? 0.018 : 0.005,
            decay: texture === 'clean' ? 0.42 : 0.8,
            sustain: texture === 'wash' || texture === 'dark' ? 0.18 : 0,
            release: texture === 'wash' || texture === 'dark' ? 1.8 : 1.0,
          },
        }).connect(reverb);
        chordBaseDb = texture === 'fuzz' ? -16 : texture === 'wash' ? -14 : -12;
        break;
      case 'strings':
        chordInst = new Tone.PolySynth(Tone.AMSynth, {
          harmonicity:1.5,
          oscillator:{ type:'sawtooth' },
          envelope:{ attack:0.5, decay:0.3, sustain:0.85, release:1.8 },
          modulation:{ type:'sine' },
          modulationEnvelope:{ attack:0.4, decay:0.2, sustain:0.7, release:1.0 },
        }).connect(reverb);
        chordBaseDb = -14;
        break;
      case 'pad':
        chordInst = new Tone.PolySynth(Tone.Synth, {
          oscillator:{ type: texture === 'dark' ? 'fatsine' : 'sawtooth', count: texture === 'dark' ? 3 : undefined, spread: texture === 'dark' ? 18 : undefined },
          envelope:{ attack: texture === 'clean' ? 0.35 : 0.8, decay:0.6, sustain:0.92, release: texture === 'clean' ? 1.4 : 2.4 },
        }).connect(reverb);
        chordBaseDb = -18;
        break;
      case 'organ':
        chordInst = new Tone.PolySynth(Tone.Synth, {
          oscillator:{
            type: 'fatsawtooth', count: 3, spread: 18,
          },
          envelope:{ attack:0.02, decay:0.2, sustain:0.9, release:0.4 },
        }).connect(reverb);
        chordBaseDb = -12;
        break;
      case 'harp':
        chordInst = new Tone.PolySynth(Tone.PluckSynth, {
          attackNoise: 1.0, dampening: 4000, resonance: 0.96,
        }).connect(reverb);
        chordBaseDb = -8;
        break;
      case 'piano':
      default:
        chordInst = new Tone.PolySynth(Tone.Synth, {
          oscillator:{ type:'triangle' },
          envelope:{ attack:0.004, decay:0.5, sustain:0.25, release:1.4 },
        }).connect(reverb);
        chordBaseDb = -8;
    }
    if (chordInst && name !== 'guitar') {
      if (texture === 'clean') chordBaseDb += 1.5;
      if (texture === 'wash') chordBaseDb -= 1;
      if (texture === 'fuzz') chordBaseDb -= 2.5;
      if (texture === 'dark') chordBaseDb -= 2;
    }
    setBaseVolume(chordInst, chordBaseDb, 'chords');
  }

  function clearTimers() {
    timers.forEach(t => clearTimeout(t));
    timers = [];
  }

  function clearPreviewTimers() {
    previewTimers.forEach(t => clearTimeout(t));
    previewTimers = [];
  }

  function stopPreview() {
    previewToken += 1;
    clearPreviewTimers();
  }

  function stopPlayback() {
    stopFlag = true;
    clearTimers();
    try { chordInst && chordInst.releaseAll(); } catch(e){}
    try { bassInst && bassInst.triggerRelease(); } catch(e){}
    try { leadInst && leadInst.triggerRelease(); } catch(e){}
    try { underInst && underInst.triggerRelease(); } catch(e){}
  }

  function stop() {
    stopPlayback();
    stopPreview();
  }

  // ── Voicing helpers ──────────────────────────────────────────────────────
  function voiceChord(chord, mode, prev) {
    if (V) return V.voice(chord, mode || 'smart', { previous: prev || null });
    // fallback: original stacked voicing
    const baseOct = 4;
    let lastMidi = 0;
    const out = [];
    chord.intervals.forEach((iv, i) => {
      const pc = (chord.rootPc + iv) % 12;
      let oct = baseOct;
      if (i > 0) {
        for (oct = 2; oct <= 7; oct++) {
          const m = pc + (oct + 1) * 12;
          if (m > lastMidi) break;
        }
      }
      const midi = pc + (oct + 1) * 12;
      lastMidi = midi;
      const name = (chord.preferFlats
        ? ['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B']
        : ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'])[pc];
      out.push(name + oct);
    });
    return out;
  }

  function rootName(chord, oct) {
    const pc = chord.rootPc;
    const n = chord.preferFlats
      ? ['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'][pc]
      : ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'][pc];
    return n + (oct == null ? 2 : oct);
  }

  function noteAt(pc, oct, preferFlats) {
    const n = preferFlats
      ? ['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'][pc]
      : ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'][pc];
    return n + oct;
  }

  function uniqueNotes(notes) {
    const seen = new Set();
    return notes.filter(n => {
      if (!n || seen.has(n)) return false;
      seen.add(n);
      return true;
    });
  }

  function performanceVoicing(chord, voicing, limit) {
    const thirdIv = chord.intervals[1] == null ? 4 : chord.intervals[1];
    const fifthIv = chord.intervals.find(iv => iv === 6 || iv === 7 || iv === 8);
    const colorIv = chord.intervals.length > 3 ? chord.intervals[chord.intervals.length - 1] : thirdIv;
    const expanded = [
      rootName(chord, 3),
      ...voicing,
      noteAt((chord.rootPc + thirdIv) % 12, 4, chord.preferFlats),
      noteAt((chord.rootPc + (fifthIv == null ? 7 : fifthIv)) % 12, 4, chord.preferFlats),
      noteAt((chord.rootPc + colorIv) % 12, 5, chord.preferFlats),
      rootName(chord, 5),
    ];
    return uniqueNotes(expanded).slice(0, limit || 6);
  }

  function shouldLoop(opts) {
    if (!opts) return false;
    return typeof opts.loop === 'function' ? !!opts.loop() : !!opts.loop;
  }

  const SHARP_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  function midiName(midi) { return SHARP_NAMES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1); }
  function bassRootMidi(chord) { return 40 + ((chord.rootPc - 4 + 12) % 12); }   // E2–D#3, as the bass tab has it

  // The felt beats of one bar of `meter`, for the click and the beat lights:
  // the strong ones (where each group starts) click higher. onBeat hears the
  // beat's place in the bar (0 to 5 in 6/8). None from untilMs on.
  function scheduleMeterBeats(barStartMs, stepMs, meter, opts, untilMs) {
    const M = global.Meters;
    if (!M || !opts) return;
    M.pulses(meter).forEach((p, i) => {
      const t = barStartMs + p.step * stepMs;
      if (untilMs != null && t >= untilMs - 1) return;
      timers.push(setTimeout(() => {
        if (stopFlag) return;
        if (opts.metronome) { try { clickInst.triggerAttackRelease(p.strong ? 'C6' : 'C5', '32n'); } catch(e){} }
        if (opts.onBeat) opts.onBeat(i);
      }, Math.max(0, t)));
    });
  }

  // Note lengths as Tone writes them, in beats.
  const NOTE_BEATS = { '1n': 4, '2n': 2, '4n': 1, '8n': 0.5, '16n': 0.25, '32n': 0.125 };
  // A note's length, cut so that it stops where its chord does (untilMs is on
  // the same clock as atMs). With no end given it is left as it is.
  function fitLength(dur, atMs, untilMs, beatMs) {
    if (!(untilMs < Infinity)) return dur;
    const seconds = typeof dur === 'number' ? dur : (NOTE_BEATS[dur] || 1) * beatMs / 1000;
    return Math.max(0.05, Math.min(seconds, (untilMs - atMs) / 1000 - 0.02));
  }

  // One bar of a section played from a chart (theory/meters.js): strokes,
  // picked notes, chucks and bass, each on the chord sounding at that point
  // and none ringing on into the next chord.
  function scheduleChartBar(chart, bar, chords, voicings, stepsPerChord, totalSteps, startOffset, stepMs, opts, withBass) {
    const M = global.Meters;
    const L = chart.length;
    M.chordHits(chart.chords).forEach((h, k) => {
      const abs = bar * L + h.step;
      if (abs >= totalSteps) return;
      const ci = Math.min(chords.length - 1, Math.floor(abs / stepsPerChord));
      const ch = chords[ci];
      const voicing = voicings[ci];
      const ringSteps = Math.min(h.length, (ci + 1) * stepsPerChord - abs, totalSteps - abs);
      const dur = Math.max(0.06, ringSteps * stepMs / 1000 - 0.03);
      const at = startOffset + abs * stepMs;
      const seed = (bar + 1) * 97 + k * 31;
      if (h.kind === 'pick') {
        const n = voicing[(h.tone - 1) % voicing.length];
        timers.push(setTimeout(() => {
          if (stopFlag) return;
          notifyNote(opts, ci, ch, n);
          try { chordInst.triggerAttackRelease(n, dur, undefined, humanVelocity(0.62, seed, 0.1)); } catch(e){}
        }, Math.max(0, at + humanOffset(6, seed))));
        return;
      }
      const top = voicing.slice(-Math.min(4, voicing.length));
      const notes = h.kind === 'up' ? top.slice().reverse() : h.kind === 'chuck' ? top : voicing;
      const spread = h.kind === 'down' ? 14 : h.kind === 'up' ? 10 : 4;
      const vel = h.kind === 'chuck' ? 0.28 : h.kind === 'up' ? (h.accent ? 0.6 : 0.42) : (h.accent ? 0.8 : 0.55);
      notes.forEach((n, j) => {
        timers.push(setTimeout(() => {
          if (stopFlag) return;
          notifyNote(opts, ci, ch, n);
          try { chordInst.triggerAttackRelease(n, h.kind === 'chuck' ? 0.05 : dur, undefined, humanVelocity(vel, seed + j, 0.12)); } catch(e){}
        }, Math.max(0, at + j * spread + humanOffset(5, seed + j))));
      });
    });
    if (!withBass) return;
    M.bassHits(chart.bass).forEach(h => {
      const abs = bar * L + h.step;
      if (abs >= totalSteps) return;
      const ci = Math.min(chords.length - 1, Math.floor(abs / stepsPerChord));
      const ch = chords[ci];
      const next = chords[(ci + 1) % chords.length];
      const root = bassRootMidi(ch);
      const midi = h.degree === 'fifth' ? root + 7 - (root + 7 > 51 ? 12 : 0)
        : h.degree === 'octave' ? root + 12
        : h.degree === 'third' ? root + (ch.intervals.includes(3) && !ch.intervals.includes(4) ? 3 : 4)
        : h.degree === 'approach' ? bassRootMidi(next) - 1
        : root;
      const ringSteps = Math.min(h.length, (ci + 1) * stepsPerChord - abs, totalSteps - abs);
      timers.push(setTimeout(() => {
        if (stopFlag) return;
        try { bassInst.triggerAttackRelease(midiName(midi), Math.max(0.08, ringSteps * stepMs / 1000 - 0.06)); } catch(e){}
      }, Math.max(0, startOffset + abs * stepMs)));
    });
  }

  // Schedule click track (one beep per beat). If accent, first beat is louder.
  function scheduleClick(startMs, beatMs, beats, opts) {
    if (!opts || !opts.metronome) return;
    for (let i = 0; i < beats; i++) {
      const t = startMs + i * beatMs;
      const accent = i % 4 === 0;
      timers.push(setTimeout(() => {
        if (stopFlag) return;
        try { clickInst.triggerAttackRelease(accent ? 'C6' : 'C5', '32n'); } catch(e){}
        if (opts.onBeat) opts.onBeat(i % 4);
      }, t));
    }
  }

  function notifyNote(opts, chordIdx, chord, noteName) {
    if (opts && opts.onNote) {
      try { opts.onNote(chordIdx, chord, noteName); } catch(e) {}
    }
  }

  // ── Simple chord-by-chord playback ───────────────────────────────────────
  async function playProgression(chords, opts) {
    opts = opts || {};
    // In another time than 4/4 the plain styles are played as charts made for that time.
    const M = global.Meters;
    if (opts.meter && M && M.id(opts.meter) !== '4/4') {
      const chart = M.styleChart(opts.meter, opts.style || 'block');
      return playBacking(chords, Object.assign({}, opts, {
        pattern: { steps: { meter: M.id(opts.meter), length: M.stepsPerBar(opts.meter), chords: chart.chords, bass: chart.bass, accents: [] },
          drums: { kick: [], snare: [], hhClosed: [], hhOpen: [] }, swing: 0, human: 6 },
        stepsPerChord: opts.beatsPerChord ? Math.round(opts.beatsPerChord * 4) : M.stepsPerBar(opts.meter),
      }));
    }
    await start();
    stopPlayback();
    stopPreview();
    stopFlag = false;
    const tempo = clamp(opts.tempo || 90, 40, 240);
    const style = opts.style || 'block';
    const withBass = opts.withBass !== false;
    const voicingMode = opts.voicing || 'smart';
    const beatMs = 60000 / tempo;
    const beatsPerChord = opts.beatsPerChord || 4;
    const chordDur = beatMs * beatsPerChord;

    // Count-in if metronome on
    let chordsStartMs = 0;
    if (opts.metronome && opts.countIn) {
      scheduleClick(0, beatMs, 4, opts);
      chordsStartMs = 4 * beatMs;
    }
    if (opts.metronome) scheduleClick(chordsStartMs, beatMs, chords.length * beatsPerChord, opts);

    let prevVoicing = null;
    let t = chordsStartMs;
    function scheduleAt(atMs, fn) {
      timers.push(setTimeout(() => {
        if (!stopFlag) fn();
      }, Math.max(0, atMs)));
    }
    function chordHit(idx, ch, notes, atMs, dur, velocity) {
      scheduleAt(atMs, () => {
        const list = Array.isArray(notes) ? notes : [notes];
        list.forEach(n => notifyNote(opts, idx, ch, n));
        try { chordInst.triggerAttackRelease(notes, dur, undefined, velocity == null ? 0.76 : velocity); } catch(e){}
      });
    }
    function strumHit(idx, ch, notes, atMs, spreadMs, dur, velocity, reverse) {
      const list = reverse ? notes.slice().reverse() : notes.slice();
      list.forEach((n, j) => {
        scheduleAt(atMs + j * spreadMs + humanOffset(8, idx * 101 + j), () => {
          notifyNote(opts, idx, ch, n);
          try { chordInst.triggerAttackRelease(n, dur, undefined, humanVelocity(velocity, idx * 131 + j, 0.12)); } catch(e){}
        });
      });
    }
    for (let i = 0; i < chords.length; i++) {
      const idx = i;
      const ch = chords[i];
      const rawVoicing = voiceChord(ch, voicingMode, prevVoicing);
      const voicing = performanceVoicing(ch, rawVoicing, 6);
      prevVoicing = rawVoicing;
      const bassNote = rootName(ch, 2);
      const top = voicing.slice(-Math.min(4, voicing.length));

      scheduleAt(t, () => {
        if (opts.onChordStart) opts.onChordStart(idx, ch);
      });
      // A bar of the style at a time: again in each bar a long chord lasts,
      // and only the strokes that fall inside a short one.
      for (let from = 0; from < beatsPerChord; from += 4) {
        const b0 = t + from * beatMs;
        const span = Math.min(4, beatsPerChord - from);
        const barDur = beatMs * span;
        const barNote = Math.max(0.1, barDur / 1000 - 0.08);
        if (withBass) {
          scheduleAt(b0, () => { try { bassInst.triggerAttackRelease(bassNote, Math.max(0.2, barNote * 0.55)); } catch(e){} });
          if (span >= 4) {
            scheduleAt(b0 + beatMs * 2, () => { try { bassInst.triggerAttackRelease(bassNote, Math.max(0.2, barNote * 0.42)); } catch(e){} });
          }
        }

        if (style === 'arpeggio') {
          const seqs = [
            [0, 2, 4, 1, 3, 5, 4, 2],
            [0, 1, 3, 5, 2, 4, 5, 3],
            [0, 3, 2, 4, 1, 5, 3, 2],
            [0, 4, 2, 5, 3, 1, 4, 5],
          ];
          const seq = seqs[idx % seqs.length];
          seq.forEach((noteIdx, j) => {
            const n = voicing[noteIdx % voicing.length];
            const at = b0 + j * (barDur / seq.length) + humanOffset(12, idx * 37 + j);
            chordHit(idx, ch, n, at, (barDur / seq.length) / 1000 + 0.22, humanVelocity(0.78, idx * 41 + j, 0.15));
          });
        } else if (style === 'strum') {
          strumHit(idx, ch, voicing, b0, 24, '2n', 0.8, false);
          if (span > 1.5) chordHit(idx, ch, top, b0 + beatMs + beatMs * 0.5, '8n', 0.42);
          if (span > 2) strumHit(idx, ch, voicing, b0 + beatMs * 2, 20, '2n', 0.68, false);
          if (span > 3.5) strumHit(idx, ch, top, b0 + beatMs * 3 + beatMs * 0.5, 16, '8n', 0.45, true);
        } else {
          chordHit(idx, ch, voicing, b0, Math.max(0.6, barNote * 0.58), 0.78);
          if (span >= 4) chordHit(idx, ch, top, b0 + beatMs * 2, Math.max(0.35, barNote * 0.3), 0.52);
        }
      }

      t += chordDur;
    }
    timers.push(setTimeout(() => {
      if (stopFlag) return;
      if (shouldLoop(opts)) { playProgression(chords, opts); return; }
      opts.onDone && opts.onDone();
    }, t + 50));
  }

  // ── Backing-track playback ───────────────────────────────────────────────
  // Core scheduler: pushes all note timers for one pass of `chords` starting
  // at `startOffset` ms from now, and returns the total end time in ms.
  // Does NOT call start()/stop cleanup and does NOT schedule looping — the
  // public entry points (playBacking, playSong) own that.
  function scheduleBacking(chords, opts, startOffset) {
    opts = opts || {};
    const tempo = clamp(opts.tempo || 90, 40, 240);
    const pattern = opts.pattern || { drums:{kick:[0,8],snare:[4,12],hhClosed:[0,2,4,6,8,10,12,14],hhOpen:[]}, bass:'root', chords:'block' };
    const sixteenthMs = (60000 / tempo) / 4;
    const beatMs = sixteenthMs * 4;
    const chart = pattern.steps && global.Meters ? pattern.steps : null;
    if (chart) return scheduleChartSection(chords, opts, startOffset, pattern, chart, sixteenthMs, beatMs);
    // A chord lasts a bar unless the section says otherwise: half a bar, two bars...
    const stepsPerChord = Math.max(1, Math.round(opts.stepsPerChord || 16));
    const totalSteps = chords.length * stepsPerChord;
    const bars = Math.ceil(totalSteps / 16);
    // pattern.swing may be a tuned number (0-0.3) or legacy boolean true (=0.18)
    const swingAmt = (opts.swing != null ? opts.swing
      : (typeof pattern.swing === 'number' ? pattern.swing : (pattern.swing ? 0.18 : 0)));
    const voicingMode = opts.voicing || 'smart';
    const withBass = opts.withBass !== false;
    const drumHuman = pattern.drum && pattern.drum.human != null
      ? pattern.drum.human
      : (bandOptions.drums === 'hazy' || bandOptions.drums === 'distant' ? 18 : 7);

    function swungOffset(step) {
      return swingAmt > 0 && (step % 2 === 1) ? sixteenthMs * swingAmt : 0;
    }

    // Bar by bar: the beat lights, the drums and the click, up to where the last chord ends.
    for (let bar = 0; bar < bars; bar++) {
      const barStartMs = startOffset + bar * 16 * sixteenthMs;
      const steps = Math.min(16, totalSteps - bar * 16);
      if (opts.onBeat) {
        for (let b = 0; b < 4 && b * 4 < steps; b++) {
          timers.push(setTimeout(() => { if (!stopFlag) opts.onBeat(b); }, barStartMs + b * beatMs));
        }
      }
      scheduleDrumGroove(pattern.drums, bar, bars, barStartMs, sixteenthMs, swingAmt, drumHuman, pattern.drum, undefined, steps);
      if (opts.metronome) scheduleClick(barStartMs, beatMs, Math.ceil(steps / 4), opts);
    }

    let prevVoicing = null;

    for (let ci = 0; ci < chords.length; ci++) {
      const ch = chords[ci];
      const next = chords[ci + 1];
      const chordStartMs = startOffset + ci * stepsPerChord * sixteenthMs;
      const chordEndMs = chordStartMs + stepsPerChord * sixteenthMs;
      const rawVoicing = voiceChord(ch, voicingMode, prevVoicing);
      const voicing = performanceVoicing(ch, rawVoicing, 6);
      prevVoicing = rawVoicing;

      // Bass and chord layer: the style's bar once for every bar the chord
      // lasts, cut off where the chord ends. Only the last bar leads into the next chord.
      for (let from = 0; from < stepsPerChord; from += 16) {
        const at = chordStartMs + from * sixteenthMs;
        const last = from + 16 >= stepsPerChord;
        const until = from + 16 > stepsPerChord ? chordEndMs : Infinity;
        if (withBass) schedulesBass(pattern.bass, ch, last ? next : null, at, sixteenthMs, until);
        schedulesChords(pattern.chords, voicing, at, sixteenthMs, swingAmt, opts, ci, ch, until);
      }

      // Card highlight
      timers.push(setTimeout(() => {
        if (!stopFlag && opts.onChordStart) opts.onChordStart(ci, ch);
      }, chordStartMs));
    }

    scheduleMelodyEvents(opts.melody, leadInst, startOffset, beatMs, 0.85, opts);
    scheduleMelodyEvents(opts.underMelody, underInst, startOffset, beatMs, 0.55, opts);

    return startOffset + totalSteps * sixteenthMs;
  }

  // A section played from a chart, bar after bar, in any time. A chord lasts
  // opts.stepsPerChord sixteenths (a bar unless the section says otherwise).
  function scheduleChartSection(chords, opts, startOffset, pattern, chart, sixteenthMs, beatMs) {
    const L = chart.length;
    const stepsPerChord = Math.max(1, Math.round(opts.stepsPerChord || L));
    const totalSteps = chords.length * stepsPerChord;
    const bars = Math.ceil(totalSteps / L);
    const voicingMode = opts.voicing || 'smart';
    const withBass = opts.withBass !== false;
    const drumHuman = pattern.human != null ? pattern.human : 6;
    let prevVoicing = null;
    const voicings = chords.map(ch => {
      const raw = voiceChord(ch, voicingMode, prevVoicing);
      prevVoicing = raw;
      return performanceVoicing(ch, raw, 6);
    });
    for (let bar = 0; bar < bars; bar++) {
      const barStartMs = startOffset + bar * L * sixteenthMs;
      scheduleMeterBeats(barStartMs, sixteenthMs, chart.meter, opts);
      scheduleDrumGroove(pattern.drums, bar, bars, barStartMs, sixteenthMs, 0, drumHuman, pattern.drum, L);
      scheduleChartBar(chart, bar, chords, voicings, stepsPerChord, totalSteps, startOffset, sixteenthMs, opts, withBass);
    }
    chords.forEach((ch, ci) => {
      timers.push(setTimeout(() => {
        if (!stopFlag && opts.onChordStart) opts.onChordStart(ci, ch);
      }, startOffset + ci * stepsPerChord * sixteenthMs));
    });
    scheduleMelodyEvents(opts.melody, leadInst, startOffset, beatMs, 0.85, opts);
    scheduleMelodyEvents(opts.underMelody, underInst, startOffset, beatMs, 0.55, opts);
    return startOffset + totalSteps * sixteenthMs;
  }

  // A count-in: one bar of the time being played (four beats when no time is given).
  function countIn(opts) {
    const tempo = clamp(opts.tempo || 90, 40, 240);
    const beatMs = 60000 / tempo;
    const M = global.Meters;
    const meter = opts.meter || (opts.pattern && opts.pattern.steps ? opts.pattern.steps.meter : null);
    if (meter && M && M.id(meter) !== '4/4') {
      scheduleMeterBeats(0, beatMs / 4, meter, opts);
      return M.stepsPerBar(meter) * beatMs / 4;
    }
    scheduleClick(0, beatMs, 4, opts);
    return 4 * beatMs;
  }

  async function playBacking(chords, opts) {
    await start();
    stopPlayback();
    stopPreview();
    stopFlag = false;
    opts = opts || {};
    let startOffset = 0;
    if (opts.metronome && opts.countIn) startOffset = countIn(opts);
    const total = scheduleBacking(chords, opts, startOffset) + 50;
    timers.push(setTimeout(() => {
      if (stopFlag) return;
      if (shouldLoop(opts)) { playBacking(chords, opts); return; }
      opts.onDone && opts.onDone();
    }, total));
  }

  // ── Whole-song playback ──────────────────────────────────────────────────
  // items: Song.buildPlayback(song) → [{ sectionId, name, chords, melody,
  //   under, pattern, tempo, beatsPerChord, repeat, levels, tones }]
  // Sections chain with a timer at each boundary, so per-section tempo and
  // tone changes are free and timing re-anchors every section.
  async function playSong(items, opts) {
    await start();
    stopPlayback();
    stopPreview();
    stopFlag = false;
    opts = opts || {};
    if (!items || !items.length) { opts.onDone && opts.onDone(); return; }

    // Expand repeats into a flat play queue.
    const queue = [];
    items.forEach((item, idx) => {
      const reps = Math.max(1, item.repeat || 1);
      for (let r = 0; r < reps; r++) queue.push({ item, idx });
    });

    function playNext(qi) {
      if (stopFlag) return;
      if (qi >= queue.length) {
        if (shouldLoop(opts)) { playNext(0); return; }
        opts.onDone && opts.onDone();
        return;
      }
      const { item, idx } = queue[qi];
      if (item.tones || item.levels) {
        setBandOptions({
          texture: item.tones && item.tones.texture,
          drums: item.tones && item.tones.drums,
          melody: item.tones && item.tones.melody,
          levels: item.levels,
        });
      }
      if (opts.onSectionStart) opts.onSectionStart(idx, item);
      const total = scheduleBacking(item.chords, {
        tempo: item.tempo,
        pattern: item.pattern,
        stepsPerChord: item.stepsPerChord,
        voicing: opts.voicing || 'smart',
        withBass: opts.withBass !== false,
        melody: item.melody,
        underMelody: item.under,
        metronome: false,
        onBeat: opts.onBeat,
        onChordStart: opts.onChordStart ? (ci, ch) => opts.onChordStart(idx, ci, ch) : null,
        onNote: opts.onNote,
      }, 0);
      timers.push(setTimeout(() => playNext(qi + 1), total));
    }

    playNext(0);
  }

  async function playDrums(opts) {
    await start();
    stopPlayback();
    stopPreview();
    stopFlag = false;
    opts = opts || {};
    const tempo = clamp(opts.tempo || 90, 40, 240);
    const pattern = opts.pattern || { drums:{kick:[0,8],snare:[4,12],hhClosed:[0,2,4,6,8,10,12,14],hhOpen:[]}, swing:0 };
    const sixteenthMs = (60000 / tempo) / 4;
    const beatMs = sixteenthMs * 4;
    const bars = clamp(parseInt(opts.bars || 4, 10) || 4, 1, 32);
    const swingAmt = opts.swing != null ? opts.swing : (pattern.swing || 0);
    const drumHuman = pattern.drum && pattern.drum.human != null
      ? pattern.drum.human
      : (bandOptions.drums === 'hazy' || bandOptions.drums === 'distant' ? 18 : 7);
    const chart = pattern.steps && global.Meters ? pattern.steps : null;
    const barSteps = chart ? chart.length : 16;

    let startOffset = 0;
    if (opts.metronome && opts.countIn) startOffset = countIn(Object.assign({}, opts, { tempo }));

    for (let bar = 0; bar < bars; bar++) {
      const barStartMs = startOffset + bar * barSteps * sixteenthMs;
      if (chart) {
        scheduleMeterBeats(barStartMs, sixteenthMs, chart.meter, opts);
      } else {
        if (opts.onBeat) {
          for (let b = 0; b < 4; b++) {
            timers.push(setTimeout(() => { if (!stopFlag) opts.onBeat(b); }, barStartMs + b * beatMs));
          }
        }
        if (opts.metronome) scheduleClick(barStartMs, beatMs, 4, opts);
      }
      scheduleDrumGroove(pattern.drums, bar, bars, barStartMs, sixteenthMs, chart ? 0 : swingAmt, drumHuman, pattern.drum, barSteps);
    }

    const total = startOffset + bars * barSteps * sixteenthMs + 50;
    timers.push(setTimeout(() => {
      if (stopFlag) return;
      if (shouldLoop(opts)) { playDrums(opts); return; }
      opts.onDone && opts.onDone();
    }, total));
  }

  function scheduleMelodyEvents(events, inst, startOffset, beatMs, velocity, opts) {
    if (!events || !events.length || !inst) return;
    events.forEach(ev => {
      const at = startOffset + ev.beatStart * beatMs;
      const dur = Math.max(0.05, ev.beats * beatMs / 1000 - 0.02);
      timers.push(setTimeout(() => {
        if (stopFlag) return;
        notifyNote(opts, -1, null, ev.name);
        try { inst.triggerAttackRelease(ev.name, dur, undefined, velocity == null ? 0.8 : velocity); } catch(e){}
      }, at));
    });
  }

  // barSteps: sixteenths in the bar. Only 4/4 bars get the style fills; a
  // groove written for another time plays as written. stepsLimit: where a
  // bar cut short by the end of the section stops.
  function scheduleDrumGroove(drums, barIdx, totalBars, startMs, stepMs, swingAmt, drumHuman, meta, barSteps, stepsLimit) {
    const plain = barSteps && barSteps !== 16;
    const d = plain ? {
      kick: (drums && drums.kick || []).slice(), snare: (drums && drums.snare || []).slice(),
      hhClosed: (drums && drums.hhClosed || []).slice(), hhOpen: (drums && drums.hhOpen || []).slice(),
    } : varyDrumPattern(drums || {}, barIdx, totalBars, meta);
    function swungOffset(step) {
      return swingAmt > 0 && (step % 2 === 1) ? stepMs * swingAmt : 0;
    }
    ['kick','snare','hhClosed','hhOpen'].forEach(layer => {
      (d[layer] || []).forEach(step => {
        if (stepsLimit != null && step >= stepsLimit) return;
        const seed = (barIdx + 1) * 101 + step * 7 + layer.length * 13;
        const at = startMs + step * stepMs + swungOffset(step) + humanOffset(drumHuman, seed);
        timers.push(setTimeout(() => {
          if (stopFlag) return;
          const ghostSnare = !plain && layer === 'snare' && step !== 4 && step !== 12;
          const baseVel = layer === 'kick' ? 0.82 : ghostSnare ? 0.32 : layer === 'snare' ? 0.68 : layer === 'hhOpen' ? 0.38 : 0.28;
          const vel = humanVelocity(baseVel, seed + 5, layer === 'kick' ? 0.18 : 0.14);
          try {
            if (layer === 'kick')          kickDrum.triggerAttackRelease('C1', '8n', undefined, vel);
            else if (layer === 'snare')    snareDrum.triggerAttackRelease('16n', undefined, vel);
            else if (layer === 'hhClosed') hatClosed.triggerAttackRelease('32n', undefined, vel);
            else if (layer === 'hhOpen')   hatOpen.triggerAttackRelease('8n', undefined, vel);
          } catch(e){}
        }, Math.max(0, at)));
      });
    });
  }

  function uniqueSteps(steps) {
    return Array.from(new Set((steps || []).filter(s => Number.isFinite(s) && s >= 0 && s < 16))).sort((a, b) => a - b);
  }

  function varyDrumPattern(drums, chordIdx, totalChords, meta) {
    const out = {
      kick: uniqueSteps(drums.kick),
      snare: uniqueSteps(drums.snare),
      hhClosed: uniqueSteps(drums.hhClosed),
      hhOpen: uniqueSteps(drums.hhOpen),
    };
    if (!out.kick.length && !out.snare.length && !out.hhClosed.length && !out.hhOpen.length) return out;

    const family = meta && meta.family || '';
    const last = chordIdx === totalChords - 1;
    if (family === 'Shoegaze') {
      if (chordIdx % 2 === 1) out.kick.push(15);
      if (chordIdx % 3 === 2) out.snare.push(11);
      if (last) out.hhOpen.push(15);
    } else if (family === 'Post-Punk') {
      if (chordIdx % 2 === 0) out.kick.push(10);
      if (chordIdx % 2 === 1) out.hhClosed.push(3, 7, 11, 15);
      if (last) out.snare.push(14);
    } else if (family === 'Jangle') {
      if (chordIdx % 2 === 1) out.kick.push(6);
      out.hhClosed.push(chordIdx % 2 ? 2 : 10);
      if (last) out.hhOpen.push(14);
    } else if (family === 'Dream Pop') {
      if (chordIdx % 2 === 1) out.kick.push(10);
      out.hhClosed.push(3, 11);
      if (last) out.hhOpen.push(15);
    } else if (family === 'Slowcore') {
      if (last) out.kick.push(10);
      if (last && out.snare.length) out.snare.push(14);
    } else if (family === 'Folk') {
      if (chordIdx % 2 === 1) out.kick.push(10);
      if (last) out.snare.push(14);
    } else if (family === 'Indie Rock') {
      if (chordIdx % 2 === 0) out.kick.push(6);
      if (chordIdx % 2 === 1) out.hhOpen.push(15);
      if (last) out.snare.push(14, 15);
    } else if (family === 'Electronic') {
      if (chordIdx % 2 === 1) out.hhClosed.push(1, 9);
      if (last) out.hhOpen.push(14);
      if (last) out.kick.push(15);
    }

    out.kick = uniqueSteps(out.kick);
    out.snare = uniqueSteps(out.snare);
    out.hhClosed = uniqueSteps(out.hhClosed);
    out.hhOpen = uniqueSteps(out.hhOpen);
    return out;
  }

  // untilMs: where the chord ends, when that is before the end of the bar.
  function schedulesBass(bassType, ch, next, startMs, stepMs, untilMs) {
    const beat = stepMs * 4;
    const until = untilMs == null ? Infinity : untilMs;
    const root = rootName(ch, 2);
    const fifthMidi = (ch.rootPc + 7) % 12;
    const fifth = noteAt(fifthMidi, 2, ch.preferFlats);
    const oct = rootName(ch, 3);
    const third = noteAt((ch.rootPc + ((ch.intervals[1] || 4))) % 12, 2, ch.preferFlats);

    function bassHit(midiName, atMs, dur) {
      const at = startMs + atMs;
      if (at >= until - 1) return;
      const length = fitLength(dur || '8n', at, until, beat);
      timers.push(setTimeout(() => {
        if (stopFlag) return;
        try { bassInst.triggerAttackRelease(midiName, length); } catch(e){}
      }, at));
    }

    switch (bassType) {
      case 'root':
        bassHit(root, 0, '2n');
        bassHit(root, beat * 2, '2n');
        break;
      case 'root-fifth':
        bassHit(root, 0, '4n'); bassHit(fifth, beat, '4n');
        bassHit(root, beat * 2, '4n'); bassHit(fifth, beat * 3, '4n');
        break;
      case 'walking': {
        const tones = [root, third, fifth, oct];
        bassHit(tones[0], 0, '4n');
        bassHit(tones[1], beat, '4n');
        bassHit(tones[2], beat * 2, '4n');
        if (next) {
          const approachPc = (next.rootPc + 11) % 12;
          bassHit(noteAt(approachPc, 2, ch.preferFlats), beat * 3, '4n');
        } else bassHit(tones[3], beat * 3, '4n');
        break;
      }
      case 'tumbao':
        bassHit(root, 0, '4n');
        bassHit(fifth, beat * 1 + stepMs * 2, '8n');
        bassHit(root, beat * 2 + stepMs * 2, '8n');
        bassHit(fifth, beat * 3, '4n');
        break;
      case 'reggae':
        bassHit(root, beat * 2, '2n');
        break;
      case 'funk-16th':
        bassHit(root, 0, '16n');
        bassHit(oct, beat + stepMs * 1, '16n');
        bassHit(root, beat * 1 + stepMs * 3, '16n');
        bassHit(root, beat * 2, '16n');
        bassHit(oct, beat * 2 + stepMs * 3, '16n');
        bassHit(root, beat * 3 + stepMs * 1, '16n');
        break;
      case 'pumping':
        for (let i = 0; i < 8; i++) bassHit(root, i * stepMs * 2, '8n');
        break;
      case 'sustained':
        bassHit(root, 0, '1n');
        break;
      default:
        bassHit(root, 0, '2n');
    }
  }

  // untilMs: where the chord ends, when that is before the end of the bar.
  function schedulesChords(chordType, voicing, startMs, stepMs, swing, opts, chordIdx, chord, untilMs) {
    const beat = stepMs * 4;
    const until = untilMs == null ? Infinity : untilMs;
    const top = (n) => voicing.slice(-Math.min(n, voicing.length));
    const low = (n) => voicing.slice(0, Math.min(n, voicing.length));
    const noteFrom = (idx) => voicing[((idx % voicing.length) + voicing.length) % voicing.length];
    function hit(notes, atMs, dur, velocity) {
      const at = startMs + atMs;
      if (at >= until - 1) return;
      const length = fitLength(dur || '4n', at, until, beat);
      timers.push(setTimeout(() => {
        if (stopFlag) return;
        const list = Array.isArray(notes) ? notes : [notes];
        list.forEach(n => notifyNote(opts, chordIdx, chord, n));
        try { chordInst.triggerAttackRelease(notes, length, undefined, velocity == null ? 0.72 : velocity); } catch(e){}
      }, Math.max(0, at)));
    }
    function strum(atMs, notes, spreadMs, dur, velocity, reverse) {
      const list = (reverse ? notes.slice().reverse() : notes.slice());
      list.forEach((n, j) => {
        const at = startMs + atMs + j * spreadMs + humanOffset(8, chordIdx * 41 + j);
        if (at >= until - 1) return;
        const length = fitLength(dur || '8n', at, until, beat);
        timers.push(setTimeout(() => {
          if (stopFlag) return;
          notifyNote(opts, chordIdx, chord, n);
          try { chordInst.triggerAttackRelease(n, length, undefined, humanVelocity(velocity || 0.72, chordIdx * 31 + j, 0.14)); } catch(e){}
        }, Math.max(0, at)));
      });
    }

    switch (chordType) {
      case 'block':
        hit(voicing, 0, '2n');
        hit(top(4), beat * 2, '2n', 0.54);
        break;
      case 'strum':
        strum(0, voicing, 24, '2n', 0.78, false);
        hit(top(3), beat + stepMs * 2, '8n', 0.42);
        strum(beat * 2, voicing, 20, '2n', 0.68, false);
        strum(beat * 3 + stepMs * 2, top(4), 16, '8n', 0.46, true);
        break;
      case 'comp':
        hit(voicing, beat * 1 + stepMs * 2 + (swing ? stepMs * 0.4 : 0), '4n');
        hit(voicing, beat * 3 + stepMs * 2 + (swing ? stepMs * 0.4 : 0), '4n');
        break;
      case 'four-floor':
        for (let i = 0; i < 4; i++) hit(voicing, i * beat + stepMs * 2, '8n');
        break;
      case 'skank':
        for (let i = 0; i < 4; i++) hit(voicing, i * beat + stepMs * 2, '8n');
        break;
      case 'arp':
        [
          [0, 2, 4, 1, 3, 5, 4, 2],
          [0, 1, 3, 5, 2, 4, 5, 3],
          [0, 3, 2, 4, 1, 5, 3, 2],
          [0, 4, 2, 5, 3, 1, 4, 5],
        ][chordIdx % 4].forEach((noteIdx, i) => {
          hit([noteFrom(noteIdx)], i * stepMs * 2, '8n', i % 2 ? 0.62 : 0.76);
        });
        break;
      case 'sustained':
        hit(voicing, 0, '1n');
        break;
      case 'travis':
        hit([voicing[0]], 0, '4n');
        hit(voicing.slice(1), beat * 1, '4n');
        hit([voicing[0]], beat * 2, '4n');
        hit(voicing.slice(1), beat * 3, '4n');
        break;
      case 'shoegaze-wash':
        strum(0, voicing, 36, '1n', 0.72, false);
        hit(chordIdx % 2 ? top(4) : [...low(1), ...top(3)], beat * 2 + stepMs * 2, '4n', 0.42);
        hit(top(2), beat * 3 + stepMs, '8n', 0.3);
        break;
      case 'tremolo-wash':
        strum(0, voicing, 30, '2n', 0.66, false);
        for (let i = 2; i < 16; i += 2) {
          const notes = i % 4 === 0 ? top(3) : [noteFrom(chordIdx + i)];
          hit(notes, i * stepMs, '16n', i % 4 === 0 ? 0.42 : 0.32);
        }
        break;
      case 'half-wash':
        strum(0, voicing, 42, '1n', 0.72, false);
        hit(chordIdx % 2 ? top(4) : voicing, beat * 3, '4n', 0.45);
        break;
      case 'reverse-swell':
        hit(top(3), beat + stepMs * 2, '8n', 0.28);
        strum(beat * 2 + stepMs * 2, voicing, 38, '2n', 0.68, true);
        break;
      case 'noise-pop-drive':
        for (let i = 0; i < 8; i++) strum(i * stepMs * 2, voicing, 12, '8n', i % 2 ? 0.46 : 0.64, false);
        break;
      case 'glide-strum':
        strum(0, voicing, 26, '4n', 0.72, false);
        hit(chordIdx % 2 ? top(4) : voicing.slice(1), beat + stepMs * 2, '8n', 0.48);
        strum(beat * 2, voicing, 24, '4n', 0.68, false);
        strum(beat * 3 + stepMs * 2, top(4), 16, '8n', 0.44, true);
        break;
      case 'postpunk-chime':
        hit(voicing.slice(-2), beat * 1, '8n');
        hit(voicing, beat * 1 + stepMs * 2, '8n');
        hit(voicing.slice(-2), beat * 3, '8n');
        hit(voicing, beat * 3 + stepMs * 2, '8n');
        break;
      case 'cold-pulse':
        hit(top(3), 0, '8n', 0.55);
        hit([noteFrom(chordIdx + 2), noteFrom(chordIdx + 4)], beat, '8n', 0.42);
        hit(voicing, beat * 2, '8n', 0.58);
        hit(top(3), beat * 3, '8n', 0.42);
        break;
      case 'chorus-chop':
        [0, 3, 6, 8, 11, 14].forEach((s, i) => hit(i % 2 ? voicing.slice(-2) : voicing, s * stepMs, '16n', i % 2 ? 0.42 : 0.58));
        break;
      case 'jangle-arp':
        [
          [0, 2, 4, 5, 3, 1, 4, 2, 0, 3, 5, 4, 2, 1, 3, 5],
          [0, 1, 3, 5, 4, 2, 5, 3, 0, 2, 4, 1, 3, 5, 2, 4],
          [0, 3, 1, 4, 2, 5, 4, 1, 0, 2, 5, 3, 1, 4, 2, 5],
        ][chordIdx % 3].forEach((noteIdx, i) => {
          hit([noteFrom(noteIdx)], i * stepMs, '16n', i % 4 === 0 ? 0.66 : 0.5);
        });
        break;
      case 'dream-pulse':
        hit(voicing, 0, '4n');
        hit(chordIdx % 2 ? top(4) : [...low(1), ...top(2)], beat * 1 + stepMs * 2, '8n');
        hit(voicing, beat * 2, '4n');
        hit(top(3), beat * 3 + stepMs * 2, '8n', 0.44);
        break;
      case 'slowcore-swell':
        hit(voicing, 0, '1n');
        break;
      case 'slow-pick':
        hit([voicing[0]], 0, '4n', 0.5);
        hit(chordIdx % 2 ? top(3) : [noteFrom(2), noteFrom(4)], beat + stepMs * 2, '4n', 0.42);
        hit([noteFrom(chordIdx + 1)], beat * 3, '4n', 0.36);
        break;
      case 'folk-pick':
        hit([voicing[0]], 0, '8n');
        hit(voicing.slice(1), stepMs * 2, '8n');
        hit([voicing[0]], beat, '8n');
        hit(voicing.slice(-2), beat + stepMs * 2, '8n');
        hit([voicing[0]], beat * 2, '8n');
        hit(voicing.slice(1), beat * 2 + stepMs * 2, '8n');
        hit([voicing[0]], beat * 3, '8n');
        hit(voicing.slice(-2), beat * 3 + stepMs * 2, '8n');
        break;
      case 'drone-strum':
        strum(0, voicing, 24, '2n', 0.64, false);
        hit(top(2), beat + stepMs * 2, '8n', 0.35);
        hit([noteFrom(chordIdx + voicing.length - 1)], beat * 3 + stepMs * 2, '8n', 0.35);
        break;
      default:
        hit(voicing, 0, '2n');
    }
  }

  async function playWithMelody(chords, melody, opts) {
    await start();
    stopPlayback();
    stopPreview();
    stopFlag = false;
    opts = opts || {};
    const tempo = clamp(opts.tempo || 90, 40, 240);
    const beatMs = 60000 / tempo;
    const beatsPerChord = opts.beatsPerChord || 2;
    const chordDur = beatMs * beatsPerChord;
    const voicingMode = opts.voicing || 'smart';

    let startOffset = 0;
    if (opts.metronome && opts.countIn) startOffset = countIn(Object.assign({}, opts, { tempo }));
    // The beat lights, and the click when it is on, bar after bar of the time.
    const M = global.Meters;
    const endMs = startOffset + chords.length * chordDur;
    if (M) {
      const barMs = M.barQuarters(opts.meter || '4/4') * beatMs;
      for (let barStart = startOffset; barStart < endMs - 1; barStart += barMs) {
        scheduleMeterBeats(barStart, beatMs / 4, opts.meter || '4/4', opts, endMs);
      }
    }

    let prevVoicing = null;
    for (let i = 0; i < chords.length; i++) {
      const ch = chords[i];
      const rawVoicing = voiceChord(ch, voicingMode, prevVoicing);
      const voicing = performanceVoicing(ch, rawVoicing, 6);
      prevVoicing = rawVoicing;
      timers.push(setTimeout(() => {
        if (stopFlag) return;
        if (opts.onChordStart) opts.onChordStart(i, ch);
        voicing.forEach(n => notifyNote(opts, i, ch, n));
        try { chordInst.triggerAttackRelease(voicing, (chordDur / 1000) - 0.05); } catch(e){}
        if (opts.withBass !== false) {
          try { bassInst.triggerAttackRelease(rootName(ch, 2), (chordDur / 1000) - 0.05); } catch(e){}
        }
      }, startOffset + i * chordDur));
    }
    melody.forEach(ev => {
      const at = startOffset + ev.beatStart * beatMs;
      const dur = ev.beats * beatMs / 1000 - 0.02;
      timers.push(setTimeout(() => {
        if (stopFlag) return;
        notifyNote(opts, -1, null, ev.name);
        try { leadInst.triggerAttackRelease(ev.name, Math.max(0.05, dur)); } catch(e){}
      }, at));
    });

    const totalMs = startOffset + chords.length * chordDur + 100;
    timers.push(setTimeout(() => {
      if (stopFlag) return;
      if (shouldLoop(opts)) { playWithMelody(chords, melody, opts); return; }
      opts.onDone && opts.onDone();
    }, totalMs));
  }

  // Preview a single chord for hover/click feedback
  async function previewChord(chord, voicingMode, opts) {
    await start();
    if (!chordInst) return;
    opts = opts || {};
    stopPreview();
    const token = previewToken;
    const rawVoicing = voiceChord(chord, voicingMode || 'smart');
    const voicing = performanceVoicing(chord, rawVoicing, 6);
    const style = opts.style || 'strum';
    const washed = opts.focusStyle === 'shoegaze' || bandOptions.texture === 'wash' || bandOptions.texture === 'fuzz';
    const dur = washed ? 1.35 : 0.9;
    const top = voicing.slice(-Math.min(4, voicing.length));
    const low = voicing.slice(0, Math.min(2, voicing.length));

    function schedule(atMs, fn) {
      previewTimers.push(setTimeout(() => {
        if (token !== previewToken) return;
        fn();
      }, Math.max(0, atMs)));
    }
    function hit(notes, atMs, noteDur, velocity) {
      schedule(atMs, () => {
        const list = Array.isArray(notes) ? notes : [notes];
        list.forEach(n => notifyNote(opts, -1, chord, n));
        try { chordInst.triggerAttackRelease(notes, noteDur, undefined, velocity == null ? 0.72 : velocity); } catch(e){}
      });
    }
    function strum(notes, atMs, spreadMs, noteDur, velocity, reverse) {
      const list = reverse ? notes.slice().reverse() : notes.slice();
      list.forEach((n, j) => {
        hit(n, atMs + j * spreadMs + humanOffset(6, j + 73), noteDur, humanVelocity(velocity, j + 89, 0.1));
      });
    }

    if (style === 'arpeggio') {
      const seq = [0, 2, 4, 1, 3, 5, 4, 2];
      const stepMs = washed ? 115 : 82;
      seq.forEach((noteIdx, j) => {
        hit(voicing[noteIdx % voicing.length], j * stepMs + humanOffset(8, j + 11), dur * 0.42, humanVelocity(0.76, j + 3, 0.12));
      });
    } else if (style === 'strum') {
      strum(voicing, 0, washed ? 34 : 22, dur, 0.78, false);
      hit(top, washed ? 520 : 360, 0.32, 0.38);
      strum(top, washed ? 780 : 560, 15, 0.28, 0.42, true);
    } else {
      hit(voicing, 0, dur, 0.78);
      hit([...low, ...top.slice(-2)], washed ? 580 : 430, 0.42, 0.4);
    }
  }

  // Play single note (used by piano viz)
  async function previewNote(noteName) {
    await start();
    if (!chordInst) return;
    try { chordInst.triggerAttackRelease(noteName, 0.5); } catch(e){}
  }

  global.Audio = {
    start, setInstrument, setBandOptions, playProgression, playDrums, playBacking, playWithMelody, playSong,
    previewChord, previewNote, stop, voiceChord,
  };
})(typeof window !== 'undefined' ? window : globalThis);
