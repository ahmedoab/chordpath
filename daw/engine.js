/* ChordPath — daw/engine.js
 * The DAW's audio engine, written straight on the Web Audio API.
 *
 * Each track has a channel strip: three-band EQ, compressor, fader with
 * mute/solo, pan, and sends to a shared reverb and delay. Everything meets at
 * a limited master bus. Instruments are small synthesised voices that exist
 * only while a note sounds, which keeps a full song cheap to play and lets a
 * mixdown render many times faster than real time.
 *
 * The same Mixer builds the graph for live playback and for offline bounces,
 * and nothing in it is random at run time, so an export is what was heard
 * and two exports of the same project match to far below audibility.
 */
(function (global) {
  'use strict';

  const P = () => global.DawProject;
  const LOOKAHEAD = 0.12;            // seconds of audio scheduled ahead of the clock
  const CHAIN_DELAY = 0.012;         // look-ahead of the two compressors in every path
  const TIMER_SOURCE = 'let h=null;onmessage=e=>{if(e.data==="start"){if(!h)h=setInterval(()=>postMessage(0),25);}' +
    'else{clearInterval(h);h=null;}};';

  function hz(midi) { return 440 * Math.pow(2, (midi - 69) / 12); }
  function dbToGain(db) { return db <= -60 ? 0 : Math.pow(10, db / 20); }
  function toDb(x) { return x > 1e-8 ? 20 * Math.log10(x) : -160; }
  function prng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ── Voices ───────────────────────────────────────────────────────────────
  // An amplitude envelope on a fresh gain node. Returns the node and the time
  // the note has fully died away.
  function shaped(ctx, when, dur, env, peak) {
    const node = ctx.createGain();
    const p = node.gain;
    const off = when + Math.max(dur, env.a + 0.005);
    const sustain = peak * env.s;
    const tau = Math.max(0.001, env.d / 3);
    p.setValueAtTime(0, when);
    p.linearRampToValueAtTime(peak, when + env.a);
    p.setTargetAtTime(sustain, when + env.a, tau);
    p.setValueAtTime(sustain + (peak - sustain) * Math.exp(-(off - when - env.a) / tau), off);
    p.setTargetAtTime(0, off, Math.max(0.001, env.r / 4));
    return { node, end: off + env.r };
  }

  function osc(ctx, type, frequency, when, end, cents) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = frequency;
    if (cents) o.detune.value = cents;
    o.start(when);
    o.stop(end + 0.02);
    return o;
  }

  function lowpass(ctx, cutoff, q) {
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = cutoff;
    f.Q.value = q == null ? 0.7 : q;
    return f;
  }

  // Wires sources → (filter) → envelope → strip, and notes when the voice
  // will be over. `strip.live` lets Stop cut whatever is still ringing and
  // lets sweep() unhook voices that have finished.
  function launch(strip, sources, filter, amp) {
    const head = filter || amp.node;
    sources.forEach(s => s.connect(head));
    if (filter) filter.connect(amp.node);
    amp.node.connect(strip.input);
    strip.live.add({ amp: amp.node, sources, end: amp.end + 0.05 });
  }

  const VOICES = {
    piano(m, strip, f, when, dur, vel) {
      const amp = shaped(m.ctx, when, dur, { a: 0.004, d: 0.7, s: 0.18, r: 0.45 }, vel * 0.42);
      const body = osc(m.ctx, 'triangle', f, when, amp.end);
      const shine = osc(m.ctx, 'sine', f * 2, when, amp.end);
      const shineGain = m.ctx.createGain();
      shineGain.gain.setValueAtTime(0.3, when);
      shineGain.gain.setTargetAtTime(0.02, when, 0.12);
      shine.connect(shineGain);
      launch(strip, [body, shineGain], null, amp);
    },
    epiano(m, strip, f, when, dur, vel) {
      const amp = shaped(m.ctx, when, dur, { a: 0.005, d: 0.9, s: 0.3, r: 0.5 }, vel * 0.4);
      const carrier = osc(m.ctx, 'sine', f, when, amp.end);
      const mod = osc(m.ctx, 'sine', f, when, amp.end);
      const depth = m.ctx.createGain();
      depth.gain.setValueAtTime(f * 2.4 * vel, when);
      depth.gain.setTargetAtTime(f * 0.25, when, 0.18);
      mod.connect(depth);
      depth.connect(carrier.frequency);
      launch(strip, [carrier], null, amp);
    },
    guitar(m, strip, f, when, dur, vel) {
      const amp = shaped(m.ctx, when, dur, { a: 0.003, d: 0.9, s: 0.07, r: 0.35 }, vel * 0.3);
      const filter = lowpass(m.ctx, Math.min(7000, f * 9), 1.1);
      filter.frequency.setValueAtTime(Math.min(7000, f * 9), when);
      filter.frequency.setTargetAtTime(Math.min(2600, f * 2.2), when, 0.09);
      launch(strip, [osc(m.ctx, 'sawtooth', f, when, amp.end), osc(m.ctx, 'sawtooth', f, when, amp.end, 5)], filter, amp);
    },
    pluck(m, strip, f, when, dur, vel) {
      const amp = shaped(m.ctx, when, Math.min(dur, 0.25), { a: 0.002, d: 0.32, s: 0, r: 0.2 }, vel * 0.45);
      const filter = lowpass(m.ctx, Math.min(6000, f * 6), 0.9);
      filter.frequency.setTargetAtTime(Math.min(1800, f * 1.5), when, 0.07);
      launch(strip, [osc(m.ctx, 'triangle', f, when, amp.end), osc(m.ctx, 'sawtooth', f, when, amp.end, -3)], filter, amp);
    },
    strings(m, strip, f, when, dur, vel) {
      const amp = shaped(m.ctx, when, dur, { a: 0.22, d: 0.3, s: 0.85, r: 0.9 }, vel * 0.17);
      launch(strip, [osc(m.ctx, 'sawtooth', f, when, amp.end, -7), osc(m.ctx, 'sawtooth', f, when, amp.end, 7)],
        lowpass(m.ctx, 2400, 0.5), amp);
    },
    pad(m, strip, f, when, dur, vel) {
      const amp = shaped(m.ctx, when, dur, { a: 0.55, d: 0.5, s: 0.9, r: 1.5 }, vel * 0.12);
      launch(strip, [-10, 0, 10].map(c => osc(m.ctx, 'sawtooth', f, when, amp.end, c)), lowpass(m.ctx, 1500, 0.4), amp);
    },
    organ(m, strip, f, when, dur, vel) {
      const amp = shaped(m.ctx, when, dur, { a: 0.012, d: 0.1, s: 0.95, r: 0.08 }, vel * 0.2);
      const drawbars = [[1, 1], [2, 0.5], [3, 0.3], [4, 0.14]].map(([ratio, level]) => {
        const o = osc(m.ctx, 'sine', f * ratio, when, amp.end);
        const g = m.ctx.createGain();
        g.gain.value = level;
        o.connect(g);
        return { o, g };
      });
      drawbars.forEach(d => d.g.connect(amp.node));
      amp.node.connect(strip.input);
      strip.live.add({ amp: amp.node, sources: drawbars.map(d => d.o), end: amp.end + 0.05 });
    },
    bass(m, strip, f, when, dur, vel) {
      const amp = shaped(m.ctx, when, dur, { a: 0.008, d: 0.3, s: 0.6, r: 0.12 }, vel * 0.5);
      const filter = lowpass(m.ctx, 900, 1.8);
      filter.frequency.setValueAtTime(950, when);
      filter.frequency.setTargetAtTime(240, when, 0.1);
      launch(strip, [osc(m.ctx, 'sawtooth', f, when, amp.end), osc(m.ctx, 'sine', f, when, amp.end)], filter, amp);
    },
    lead(m, strip, f, when, dur, vel) {
      const amp = shaped(m.ctx, when, dur, { a: 0.02, d: 0.3, s: 0.65, r: 0.25 }, vel * 0.26);
      const main = osc(m.ctx, 'triangle', f, when, amp.end);
      const edge = osc(m.ctx, 'square', f, when, amp.end);
      const edgeGain = m.ctx.createGain();
      edgeGain.gain.value = 0.22;
      edge.connect(edgeGain);
      // A little vibrato once the note has settled.
      const lfo = osc(m.ctx, 'sine', 5.4, when, amp.end);
      const wobble = m.ctx.createGain();
      wobble.gain.setValueAtTime(0, when);
      wobble.gain.setTargetAtTime(7, when + 0.18, 0.15);
      lfo.connect(wobble);
      wobble.connect(main.detune);
      wobble.connect(edge.detune);
      launch(strip, [main, edgeGain], lowpass(m.ctx, 3200, 0.6), amp);
    },
    bell(m, strip, f, when, dur, vel) {
      const amp = shaped(m.ctx, when, Math.min(dur, 0.4), { a: 0.002, d: 1.1, s: 0, r: 0.9 }, vel * 0.3);
      const carrier = osc(m.ctx, 'sine', f, when, amp.end);
      const mod = osc(m.ctx, 'sine', f * 3.5, when, amp.end);
      const depth = m.ctx.createGain();
      depth.gain.setValueAtTime(f * 3, when);
      depth.gain.setTargetAtTime(0, when, 0.35);
      mod.connect(depth);
      depth.connect(carrier.frequency);
      launch(strip, [carrier], null, amp);
    },
  };

  // The drum kit: every piece is built from an oscillator or shared noise.
  function noiseHit(m, strip, when, vel, type, cutoff, decay, level) {
    const src = m.ctx.createBufferSource();
    src.buffer = m.noise;
    const filter = m.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = cutoff;
    const amp = m.ctx.createGain();
    amp.gain.setValueAtTime(vel * level, when);
    amp.gain.setTargetAtTime(0, when, decay / 4);
    src.connect(filter);
    filter.connect(amp);
    amp.connect(strip.input);
    src.start(when, (when * 37) % 1);
    src.stop(when + decay + 0.05);
    strip.live.add({ amp, sources: [src], end: when + decay + 0.05 });
  }

  function thump(m, strip, when, vel, from, to, sweep, decay, level) {
    const o = m.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(from, when);
    o.frequency.exponentialRampToValueAtTime(to, when + sweep);
    const amp = m.ctx.createGain();
    amp.gain.setValueAtTime(vel * level, when);
    amp.gain.setTargetAtTime(0, when + 0.01, decay / 4);
    o.connect(amp);
    amp.connect(strip.input);
    o.start(when);
    o.stop(when + decay + 0.05);
    strip.live.add({ amp, sources: [o], end: when + decay + 0.05 });
  }

  function drum(m, strip, midi, when, vel) {
    if (midi === 36 || midi === 35) thump(m, strip, when, vel, 150, 46, 0.11, 0.34, 0.95);
    else if (midi === 38 || midi === 40) {
      thump(m, strip, when, vel, 210, 150, 0.06, 0.12, 0.4);
      noiseHit(m, strip, when, vel, 'highpass', 1400, 0.17, 0.5);
    } else if (midi === 39) {
      [0, 0.011, 0.023].forEach(d => noiseHit(m, strip, when + d, vel, 'bandpass', 1300, 0.1, 0.45));
    } else if (midi === 42 || midi === 44) noiseHit(m, strip, when, vel, 'highpass', 7200, 0.05, 0.4);
    else if (midi === 46) noiseHit(m, strip, when, vel, 'highpass', 6800, 0.3, 0.38);
    else if (midi === 49 || midi === 51 || midi === 57) noiseHit(m, strip, when, vel, 'highpass', 4800, 1.3, 0.36);
    else thump(m, strip, when, vel, hz(midi + 12) * 1.5, hz(midi + 12), 0.12, 0.3, 0.7);
  }

  // ── Mixer: the audio graph for one context ───────────────────────────────
  function Mixer(ctx, withMeters) {
    this.ctx = ctx;
    this.withMeters = withMeters;
    this.strips = new Map();
    this.buffers = new Map();

    const rand = prng(20261011);
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const nd = this.noise.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = rand() * 2 - 1;

    this.master = ctx.createGain();
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -1.5;
    this.limiter.knee.value = 0;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.002;
    this.limiter.release.value = 0.12;
    this.master.connect(this.limiter);
    this.limiter.connect(ctx.destination);
    this.masterMeter = withMeters ? this.analyser(this.limiter) : null;

    // Reverb: a generated room, darker as it decays.
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.room(2.4);
    this.reverbIn = ctx.createGain();
    const reverbOut = ctx.createGain();
    reverbOut.gain.value = 3;
    this.reverbIn.connect(this.reverb);
    this.reverb.connect(reverbOut);
    reverbOut.connect(this.master);

    // Delay: dotted-eighth echoes that lose their top end as they repeat.
    this.delay = ctx.createDelay(2);
    this.delayIn = ctx.createGain();
    const feedback = ctx.createGain();
    feedback.gain.value = 0.34;
    const damp = lowpass(ctx, 3400, 0.5);
    this.delayIn.connect(this.delay);
    this.delay.connect(damp);
    damp.connect(feedback);
    feedback.connect(this.delay);
    damp.connect(this.master);
  }

  Mixer.prototype.room = function (seconds) {
    const sr = this.ctx.sampleRate;
    const n = Math.floor(sr * seconds);
    const buf = this.ctx.createBuffer(2, n, sr);
    for (let c = 0; c < 2; c++) {
      const rand = prng(4242 + c * 97);
      const data = buf.getChannelData(c);
      let lp = 0;
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        lp += (0.22 + 0.6 * Math.exp(-t * 1.6)) * ((rand() * 2 - 1) - lp);
        data[i] = t < 0.012 ? 0 : lp * Math.exp(-t * 3.1);
      }
    }
    return buf;
  };

  Mixer.prototype.analyser = function (source) {
    const a = this.ctx.createAnalyser();
    a.fftSize = 1024;
    source.connect(a);
    return { node: a, data: new Float32Array(a.fftSize) };
  };

  Mixer.prototype.makeStrip = function (track) {
    const ctx = this.ctx;
    const band = (type, frequency) => {
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = frequency;
      return f;
    };
    const strip = {
      kind: track.kind, instrument: track.instrument, live: new Set(),
      input: ctx.createGain(),
      low: band('lowshelf', 220), mid: band('peaking', 1100), high: band('highshelf', 4200),
      comp: ctx.createDynamicsCompressor(),
      fader: ctx.createGain(),
      pan: ctx.createStereoPanner(),
      reverbSend: ctx.createGain(),
      delaySend: ctx.createGain(),
      meter: null,
    };
    strip.mid.Q.value = 0.8;
    strip.fader.gain.value = 0;
    [strip.input, strip.low, strip.mid, strip.high, strip.comp, strip.fader, strip.pan]
      .reduce((a, b) => { a.connect(b); return b; });
    strip.pan.connect(this.master);
    strip.pan.connect(strip.reverbSend);
    strip.pan.connect(strip.delaySend);
    strip.reverbSend.connect(this.reverbIn);
    strip.delaySend.connect(this.delayIn);
    if (this.withMeters) strip.meter = this.analyser(strip.pan);
    return strip;
  };

  Mixer.prototype.dropStrip = function (strip) {
    this.cut(strip, this.ctx.currentTime);
    [strip.input, strip.low, strip.mid, strip.high, strip.comp, strip.fader, strip.pan, strip.reverbSend, strip.delaySend]
      .forEach(n => n.disconnect());
    if (strip.meter) strip.meter.node.disconnect();
  };

  // Makes the graph match the project's tracks and mixer settings.
  // `smooth` glides faders instead of jumping them (live playback).
  Mixer.prototype.sync = function (project, smooth) {
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const set = (param, value) => {
      if (smooth) param.setTargetAtTime(value, now, 0.015);
      else param.value = value;
    };
    this.project = project;
    set(this.master.gain, dbToGain(project.master));
    this.delay.delayTime.value = Math.min(1.9, (60 / project.tempo) * 0.75);

    const alive = new Set(project.tracks.map(t => t.id));
    this.strips.forEach((strip, id) => {
      if (!alive.has(id)) { this.dropStrip(strip); this.strips.delete(id); }
    });
    const anySolo = project.tracks.some(t => t.solo);
    project.tracks.forEach(track => {
      let strip = this.strips.get(track.id);
      if (!strip) {
        strip = this.makeStrip(track);
        this.strips.set(track.id, strip);
      }
      strip.kind = track.kind;
      strip.instrument = track.instrument;
      const silent = track.mute || (anySolo && !track.solo);
      set(strip.fader.gain, silent ? 0 : dbToGain(track.volume));
      set(strip.pan.pan, track.pan);
      set(strip.low.gain, track.fx.low);
      set(strip.mid.gain, track.fx.mid);
      set(strip.high.gain, track.fx.high);
      strip.comp.threshold.value = track.fx.comp ? -24 : 0;
      strip.comp.ratio.value = track.fx.comp ? 4 : 1;
      strip.comp.knee.value = track.fx.comp ? 8 : 0;
      set(strip.reverbSend.gain, track.fx.reverb);
      set(strip.delaySend.gain, track.fx.delay * 0.7);
    });
  };

  Mixer.prototype.setAudio = function (audioId, sampleRate, channels) {
    const buffer = this.ctx.createBuffer(channels.length, Math.max(1, channels[0].length), sampleRate);
    channels.forEach((data, c) => buffer.copyToChannel(data, c));
    this.buffers.set(audioId, buffer);
  };

  Mixer.prototype.note = function (trackId, midi, when, seconds, velocity) {
    const strip = this.strips.get(trackId);
    if (!strip || strip.kind === 'audio') return;
    if (strip.kind === 'drums') drum(this, strip, midi, when, velocity);
    else (VOICES[strip.instrument] || VOICES.piano)(this, strip, hz(midi), when, seconds, velocity);
  };

  // Starts (part of) an audio clip. `skip` is how far into the clip to begin.
  Mixer.prototype.playClip = function (trackId, clip, when, skip, spb) {
    const strip = this.strips.get(trackId);
    const buffer = this.buffers.get(clip.audioId);
    if (!strip || !buffer) return;
    const offset = clip.offset + skip;
    const seconds = Math.min(clip.length * spb - skip, buffer.duration - offset);
    if (seconds <= 0.001) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const amp = this.ctx.createGain();
    amp.gain.setValueAtTime(0, when);
    amp.gain.linearRampToValueAtTime(clip.gain, when + 0.004);
    amp.gain.setValueAtTime(clip.gain, when + Math.max(0.004, seconds - 0.006));
    amp.gain.linearRampToValueAtTime(0, when + seconds);
    src.connect(amp);
    amp.connect(strip.input);
    src.start(when, offset, seconds);
    strip.live.add({ amp, sources: [src], end: when + seconds });
  };

  Mixer.prototype.cut = function (strip, now) {
    strip.live.forEach(voice => {
      voice.amp.gain.cancelScheduledValues(now);
      voice.amp.gain.setTargetAtTime(0, now, 0.012);
      voice.sources.forEach(s => { try { s.stop(now + 0.08); } catch (e) { /* already stopped */ } });
    });
  };

  // Unhooks voices that ended before `time`. Done at known points on the
  // audio clock (not whenever the browser reports a node finished), so an
  // offline render comes out the same every time.
  Mixer.prototype.sweep = function (time) {
    this.strips.forEach(strip => strip.live.forEach(voice => {
      if (voice.end + 0.4 < time) { voice.amp.disconnect(); strip.live.delete(voice); }
    }));
  };

  Mixer.prototype.cutAll = function () {
    const now = this.ctx.currentTime;
    this.strips.forEach(strip => this.cut(strip, now));
  };

  // ── Flattening a project into time-ordered events ────────────────────────
  function flatten(project) {
    const notes = [];
    const clips = [];
    project.tracks.forEach(track => {
      if (track.kind === 'audio') {
        track.clips.forEach(clip => clips.push({ trackId: track.id, clip, beat: clip.start, end: clip.start + clip.length }));
        return;
      }
      track.clips.forEach(clip => clip.notes.forEach(n => {
        if (n.t >= clip.length) return;
        notes.push({ trackId: track.id, beat: clip.start + n.t, n: n.n, v: n.v, d: Math.min(n.d, clip.length - n.t) });
      }));
    });
    notes.sort((a, b) => a.beat - b.beat);
    clips.sort((a, b) => a.beat - b.beat);
    return { notes, clips };
  }

  function firstAtOrAfter(list, beat) {
    let lo = 0, hi = list.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid].beat < beat) lo = mid + 1; else hi = mid;
    }
    return lo;
  }

  // ── Live engine ──────────────────────────────────────────────────────────
  function Engine() {
    this.ctx = null;
    this.mixer = null;
    this.project = null;
    this.flat = { notes: [], clips: [] };
    this.audio = new Map();          // audio id → { sampleRate, channels }
    this.playing = false;
    this.paused = 0;                 // beat the playhead rests on
    this.anchors = [];               // [{ time, beat, spb }]: beat = anchor.beat + (t - anchor.time) / spb
    this.until = 0;                  // everything before this beat has been scheduled
    this.noteCursor = 0;
    this.clipCursor = 0;
    this.clickOn = false;
    this.timer = null;
    this.recording = null;
  }

  Engine.prototype.ensure = function () {
    if (this.ctx) return;
    const Ctx = global.AudioContext || global.webkitAudioContext;
    this.ctx = new Ctx({ latencyHint: 'interactive' });
    this.mixer = new Mixer(this.ctx, true);
    this.audio.forEach((a, id) => this.mixer.setAudio(id, a.sampleRate, a.channels));
    if (this.project) this.mixer.sync(this.project, false);
    try {
      this.timer = new Worker(URL.createObjectURL(new Blob([TIMER_SOURCE], { type: 'text/javascript' })));
      this.timer.onmessage = () => this.pump();
    } catch (e) {
      this.timer = null;             // fall back to an ordinary interval
    }
  };

  Engine.prototype.spb = function () { return 60 / this.project.tempo; };

  // Brings the engine in line with the project after any edit.
  Engine.prototype.sync = function (project) {
    const retimed = this.project && this.project.tempo !== project.tempo;
    const here = this.playing ? this.position() : this.paused;
    this.project = project;
    this.flat = flatten(project);
    if (this.mixer) this.mixer.sync(project, true);
    if (!this.playing) return;
    if (retimed) {
      // Re-anchor at the playhead so a tempo change takes effect at once.
      const now = this.ctx.currentTime;
      this.mixer.cutAll();
      this.anchors = [{ time: now + 0.03, beat: here, spb: this.spb() }];
      this.until = here;
      this.startRunningClips(here, now + 0.03);
    }
    this.noteCursor = firstAtOrAfter(this.flat.notes, this.until);
    this.clipCursor = firstAtOrAfter(this.flat.clips, this.until);
  };

  Engine.prototype.setAudio = function (audioId, sampleRate, channels) {
    this.audio.set(audioId, { sampleRate, channels });
    if (this.mixer) this.mixer.setAudio(audioId, sampleRate, channels);
  };
  Engine.prototype.hasAudio = function (audioId) { return this.audio.has(audioId); };
  // Lets go of every recording except those named, so a session that opens
  // one project after another does not hold all their audio in memory.
  Engine.prototype.keepOnlyAudio = function (audioIds) {
    const keep = new Set(audioIds);
    this.audio.forEach((a, id) => {
      if (keep.has(id)) return;
      this.audio.delete(id);
      if (this.mixer) this.mixer.buffers.delete(id);
    });
  };
  Engine.prototype.audioPeaks = function (audioId, buckets) {
    const a = this.audio.get(audioId);
    return a ? global.Wav.peaks(a.channels[0], buckets) : null;
  };
  Engine.prototype.audioSeconds = function (audioId) {
    const a = this.audio.get(audioId);
    return a ? a.channels[0].length / a.sampleRate : 0;
  };

  // Turns an audio file's bytes (WAV, MP3, OGG, FLAC…) into samples with the
  // decoders built into the app. Resolves to { sampleRate, channels }, at most
  // two channels; rejects when the bytes are not audio.
  Engine.prototype.decode = async function (bytes) {
    this.ensure();
    const buffer = await this.ctx.decodeAudioData(bytes);
    const channels = [];
    for (let c = 0; c < Math.min(2, buffer.numberOfChannels); c++) channels.push(new Float32Array(buffer.getChannelData(c)));
    if (!channels.length || !channels[0].length) throw new Error('The file holds no audio');
    return { sampleRate: buffer.sampleRate, channels };
  };

  Engine.prototype.anchorAt = function (time) {
    let a = this.anchors[0];
    for (let i = 1; i < this.anchors.length; i++) {
      if (this.anchors[i].time <= time) a = this.anchors[i];
    }
    return a;
  };
  Engine.prototype.beatAt = function (time) {
    const a = this.anchorAt(time);
    return a.beat + Math.max(0, time - a.time) / a.spb;
  };
  Engine.prototype.timeOf = function (beat) {
    const a = this.anchors[this.anchors.length - 1];
    return a.time + (beat - a.beat) * a.spb;
  };

  Engine.prototype.isPlaying = function () { return this.playing; };
  Engine.prototype.position = function () {
    return this.playing ? this.beatAt(this.ctx.currentTime) : this.paused;
  };

  // Audio clips that are already under way at `beat` start part-way through.
  Engine.prototype.startRunningClips = function (beat, when) {
    const spb = this.spb();
    this.flat.clips.forEach(c => {
      if (c.beat < beat && c.end > beat) this.mixer.playClip(c.trackId, c.clip, when, (beat - c.beat) * spb, spb);
    });
  };

  // Starts playback from the resting playhead. `at` delays the start to a
  // context time (used for the count-in before recording).
  Engine.prototype.play = async function (at) {
    this.ensure();
    if (this.ctx.state !== 'running') await this.ctx.resume();
    if (this.playing || !this.project) return;
    const when = at || this.ctx.currentTime + 0.06;
    this.anchors = [{ time: when, beat: this.paused, spb: this.spb() }];
    this.until = this.paused;
    this.noteCursor = firstAtOrAfter(this.flat.notes, this.until);
    this.clipCursor = firstAtOrAfter(this.flat.clips, this.until);
    this.startRunningClips(this.paused, when);
    this.playing = true;
    this.pump();
    if (this.timer) this.timer.postMessage('start');
    else this.interval = setInterval(() => this.pump(), 25);
  };

  Engine.prototype.stop = function () {
    if (!this.playing) return;
    this.paused = this.position();
    this.playing = false;
    if (this.timer) this.timer.postMessage('stop');
    else clearInterval(this.interval);
    this.mixer.cutAll();
    this.sweepLater(600);
  };

  Engine.prototype.sweepLater = function (ms) {
    setTimeout(() => { if (this.mixer) this.mixer.sweep(this.ctx.currentTime); }, ms);
  };

  Engine.prototype.seek = function (beat) {
    const was = this.playing;
    if (was) this.stop();
    this.paused = Math.max(0, beat);
    if (was) return this.play();
    return Promise.resolve();
  };

  Engine.prototype.setClick = function (on) { this.clickOn = !!on; };

  Engine.prototype.tick = function (when, accent) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = accent ? 1760 : 1175;
    g.gain.setValueAtTime(0.25, when);
    g.gain.setTargetAtTime(0, when, 0.012);
    o.connect(g);
    g.connect(this.mixer.limiter);
    o.start(when);
    o.stop(when + 0.08);
  };

  // Schedules everything between `from` and `to` beats on the current anchor.
  Engine.prototype.scheduleSpan = function (from, to) {
    const spb = this.anchors[this.anchors.length - 1].spb;
    const notes = this.flat.notes;
    while (this.noteCursor < notes.length && notes[this.noteCursor].beat < to) {
      const ev = notes[this.noteCursor++];
      if (ev.beat >= from) this.mixer.note(ev.trackId, ev.n, this.timeOf(ev.beat), ev.d * spb, ev.v);
    }
    const clips = this.flat.clips;
    while (this.clipCursor < clips.length && clips[this.clipCursor].beat < to) {
      const c = clips[this.clipCursor++];
      if (c.beat >= from) this.mixer.playClip(c.trackId, c.clip, this.timeOf(c.beat), 0, spb);
    }
    if (this.clickOn) {
      for (let b = Math.ceil(from - 1e-9); b < to; b++) this.tick(this.timeOf(b), b % 4 === 0);
    }
    this.until = to;
  };

  // Called every 25 ms while playing: keeps LOOKAHEAD seconds scheduled, and
  // jumps back to the loop start when the loop end comes into view.
  Engine.prototype.pump = function () {
    if (!this.playing) return;
    this.mixer.sweep(this.ctx.currentTime);
    const horizon = this.ctx.currentTime + LOOKAHEAD;
    if (this.anchors.length > 4) this.anchors = this.anchors.slice(-2);
    for (let guard = 0; guard < 64; guard++) {
      const a = this.anchors[this.anchors.length - 1];
      const to = a.beat + (horizon - a.time) / a.spb;
      if (to <= this.until) return;
      const loop = this.project.loop;
      if (loop.on && loop.end > loop.start && this.until < loop.end && to >= loop.end) {
        this.scheduleSpan(this.until, loop.end);
        const jumpTime = this.timeOf(loop.end);
        this.anchors.push({ time: jumpTime, beat: loop.start, spb: this.spb() });
        this.until = loop.start;
        this.noteCursor = firstAtOrAfter(this.flat.notes, loop.start);
        this.clipCursor = firstAtOrAfter(this.flat.clips, loop.start);
        this.startRunningClips(loop.start, jumpTime);
        continue;
      }
      this.scheduleSpan(this.until, to);
      return;
    }
  };

  // Plays one note now, for clicking keys and placing notes.
  Engine.prototype.audition = function (trackId, midi, velocity) {
    this.ensure();
    if (this.ctx.state !== 'running') this.ctx.resume();
    this.mixer.note(trackId, midi, this.ctx.currentTime + 0.01, 0.3, velocity || 0.8);
    if (!this.playing) this.sweepLater(4000);
  };

  // Current peak level of every track and the master, in dB.
  Engine.prototype.levels = function () {
    const tracks = {};
    if (!this.mixer) return { master: -160, tracks };
    const read = meter => {
      meter.node.getFloatTimeDomainData(meter.data);
      let peak = 0;
      for (let i = 0; i < meter.data.length; i++) {
        const a = meter.data[i] < 0 ? -meter.data[i] : meter.data[i];
        if (a > peak) peak = a;
      }
      return toDb(peak);
    };
    this.mixer.strips.forEach((strip, id) => { tracks[id] = read(strip.meter); });
    return { master: read(this.mixer.masterMeter), tracks };
  };

  // ── Recording ────────────────────────────────────────────────────────────
  // The worklet hands over every block of microphone samples stamped with
  // the sample frame it began on, so a take can be lined up exactly.
  const RECORDER_SOURCE = `
    class ChordPathRecorder extends AudioWorkletProcessor {
      process(inputs) {
        const input = inputs[0];
        if (input && input.length && input[0].length) {
          this.port.postMessage({ frame: currentFrame, channels: input.map(ch => ch.slice(0)) });
        }
        return true;
      }
    }
    registerProcessor('chordpath-recorder', ChordPathRecorder);`;

  // Opens the microphone, counts in one bar, then plays from the resting
  // playhead while capturing. Resolves once the microphone is open.
  Engine.prototype.startRecording = async function () {
    this.ensure();
    if (this.recording) return;
    if (this.ctx.state !== 'running') await this.ctx.resume();
    this.stop();
    const stream = await global.navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    if (!this.recorderLoaded) {
      await this.ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([RECORDER_SOURCE], { type: 'text/javascript' })));
      this.recorderLoaded = true;
    }
    const source = this.ctx.createMediaStreamSource(stream);
    const node = new global.AudioWorkletNode(this.ctx, 'chordpath-recorder', { numberOfInputs: 1, numberOfOutputs: 0 });
    const chunks = [];
    node.port.onmessage = e => chunks.push(e.data);
    source.connect(node);

    const spb = this.spb();
    const first = this.ctx.currentTime + 0.12;
    for (let i = 0; i < 4; i++) this.tick(first + i * spb, i === 0);
    const startTime = first + 4 * spb;
    this.recording = { stream, source, node, chunks, startTime, fromBeat: this.paused, sampleRate: this.ctx.sampleRate };
    await this.play(startTime);
  };

  // Stops and returns the take — { sampleRate, channels, startBeat, beats,
  // latency } — or null if nothing was captured.
  Engine.prototype.stopRecording = function () {
    const rec = this.recording;
    if (!rec) return null;
    this.recording = null;
    const endTime = this.ctx.currentTime;
    this.stop();
    this.paused = rec.fromBeat;
    rec.source.disconnect();
    rec.node.port.onmessage = null;
    rec.stream.getTracks().forEach(t => t.stop());

    const firstFrame = Math.round(rec.startTime * rec.sampleRate);
    const total = Math.round(endTime * rec.sampleRate) - firstFrame;
    if (total <= 0 || !rec.chunks.length) return null;
    const count = Math.min(2, rec.chunks[0].channels.length);
    const channels = [];
    for (let c = 0; c < count; c++) channels.push(new Float32Array(total));
    rec.chunks.forEach(chunk => {
      const at = chunk.frame - firstFrame;
      for (let c = 0; c < count; c++) {
        const data = chunk.channels[c] || chunk.channels[0];
        const from = Math.max(0, -at);
        const to = Math.min(data.length, total - at);
        if (to > from) channels[c].set(data.subarray(from, to), at + from);
      }
    });
    // The player heard the band late (output path) and was then heard late
    // again (input path); the clip skips that much of the take to line up.
    const latency = Math.min(0.5, (this.ctx.outputLatency || 0) + (this.ctx.baseLatency || 0) + CHAIN_DELAY);
    return {
      sampleRate: rec.sampleRate, channels, latency,
      startBeat: rec.fromBeat, beats: (total / rec.sampleRate) / this.spb(),
    };
  };

  Engine.prototype.isRecording = function () { return !!this.recording; };

  // ── Bouncing to a file ───────────────────────────────────────────────────
  // Renders a project off-line. options: { onlyTrackId, tail, sampleRate }.
  // Resolves to { sampleRate, channels } ready for Wav.encode.
  async function render(project, audio, options) {
    options = options || {};
    const sampleRate = options.sampleRate || 44100;
    const source = P().sanitize(JSON.parse(JSON.stringify(project)));
    if (options.onlyTrackId) {
      source.tracks = source.tracks.filter(t => t.id === options.onlyTrackId);
      source.tracks.forEach(t => { t.mute = false; t.solo = false; });
    }
    const spb = 60 / source.tempo;
    const seconds = Math.max(0.5, P().endBeat(source) * spb + (options.tail == null ? 2.5 : options.tail));
    const Offline = global.OfflineAudioContext || global.webkitOfflineAudioContext;
    const ctx = new Offline(2, Math.ceil(seconds * sampleRate), sampleRate);
    const mixer = new Mixer(ctx, false);
    (audio || new Map()).forEach((a, id) => mixer.setAudio(id, a.sampleRate, a.channels));
    mixer.sync(source, false);

    const flat = flatten(source);
    flat.clips.forEach(c => mixer.playClip(c.trackId, c.clip, c.beat * spb, 0, spb));
    // Notes are created a couple of seconds at a time while the render is
    // paused, so the graph never holds more than what is currently sounding.
    const CHUNK = 2;
    let cursor = 0;
    const scheduleUntil = time => {
      const beat = time / spb;
      while (cursor < flat.notes.length && flat.notes[cursor].beat < beat) {
        const ev = flat.notes[cursor++];
        mixer.note(ev.trackId, ev.n, ev.beat * spb, ev.d * spb, ev.v);
      }
    };
    scheduleUntil(CHUNK);
    for (let t = CHUNK; t < seconds; t += CHUNK) {
      const upTo = t + CHUNK;
      ctx.suspend(t).then(() => { mixer.sweep(t); scheduleUntil(upTo); ctx.resume(); });
    }
    const buffer = await ctx.startRendering();
    const channels = [];
    for (let c = 0; c < buffer.numberOfChannels; c++) channels.push(buffer.getChannelData(c));
    return { sampleRate: buffer.sampleRate, channels };
  }

  let live = null;
  function get() {
    if (!live) live = new Engine();
    return live;
  }

  global.DawEngine = { Engine, get, render, CHAIN_DELAY };
})(typeof window !== 'undefined' ? window : globalThis);
