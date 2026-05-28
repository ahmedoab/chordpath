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
  let chordInst = null, bassInst = null, leadInst = null, clickInst = null;
  let kickDrum = null, snareDrum = null, hatClosed = null, hatOpen = null;
  let reverb = null, master = null;
  let stopFlag = false;
  let timers = [];
  let currentInstrument = 'piano';

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  async function start() {
    if (started) return;
    await Tone.start();
    master = new Tone.Limiter(-1).toDestination();
    reverb = new Tone.Reverb({ decay: 2.6, wet: 0.20 }).connect(master);
    setInstrument('piano');
    buildBass();
    buildDrums();
    buildLead();
    buildClick();
    started = true;
  }

  function buildBass() {
    bassInst = new Tone.MonoSynth({
      oscillator:{ type:'fmtriangle', modulationType:'sine', harmonicity:0.5 },
      envelope:{ attack:0.012, decay:0.25, sustain:0.45, release:0.6 },
      filter:{ Q:1.2, type:'lowpass', rolloff:-24 },
      filterEnvelope:{ attack:0.01, decay:0.4, sustain:0.4, release:0.5, baseFrequency:90, octaves:2.4 },
    }).connect(master);
    bassInst.volume.value = -6;
  }

  function buildLead() {
    leadInst = new Tone.AMSynth({
      harmonicity: 2,
      oscillator:{ type:'sine' },
      envelope:{ attack:0.02, decay:0.3, sustain:0.5, release:0.5 },
      modulation:{ type:'square' },
      modulationEnvelope:{ attack:0.02, decay:0.2, sustain:0.4, release:0.3 },
    }).connect(reverb);
    leadInst.volume.value = -8;
  }

  function buildDrums() {
    kickDrum = new Tone.MembraneSynth({
      pitchDecay: 0.05, octaves: 6,
      oscillator:{ type:'sine' },
      envelope:{ attack:0.001, decay:0.42, sustain:0.0, release:1.4 },
    }).connect(master);
    kickDrum.volume.value = -3;

    snareDrum = new Tone.NoiseSynth({
      noise:{ type:'white' },
      envelope:{ attack:0.001, decay:0.16, sustain:0 },
    }).connect(master);
    snareDrum.volume.value = -12;

    hatClosed = new Tone.MetalSynth({
      frequency: 250, envelope:{ attack:0.001, decay:0.06, release:0.02 },
      harmonicity: 5.1, modulationIndex: 32, resonance: 4000, octaves: 1.5,
    }).connect(master);
    hatClosed.volume.value = -24;

    hatOpen = new Tone.MetalSynth({
      frequency: 250, envelope:{ attack:0.001, decay:0.3, release:0.1 },
      harmonicity: 5.1, modulationIndex: 32, resonance: 4000, octaves: 1.5,
    }).connect(master);
    hatOpen.volume.value = -20;
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
    disposeChordInst();
    switch (name) {
      case 'epiano':
        chordInst = new Tone.PolySynth(Tone.FMSynth, {
          harmonicity:2.5, modulationIndex:9,
          oscillator:{ type:'sine' },
          envelope:{ attack:0.01, decay:0.4, sustain:0.4, release:1.4 },
          modulation:{ type:'square' },
          modulationEnvelope:{ attack:0.02, decay:0.5, sustain:0, release:0.5 },
        }).connect(reverb);
        chordInst.volume.value = -10;
        break;
      case 'guitar':
        chordInst = new Tone.PolySynth(Tone.Synth, {
          oscillator:{ type:'fmsawtooth', modulationType:'sine', harmonicity:1 },
          envelope:{ attack:0.005, decay:0.7, sustain:0, release:1.0 },
        }).connect(reverb);
        chordInst.volume.value = -12;
        break;
      case 'strings':
        chordInst = new Tone.PolySynth(Tone.AMSynth, {
          harmonicity:1.5,
          oscillator:{ type:'sawtooth' },
          envelope:{ attack:0.5, decay:0.3, sustain:0.85, release:1.8 },
          modulation:{ type:'sine' },
          modulationEnvelope:{ attack:0.4, decay:0.2, sustain:0.7, release:1.0 },
        }).connect(reverb);
        chordInst.volume.value = -14;
        break;
      case 'pad':
        chordInst = new Tone.PolySynth(Tone.Synth, {
          oscillator:{ type:'sawtooth' },
          envelope:{ attack:0.8, decay:0.6, sustain:0.92, release:2.4 },
        }).connect(reverb);
        chordInst.volume.value = -18;
        break;
      case 'organ':
        chordInst = new Tone.PolySynth(Tone.Synth, {
          oscillator:{
            type: 'fatsawtooth', count: 3, spread: 18,
          },
          envelope:{ attack:0.02, decay:0.2, sustain:0.9, release:0.4 },
        }).connect(reverb);
        chordInst.volume.value = -12;
        break;
      case 'harp':
        chordInst = new Tone.PolySynth(Tone.PluckSynth, {
          attackNoise: 1.0, dampening: 4000, resonance: 0.96,
        }).connect(reverb);
        chordInst.volume.value = -8;
        break;
      case 'piano':
      default:
        chordInst = new Tone.PolySynth(Tone.Synth, {
          oscillator:{ type:'triangle' },
          envelope:{ attack:0.004, decay:0.5, sustain:0.25, release:1.4 },
        }).connect(reverb);
        chordInst.volume.value = -8;
    }
  }

  function clearTimers() {
    timers.forEach(t => clearTimeout(t));
    timers = [];
  }

  function stop() {
    stopFlag = true;
    clearTimers();
    try { chordInst && chordInst.releaseAll(); } catch(e){}
    try { bassInst && bassInst.triggerRelease(); } catch(e){}
    try { leadInst && leadInst.triggerRelease(); } catch(e){}
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

  // ── Simple chord-by-chord playback ───────────────────────────────────────
  async function playProgression(chords, opts) {
    await start();
    stop();
    stopFlag = false;
    opts = opts || {};
    const tempo = clamp(opts.tempo || 90, 40, 240);
    const style = opts.style || 'block';
    const withBass = opts.withBass !== false;
    const voicingMode = opts.voicing || 'smart';
    const beatMs = 60000 / tempo;
    const chordDur = beatMs * 2;
    const noteDur = chordDur / 1000 - 0.05;
    const totalMs = chords.length * chordDur;

    // Count-in if metronome on
    let chordsStartMs = 0;
    if (opts.metronome && opts.countIn) {
      scheduleClick(0, beatMs, 4, opts);
      chordsStartMs = 4 * beatMs;
    }
    if (opts.metronome) scheduleClick(chordsStartMs, beatMs, chords.length * 2, opts);

    let prevVoicing = null;
    let t = chordsStartMs;
    for (let i = 0; i < chords.length; i++) {
      const idx = i;
      const ch = chords[i];
      const voicing = voiceChord(ch, voicingMode, prevVoicing);
      prevVoicing = voicing;
      const bassNote = rootName(ch, 2);

      timers.push(setTimeout(() => {
        if (stopFlag) return;
        if (opts.onChordStart) opts.onChordStart(idx, ch);
        if (withBass) try { bassInst.triggerAttackRelease(bassNote, noteDur); } catch(e){}
        if (style === 'block') {
          try { chordInst.triggerAttackRelease(voicing, noteDur); } catch(e){}
        } else if (style === 'arpeggio') {
          const step = chordDur / voicing.length / 1000;
          voicing.forEach((n, j) => {
            timers.push(setTimeout(() => {
              if (!stopFlag) try { chordInst.triggerAttackRelease(n, step + 0.15); } catch(e){}
            }, j * step * 1000));
          });
        } else if (style === 'strum') {
          voicing.forEach((n, j) => {
            timers.push(setTimeout(() => {
              if (!stopFlag) try { chordInst.triggerAttackRelease(n, noteDur); } catch(e){}
            }, j * 28));
          });
        }
      }, t));

      t += chordDur;
    }
    timers.push(setTimeout(() => {
      if (stopFlag) return;
      if (opts.loop) { playProgression(chords, opts); return; }
      opts.onDone && opts.onDone();
    }, t + 50));
  }

  // ── Backing-track playback ───────────────────────────────────────────────
  async function playBacking(chords, opts) {
    await start();
    stop();
    stopFlag = false;
    opts = opts || {};
    const tempo = clamp(opts.tempo || 90, 40, 240);
    const pattern = opts.pattern || { drums:{kick:[0,8],snare:[4,12],hhClosed:[0,2,4,6,8,10,12,14],hhOpen:[]}, bass:'root', chords:'block' };
    const sixteenthMs = (60000 / tempo) / 4;
    const beatMs = sixteenthMs * 4;
    const stepsPerChord = 16;
    const swingAmt = (opts.swing != null ? opts.swing : (pattern.swing ? 0.18 : 0));
    const voicingMode = opts.voicing || 'smart';

    function swungOffset(step) {
      return swingAmt > 0 && (step % 2 === 1) ? sixteenthMs * swingAmt : 0;
    }

    let prevVoicing = null;
    let startOffset = 0;
    if (opts.metronome && opts.countIn) {
      scheduleClick(0, beatMs, 4, opts);
      startOffset = 4 * beatMs;
    }

    for (let ci = 0; ci < chords.length; ci++) {
      const ch = chords[ci];
      const next = chords[ci + 1];
      const chordStartMs = startOffset + ci * stepsPerChord * sixteenthMs;
      const voicing = voiceChord(ch, voicingMode, prevVoicing);
      prevVoicing = voicing;

      // Beat LED
      if (opts.onBeat) {
        for (let b = 0; b < 4; b++) {
          timers.push(setTimeout(() => { if (!stopFlag) opts.onBeat(b); }, chordStartMs + b * beatMs));
        }
      }

      // ── Drums ─────────────────────────────────────────────────────────────
      const d = pattern.drums || {};
      ['kick','snare','hhClosed','hhOpen'].forEach(layer => {
        (d[layer] || []).forEach(step => {
          const at = chordStartMs + step * sixteenthMs + swungOffset(step);
          timers.push(setTimeout(() => {
            if (stopFlag) return;
            try {
              if (layer === 'kick')          kickDrum.triggerAttackRelease('C1', '8n');
              else if (layer === 'snare')    snareDrum.triggerAttackRelease('16n');
              else if (layer === 'hhClosed') hatClosed.triggerAttackRelease('32n');
              else if (layer === 'hhOpen')   hatOpen.triggerAttackRelease('8n');
            } catch(e){}
          }, at));
        });
      });

      // Click track
      if (opts.metronome) scheduleClick(chordStartMs, beatMs, 4, opts);

      // Bass
      schedulesBass(pattern.bass, ch, next, chordStartMs, sixteenthMs);

      // Chord layer
      schedulesChords(pattern.chords, voicing, chordStartMs, sixteenthMs, swingAmt);

      // Card highlight
      timers.push(setTimeout(() => {
        if (!stopFlag && opts.onChordStart) opts.onChordStart(ci, ch);
      }, chordStartMs));
    }

    const total = startOffset + chords.length * stepsPerChord * sixteenthMs + 50;
    timers.push(setTimeout(() => {
      if (stopFlag) return;
      if (opts.loop) { playBacking(chords, opts); return; }
      opts.onDone && opts.onDone();
    }, total));
  }

  function schedulesBass(bassType, ch, next, startMs, stepMs) {
    const beat = stepMs * 4;
    const root = rootName(ch, 2);
    const fifthMidi = (ch.rootPc + 7) % 12;
    const fifth = noteAt(fifthMidi, 2, ch.preferFlats);
    const oct = rootName(ch, 3);
    const third = noteAt((ch.rootPc + ((ch.intervals[1] || 4))) % 12, 2, ch.preferFlats);

    function bassHit(midiName, atMs, dur) {
      timers.push(setTimeout(() => {
        if (stopFlag) return;
        try { bassInst.triggerAttackRelease(midiName, dur || '8n'); } catch(e){}
      }, startMs + atMs));
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

  function schedulesChords(chordType, voicing, startMs, stepMs, swing) {
    const beat = stepMs * 4;
    function hit(notes, atMs, dur) {
      timers.push(setTimeout(() => {
        if (stopFlag) return;
        try { chordInst.triggerAttackRelease(notes, dur || '4n'); } catch(e){}
      }, startMs + atMs));
    }

    switch (chordType) {
      case 'block':
        hit(voicing, 0, '2n');
        hit(voicing, beat * 2, '2n');
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
        voicing.forEach((n, i) => hit([n], i * stepMs * 2, '8n'));
        voicing.forEach((n, i) => hit([n], beat * 2 + i * stepMs * 2, '8n'));
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
      default:
        hit(voicing, 0, '2n');
    }
  }

  async function playWithMelody(chords, melody, opts) {
    await start();
    stop();
    stopFlag = false;
    opts = opts || {};
    const tempo = clamp(opts.tempo || 90, 40, 240);
    const beatMs = 60000 / tempo;
    const beatsPerChord = opts.beatsPerChord || 2;
    const chordDur = beatMs * beatsPerChord;
    const voicingMode = opts.voicing || 'smart';

    let startOffset = 0;
    if (opts.metronome && opts.countIn) {
      scheduleClick(0, beatMs, 4, opts);
      startOffset = 4 * beatMs;
    }

    let prevVoicing = null;
    for (let i = 0; i < chords.length; i++) {
      const ch = chords[i];
      const voicing = voiceChord(ch, voicingMode, prevVoicing);
      prevVoicing = voicing;
      timers.push(setTimeout(() => {
        if (stopFlag) return;
        if (opts.onChordStart) opts.onChordStart(i, ch);
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
        try { leadInst.triggerAttackRelease(ev.name, Math.max(0.05, dur)); } catch(e){}
      }, at));
    });

    const totalMs = startOffset + chords.length * chordDur + 100;
    timers.push(setTimeout(() => {
      if (stopFlag) return;
      if (opts.loop) { playWithMelody(chords, melody, opts); return; }
      opts.onDone && opts.onDone();
    }, totalMs));
  }

  // Preview a single chord for hover/click feedback
  async function previewChord(chord, voicingMode) {
    await start();
    if (!chordInst) return;
    const voicing = voiceChord(chord, voicingMode || 'smart');
    try { chordInst.triggerAttackRelease(voicing, 0.9); } catch(e){}
  }

  // Play single note (used by piano viz)
  async function previewNote(noteName) {
    await start();
    if (!chordInst) return;
    try { chordInst.triggerAttackRelease(noteName, 0.5); } catch(e){}
  }

  global.Audio = {
    start, setInstrument, playProgression, playBacking, playWithMelody,
    previewChord, previewNote, stop, voiceChord,
  };
})(typeof window !== 'undefined' ? window : globalThis);
