/* ChordPath — daw/native.js
 * The page's side of the audio host: the separate program that holds the
 * sound card and the plugins (desktop/audiohost.js, native/).
 *
 * When the host is in use the page still makes every track's sound itself —
 * notes, recordings, tone controls, compressor — but instead of mixing them
 * it sends each track on, untouched, through a "tap". The host puts each one
 * through its plugins and does the rest of the mixing: faders, pans, reverb,
 * echo, master, limiter. This file is that hand-over:
 *
 *   the line   — requests to the host and news from it
 *   the tap    — an audio worklet that sends the tracks' audio straight from
 *                the audio thread to the host (or, for a mixdown, back here)
 *   the rack   — which plugin of the project is which plugin in the host,
 *                kept in step as the project changes, and their settings
 *                saved as they are changed
 *
 * The engine (daw/engine.js) uses these; nothing here draws anything.
 */
(function (global) {
  'use strict';

  const desktop = () => (global.Desktop && global.Desktop.audio) || null;
  const store = () => global.DawStore;
  const QUIET_AFTER_MS = 600;       // how long after a plugin was last touched its settings are saved

  // ── The line to the host ─────────────────────────────────────────────────
  const link = { port: null, connecting: null, watching: false, pending: new Map(), nextId: 1, listeners: new Map(), status: null };

  function supported() { return !!desktop(); }
  function connected() { return !!link.port; }

  function on(event, handler) {
    if (!link.listeners.has(event)) link.listeners.set(event, []);
    link.listeners.get(event).push(handler);
  }
  function off(event, handler) {
    const list = link.listeners.get(event) || [];
    const at = list.indexOf(handler);
    if (at >= 0) list.splice(at, 1);
  }
  function emit(event, payload) {
    (link.listeners.get(event) || []).slice().forEach(handler => {
      try { handler(payload); } catch (e) { /* one listener's trouble is not another's */ }
    });
  }

  function heard(e) {
    const m = e.data;
    if (!m) return;
    if (m.event) {
      if (m.event === 'status') link.status = m.status;
      emit(m.event, m);
      return;
    }
    const waiting = link.pending.get(m.id);
    if (!waiting) return;
    link.pending.delete(m.id);
    if (m.error) waiting.reject(new Error(m.error));
    else waiting.resolve(m.result);
  }

  // The host has gone (it crashed, or was closed): everyone waiting is told.
  function dropped(reason) {
    const port = link.port;
    link.port = null;
    link.status = null;
    link.pending.forEach(waiting => waiting.reject(new Error(reason)));
    link.pending.clear();
    if (port) {
      try { port.close(); } catch (e) { /* closed already */ }
      emit('gone', reason);
    }
  }

  function connect() {
    if (link.port) return Promise.resolve();
    if (link.connecting) return link.connecting;
    const audio = desktop();
    if (!audio) return Promise.reject(new Error('Sound cards and plugins need the desktop app'));
    if (!link.watching) {
      link.watching = true;
      audio.onGone(() => dropped('The audio engine stopped'));
    }
    link.connecting = new Promise((resolve, reject) => {
      const arrived = e => {
        if (e.source !== global || !e.data || e.data.chordpath !== 'audio-ports' || !e.ports || !e.ports.length) return;
        global.removeEventListener('message', arrived);
        link.port = e.ports[0];
        link.port.onmessage = heard;
        resolve();
      };
      global.addEventListener('message', arrived);
      const failed = error => { global.removeEventListener('message', arrived); reject(error); };
      audio.connect().then(answer => {
        if (!answer || !answer.ok) failed(new Error((answer && answer.error) || 'The audio engine could not start'));
      }, failed);
    });
    const done = () => { link.connecting = null; };
    link.connecting.then(done, done);
    return link.connecting;
  }

  function call(method) {
    const args = Array.prototype.slice.call(arguments, 1);
    return new Promise((resolve, reject) => {
      if (!link.port) { reject(new Error('The audio engine is not running')); return; }
      const id = link.nextId++;
      link.pending.set(id, { resolve, reject });
      link.port.postMessage({ id, method, args });
    });
  }

  function info() {
    const audio = desktop();
    return audio ? audio.info() : Promise.resolve({ available: false });
  }
  function installed(rescan) {
    const audio = desktop();
    return audio ? audio.plugins(rescan === true) : Promise.resolve({ plugins: [], failed: [] });
  }

  // ── The tap ──────────────────────────────────────────────────────────────
  // One input for every strip and a last one for the metronome. Every few
  // blocks it sends what came in, for the strips that had anything connected,
  // as one lump: { n: frames, s: [strip], d: left and right for each of those
  // strips, frame after frame }.
  const TAP_SOURCE = `
    class ChordPathTap extends AudioWorkletProcessor {
      constructor(options) {
        super();
        const o = (options && options.processorOptions) || {};
        this.count = options.numberOfInputs;
        this.frames = 128 * Math.max(1, o.quanta | 0);
        this.local = !!o.local;
        this.scratch = new Float32Array(this.frames * this.count * 2);
        this.used = new Uint8Array(this.count);
        this.filled = 0;
        this.started = false;
        this.to = null;
        this.port.onmessage = e => { if (e.data && e.data.port) this.to = e.data.port; };
      }
      process(inputs) {
        if (!this.started) {
          if (!this.local && !this.to) return true;
          // The stream begins here: the page is told which of its frames that is.
          this.started = true;
          this.port.postMessage({ origin: currentFrame });
        }
        const width = this.count * 2;
        for (let s = 0; s < this.count; s++) {
          const input = inputs[s];
          if (!input || !input.length) continue;
          const left = input[0], right = input[1] || input[0];
          this.used[s] = 1;
          for (let i = 0, at = this.filled * width + s * 2; i < 128; i++, at += width) {
            this.scratch[at] = left[i];
            this.scratch[at + 1] = right[i];
          }
        }
        this.filled += 128;
        if (this.filled < this.frames) return true;
        const slots = [];
        for (let s = 0; s < this.count; s++) if (this.used[s]) slots.push(s);
        const each = slots.length * 2;
        const data = new Float32Array(this.frames * each);
        for (let k = 0; k < slots.length; k++) {
          for (let i = 0, from = slots[k] * 2, to = k * 2; i < this.frames; i++, from += width, to += each) {
            data[to] = this.scratch[from];
            data[to + 1] = this.scratch[from + 1];
          }
        }
        (this.local ? this.port : this.to).postMessage({ n: this.frames, s: slots, d: data });
        this.scratch.fill(0);
        this.used.fill(0);
        this.filled = 0;
        return true;
      }
    }
    registerProcessor('chordpath-tap', ChordPathTap);`;

  const tapped = new WeakSet();     // contexts that have the worklet loaded
  async function loadTap(ctx) {
    if (tapped.has(ctx)) return;
    const url = URL.createObjectURL(new Blob([TAP_SOURCE], { type: 'text/javascript' }));
    try { await ctx.audioWorklet.addModule(url); } finally { URL.revokeObjectURL(url); }
    tapped.add(ctx);
  }

  function tapNode(ctx, strips, options) {
    return new global.AudioWorkletNode(ctx, 'chordpath-tap', {
      numberOfInputs: strips + 1, numberOfOutputs: 0,
      channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'speakers',
      processorOptions: options,
    });
  }

  // ── Matching the page's own engine ───────────────────────────────────────
  // The page's compressors hold the sound back a little and its limiter lifts
  // it a little. How much is the browser's business, so it is measured, once
  // for each sample rate: a small click is put through and looked for. (The
  // click comes half a second in: a compressor that has only just been made
  // spends its first moments fading in.)
  const measured = new Map();
  async function measure(rate) {
    if (measured.has(rate)) return measured.get(rate);
    const Offline = global.OfflineAudioContext || global.webkitOfflineAudioContext;
    const one = async settings => {
      const at = Math.round(rate * 0.5);
      const ctx = new Offline(1, at + Math.ceil(rate * 0.1), rate);
      const click = ctx.createBuffer(1, at + 16, rate);
      click.getChannelData(0)[at] = 0.1;
      const source = ctx.createBufferSource();
      source.buffer = click;
      const comp = ctx.createDynamicsCompressor();
      Object.keys(settings).forEach(name => { comp[name].value = settings[name]; });
      source.connect(comp);
      comp.connect(ctx.destination);
      source.start(0);
      const out = (await ctx.startRendering()).getChannelData(0);
      let found = 0;
      for (let i = 0; i < out.length; i++) if (Math.abs(out[i]) > Math.abs(out[found])) found = i;
      return { delay: Math.max(0, found - at), gain: out[found] / 0.1 };
    };
    const result = {
      strip: await one({ threshold: 0, ratio: 1, knee: 0 }),
      limiter: await one({ threshold: -1.5, knee: 0, ratio: 20, attack: 0.002, release: 0.12 }),
    };
    measured.set(rate, result);
    return result;
  }

  // The reverb's room as the browser itself plays it. The browser scales an
  // impulse response by a rule of its own before using it; rather than
  // repeat that rule here and hope, a single click is put through the
  // browser's reverb and what comes out is the room the host is given.
  async function roomOf(buffer) {
    const Offline = global.OfflineAudioContext || global.webkitOfflineAudioContext;
    const ctx = new Offline(2, buffer.length, buffer.sampleRate);
    const click = ctx.createBuffer(2, 8, buffer.sampleRate);
    click.getChannelData(0)[0] = 1;
    click.getChannelData(1)[0] = 1;
    const source = ctx.createBufferSource();
    source.buffer = click;
    const reverb = ctx.createConvolver();
    reverb.buffer = buffer;
    source.connect(reverb);
    reverb.connect(ctx.destination);
    source.start(0);
    const out = await ctx.startRendering();
    return [new Float32Array(out.getChannelData(0)), new Float32Array(out.getChannelData(1))];
  }

  // What the host's master needs to know, for a project and a sample rate.
  function masterFor(project, gain, match) {
    return {
      gain, reverbReturn: 3,
      echoSeconds: Math.min(1.9, (60 / project.tempo) * 0.75), echoFeedback: 0.34, echoDampHz: 3400, echoDampQ: 0.5,
      limiterDelay: match.limiter.delay, limiterGain: match.limiter.gain,
      limiterThresholdDb: -1.5, limiterRatio: 20, limiterAttack: 0.002, limiterRelease: 0.12,
    };
  }

  // ── The rack ─────────────────────────────────────────────────────────────
  // Every plugin the project names is loaded into the host, given back the
  // settings it was last saved with, and put on its strip in order. Plugins
  // the project no longer names are let go.
  function entriesOf(project) {
    const all = [];
    project.tracks.forEach(track => (track.plugins || []).forEach(entry => all.push({ entry, trackId: track.id })));
    (project.masterPlugins || []).forEach(entry => all.push({ entry, trackId: null }));
    return all;
  }

  function Rack(tap) {
    this.tap = tap;
    this.loaded = new Map();        // the project's plugin id → { key, hostId, about, failed, editorOpen, bypass }
    this.chains = new Map();        // strip → the ids last put on it, as text
    this.instruments = new Map();   // track id → host id of the plugin instrument playing it
    this.projectId = null;
    this.work = Promise.resolve();
    this.dirty = new Map();         // plugin id → timer for saving its settings
    this.changed = null;            // called when something the screen shows has changed
  }

  Rack.prototype.queue = function (job) {
    const next = this.work.then(job);
    this.work = next.catch(() => { /* reported where it happened */ });
    return next;
  };

  Rack.prototype.byHost = function (hostId) {
    for (const [id, p] of this.loaded) if (p.hostId === hostId) return id;
    return null;
  };

  // Brings the host in line with the project. Safe to call on every edit.
  Rack.prototype.sync = function (project) {
    this.projectId = project.id;
    const snapshot = JSON.stringify(entriesOf(project).map(e => [e.entry.id, e.entry.path, e.entry.uid, !!e.entry.bypass, e.trackId]));
    if (snapshot === this.last) return this.work;
    this.last = snapshot;
    const wanted = entriesOf(project);
    const tracks = project.tracks.map(t => ({ id: t.id, plugins: (t.plugins || []).map(p => p.id) }));
    const master = (project.masterPlugins || []).map(p => p.id);
    return this.queue(() => this.reconcile(wanted, tracks, master));
  };

  Rack.prototype.reconcile = async function (wanted, tracks, master) {
    const want = new Map(wanted.map(w => [w.entry.id, w.entry]));
    let told = false;
    // Let go of what is no longer named (or now names a different plugin).
    for (const [id, p] of Array.from(this.loaded)) {
      const entry = want.get(id);
      if (entry && entry.path + '|' + entry.uid === p.key) continue;
      this.loaded.delete(id);
      told = true;
      if (p.hostId) await call('unload', p.hostId).catch(() => { /* gone with the host */ });
    }
    // Load what is new.
    for (const [id, entry] of want) {
      if (this.loaded.has(id)) continue;
      const slot = { key: entry.path + '|' + entry.uid, hostId: 0, about: null, failed: '', editorOpen: false, bypass: false };
      this.loaded.set(id, slot);
      told = true;
      try {
        let state = null;
        try { state = await store().getPluginState(id); } catch (e) { state = null; }
        const made = await call('load', { path: entry.path, uid: entry.uid, state });
        slot.hostId = made.id;
        slot.about = made.about;
      } catch (e) {
        slot.failed = String((e && e.message) || e);
      }
    }
    for (const [id, entry] of want) {
      const p = this.loaded.get(id);
      if (!p || !p.hostId || p.bypass === !!entry.bypass) continue;
      p.bypass = !!entry.bypass;
      await call('bypass', p.hostId, p.bypass).catch(() => { /* gone with the host */ });
    }
    // Put them on their strips, in order.
    const hosts = ids => ids.map(id => this.loaded.get(id)).filter(p => p && p.hostId).map(p => p.hostId);
    const place = async (strip, ids) => {
      const list = hosts(ids), text = list.join(',');
      if ((this.chains.get(strip) || '') === text) return;
      this.chains.set(strip, text);
      await call('chain', strip, list).catch(() => { /* gone with the host */ });
    };
    this.instruments.clear();
    for (const track of tracks) {
      const strip = this.tap.slotOf(track.id);
      if (strip == null) continue;
      await place(strip, track.plugins);
      const first = track.plugins.map(id => this.loaded.get(id)).find(p => p && p.hostId && p.about && p.about.instrument);
      if (first) this.instruments.set(track.id, first.hostId);
    }
    await place(-1, master);
    if (told && this.changed) this.changed();
  };

  // A strip no track uses any more loses its plugins.
  Rack.prototype.clear = function (strip) {
    return this.queue(async () => {
      if (!this.chains.get(strip)) return;
      this.chains.delete(strip);
      await call('chain', strip, []).catch(() => { /* gone with the host */ });
    });
  };

  // What the screen may want to know about one of the project's plugins.
  Rack.prototype.about = function (id) {
    const p = this.loaded.get(id);
    if (!p) return { state: 'waiting' };
    if (p.failed) return { state: 'failed', error: p.failed };
    if (!p.hostId) return { state: 'loading' };
    return { state: 'ready', hasEditor: !!(p.about && p.about.hasEditor), instrument: !!(p.about && p.about.instrument), editorOpen: p.editorOpen, latency: p.about ? p.about.latency : 0 };
  };

  Rack.prototype.openWindow = async function (id, title) {
    await this.work;
    const p = this.loaded.get(id);
    if (!p || !p.hostId) throw new Error(p && p.failed ? p.failed : 'The plugin is still loading');
    const ok = await call('editor', p.hostId, title);
    p.editorOpen = !!ok;
    if (this.changed) this.changed();
    return !!ok;
  };
  Rack.prototype.closeWindow = async function (id) {
    const p = this.loaded.get(id);
    if (!p || !p.hostId) return;
    await call('closeEditor', p.hostId).catch(() => { /* gone with the host */ });
    p.editorOpen = false;
    if (this.changed) this.changed();
  };

  // Saves a plugin's settings beside the project. They are kept apart from
  // the project itself, like recordings, so that undo history stays small.
  Rack.prototype.save = async function (id) {
    clearTimeout(this.dirty.get(id));
    this.dirty.delete(id);
    const p = this.loaded.get(id);
    if (!p || !p.hostId || !this.projectId) return;
    try {
      const bytes = await call('state', p.hostId);
      if (bytes && bytes.length) await store().putPluginState(id, this.projectId, bytes);
    } catch (e) { /* the plugin went, or the host did */ }
  };
  Rack.prototype.touched = function (hostId) {
    const id = this.byHost(hostId);
    if (!id) return;
    clearTimeout(this.dirty.get(id));
    this.dirty.set(id, setTimeout(() => this.save(id), QUIET_AFTER_MS));
  };
  // Saves everything that is waiting to be saved, now.
  Rack.prototype.flush = function () {
    return Promise.all(Array.from(this.dirty.keys()).map(id => this.save(id)));
  };
  // Saves every plugin's settings, whether or not it said they changed.
  Rack.prototype.saveAll = function () {
    return Promise.all(Array.from(this.loaded.keys()).map(id => this.save(id)));
  };

  // ── The live tap: tracks on their way to the sound card ──────────────────
  function LiveTap(ctx, opened, match) {
    this.ctx = ctx;
    this.opened = opened;
    this.match = match;
    this.rate = opened.sampleRate;
    this.strips = opened.strips;
    this.spare = opened.strips - 1;             // a strip kept for hearing the input when no track is chosen for it
    this.node = tapNode(ctx, this.strips, { quanta: 2 });
    this.direct = ctx.createGain();             // the metronome's way in
    this.direct.connect(this.node, 0, this.strips);
    this.slots = new Map();                     // track id → strip
    this.free = [];
    for (let s = this.spare - 1; s >= 0; s--) this.free.push(s);
    this.sent = new Map();
    this.sentMaster = '';
    this.origin = null;
    this.notes = [];
    this.posting = false;
    this.rack = new Rack(this);
    this.live = true;

    this.started = new Promise(resolve => {
      this.node.port.onmessage = e => {
        if (e.data && typeof e.data.origin === 'number') { this.origin = e.data.origin; resolve(); }
      };
    });
    // The audio goes to the host over a channel of its own, straight from the audio thread.
    const channel = new MessageChannel();
    link.port.postMessage({ feed: true }, [channel.port1]);
    this.node.port.postMessage({ port: channel.port2 }, [channel.port2]);

    this.onEdited = m => this.rack.touched(m.id);
    this.onClosed = m => {
      const id = this.rack.byHost(m.id);
      const p = id && this.rack.loaded.get(id);
      if (!p) return;
      p.editorOpen = false;
      this.rack.save(id);                       // a window just closed is a good moment to keep what was set in it
      if (this.rack.changed) this.rack.changed();
    };
    on('edited', this.onEdited);
    on('editorClosed', this.onClosed);
  }

  LiveTap.prototype.dispose = function () {
    off('edited', this.onEdited);
    off('editorClosed', this.onClosed);
    try { this.node.disconnect(); this.direct.disconnect(); } catch (e) { /* already apart */ }
  };

  LiveTap.prototype.slotOf = function (trackId) {
    const slot = this.slots.get(trackId);
    return slot == null ? null : slot;
  };
  // Where a strip's sound should be sent: { node, index }, or null when every strip is taken.
  LiveTap.prototype.input = function (trackId) {
    let slot = this.slots.get(trackId);
    if (slot == null) {
      if (!this.free.length) return null;
      slot = this.free.pop();
      this.slots.set(trackId, slot);
    }
    return { node: this.node, index: slot };
  };
  LiveTap.prototype.release = function (trackId) {
    const slot = this.slots.get(trackId);
    if (slot == null) return;
    this.slots.delete(trackId);
    this.free.push(slot);
    this.sent.delete(slot);
    if (connected()) call('strip', slot, { active: false, gain: 0 }).catch(() => { /* gone with the host */ });
    this.rack.clear(slot);
  };
  LiveTap.prototype.strip = function (trackId, settings) {
    const slot = this.slots.get(trackId);
    if (slot == null || !connected()) return;
    const text = JSON.stringify(settings);
    if (this.sent.get(slot) === text) return;
    this.sent.set(slot, text);
    call('strip', slot, Object.assign({ active: true }, settings)).catch(() => { /* gone with the host */ });
  };
  LiveTap.prototype.master = function (project, gain) {
    if (!connected()) return;
    const settings = masterFor(project, gain, this.match);
    const text = JSON.stringify(settings);
    if (this.sentMaster === text) return;
    this.sentMaster = text;
    call('master', settings).catch(() => { /* gone with the host */ });
  };
  LiveTap.prototype.plugins = function (project) { return this.rack.sync(project); };
  // Is this track played by a plugin instrument (rather than the built-in ones)?
  LiveTap.prototype.plays = function (trackId) { return this.rack.instruments.has(trackId); };

  // Where in the stream a moment on the page's clock falls. A note for a
  // plugin instrument is placed as late as the page's own instruments come
  // out of their compressor, so the two stay together.
  LiveTap.prototype.frameAt = function (when) {
    return Math.max(1, Math.round(when * this.rate) - this.origin + this.match.strip.delay);
  };
  LiveTap.prototype.note = function (trackId, midi, when, seconds, velocity) {
    const plugin = this.rack.instruments.get(trackId);
    if (!plugin || this.origin == null) return;
    this.notes.push({ plugin, frame: this.frameAt(when), on: true, pitch: midi, velocity },
      { plugin, frame: this.frameAt(when + Math.max(0.01, seconds)), on: false, pitch: midi });
    if (this.posting) return;
    this.posting = true;
    Promise.resolve().then(() => {
      this.posting = false;
      if (connected()) call('notes', this.notes.splice(0)).catch(() => { /* gone with the host */ });
    });
  };
  // Stops every plugin instrument and forgets the notes still to come.
  LiveTap.prototype.silence = function () {
    this.notes.length = 0;
    if (connected()) call('silence', Array.from(new Set(this.rack.instruments.values()))).catch(() => { /* gone with the host */ });
  };

  // How long after the page plays something it is heard: what is kept in
  // hand, what the plugins and limiter take, and what the card adds.
  LiveTap.prototype.heardAfter = function () {
    const desk = link.status ? link.status.latency : this.match.limiter.delay;
    return (this.match.strip.delay + this.opened.prebufferFrames + desk + this.opened.outputLatency) / this.rate;
  };

  // Peak levels in dB for the project's tracks and the master.
  LiveTap.prototype.levels = function () {
    const peaks = link.status && link.status.peaks ? link.status.peaks : [];
    const db = x => (x > 1e-8 ? 20 * Math.log10(x) : -160);
    const tracks = {};
    this.slots.forEach((slot, trackId) => { tracks[trackId] = db(Math.max(peaks[slot * 2] || 0, peaks[slot * 2 + 1] || 0)); });
    const m = this.strips * 2;
    return { master: db(Math.max(peaks[m] || 0, peaks[m + 1] || 0)), tracks };
  };

  // Opens the card and makes the tap for it. `ctx` is made by the caller at the card's sample rate.
  async function liveTap(ctx, opened) {
    const match = await measure(opened.sampleRate);
    await loadTap(ctx);
    const tap = new LiveTap(ctx, opened, match);
    return tap;
  }

  // ── The mixdown tap: tracks on their way to a file ───────────────────────
  // The same hand-over inside an offline render. The lumps come back to the
  // page, which passes them to the host a stretch at a time.
  const MIX_QUANTA = 32;            // 4096 frames to a lump
  function MixTap(ctx, strips, rack, match) {
    this.ctx = ctx;
    this.rate = ctx.sampleRate;
    this.strips = strips;
    this.rack = rack;
    this.match = match;
    this.node = tapNode(ctx, strips, { quanta: MIX_QUANTA, local: true });
    this.direct = ctx.createGain();
    this.direct.connect(this.node, 0, strips);
    this.slots = new Map();
    this.settings = new Map();
    this.masterSettings = null;
    this.notes = [];
    this.lumps = [];
    this.received = 0;
    this.live = false;
    this.node.port.onmessage = e => {
      if (!e.data || !e.data.d) return;
      this.lumps.push(e.data);
      this.received += e.data.n;
    };
  }
  MixTap.prototype.slotOf = function (trackId) { const s = this.slots.get(trackId); return s == null ? null : s; };
  MixTap.prototype.input = function (trackId) {
    if (!this.slots.has(trackId)) {
      if (this.slots.size >= this.strips) return null;
      this.slots.set(trackId, this.slots.size);
    }
    return { node: this.node, index: this.slots.get(trackId) };
  };
  MixTap.prototype.release = function () {};
  MixTap.prototype.strip = function (trackId, settings) {
    const slot = this.slots.get(trackId);
    if (slot != null) this.settings.set(slot, Object.assign({ active: true }, settings));
  };
  MixTap.prototype.master = function (project, gain) { this.masterSettings = masterFor(project, gain, this.match); };
  MixTap.prototype.plugins = function () {};
  // The plugin instruments are the ones already loaded for playing live.
  MixTap.prototype.plays = function (trackId) { return this.rack.instruments.has(trackId); };
  MixTap.prototype.note = function (trackId, midi, when, seconds, velocity) {
    const plugin = this.rack.instruments.get(trackId);
    if (!plugin) return;
    const at = t => Math.max(0, Math.round(t * this.rate) + this.match.strip.delay);
    this.notes.push({ plugin, frame: at(when), on: true, pitch: midi, velocity },
      { plugin, frame: at(when + Math.max(0.01, seconds)), on: false, pitch: midi });
  };
  MixTap.prototype.silence = function () {};
  // Everything received so far as one lump, in strip order with gaps filled: { samples, frames, slots }.
  MixTap.prototype.take = function () {
    const lumps = this.lumps.splice(0);
    const frames = lumps.reduce((n, l) => n + l.n, 0);
    const used = new Set();
    lumps.forEach(l => l.s.forEach(s => used.add(s)));
    const slots = Array.from(used).sort((a, b) => a - b);
    if (!frames || !slots.length) return { samples: null, frames, slots: [] };
    const each = slots.length * 2;
    const samples = new Float32Array(frames * each);
    let at = 0;
    lumps.forEach(l => {
      const width = l.s.length * 2;
      l.s.forEach((slot, k) => {
        const to = slots.indexOf(slot) * 2;
        for (let i = 0; i < l.n; i++) {
          samples[(at + i) * each + to] = l.d[i * width + k * 2];
          samples[(at + i) * each + to + 1] = l.d[i * width + k * 2 + 1];
        }
      });
      at += l.n;
    });
    return { samples, frames, slots };
  };

  async function mixTap(ctx, strips, rack) {
    const match = await measure(ctx.sampleRate);
    await loadTap(ctx);
    return new MixTap(ctx, strips, rack, match);
  }

  global.NativeAudio = {
    supported, connected, connect, call, on, off, info, installed,
    status: () => link.status,
    liveTap, mixTap, roomOf, measure, masterFor, MIX_FRAMES: MIX_QUANTA * 128,
  };
})(typeof window !== 'undefined' ? window : globalThis);
