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
 *
 * In the desktop app the mixing can be handed to the audio host instead
 * (daw/native.js): the tracks are still made here, but each one leaves by a
 * "tap" after its compressor, and the host puts it through its plugins and
 * does the fader, pan, sends, master and limiter, out through a sound card
 * of its choosing. Everything that differs for that is marked "tap" below.
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
  function Mixer(ctx, withMeters, tap) {
    this.ctx = ctx;
    this.withMeters = withMeters;
    this.tap = tap || null;          // set when the audio host is mixing
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
    this.clicks = tap ? tap.direct : this.limiter;     // where the metronome joins

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
      trackId: track.id, kind: track.kind, instrument: track.instrument, live: new Set(),
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
    [strip.input, strip.low, strip.mid, strip.high, strip.comp].reduce((a, b) => { a.connect(b); return b; });
    // Tapped, the strip's sound leaves here: its fader, pan and sends are the host's to do.
    const out = this.tap ? this.tap.input(track.id) : null;
    if (out) {
      strip.comp.connect(out.node, 0, out.index);
      return strip;
    }
    strip.comp.connect(strip.fader);
    strip.fader.connect(strip.pan);
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
    if (this.tap) this.tap.release(strip.trackId);
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
    if (this.tap) this.tap.master(project, dbToGain(project.master));

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
      if (this.tap) {
        this.tap.strip(track.id, {
          gain: silent ? 0 : dbToGain(track.volume), pan: track.pan, reverb: track.fx.reverb, echo: track.fx.delay * 0.7,
        });
      }
    });
    if (this.tap) this.tap.plugins(project);
  };

  Mixer.prototype.setAudio = function (audioId, sampleRate, channels) {
    const buffer = this.ctx.createBuffer(channels.length, Math.max(1, channels[0].length), sampleRate);
    channels.forEach((data, c) => buffer.copyToChannel(data, c));
    this.buffers.set(audioId, buffer);
  };

  Mixer.prototype.note = function (trackId, midi, when, seconds, velocity) {
    const strip = this.strips.get(trackId);
    if (!strip || strip.kind === 'audio') return;
    // A track with a plugin instrument on it is played by that, not by the voices here.
    if (this.tap && this.tap.plays(trackId)) { this.tap.note(trackId, midi, when, seconds, velocity); return; }
    if (strip.kind === 'drums') drum(this, strip, midi, when, velocity);
    else (VOICES[strip.instrument] || VOICES.piano)(this, strip, hz(midi), when, seconds, velocity);
  };

  // The name a stretched copy of a recording is kept under.
  function fitKey(audioId, rate) { return audioId + '@' + rate; }

  // Starts (part of) an audio clip. `lasts` is how long the clip's place on
  // the timeline is in seconds, `skip` how far into it to begin, and `rate`
  // how much its audio is stretched to follow the tempo (1 = not at all).
  // Until a stretched copy has been made the take plays as it was recorded.
  Mixer.prototype.playClip = function (trackId, clip, when, skip, lasts, rate) {
    const strip = this.strips.get(trackId);
    const fitted = rate && rate !== 1 ? this.buffers.get(fitKey(clip.audioId, rate)) : null;
    const buffer = fitted || this.buffers.get(clip.audioId);
    if (!strip || !buffer) return;
    const offset = clip.offset * (fitted ? rate : 1) + skip;
    const seconds = Math.min(lasts - skip, buffer.duration - offset);
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
    if (this.tap) this.tap.silence();
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
    this.inputId = '';               // input to record from; '' = the system default
    this.input = null;               // the open input: { id, stream, source, fellBack }
    this.monitoring = false;         // whether the input is being passed to the output
    this.monitorGain = null;
    this.native = null;              // the tap, while the audio host is mixing (daw/native.js)
    this.nativeConfig = null;        // what the host was asked to open
    this.onLost = null;              // called if the audio host stops while in use
  }

  Engine.prototype.ensure = function () {
    if (this.ctx) return;
    const Ctx = global.AudioContext || global.webkitAudioContext;
    this.ctx = new Ctx({ latencyHint: 'interactive' });
    this.mixer = new Mixer(this.ctx, true);
    this.adopt();
  };

  // Gives a new mixer the recordings and the project, and starts the clock that schedules playback.
  Engine.prototype.adopt = function () {
    this.audio.forEach((a, id) => this.mixer.setAudio(id, a.sampleRate, a.channels));
    if (this.project) this.mixer.sync(this.project, false);
    if (this.clocked) return;
    this.clocked = true;
    try {
      this.timer = new Worker(URL.createObjectURL(new Blob([TIMER_SOURCE], { type: 'text/javascript' })));
      this.timer.onmessage = () => this.pump();
    } catch (e) {
      this.timer = null;             // fall back to an ordinary interval
    }
  };

  // ── Handing the mixing to the audio host, and taking it back ─────────────
  // Stops everything and lets go of the audio context, so that another can
  // be made (at another sample rate, or with a tap).
  Engine.prototype.shutDown = async function () {
    if (this.recording) {
      this.recording.countIn.forEach(click => click.disconnect());
      this.recording = null;
    }
    if (this.playing) this.stop();
    this.monitoring = false;
    this.dropInput();
    this.monitorGain = null;
    this.recorderLoaded = false;
    const ctx = this.ctx, tap = this.native;
    this.ctx = null;
    this.mixer = null;
    this.native = null;
    if (tap) {
      await tap.rack.saveAll();                            // what was set in the plugins is not lost with them
      tap.dispose();
    }
    if (ctx) { try { await ctx.close(); } catch (e) { /* closed already */ } }
  };

  // How many strips the host's desk needs: one for each track and one to spare.
  function stripsFor(project) {
    const tracks = project ? project.tracks.length : 0;
    return tracks >= 32 ? 64 : tracks >= 16 ? 32 : 16;
  }

  // Opens a sound card in the audio host and sends the tracks there to be
  // mixed. config: { api, device, useInput, input, sampleRate, bufferFrames,
  // firstOutput, firstInput }. Resolves to what was opened. If the card will
  // not open the promise rejects and the built-in engine is left in charge.
  Engine.prototype.useNative = async function (config) {
    const N = global.NativeAudio;
    await N.connect();
    await this.shutDown();
    if (!this.watchingHost) {
      this.watchingHost = true;
      N.on('gone', () => this.lostHost());
    }
    const opened = await N.call('open', Object.assign({}, config, { strips: stripsFor(this.project) }));
    const Ctx = global.AudioContext || global.webkitAudioContext;
    let ctx;
    // The page's own output is not wanted: its sound leaves by the tap. Where
    // the browser allows a context with no output at all, that is what it gets.
    try { ctx = new Ctx({ sampleRate: opened.sampleRate, latencyHint: 'interactive', sinkId: { type: 'none' } }); }
    catch (e) { ctx = new Ctx({ sampleRate: opened.sampleRate, latencyHint: 'interactive' }); }
    try {
      const tap = await N.liveTap(ctx, opened);
      const mixer = new Mixer(ctx, false, tap);
      const room = await N.roomOf(mixer.reverb.buffer);
      await N.call('reverb', room[0], room[1]);
      this.ctx = ctx;
      this.native = tap;
      this.nativeConfig = config;
      this.mixer = mixer;
      this.adopt();
      if (ctx.state !== 'running') await ctx.resume();
      // The stream starts with the first block the tap sends on.
      await Promise.race([tap.started, new Promise(resolve => setTimeout(resolve, 3000))]);
    } catch (e) {
      this.ctx = null;
      this.mixer = null;
      this.native = null;
      try { await ctx.close(); } catch (closing) { /* closed already */ }
      N.call('close').catch(() => { /* gone with the host */ });
      throw e;
    }
    return opened;
  };

  // Back to mixing here, out through whatever the system plays through.
  Engine.prototype.useBuiltIn = async function () {
    const N = global.NativeAudio;
    await this.shutDown();
    this.nativeConfig = null;
    if (N && N.connected()) await N.call('close').catch(() => { /* gone with the host */ });
  };

  Engine.prototype.usingNative = function () { return !!this.native; };

  // The audio host stopped (a plugin crashed, most likely). The song goes on
  // with the built-in engine; whoever is listening is told.
  Engine.prototype.lostHost = function () {
    if (!this.native) return;
    const ctx = this.ctx;
    if (this.playing) {
      this.playing = false;
      if (this.timer) this.timer.postMessage('stop'); else clearInterval(this.interval);
    }
    this.recording = null;
    this.monitoring = false;
    this.native.dispose();
    this.native = null;
    this.ctx = null;
    this.mixer = null;
    if (ctx) ctx.close().catch(() => { /* closed already */ });
    if (this.onLost) this.onLost();
  };

  // A project that has outgrown the desk gets a bigger one.
  Engine.prototype.growNative = function () {
    if (!this.native || this.growing || !this.project || stripsFor(this.project) <= this.native.strips) return;
    this.growing = true;
    const done = () => { this.growing = false; };
    this.useNative(this.nativeConfig).then(done, done);
  };

  // Seconds per beat where `beat` falls: the song may change tempo as it goes.
  Engine.prototype.spbAt = function (beat) { return 60 / P().tempoAt(this.project, beat); };
  // How long the stretch from one beat to another lasts.
  Engine.prototype.secondsBetween = function (from, to) {
    return P().beatToSeconds(this.project, to) - P().beatToSeconds(this.project, from);
  };
  // The beat of the next tempo change after `beat`, or Infinity.
  Engine.prototype.nextChange = function (beat) {
    const change = (this.project.changes || []).find(c => c.beat > beat + 1e-9);
    return change ? change.beat : Infinity;
  };

  // Everything about a project that decides when its beats happen.
  function timingOf(project) {
    return [project.tempo].concat((project.changes || []).map(c => c.beat + ':' + c.tempo)).join(',');
  }

  // Brings the engine in line with the project after any edit.
  Engine.prototype.sync = function (project) {
    const retimed = this.project && timingOf(this.project) !== timingOf(project);
    const here = this.playing ? this.position() : this.paused;
    this.project = project;
    this.flat = flatten(project);
    if (this.mixer) this.mixer.sync(project, true);
    this.growNative();
    if (!this.playing) return;
    if (retimed) {
      // Re-anchor at the playhead so a tempo change takes effect at once.
      const now = this.ctx.currentTime;
      this.mixer.cutAll();
      this.anchors = [{ time: now + 0.03, beat: here, spb: this.spbAt(here) }];
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

  // ── Takes that follow the tempo ──────────────────────────────────────────
  // A take that follows the tempo plays from a stretched copy, kept beside
  // the recording under the recording's name and the rate. Making one takes
  // a moment, so it is done ahead of playing.
  function wantedFits(project) {
    const wanted = new Map();
    project.tracks.forEach(track => track.clips.forEach(clip => {
      const rate = clip.audioId ? P().clipRate(project, clip) : 1;
      const limits = global.Stretch.LIMITS;
      if (rate !== 1 && rate >= limits.least && rate <= limits.most) {
        wanted.set(fitKey(clip.audioId, rate), { key: fitKey(clip.audioId, rate), audioId: clip.audioId, rate });
      }
    }));
    return wanted;
  }

  // The stretched copies the project needs and does not have yet: [{ key, audioId, rate }].
  Engine.prototype.unfitted = function () {
    if (!this.project) return [];
    return Array.from(wantedFits(this.project).values()).filter(w => !this.audio.has(w.key) && this.audio.has(w.audioId));
  };

  // Makes them, and lets go of copies no clip uses any more. `between` is
  // called with progress from 0 to 1 and may return a promise. Resolves to
  // how many were made.
  Engine.prototype.prepare = async function (between) {
    if (!this.project) return 0;
    const wanted = wantedFits(this.project);
    this.audio.forEach((a, id) => {
      if (id.includes('@') && !wanted.has(id)) {
        this.audio.delete(id);
        if (this.mixer) this.mixer.buffers.delete(id);
      }
    });
    const todo = this.unfitted();
    for (let i = 0; i < todo.length; i++) {
      const raw = this.audio.get(todo[i].audioId);
      const channels = await global.Stretch.stretch(raw.channels, raw.sampleRate, todo[i].rate,
        part => (between ? between((i + part) / todo.length) : new Promise(resolve => setTimeout(resolve, 0))));
      if (this.audio.has(todo[i].audioId)) this.setAudio(todo[i].key, raw.sampleRate, channels);
    }
    return todo.length;
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
  // Where the song is. Through the audio host the sound comes out a little
  // after the page plays it, and this is where the listener is, not the page.
  Engine.prototype.position = function () {
    if (!this.playing) return this.paused;
    return this.beatAt(this.ctx.currentTime - (this.native ? this.native.heardAfter() : 0));
  };

  // Audio clips that are already under way at `beat` start part-way through.
  Engine.prototype.startRunningClips = function (beat, when) {
    this.flat.clips.forEach(c => {
      if (c.beat < beat && c.end > beat) {
        this.mixer.playClip(c.trackId, c.clip, when, this.secondsBetween(c.beat, beat), this.secondsBetween(c.beat, c.end),
          P().clipRate(this.project, c.clip));
      }
    });
  };

  // Starts playback from the resting playhead. `at` delays the start to a
  // context time (used for the count-in before recording).
  Engine.prototype.play = async function (at) {
    this.ensure();
    if (this.ctx.state !== 'running') await this.ctx.resume();
    if (this.playing || !this.project) return;
    const when = at || this.ctx.currentTime + 0.06;
    this.anchors = [{ time: when, beat: this.paused, spb: this.spbAt(this.paused) }];
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
    setTimeout(() => { if (this.mixer && this.ctx) this.mixer.sweep(this.ctx.currentTime); }, ms);
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
    g.connect(this.mixer.clicks);
    o.start(when);
    o.stop(when + 0.08);
    return o;
  };

  // Schedules everything between `from` and `to` beats on the current anchor.
  // The span never runs past a tempo change: pump() ends it there.
  Engine.prototype.scheduleSpan = function (from, to) {
    const notes = this.flat.notes;
    while (this.noteCursor < notes.length && notes[this.noteCursor].beat < to) {
      const ev = notes[this.noteCursor++];
      if (ev.beat >= from) this.mixer.note(ev.trackId, ev.n, this.timeOf(ev.beat), this.secondsBetween(ev.beat, ev.beat + ev.d), ev.v);
    }
    const clips = this.flat.clips;
    while (this.clipCursor < clips.length && clips[this.clipCursor].beat < to) {
      const c = clips[this.clipCursor++];
      if (c.beat >= from) {
        this.mixer.playClip(c.trackId, c.clip, this.timeOf(c.beat), 0, this.secondsBetween(c.beat, c.end), P().clipRate(this.project, c.clip));
      }
    }
    if (this.clickOn) {
      P().clicksBetween(this.project, from, to).forEach(click => this.tick(this.timeOf(click.beat), click.accent));
    }
    this.until = to;
  };

  // Called every 25 ms while playing: keeps LOOKAHEAD seconds scheduled. When
  // the end of the loop comes into view it jumps back to the loop start, and
  // when a tempo change does it carries on from there at the new tempo.
  Engine.prototype.pump = function () {
    if (!this.playing) return;
    this.mixer.sweep(this.ctx.currentTime);
    const horizon = this.ctx.currentTime + LOOKAHEAD;
    if (this.anchors.length > 8) this.anchors = this.anchors.slice(-4);
    for (let guard = 0; guard < 64; guard++) {
      const a = this.anchors[this.anchors.length - 1];
      const to = a.beat + (horizon - a.time) / a.spb;
      if (to <= this.until) return;
      const loop = this.project.loop;
      const loopEnd = loop.on && loop.end > loop.start && this.until < loop.end ? loop.end : Infinity;
      const turn = Math.min(loopEnd, this.nextChange(this.until));
      if (to < turn) {
        this.scheduleSpan(this.until, to);
        return;
      }
      this.scheduleSpan(this.until, turn);
      const time = this.timeOf(turn);
      const from = turn === loopEnd ? loop.start : turn;
      this.anchors.push({ time, beat: from, spb: this.spbAt(from) });
      if (turn !== loopEnd) continue;
      this.until = loop.start;
      this.noteCursor = firstAtOrAfter(this.flat.notes, loop.start);
      this.clipCursor = firstAtOrAfter(this.flat.clips, loop.start);
      this.startRunningClips(loop.start, time);
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
    if (this.native) return this.native.levels();
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

  // The audio inputs this computer offers, as [{ id, name }]. The system only
  // gives their real names once recording has been allowed.
  Engine.prototype.inputs = async function () {
    if (this.native) return [];                            // the input is the sound card's own, chosen with the card
    const devices = await global.navigator.mediaDevices.enumerateDevices();
    return devices
      .filter(d => d.kind === 'audioinput' && d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications')
      .map((d, i) => ({ id: d.deviceId, name: d.label || 'Input ' + (i + 1) }));
  };
  // Chooses the input to record from; '' is whichever the system has as its
  // default. If the input is being listened to, listening moves to the new one.
  Engine.prototype.setInput = async function (deviceId) {
    this.inputId = typeof deviceId === 'string' ? deviceId : '';
    if (!this.monitoring || this.recording) return { fellBack: false };
    try {
      return { fellBack: (await this.openInput()).fellBack };
    } catch (e) {
      this.monitoring = false;                             // nothing left to listen to
      throw e;
    }
  };

  // The input is opened once and shared by recording and monitoring, and let
  // go of when neither needs it. Resolves to { stream, source, fellBack }:
  // fellBack is true when the chosen input was not there and the default one
  // is being used instead.
  Engine.prototype.openInput = async function () {
    if (this.input && this.input.id === this.inputId) return this.input;
    this.dropInput();                                      // another input was chosen: move over to it
    // Voice-call processing would mangle music, so it is all switched off.
    const plain = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
    const open = audio => global.navigator.mediaDevices.getUserMedia({ audio });
    let stream, fellBack = false;
    try {
      stream = await open(this.inputId ? Object.assign({ deviceId: { exact: this.inputId } }, plain) : plain);
    } catch (e) {
      if (!this.inputId) throw e;
      stream = await open(plain);
      fellBack = true;
    }
    this.input = { id: this.inputId, stream, source: this.ctx.createMediaStreamSource(stream), fellBack };
    if (this.monitoring) this.input.source.connect(this.monitorGain);
    return this.input;
  };
  Engine.prototype.dropInput = function () {
    if (!this.input) return;
    this.input.source.disconnect();
    this.input.stream.getTracks().forEach(t => t.stop());
    this.input = null;
  };
  // Lets go of the input unless a take or monitoring still needs it.
  Engine.prototype.closeInput = function () {
    if (!this.recording && !this.monitoring) this.dropInput();
  };

  // Monitoring: the input is passed straight to the output so players can
  // hear themselves. It is never part of a bounce, and a take records the
  // input itself, not this copy of it.
  Engine.prototype.setMonitor = async function (on, trackId) {
    this.ensure();
    if (this.native) return this.setNativeMonitor(on, trackId);
    if (!on) {
      if (this.monitoring && this.input) this.input.source.disconnect(this.monitorGain);
      this.monitoring = false;
      this.closeInput();
      return { fellBack: false };
    }
    if (this.monitoring) return { fellBack: this.input.fellBack };
    if (this.ctx.state !== 'running') await this.ctx.resume();
    const input = await this.openInput();
    if (!this.monitorGain) {
      this.monitorGain = this.ctx.createGain();
      this.monitorGain.connect(this.mixer.master);
    }
    input.source.connect(this.monitorGain);
    this.monitoring = true;
    return { fellBack: input.fellBack };
  };
  Engine.prototype.isMonitoring = function () { return this.monitoring; };

  // Through the audio host the input is heard through a track's own strip,
  // plugins and all, with only the card's delay: a guitar through an
  // amplifier plugin can be played like that. `trackId` is that track; with
  // none, a strip kept spare is used.
  Engine.prototype.setNativeMonitor = async function (on, trackId) {
    const N = global.NativeAudio, tap = this.native;
    if (!on) {
      await N.call('monitor', -1, 1);
      this.monitoring = false;
      return { fellBack: false };
    }
    if (!tap.opened.inputs) throw new Error('The sound card has no input open');
    let strip = trackId == null ? null : tap.slotOf(trackId);
    if (strip == null) {
      strip = tap.spare;
      await N.call('strip', strip, { active: true, gain: 1, pan: 0, reverb: 0, echo: 0 });
    }
    await N.call('monitor', strip, 1);
    this.monitoring = true;
    return { fellBack: false };
  };

  // Opens the input, counts in one bar, then plays from the resting playhead
  // while capturing. Resolves once the input is open, to { fellBack }.
  Engine.prototype.startRecording = async function () {
    this.ensure();
    if (this.recording) return { fellBack: false };
    if (this.ctx.state !== 'running') await this.ctx.resume();
    this.stop();
    if (this.native) return this.startNativeRecording();
    const input = await this.openInput();
    if (!this.recorderLoaded) {
      await this.ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([RECORDER_SOURCE], { type: 'text/javascript' })));
      this.recorderLoaded = true;
    }
    const node = new global.AudioWorkletNode(this.ctx, 'chordpath-recorder', { numberOfInputs: 1, numberOfOutputs: 0 });
    const chunks = [];
    node.port.onmessage = e => chunks.push(e.data);
    input.source.connect(node);

    // The count-in is one bar of the time and tempo in force at the playhead.
    const bar = P().positionAt(this.project, this.paused);
    const every = this.spbAt(this.paused) * 4 / bar.den;
    const first = this.ctx.currentTime + 0.12;
    const countIn = [];
    for (let i = 0; i < bar.num; i++) countIn.push(this.tick(first + i * every, i === 0));
    const startTime = first + bar.num * every;
    this.recording = {
      stream: input.stream, source: input.source, node, chunks, countIn, startTime,
      fromBeat: this.paused, sampleRate: this.ctx.sampleRate,
    };
    await this.play(startTime);
    return { fellBack: input.fellBack };
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
    rec.source.disconnect(rec.node);
    rec.node.port.onmessage = null;
    this.closeInput();                                     // unless it is still being listened to
    rec.countIn.forEach(click => click.disconnect());      // any clicks still to come stay silent

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
    const endsAt = P().secondsToBeat(this.project, P().beatToSeconds(this.project, rec.fromBeat) + total / rec.sampleRate);
    return { sampleRate: rec.sampleRate, channels, latency, startBeat: rec.fromBeat, beats: endsAt - rec.fromBeat };
  };

  // Recording through the audio host: the card's input is kept by the host,
  // which knows exactly which frame of the stream each sample arrived with.
  Engine.prototype.startNativeRecording = async function () {
    const N = global.NativeAudio, tap = this.native;
    if (!tap.opened.inputs) throw new Error('The sound card has no input open');
    await N.call('record', true);
    const bar = P().positionAt(this.project, this.paused);
    const every = this.spbAt(this.paused) * 4 / bar.den;
    const first = this.ctx.currentTime + 0.12;
    const countIn = [];
    for (let i = 0; i < bar.num; i++) countIn.push(this.tick(first + i * every, i === 0));
    const startTime = first + bar.num * every;
    this.recording = { viaHost: true, countIn, startTime, fromBeat: this.paused, sampleRate: this.ctx.sampleRate };
    await this.play(startTime);
    return { fellBack: false };
  };

  // Stops recording and resolves to the take (see stopRecording), or null.
  // Works whichever engine is recording.
  Engine.prototype.finishTake = async function () {
    const rec = this.recording;
    if (!rec || !rec.viaHost) return this.stopRecording();
    const N = global.NativeAudio, tap = this.native;
    this.recording = null;
    const endTime = this.ctx.currentTime;
    this.stop();
    this.paused = rec.fromBeat;
    rec.countIn.forEach(click => click.disconnect());
    let got = null;
    try { got = await N.call('take'); } catch (e) { got = null; }
    if (!got || !got.left || !got.left.length || !tap || tap.origin == null) return null;

    const rate = rec.sampleRate;
    const firstFrame = Math.round(rec.startTime * rate);
    const total = Math.round(endTime * rate) - firstFrame;
    if (total <= 0) return null;
    // A sample that arrived while stream frame S was being mixed was played to
    // what the player was hearing then: the stream as it was before the
    // desk's delay, the card's way out and the card's way back in.
    const status = N.status();
    const behind = (status ? status.latency : 0) + tap.opened.outputLatency + tap.opened.inputLatency;
    const shift = tap.origin + got.streamAt - behind - tap.match.strip.delay - firstFrame;
    const channels = [new Float32Array(total), new Float32Array(total)];
    [got.left, got.right].forEach((data, c) => {
      const from = Math.max(0, -shift), to = Math.min(data.length, total - shift);
      if (to > from) channels[c].set(data.subarray(from, to), shift + from);
    });
    const endsAt = P().secondsToBeat(this.project, P().beatToSeconds(this.project, rec.fromBeat) + total / rate);
    return { sampleRate: rate, channels, latency: 0, startBeat: rec.fromBeat, beats: endsAt - rec.fromBeat, dropouts: got.dropouts || 0 };
  };

  Engine.prototype.isRecording = function () { return !!this.recording; };
  // How long the take is so far; nothing during the count-in.
  Engine.prototype.recordedSeconds = function () {
    return this.recording ? Math.max(0, this.ctx.currentTime - this.recording.startTime) : 0;
  };

  // ── Bouncing to a file ───────────────────────────────────────────────────
  // Renders a project off-line. options: { onlyTrackId, tail, sampleRate }.
  // Resolves to { sampleRate, channels } ready for Wav.encode.
  async function render(project, audio, options) {
    options = options || {};
    // While the audio host is mixing, a mixdown goes through it too: same desk, same plugins.
    if (live && live.native && !options.builtIn) return renderThroughHost(project, audio, options, live.native);
    const sampleRate = options.sampleRate || 44100;
    const source = P().sanitize(JSON.parse(JSON.stringify(project)));
    if (options.onlyTrackId) {
      source.tracks = source.tracks.filter(t => t.id === options.onlyTrackId);
      source.tracks.forEach(t => { t.mute = false; t.solo = false; });
    }
    const timeOf = beat => P().beatToSeconds(source, beat);
    const seconds = Math.max(0.5, timeOf(P().endBeat(source)) + (options.tail == null ? 2.5 : options.tail));
    const Offline = global.OfflineAudioContext || global.webkitOfflineAudioContext;
    const ctx = new Offline(2, Math.ceil(seconds * sampleRate), sampleRate);
    const mixer = new Mixer(ctx, false);
    // Takes that follow the tempo are stretched first, unless a copy is already to hand.
    const sounds = new Map(audio || []);
    for (const want of wantedFits(source).values()) {
      const raw = sounds.get(want.audioId);
      if (raw && !sounds.has(want.key)) {
        sounds.set(want.key, { sampleRate: raw.sampleRate, channels: await global.Stretch.stretch(raw.channels, raw.sampleRate, want.rate) });
      }
    }
    sounds.forEach((a, id) => mixer.setAudio(id, a.sampleRate, a.channels));
    mixer.sync(source, false);

    const flat = flatten(source);
    flat.clips.forEach(c => mixer.playClip(c.trackId, c.clip, timeOf(c.beat), 0, timeOf(c.end) - timeOf(c.beat), P().clipRate(source, c.clip)));
    // Notes are created a couple of seconds at a time while the render is
    // paused, so the graph never holds more than what is currently sounding.
    const CHUNK = 2;
    let cursor = 0;
    const scheduleUntil = time => {
      const beat = P().secondsToBeat(source, time);
      while (cursor < flat.notes.length && flat.notes[cursor].beat < beat) {
        const ev = flat.notes[cursor++];
        const starts = timeOf(ev.beat);
        mixer.note(ev.trackId, ev.n, starts, timeOf(ev.beat + ev.d) - starts, ev.v);
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

  // The same render with the audio host doing the mixing. The tracks are made
  // here, off-line, a stretch at a time; each stretch is handed to the host,
  // which puts it through the plugins and the desk and hands back the mix.
  async function renderThroughHost(project, audio, options, liveTap) {
    const N = global.NativeAudio;
    const rate = liveTap.rate;
    const source = P().sanitize(JSON.parse(JSON.stringify(project)));
    if (options.onlyTrackId) {
      source.tracks = source.tracks.filter(t => t.id === options.onlyTrackId);
      source.tracks.forEach(t => { t.mute = false; t.solo = false; });
    }
    const timeOf = beat => P().beatToSeconds(source, beat);
    const wanted = Math.ceil(Math.max(0.5, timeOf(P().endBeat(source)) + (options.tail == null ? 2.5 : options.tail)) * rate);
    const strips = Math.max(1, source.tracks.length);
    const rack = liveTap.rack;
    await rack.work;                                       // plugins still loading are waited for
    const hosts = entries => (entries || []).map(e => rack.loaded.get(e.id)).filter(p => p && p.hostId).map(p => p.hostId);

    await N.call('mixBegin', { strips });
    try {
      const match = await N.measure(rate);
      await N.call('mixMaster', N.masterFor(source, dbToGain(source.master), match));
      for (let i = 0; i < source.tracks.length; i++) await N.call('mixChain', i, hosts(source.tracks[i].plugins));
      // Plugins that take time make the whole mix late by so much: that much
      // more is rendered, and cut from the front. (The limiter's own short
      // delay stays, as it does when the mixing is done here.)
      const late = Math.max(0, await N.call('mixChain', -1, options.onlyTrackId ? [] : hosts(source.masterPlugins)) - match.limiter.delay);
      await N.call('mixTransport', { tempo: source.tempo, playing: true, position: 0, meterNum: source.meter.num, meterDen: source.meter.den });

      const LUMP = N.MIX_FRAMES;
      const frames = Math.ceil((wanted + late) / LUMP) * LUMP;
      const Offline = global.OfflineAudioContext || global.webkitOfflineAudioContext;
      const ctx = new Offline(1, frames, rate);
      const tap = await N.mixTap(ctx, strips, rack);
      const mixer = new Mixer(ctx, false, tap);
      const sounds = new Map(audio || []);
      for (const want of wantedFits(source).values()) {
        const raw = sounds.get(want.audioId);
        if (raw && !sounds.has(want.key)) {
          sounds.set(want.key, { sampleRate: raw.sampleRate, channels: await global.Stretch.stretch(raw.channels, raw.sampleRate, want.rate) });
        }
      }
      sounds.forEach((a, id) => mixer.setAudio(id, a.sampleRate, a.channels));
      mixer.sync(source, false);
      for (const [slot, settings] of tap.settings) await N.call('mixStrip', slot, settings);
      const room = await N.roomOf(mixer.reverb.buffer);
      await N.call('mixReverb', room[0], room[1]);

      const flat = flatten(source);
      flat.clips.forEach(c => mixer.playClip(c.trackId, c.clip, timeOf(c.beat), 0, timeOf(c.end) - timeOf(c.beat), P().clipRate(source, c.clip)));
      let cursor = 0;
      const scheduleUntil = time => {
        const beat = P().secondsToBeat(source, time);
        while (cursor < flat.notes.length && flat.notes[cursor].beat < beat) {
          const ev = flat.notes[cursor++];
          const starts = timeOf(ev.beat);
          mixer.note(ev.trackId, ev.n, starts, timeOf(ev.beat + ev.d) - starts, ev.v);
        }
      };

      const left = new Float32Array(frames), right = new Float32Array(frames);
      let done = 0;
      // Everything the tap has made up to `upTo` frames goes through the desk.
      const pass = async upTo => {
        for (let tries = 0; tap.received < upTo && tries < 5000; tries++) await new Promise(resolve => setTimeout(resolve, 1));
        if (tap.received < upTo) throw new Error('The render stalled');
        while (tap.notes.length) await N.call('mixNotes', tap.notes.splice(0, 2000));
        const lump = tap.take();
        if (!lump.frames) return;
        const mixed = await N.call('mixProcess', lump.samples, lump.frames, lump.slots);
        left.set(mixed.left, done);
        right.set(mixed.right, done);
        done += lump.frames;
      };

      const CHUNK = LUMP * Math.max(1, Math.round(2 * rate / LUMP));    // about two seconds, in whole lumps
      let failed = null;
      scheduleUntil(CHUNK / rate);
      for (let f = CHUNK; f < frames; f += CHUNK) {
        ctx.suspend(f / rate).then(async () => {
          try {
            mixer.sweep(f / rate);
            scheduleUntil((f + CHUNK) / rate);
            await pass(f);
          } catch (e) {
            failed = failed || e;
          }
          ctx.resume();
        });
      }
      await ctx.startRendering();
      if (failed) throw failed;
      await pass(frames);
      return { sampleRate: rate, channels: [left.slice(late, late + wanted), right.slice(late, late + wanted)] };
    } finally {
      await N.call('mixEnd').catch(() => { /* gone with the host */ });
    }
  }

  let live = null;
  function get() {
    if (!live) live = new Engine();
    return live;
  }

  global.DawEngine = { Engine, get, render, CHAIN_DELAY };
})(typeof window !== 'undefined' ? window : globalThis);
