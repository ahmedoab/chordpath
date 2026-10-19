/* ChordPath — desktop/audiohost.js
 * The audio host: a process of its own that holds the sound card and the
 * plugins, so that a plugin which crashes takes this process with it and not
 * the app, and so that nothing the app's window is busy with can make the
 * sound stutter.
 *
 * It is spoken to over a channel that the shell (audioservice.js) hands it,
 * leading straight to the app's window:
 *   control — requests ({ id, method, args }) answered one for one
 *             ({ id, result } or { id, error }), and news it sends unasked
 *             ({ event, … }): levels, a plugin's settings changing, a plugin
 *             window being closed.
 * Over that channel the window passes it a second one:
 *   feed    — the app's audio, in lumps, straight from the page's audio
 *             thread: { n: frames, s: [strip], d: Float32Array }.
 *
 * Everything asked of it is checked here before it reaches the native code:
 * plugins are loaded only from where plugins are installed, and the numbers
 * are bounded again inside the native host itself.
 */
'use strict';

const path = require('path');

const ADDON = (process.env.CHORDPATH_NATIVE || path.join(__dirname, '..', 'native', 'build', 'Release', 'chordpath_native.node'))
  .replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');

let native = null;
let loadError = '';
try { native = require(ADDON); } catch (e) { loadError = String((e && e.message) || e); }

const LIMITS = { plugins: 160, chain: 16, state: 64 * 1024 * 1024, notes: 4096, takeSeconds: 1200, title: 120 };
const TICK_MS = 40;

const S = {
  control: null, feed: null,
  io: null, opened: null, session: 0,
  plugins: new Map(),          // id → { plugin, about, editorOpen }
  chains: new Map(),           // strip (-1 = master) → [plugin id]
  nextPlugin: 1,
  timer: null,
  take: null,                  // a recording in progress
  mix: null,                   // a mixdown in progress
  onTop: false,
  installed: null,             // the plugin files on this computer, as a Set
};

function send(message) {
  if (S.control) S.control.postMessage(message);
}

function need(what, message) {
  if (!what) throw new Error(message);
  return what;
}
function card() { return need(S.io, 'The sound card is not open'); }
function entry(id) { return need(S.plugins.get(id), 'That plugin is not loaded'); }
function whole(value, least, most, fallback) {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.max(least, Math.min(most, n)) : fallback;
}
function text(value, most) { return typeof value === 'string' ? value.slice(0, most) : ''; }

function installedPlugins(refresh) {
  if (!S.installed || refresh) S.installed = new Set(native.pluginPaths());
  return S.installed;
}

// The chain for a strip as the native host wants it.
function chainOf(ids) {
  return ids.map(id => ({ id, plugin: entry(id).plugin }));
}

function applyChain(strip) {
  if (S.io) S.io.setChain(strip, chainOf(S.chains.get(strip) || []));
}

function releasePlugins() {
  S.plugins.forEach(p => { try { p.plugin.dispose(); } catch (e) { /* already gone */ } });
  S.plugins.clear();
  S.chains.clear();
}

function endMix() {
  if (!S.mix) return;
  S.mix = null;
  S.plugins.forEach(p => { try { p.plugin.setOffline(false); } catch (e) { /* closed meanwhile */ } });
  if (S.io) S.io.setPaused(false);
}

function closeCard() {
  endMix();
  S.session++;
  clearInterval(S.timer);
  S.timer = null;
  S.take = null;
  if (S.io) {
    try { S.io.close(); } catch (e) { /* it is going either way */ }
  }
  S.io = null;
  S.opened = null;
  releasePlugins();
}

// Collects what the card has recorded since last asked.
function pull() {
  const take = S.take;
  if (!take || !S.io) return;
  const rate = S.opened.sampleRate;
  const left = new Float32Array(Math.ceil(rate / 2)), right = new Float32Array(left.length);
  for (;;) {
    const got = S.io.readInput(left, right);
    if (!got.frames) break;
    if (take.streamAt === null) { take.streamAt = got.streamAt; take.cardAt = got.cardAt; }
    if (take.frames < LIMITS.takeSeconds * rate) {
      take.left.push(left.slice(0, got.frames));
      take.right.push(right.slice(0, got.frames));
      take.frames += got.frames;
    }
    if (got.frames < left.length) break;
  }
}

function join(parts, frames) {
  const out = new Float32Array(frames);
  let at = 0;
  parts.forEach(p => { out.set(p, at); at += p.length; });
  return out;
}

function tick() {
  if (!S.io) return;
  const s = S.io.status();
  pull();
  let delays = false;
  S.plugins.forEach((p, id) => {
    const c = p.plugin.changes();
    if (c.edited) send({ event: 'edited', id });
    if (c.latency) delays = true;
    if (p.editorOpen && !c.editorOpen) send({ event: 'editorClosed', id });
    p.editorOpen = c.editorOpen;
  });
  // A plugin that now takes longer (or less long) changes how the tracks line up: the desk works it out again.
  if (delays && !S.mix) {
    try { S.chains.forEach((ids, strip) => applyChain(strip)); } catch (e) { /* a plugin went meanwhile */ }
  }
  send({
    event: 'status',
    status: {
      flowing: s.flowing, buffered: s.buffered, underruns: s.underruns, lost: s.lost, slips: s.slips, blocks: s.blocks,
      load: s.load, idle: s.idleSeconds, latency: s.latencyFrames, overloads: s.overloads, reset: s.resetWanted, peaks: s.peaks,
    },
  });
}

// ── What can be asked ──────────────────────────────────────────────────────
const api = {
  hello() {
    return { ok: !!native, error: loadError, opened: S.opened };
  },

  devices() { return native.audioDevices(); },
  describe(name) { return native.describeAsio(text(name, 200)); },

  // open({ api, device, useInput, input, firstOutput, firstInput, sampleRate, bufferFrames, strips, prebufferFrames })
  open(config) {
    config = config && typeof config === 'object' ? config : {};
    closeCard();
    const request = {
      api: config.api === 'asio' ? 'asio' : 'wasapi',
      device: text(config.device, 200),
      useInput: config.useInput === true,
      input: text(config.input, 200),
      firstOutput: whole(config.firstOutput, 0, 1024, 0),
      firstInput: whole(config.firstInput, 0, 1024, 0),
      sampleRate: whole(config.sampleRate, 0, 384000, 0),
      bufferFrames: whole(config.bufferFrames, 0, 8192, 0),
      strips: whole(config.strips, 1, 64, 16),
      prebufferFrames: whole(config.prebufferFrames, 0, 192000, 0),
      muted: process.env.CHORDPATH_E2E === '1' && config.muted !== false,   // tests never make a sound
    };
    const io = new native.AudioIO();
    const opened = io.open(request);
    S.io = io;
    S.opened = opened;
    S.timer = setInterval(tick, TICK_MS);
    return opened;
  },
  close() { closeCard(); return true; },
  panel() { return card().showControlPanel(); },

  strip(index, settings) { card().setStrip(whole(index, 0, 63, 0), settings || {}); },
  master(settings) { card().setMaster(settings || {}); },
  reverb(left, right) { card().setReverb(left, right); },
  transport(t) { card().setTransport(t || {}); },
  monitor(strip, gain) { card().setMonitor(whole(strip, -1, 63, -1), Number(gain) || 0); },
  pause(on) { card().setPaused(!!on); },
  status() { return card().status(); },
  capture(frames) {
    const n = whole(frames, 1, 131072, 4096);
    const left = new Float32Array(n), right = new Float32Array(n);
    const got = card().capture(left, right);
    return { left: left.subarray(0, got), right: right.subarray(0, got) };
  },

  // ── Plugins ──
  // load({ path, uid, state }) → { id, about }
  async load(what) {
    what = what && typeof what === 'object' ? what : {};
    card();
    need(S.plugins.size < LIMITS.plugins, 'Too many plugins are loaded');
    const file = text(what.path, 1024);
    if (!installedPlugins().has(file) && !installedPlugins(true).has(file)) {
      throw new Error('That is not one of the plugins installed on this computer');
    }
    const session = S.session;
    const plugin = await native.loadPlugin({
      path: file, uid: text(what.uid, 64), sampleRate: S.opened.sampleRate,
      blockSize: Math.max(64, Math.min(8192, S.opened.bufferFrames)),
    });
    let about = plugin.about;
    if (what.state instanceof Uint8Array && what.state.length && what.state.length <= LIMITS.state) {
      try {
        if (await plugin.setState(what.state)) about = await plugin.refresh();
      } catch (e) { /* it keeps the settings it started with */ }
    }
    if (session !== S.session) {                 // the card was changed while it loaded: it belongs to nothing now
      plugin.dispose();
      throw new Error('The sound card was changed while the plugin was loading');
    }
    plugin.changes();                            // loading and restoring are not the plugin changing itself
    plugin.setEditorOnTop(S.onTop);
    const id = S.nextPlugin++;
    S.plugins.set(id, { plugin, about, editorOpen: false });
    return { id, about };
  },
  unload(id) {
    const gone = S.plugins.get(id);
    if (!gone) return false;
    // Off every strip first, so nothing is still playing through it.
    S.chains.forEach((ids, strip) => {
      if (!ids.includes(id)) return;
      S.chains.set(strip, ids.filter(other => other !== id));
      applyChain(strip);
    });
    S.plugins.delete(id);
    gone.plugin.dispose();
    return true;
  },
  // chain(strip, [id]): the plugins on a strip, in order; strip -1 is the master.
  chain(strip, ids) {
    card();
    const index = whole(strip, -1, 63, 0);
    const list = (Array.isArray(ids) ? ids : []).slice(0, LIMITS.chain);
    list.forEach(entry);
    S.chains.set(index, list);
    applyChain(index);
    return card().status().latencyFrames;
  },
  bypass(id, on) { entry(id).plugin.setBypassed(!!on); },
  async editor(id, title) {
    const p = entry(id);
    const ok = await p.plugin.openEditor({ title: text(title, LIMITS.title) });
    if (ok) p.editorOpen = true;
    return ok;
  },
  async closeEditor(id) { await entry(id).plugin.closeEditor(); },
  async state(id) { return new Uint8Array(await entry(id).plugin.getState()); },
  onTop(on) {
    S.onTop = !!on;
    S.plugins.forEach(p => p.plugin.setEditorOnTop(S.onTop));
  },

  // ── Notes for plugin instruments ──
  // notes([{ plugin, frame, on, pitch, velocity }]): frame is a place in the stream; 0 is at once.
  notes(list) { return card().schedule((Array.isArray(list) ? list : []).slice(0, LIMITS.notes)); },
  // silence([id]): lets go of every note those instruments are holding, and forgets the notes still to come.
  silence(ids) {
    card().clearEvents();
    (Array.isArray(ids) ? ids : []).forEach(id => { const p = S.plugins.get(id); if (p) p.plugin.allNotesOff(); });
  },

  // ── Recording the card's input ──
  record(on) {
    if (on) {
      S.take = { left: [], right: [], frames: 0, streamAt: null, cardAt: null, dropouts: card().status().underruns };
      S.io.setRecording(true);
      return true;
    }
    if (S.io) S.io.setRecording(false);
    return false;
  },
  // take() → { left, right, streamAt, dropouts } or null: what was recorded, and where in the stream it began.
  take() {
    const take = S.take;
    if (!take || !S.io) return null;
    pull();
    S.io.setRecording(false);
    S.take = null;
    if (!take.frames) return null;
    return {
      left: join(take.left, take.frames), right: join(take.right, take.frames),
      streamAt: take.streamAt, cardAt: take.cardAt, dropouts: S.io.status().underruns - take.dropouts,
    };
  },

  // ── Mixing down to a file, through the same plugins ──
  mixBegin(settings) {
    card();
    endMix();
    S.io.setPaused(true);                        // the card plays silence and leaves the plugins to the mixdown
    S.plugins.forEach(p => p.plugin.setOffline(true));
    S.mix = new native.Mixdown({ sampleRate: S.opened.sampleRate, strips: whole(settings && settings.strips, 1, 64, 16) });
    return { sampleRate: S.opened.sampleRate };
  },
  mixStrip(index, settings) { need(S.mix, 'No mixdown is under way').setStrip(whole(index, 0, 63, 0), settings || {}); },
  mixMaster(settings) { need(S.mix, 'No mixdown is under way').setMaster(settings || {}); },
  mixReverb(left, right) { need(S.mix, 'No mixdown is under way').setReverb(left, right); },
  mixTransport(t) { need(S.mix, 'No mixdown is under way').setTransport(t || {}); },
  mixChain(strip, ids) {
    const mix = need(S.mix, 'No mixdown is under way');
    mix.setChain(whole(strip, -1, 63, 0), chainOf((Array.isArray(ids) ? ids : []).slice(0, LIMITS.chain)));
    return mix.latency();
  },
  mixNotes(list) { return need(S.mix, 'No mixdown is under way').schedule(Array.isArray(list) ? list : []); },
  // mixProcess(samples | null, frames, slots) → { left, right }
  mixProcess(samples, frames, slots) {
    const mix = need(S.mix, 'No mixdown is under way');
    return samples ? mix.process(samples, frames, Array.isArray(slots) ? slots : []) : mix.process(null, frames);
  },
  mixEnd() { endMix(); return true; },
};

async function answer(request) {
  const id = request && request.id;
  try {
    need(native, 'The audio host could not start: ' + loadError);
    const handler = request && Object.prototype.hasOwnProperty.call(api, request.method) ? api[request.method] : null;
    need(handler, 'The audio host does not know how to do that');
    const result = await handler.apply(null, Array.isArray(request.args) ? request.args : []);
    send({ id, result: result === undefined ? null : result });
  } catch (e) {
    send({ id, error: String((e && e.message) || e) });
  }
}

function takeFeed(message) {
  const lump = message && message.data;
  if (!S.io || !lump || !(lump.d instanceof Float32Array) || !Array.isArray(lump.s)) return;
  try { S.io.push(lump.d, lump.n, lump.s); } catch (e) { /* a lump that does not add up is dropped */ }
}

function takeFeedFrom(port) {
  if (S.feed) S.feed.close();
  S.feed = port;
  port.on('message', takeFeed);
  port.start();
}

function attach(control) {
  // A window that reloads comes back with a new channel; what the old one had open goes.
  if (S.control) { closeCard(); S.control.close(); }
  if (S.feed) { S.feed.close(); S.feed = null; }
  S.control = control;
  control.on('message', message => {
    if (message.ports && message.ports.length) takeFeedFrom(message.ports[0]);
    else answer(message.data);
  });
  control.on('close', () => { if (S.control === control) { S.control = null; closeCard(); } });
  control.start();
}

process.parentPort.on('message', message => {
  const what = message.data || {};
  if (what.type === 'attach' && message.ports.length === 1) {
    attach(message.ports[0]);
    process.parentPort.postMessage({ type: 'attached', ok: !!native, error: loadError });
  } else if (what.type === 'onTop') {
    if (native) api.onTop(what.on);
  } else if (what.type === 'quit') {
    closeCard();
    process.exit(0);
  }
});

process.on('uncaughtException', error => {
  try { send({ event: 'failed', error: String((error && error.message) || error) }); } catch (e) { /* nobody to tell */ }
  process.exit(1);
});

process.parentPort.postMessage({ type: 'ready', ok: !!native, error: loadError });
