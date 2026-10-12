/* ChordPath — tests for the native audio host: VST 3 plugins, the mixing desk
 * behind them, and sound cards.
 * Run with: node tests/native-test.js
 * Needs the host built (npm run build:native). Checks that depend on a
 * particular plugin are skipped where that plugin is not installed; the
 * plugins used are free ones: TDR Nova, Valhalla Supermassive and Surge XT.
 * The sound-card checks use a stand-in ASIO driver that is part of the host
 * and needs no hardware. Nothing is played aloud.
 */
'use strict';

const path = require('path');
const fs = require('fs');
const ROOT = path.join(__dirname, '..');
const BUILT = path.join(ROOT, 'native', 'build', 'Release', 'chordpath_native.node');

let passed = 0, failed = 0, skipped = 0;
const failures = [];
const VERBOSE = process.argv.includes('--verbose');
function check(label, cond) {
  if (cond) { passed++; if (VERBOSE) console.log('  ok: ' + label); }
  else { failed++; failures.push(label); console.error('  FAIL: ' + label); }
}
function throws(label, fn, pattern) {
  try { fn(); check(label, false); }
  catch (e) { check(label, !pattern || pattern.test(e.message)); }
}
async function rejects(label, fn, pattern) {
  try { await fn(); check(label, false); }
  catch (e) { check(label, !pattern || pattern.test(e.message)); }
}
function section(name) { console.log('\n== ' + name + ' =='); }
function skip(what) { skipped++; console.log('  (skipped: ' + what + ')'); }
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

if (!fs.existsSync(BUILT)) {
  console.log('The native host has not been built (npm run build:native), so there is nothing to test.');
  process.exit(0);
}
process.env.CHORDPATH_TEST_AUDIO = '1';       // puts the stand-in ASIO driver on offer
const native = require(BUILT);

const SR = 48000;
const TEST_DRIVER = 'ChordPath test driver';
const rms = (d, from, to) => { let s = 0; const a = from || 0, b = to == null ? d.length : to; for (let i = a; i < b; i++) s += d[i] * d[i]; return Math.sqrt(s / Math.max(1, b - a)); };
const peakOf = (d, from, to) => { let p = 0; for (let i = from || 0; i < (to == null ? d.length : to); i++) p = Math.max(p, Math.abs(d[i])); return p; };
const peakAt = d => { let at = 0; for (let i = 0; i < d.length; i++) if (Math.abs(d[i]) > Math.abs(d[at])) at = i; return at; };
const sine = (hz, n, level) => Float32Array.from({ length: n }, (unused, i) => level * Math.sin(2 * Math.PI * hz * i / SR));
const apart = (a, b) => { let most = 0; for (let i = 0; i < Math.min(a.length, b.length); i++) most = Math.max(most, Math.abs(a[i] - b[i])); return most; };
function noise(n, level, seed) {
  let a = seed >>> 0;
  return Float32Array.from({ length: n }, () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296 * 2 - 1) * level;
  });
}
const find = pattern => native.pluginPaths().find(p => pattern.test(p)) || null;
const load = (file, extra) => {
  const d = native.describePlugins(file)[0];
  return native.loadPlugin(Object.assign({ path: d.path, uid: d.uid, sampleRate: SR, blockSize: 512 }, extra));
};
// Left and right for each listed strip, frame after frame, as the desk takes them.
function lump(pairs) {
  const frames = pairs[0][0].length;
  const out = new Float32Array(frames * pairs.length * 2);
  pairs.forEach(([l, r], s) => {
    for (let i = 0; i < frames; i++) {
      out[(i * pairs.length + s) * 2] = l[i];
      out[(i * pairs.length + s) * 2 + 1] = r[i];
    }
  });
  return out;
}

async function plugins() {
  // ── Finding plugins ──────────────────────────────────────────────────────
  section('Finding plugins');
  const paths = native.pluginPaths();
  check('the places plugins are installed can be listed', Array.isArray(paths) && paths.every(p => typeof p === 'string' && /\.vst3$/i.test(p)));
  throws('a file that is not there is refused with a reason', () => native.describePlugins('C:/no/such/plugin.vst3'), /./);
  throws('so is something that is not a plugin', () => native.describePlugins(path.join(ROOT, 'package.json')), /./);
  throws('the path has to be text', () => native.describePlugins(42), /text/);
  throws('a plugin cannot be loaded from nothing', () => native.loadPlugin(), /object/);
  throws('nor without saying which file', () => native.loadPlugin({ sampleRate: SR }), /path/);
  await rejects('nor from a file that is not a plugin', () => native.loadPlugin({ path: path.join(ROOT, 'package.json'), sampleRate: SR }), /./);

  // ── An effect ────────────────────────────────────────────────────────────
  section('An effect: TDR Nova');
  const novaPath = find(/TDR Nova\.vst3$/i);
  if (!novaPath) skip('TDR Nova is not installed');
  else {
    const about = native.describePlugins(novaPath);
    check('the file says what is in it', about.length === 1 && /Nova/.test(about[0].name) && about[0].instrument === false && /^[0-9A-F]{32}$/.test(about[0].uid));
    await rejects('asking for a plugin the file does not hold is refused', () => native.loadPlugin({ path: novaPath, uid: '0'.repeat(32), sampleRate: SR }), /not in the file/);
    throws('an impossible sample rate is refused', () => native.loadPlugin({ path: novaPath, sampleRate: 5 }), /range/);

    const nova = await load(novaPath);
    const info = nova.info();
    check('it is a stereo effect with a window of its own', info.inputs === 2 && info.outputs === 2 && info.hasEditor === true && info.instrument === false);
    check(`it says how late its output is (${info.latency} samples)`, Number.isInteger(info.latency) && info.latency >= 0 && info.latency < SR);

    // Flat, an equaliser changes nothing: a tone comes out as it went in, only later.
    const left = sine(440, SR, 0.5), right = sine(440, SR, 0.25);
    nova.process(left, right);
    check(`a tone passes through at its own level (${rms(left, 8000).toFixed(4)} and ${rms(right, 8000).toFixed(4)})`,
      Math.abs(rms(left, 8000) - 0.5 / Math.SQRT2) < 0.01 && Math.abs(rms(right, 8000) - 0.25 / Math.SQRT2) < 0.005);
    {
      const fresh = await load(novaPath);
      const a = new Float32Array(4096), b = new Float32Array(4096);
      a[100] = b[100] = 1;
      fresh.process(a, b);
      check('by as many samples as it said', Math.abs(peakAt(a) - (100 + info.latency)) <= 2);
      fresh.dispose();
    }

    // Any length of audio, in one call or many, gives the same result.
    const whole = await load(novaPath), pieces = await load(novaPath);
    const wl = sine(330, 5000, 0.4), wr = sine(330, 5000, 0.4);
    const pl = Float32Array.from(wl), pr = Float32Array.from(wr);
    whole.process(wl, wr);
    for (const [from, to] of [[0, 1], [1, 700], [700, 713], [713, 5000]]) pieces.process(pl.subarray(from, to), pr.subarray(from, to));
    check(`odd-sized pieces give what one call gives (off by ${apart(wl, pl).toExponential(1)})`, apart(wl, pl) < 1e-5);
    whole.dispose();
    pieces.dispose();

    const params = nova.parameters();
    const gain = params.find(p => p.title === 'Band 1 Gain');
    check('its controls are listed with names and positions', params.length > 20 && !!gain && params.every(p => typeof p.title === 'string' && p.value >= 0 && p.value <= 1));
    if (gain) {
      check(`a control reads in the plugin's own words (${nova.paramText(gain.id)} ${gain.units})`, /^-?\d/.test(nova.paramText(gain.id)) && gain.units === 'dB');
      nova.setParam(gain.id, 1);
      check('and can be set', Math.abs(nova.getParam(gain.id) - 1) < 1e-6 && nova.paramText(gain.id) !== nova.paramText(gain.id, 0.5));
      nova.setParam(gain.id, 7);
      check('never beyond its range', nova.getParam(gain.id) <= 1);
    }
    // A plugin says when its settings have changed (a control moved in its window, say); asking clears the flag.
    const told = nova.changes();
    check('it reports changes to its settings once', typeof told.edited === 'boolean' && told.latency === false && nova.changes().edited === false);

    // State: a second instance given the first one's state holds the same settings.
    const saved = await nova.getState();
    const twin = await load(novaPath);
    check('its state can be saved and given to another instance', saved.length > 16 && (await twin.setState(saved)) === true &&
      (!gain || Math.abs(twin.getParam(gain.id) - nova.getParam(gain.id)) < 1e-6));
    check('rubbish is not accepted as a state', (await twin.setState(new Uint8Array([1, 2, 3]))) === false && (await twin.setState(new Uint8Array(64))) === false);
    throws('nor anything that is not bytes', () => twin.setState('state'), /bytes/);
    twin.dispose();

    // Bypassed, the audio goes on untouched, kept as late as the plugin would have made it.
    nova.setBypassed(true);
    const bl = noise(4096, 0.3, 7), br = noise(4096, 0.3, 8), keep = Float32Array.from(bl);
    nova.process(new Float32Array(SR / 4), new Float32Array(SR / 4));     // let what was in it run out
    nova.process(bl, br);
    let exact = true;
    for (let i = info.latency; i < bl.length; i++) if (bl[i] !== keep[i - info.latency]) exact = false;
    check('bypassed, the audio is exactly what came, held back by the same number of samples', nova.info().bypassed === true && exact);
    nova.setBypassed(false);

    throws('audio has to come as two equal Float32Arrays', () => nova.process(new Float32Array(8), new Float32Array(9)), /same length/);
    throws('and nothing else', () => nova.process([0, 0], [0, 0]), /Float32Array/);

    // Its window, opened out of sight. It lives on a thread of its own, so nothing here has to keep it going.
    check('its window opens', (await nova.openEditor({ title: 'Test', visible: false })) === true);
    await wait(250);
    const editor = nova.editor();
    check(`at the size the plugin wants (${editor.width} x ${editor.height})`, editor.open === true && editor.width > 100 && editor.height > 100);
    await nova.closeEditor();
    check('and closes', nova.editor().open === false);

    nova.dispose();
    throws('once closed, a plugin answers no more calls', () => nova.info(), /closed/);
  }

  // ── An effect with a tail ────────────────────────────────────────────────
  section('An effect that rings on: Valhalla Supermassive');
  const massivePath = find(/ValhallaSupermassive\.vst3$/i);
  if (!massivePath) skip('Valhalla Supermassive is not installed');
  else {
    const verb = await load(massivePath);
    const mix = verb.parameters().find(p => p.title === 'Mix');
    const burst = () => { const d = new Float32Array(SR * 2); d.set(sine(440, 4800, 0.5)); return d; };
    let left = burst(), right = burst();
    verb.process(left, right);
    const ringing = rms(left, SR, SR * 2);
    check(`a tenth of a second of tone is still ringing a second later (${ringing.toFixed(4)})`, ringing > 0.001);
    if (mix) {
      const dry = await load(massivePath);
      dry.setParam(mix.id, 0);
      left = burst(); right = burst();
      dry.process(left, right);
      check(`turned fully dry, it does not (${rms(left, SR, SR * 2).toExponential(1)})`, rms(left, SR, SR * 2) < ringing * 0.01);
      dry.dispose();
    }
    verb.dispose();
  }

  // ── An instrument ────────────────────────────────────────────────────────
  section('An instrument: Surge XT');
  const surgePath = find(/Surge XT\.vst3$/i);
  if (!surgePath) skip('Surge XT is not installed');
  else {
    const about = native.describePlugins(surgePath)[0];
    check('it is recognised as an instrument', about.instrument === true);
    const synth = await load(surgePath);
    const quiet = [new Float32Array(SR / 2), new Float32Array(SR / 2)];
    synth.process(quiet[0], quiet[1]);
    check('with no note it is silent', rms(quiet[0]) < 1e-4);

    // A note placed a tenth of a second into the call starts there, not at once.
    const played = [new Float32Array(SR), new Float32Array(SR)];
    synth.noteOn(57, 0.9, 4800);
    synth.process(played[0], played[1]);
    check(`a note makes sound (${rms(played[0], 9600).toFixed(4)})`, rms(played[0], 9600) > 0.01);
    check('starting where in the block it was placed', rms(played[0], 0, 4700) < 1e-4);

    synth.noteOff(57, 0);
    const after = [new Float32Array(SR * 4), new Float32Array(SR * 4)];
    synth.process(after[0], after[1]);
    check('and dies away once the note is let go', rms(after[0], SR * 3) < rms(played[0], 9600) * 0.05);
    throws('a note outside the keyboard is refused', () => synth.noteOn(200, 0.5, 0), /0 to 127/);
    synth.dispose();
  }
  return { novaPath, surgePath };
}

// ── The desk ───────────────────────────────────────────────────────────────
async function desk({ novaPath, surgePath }) {
  section('The mixing desk');
  const make = strips => new native.Mixdown({ sampleRate: SR, strips });
  const on = extra => Object.assign({ active: true, gain: 1, pan: 0, reverb: 0, echo: 0 }, extra);
  const L = noise(4000, 0.3, 11), R = noise(4000, 0.3, 12);

  let d = make(2);
  d.setStrip(0, on());
  let out = d.process(lump([[L, R]]), L.length, [0]);
  check('a strip at rest passes its sound through untouched', apart(out.left, L) === 0 && apart(out.right, R) === 0);

  d = make(2);
  d.setStrip(0, on({ gain: 0.5 }));
  out = d.process(lump([[L, R]]), L.length, [0]);
  check('the fader scales it', apart(out.left, L.map(v => v * 0.5)) < 1e-7 && apart(out.right, R.map(v => v * 0.5)) < 1e-7);

  // The pan of a stereo track, as the Web Audio API does it: one side is folded into the other.
  const pan = (p, wantL, wantR) => {
    const desk = make(1);
    desk.setStrip(0, on({ pan: p }));
    const o = desk.process(lump([[L, R]]), L.length, [0]);
    return apart(o.left, L.map((v, i) => wantL(v, R[i]))) < 1e-6 && apart(o.right, R.map((v, i) => wantR(L[i], v))) < 1e-6;
  };
  check('panned hard left, both sides come out of the left', pan(-1, (l, r) => l + r, () => 0));
  check('panned hard right, both come out of the right', pan(1, () => 0, (l, r) => r + l));
  check('half way right, the left fades as it crosses over', pan(0.5, l => l * Math.cos(Math.PI / 4), (l, r) => r + l * Math.sin(Math.PI / 4)));
  check('half way left, the mirror image', pan(-0.5, (l, r) => l + r * Math.cos(Math.PI / 4), (l, r) => r * Math.sin(Math.PI / 4)));

  d = make(3);
  d.setStrip(0, on());
  d.setStrip(1, on({ gain: 0 }));
  out = d.process(lump([[L, R], [R, L], [L, L]]), L.length, [0, 1, 2]);
  check('a muted strip and one no track is using add nothing', apart(out.left, L) === 0 && apart(out.right, R) === 0);
  d.setStrip(1, on());
  d.setStrip(2, on());
  d = make(2);
  d.setStrip(0, on());
  d.setStrip(1, on());
  out = d.process(lump([[L, R], [R, L]]), L.length, [0, 1]);
  check('strips add up', apart(out.left, L.map((v, i) => v + R[i])) < 1e-6);

  d = make(1);
  d.setStrip(0, on());
  d.setMaster({ gain: 0.25 });
  out = d.process(lump([[L, R], [R, R]]), L.length, [0, 1]);
  check('the master fader scales the strips, and the metronome joins after it',
    apart(out.left, L.map((v, i) => v * 0.25 + R[i])) < 1e-6 && apart(out.right, R.map(v => v * 0.25 + v)) < 1e-6);

  // A fader that is moved glides, as in the page's engine (15 ms), rather than jumping.
  d = make(1);
  d.setStrip(0, on());
  const ones = new Float32Array(SR / 2).fill(0.5);
  d.process(lump([[ones.subarray(0, 512), ones.subarray(0, 512)]]), 512, [0]);
  d.setStrip(0, on({ gain: 0 }));
  out = d.process(lump([[ones, ones]]), ones.length, [0]);
  check(`a moved fader glides to its new place (${out.left[100].toFixed(3)} after 2 ms, ${out.left[720].toFixed(3)} after 15, ${out.left[9600].toExponential(1)} after 200)`,
    out.left[100] > 0.3 && out.left[720] > 0.1 && out.left[720] < 0.3 && Math.abs(out.left[9600]) < 1e-4);

  throws('a strip that does not exist cannot be set', () => make(2).setStrip(2, on()), /no such strip/);
  throws('nor fed', () => make(2).process(new Float32Array(8), 4, [3]), /no such strip/);
  throws('the audio has to match what it claims to hold', () => make(2).process(new Float32Array(9), 4, [0]), /every frame/);

  // ── Reverb ──
  // A room that is a single clap comes back as a single, later, copy.
  const room = (length, at, level) => { const r = new Float32Array(length); r[at] = level; return r; };
  for (const [at, how] of [[100, 'early in the room'], [700, 'later in it'], [5000, 'much later']]) {
    d = make(1);
    d.setStrip(0, on({ reverb: 1 }));
    d.setMaster({ reverbReturn: 3 });
    d.setReverb(room(6000, at, 0.5), room(6000, at, 0.25));
    const quiet = new Float32Array(8000);
    out = d.process(lump([[Float32Array.from({ length: 16000 }, (u, i) => (i < 4000 ? L[i] : 0)), new Float32Array(16000).map((u, i) => (i < 4000 ? R[i] : 0))]]), 16000, [0]);
    const wantL = new Float32Array(16000), wantR = new Float32Array(16000);
    for (let i = 0; i < 4000; i++) { wantL[i] += L[i]; wantR[i] += R[i]; wantL[i + at] += L[i] * 1.5; wantR[i + at] += R[i] * 0.75; }
    check(`an echo ${how} comes back where and as loud as it should (off by ${Math.max(apart(out.left, wantL), apart(out.right, wantR)).toExponential(1)})`,
      apart(out.left, wantL) < 2e-5 && apart(out.right, wantR) < 2e-5 && quiet.length > 0);
  }
  {
    // A dense, uneven room against the sum worked out the slow way.
    const response = noise(2500, 0.05, 31);
    d = make(1);
    d.setStrip(0, on({ gain: 1, reverb: 1 }));
    d.setMaster({ reverbReturn: 1 });
    d.setReverb(response, response);
    const input = new Float32Array(6000);
    input.set(noise(1500, 0.3, 32));
    // Fed in ragged pieces, as a sound card would ask for it.
    const got = new Float32Array(6000);
    for (const [from, to] of [[0, 1], [1, 300], [300, 811], [811, 2048], [2048, 6000]]) {
      const piece = input.subarray(from, to);
      got.set(d.process(lump([[piece, piece]]), to - from, [0]).left, from);
    }
    const want = Float32Array.from(input);
    for (let n = 0; n < 6000; n++) {
      let sum = 0;
      for (let k = Math.max(0, n - 2499); k <= Math.min(n, 1499); k++) sum += input[k] * response[n - k];
      want[n] += sum;
    }
    check(`a real room matches the sum done the slow way (off by ${apart(got, want).toExponential(1)})`, apart(got, want) < 2e-5);
  }
  throws('the two sides of a room must be the same length', () => make(1).setReverb(new Float32Array(10), new Float32Array(11)), /same length/);

  // ── Echo ──
  d = make(1);
  d.setStrip(0, on({ echo: 1 }));
  d.setMaster({ echoSeconds: 0.25, echoFeedback: 0.34, echoDampHz: 3400, echoDampQ: 0.5 });
  const clap = new Float32Array(SR);
  clap[10] = 0.5;
  out = d.process(lump([[clap, clap]]), SR, [0]);
  const firstEcho = rms(out.left, 12000, 12100), secondEcho = rms(out.left, 24000, 24100);
  // Each repeat has been through the loop's gain (0.34) and its low-pass once more; the filter's small bump at its
  // corner (half a decibel) is the most it can add back.
  check(`an echo repeats at the time set, each one quieter and duller (${firstEcho.toFixed(4)} then ${secondEcho.toFixed(4)})`,
    out.left[10] === 0.5 && Math.abs(peakAt(out.left.subarray(11000, 13000)) + 11000 - 12010) <= 6 &&
    secondEcho < firstEcho * 0.34 * 1.06 && secondEcho > firstEcho * 0.34 * 0.5 && rms(out.left, 1000, 11000) < 1e-6);

  // ── Limiter ──
  d = make(1);
  d.setStrip(0, on());
  d.setMaster({ limiterDelay: 288, limiterGain: 1.1, limiterThresholdDb: -1.5, limiterRatio: 20 });
  out = d.process(lump([[L, R]]), L.length, [0]);
  let late = true;
  for (let i = 288; i < L.length; i++) if (Math.abs(out.left[i] - L[i - 288] * 1.1) > 1e-6) late = false;
  check('below its threshold the limiter only holds the sound back and lifts it, by what it was told', late && d.latency() === 288 && rms(out.left, 0, 288) === 0);
  d = make(1);
  d.setStrip(0, on());
  d.setMaster({ limiterDelay: 288, limiterGain: 1, limiterThresholdDb: -1.5, limiterRatio: 20 });
  const loud = sine(220, SR, 2);
  out = d.process(lump([[loud, loud]]), SR, [0]);
  check(`a sound twice too loud is held near the threshold (peaks at ${peakOf(out.left, SR / 2).toFixed(3)})`,
    peakOf(out.left, SR / 2) < 0.95 && peakOf(out.left, SR / 2) > 0.8 && peakOf(out.left) < 1.3);

  // ── Plugins on the desk ──
  if (!novaPath) skip('TDR Nova is not installed: plugins on a strip');
  else {
    const nova = await load(novaPath);
    const lateBy = nova.info().latency;
    d = make(2);
    d.setStrip(0, on());
    d.setStrip(1, on());
    d.setChain(0, [{ id: 1, plugin: nova }]);
    const click = new Float32Array(8192);
    click[1000] = 0.5;
    const silence = new Float32Array(8192);
    out = d.process(lump([[click, click], [click, click], [click, click]]), 8192, [0, 1, 2]);
    // The plain strip and the metronome are held back to arrive with the one whose plugin takes its time.
    const plain = make(2);
    plain.setStrip(1, on());
    const alone = plain.process(lump([[click, click]]), 8192, [1]);
    check(`a strip with a plugin on it comes out later, and the desk says by how much (${lateBy} samples)`, d.latency() === lateBy && lateBy > 0);
    check('the other strips and the metronome wait for it, so everything still lines up',
      Math.abs(peakAt(out.left) - (1000 + lateBy)) <= 1 && Math.abs(out.left[1000]) < 1e-6 && out.left[1000 + lateBy] > 1.2 && alone.left[1000] === 0.5 && silence.length > 0);

    nova.setBypassed(true);
    d = make(1);
    d.setStrip(0, on());
    d.setChain(0, [{ id: 1, plugin: nova }]);
    d.process(null, SR / 4);
    out = d.process(lump([[L, R]]), L.length, [0]);
    let held = true;
    for (let i = lateBy; i < L.length; i++) if (out.left[i] !== L[i - lateBy]) held = false;
    check('a bypassed plugin keeps the track in its place', held);
    nova.setBypassed(false);

    d = make(1);
    d.setStrip(0, on());
    d.setChain(-1, [{ id: 9, plugin: nova }]);
    out = d.process(lump([[click, click]]), 8192, [0]);
    check('a plugin can sit on the master too', Math.abs(peakAt(out.left) - (1000 + lateBy)) <= 2 && d.latency() === lateBy);
    d.setChain(-1, []);
    check('and be taken off again', d.latency() === 0);

    throws('a chain is a list of plugins with names', () => d.setChain(0, [nova]), /id, plugin/);
    throws('on a strip that exists', () => d.setChain(5, []), /no such strip/);
    nova.dispose();
    throws('and a closed plugin cannot be put on a strip', () => d.setChain(0, [{ id: 1, plugin: nova }]), /open plugins/);
  }

  if (!surgePath) skip('Surge XT is not installed: an instrument on a strip');
  else {
    const synth = await load(surgePath);
    d = make(2);
    d.setStrip(0, on());
    d.setChain(0, [{ id: 7, plugin: synth }]);
    const taken = d.schedule([
      { plugin: 7, frame: 24000, on: true, pitch: 57, velocity: 0.9 },
      { plugin: 7, frame: 48000, on: false, pitch: 57 },
      { plugin: 99, frame: 100, on: true, pitch: 60, velocity: 1 },     // for a plugin that is not there: ignored
      { plugin: 7, frame: 100, on: true, pitch: 300, velocity: 1 },     // not a note: refused
    ]);
    const parts = [];
    for (let i = 0; i < 5; i++) parts.push(d.process(null, SR / 2 + (i === 4 ? SR * 2 : 0)).left);
    const all = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
    parts.reduce((at, p) => { all.set(p, at); return at + p.length; }, 0);
    check('notes sent to an instrument on a strip are taken', taken === 3);
    check(`the note starts on the sample it was written for (${rms(all, 0, 23990).toExponential(1)} before, ${rms(all, 24100, 30000).toFixed(4)} after)`,
      rms(all, 0, 23990) < 1e-4 && rms(all, 24100, 30000) > 0.01);
    check('and stops when its end comes', rms(all, SR * 4) < rms(all, 24100, 30000) * 0.05);
    synth.dispose();
  }
}

// ── A sound card ───────────────────────────────────────────────────────────
// Keeps a card's stream topped up for a while. `next(frames)` returns the lump for those frames.
async function feedFor(io, ms, slots, next, pace) {
  const began = Date.now();
  let pushed = 0;
  while (Date.now() - began < ms) {
    if (pace) {
      // By the clock, at a rate of the caller's choosing: the page's clock is never quite the card's.
      const due = Math.floor((Date.now() - began) / 1000 * pace);
      while (pushed + 256 <= due) { io.push(next(256), 256, slots); pushed += 256; }
    } else {
      while (io.status().buffered < SR / 8) { io.push(next(512), 512, slots); pushed += 512; }
    }
    await wait(4);
  }
  return pushed;
}

async function card({ surgePath }) {
  section('Sound cards');
  const devices = native.audioDevices();
  check('the ASIO drivers on this computer are listed by name, without being loaded', Array.isArray(devices.asio) && devices.asio.includes(TEST_DRIVER));
  check('so is what Windows can play through', Array.isArray(devices.windows) && devices.windows.every(w => typeof w.name === 'string' && w.outputs + w.inputs > 0));
  const about = native.describeAsio(TEST_DRIVER);
  check('a driver says what it can do', about.inputs === 2 && about.outputs === 2 && about.rates.includes(48000) && about.preferredBuffer === 256 &&
    about.outputNames[0] === 'Test out 1' && about.sampleType === '32-bit');
  throws('a driver that is not installed is refused by name', () => native.describeAsio('No Such Driver'), /no ASIO driver called/);
  throws('a card needs a system to be opened through', () => new native.AudioIO().open({ api: 'carrier pigeon' }), /asio.*wasapi/);
  throws('and an ASIO driver needs naming', () => new native.AudioIO().open({ api: 'asio' }), /named/);

  section('Playing through an ASIO driver');
  const io = new native.AudioIO();
  check('before a card is opened there is nothing to report or feed', io.status().open === false && io.push(new Float32Array(4), 2, [0]) === false);
  throws('nor a desk to set', () => io.setStrip(0, { gain: 1 }), /not open/);
  const opened = io.open({ api: 'asio', device: TEST_DRIVER, useInput: true, sampleRate: SR, bufferFrames: 256, strips: 4 });
  check(`the driver opens at what was asked (${opened.sampleRate} Hz, blocks of ${opened.bufferFrames})`,
    opened.sampleRate === SR && opened.bufferFrames === 256 && opened.inputs === 2 && opened.strips === 4 && opened.asio.sampleType === '32-bit');
  check('and says how late its output and input are', opened.outputLatency === 288 && opened.inputLatency === 272);
  io.setStrip(0, { active: true, gain: 1 });
  io.setRecording(true);

  // Noise, so that any stretch of it can be found again exactly.
  const source = noise(SR * 4, 0.3, 101);
  let at = 0;
  const next = frames => {
    const l = new Float32Array(frames);
    for (let i = 0; i < frames; i++) l[i] = source[(at + i) % source.length];
    at += frames;
    return lump([[l, l]]);
  };
  const heard = [new Float32Array(SR * 3), new Float32Array(SR * 3)];
  let heardFrames = 0;
  const collect = () => {
    const l = new Float32Array(SR), r = new Float32Array(SR);
    const take = io.readInput(l, r);
    heard[0].set(l.subarray(0, Math.min(take.frames, heard[0].length - heardFrames)), heardFrames);
    heardFrames = Math.min(heard[0].length, heardFrames + take.frames);
    return take;
  };
  const collector = setInterval(collect, 100);
  await feedFor(io, 1500, [0], next);
  clearInterval(collector);
  const s = io.status();
  check(`the card asks for blocks steadily and is never kept waiting (${s.blocks} blocks, ${s.underruns} dropouts, ${(s.load * 100).toFixed(1)}% of its time used)`,
    s.open && s.flowing && s.blocks > 200 && s.underruns === 0 && s.lost === 0 && s.idleSeconds < 0.2);
  check('with clocks that agree, nothing is squeezed in or out', s.slips === 0);
  const mixL = new Float32Array(8192), mixR = new Float32Array(8192);
  const got = io.capture(mixL, mixR);
  collect();
  // The mix is the noise that was fed: find where.
  const locate = (hay, needle, within) => {
    for (let lag = 0; lag + needle.length <= hay.length; lag++) {
      let same = true;
      for (let i = 0; i < needle.length && same; i += 7) if (Math.abs(hay[lag + i] - needle[i]) > within) same = false;
      if (same && apart(hay.subarray(lag, lag + needle.length), needle) <= within) return lag;
    }
    return -1;
  };
  const twice = new Float32Array(source.length * 2);
  twice.set(source); twice.set(source, source.length);
  check('what reaches the card is exactly what was fed, sample for sample', got === 8192 && locate(twice, mixL.subarray(4096, 5120), 0) >= 0);
  // The stand-in driver hands back as input what it was given to play: through its 32-bit whole numbers and back,
  // which is exact to a part in four thousand million.
  const back = heard[0].subarray(Math.max(0, heardFrames - 6000), heardFrames - 2000);
  check(`and what comes back in through the driver is the same again (${heardFrames} frames recorded)`, heardFrames > SR && locate(twice, back.subarray(0, 1024), 1 / 2147483648) >= 0);
  check('the levels of the strips and the master are there to read', s.peaks.length === 10 && s.peaks[0] > 0.25 && s.peaks[0] <= 0.3001 && s.peaks[8] > 0.25 && s.peaks[2] === 0);

  // Paused, for a mixdown: the card goes on being fed silence and the desk is left alone.
  io.setPaused(true);
  await wait(300);
  io.capture(mixL, mixR);
  check('paused, the card plays silence', rms(mixL, 4096) === 0 && io.status().blocks > s.blocks);
  io.setPaused(false);

  // A stream that stops is waited for, not looped or stuttered.
  io.flush();
  await wait(400);
  const dry = io.status();
  check('with nothing coming in, the card is given silence and waits', dry.flowing === false && dry.buffered === 0 && dry.blocks > s.blocks);
  io.setRecording(false);
  io.close();
  check('and it closes', io.status().open === false);

  // More than there is room for is turned away whole, and counted.
  {
    const full = new native.AudioIO();
    full.open({ api: 'asio', device: TEST_DRIVER + ' (stalled)', sampleRate: SR, strips: 1, muted: true });
    let taken = 0, refused = 0;
    for (let i = 0; i < 400; i++) (full.push(new Float32Array(1024), 512, [0]) ? taken++ : refused++);
    const st = full.status();
    await wait(600);
    const later = full.status();
    check(`a driver that opens but never asks for sound is noticed (${later.blocks} blocks in ${later.idleSeconds.toFixed(1)} s)`, later.open && later.blocks === 0 && later.idleSeconds > 0.5);
    check(`what there is no room for is turned away and counted (${taken} lumps taken, ${refused} not)`, taken > 50 && refused > 50 && st.lost === refused * 512 && st.received === taken * 512);
    const before = Date.now();
    full.close();
    check(`and closing it does not hang (${Date.now() - before} ms)`, Date.now() - before < 1500 && full.status().open === false);
  }

  section('The formats drivers keep their samples in');
  for (const [kind, name, fine] of [[' (16-bit)', '16-bit', 1 / 32768], [' (24-bit)', '24-bit', 1 / 8388608], [' (float)', '32-bit float', 0]]) {
    const dev = new native.AudioIO();
    const o = dev.open({ api: 'asio', device: TEST_DRIVER + kind, useInput: true, sampleRate: SR, bufferFrames: 256, strips: 1, muted: false });
    dev.setStrip(0, { active: true, gain: 1 });
    dev.setRecording(true);
    let n = 0;
    await feedFor(dev, 700, [0], frames => {
      const l = new Float32Array(frames);
      for (let i = 0; i < frames; i++, n++) l[i] = 0.5 * Math.sin(2 * Math.PI * 441 * n / SR);
      return lump([[l, l]]);
    });
    const l = new Float32Array(SR), r = new Float32Array(SR);
    const take = dev.readInput(l, r);
    const tone = l.subarray(take.frames - 9600, take.frames);
    // Against a perfect tone of the same level: the only difference allowed is the format's own step size.
    let worst = 0;
    const level = 0.5, w = 2 * Math.PI * 441 / SR;
    // Find the phase from two neighbouring samples, then compare the rest.
    const phase = Math.atan2(tone[0] * Math.sin(w), tone[1] - tone[0] * Math.cos(w));
    for (let i = 0; i < tone.length; i++) worst = Math.max(worst, Math.abs(tone[i] - level * Math.sin(phase + w * i)));
    check(`${name}: a tone goes out and comes back whole (${o.asio.sampleType}, off by at most ${worst.toExponential(1)})`,
      o.asio.sampleType === name && take.frames > 20000 && worst < fine * 2 + 2e-4 && Math.abs(rms(tone) - 0.5 / Math.SQRT2) < 1e-3);
    dev.close();
  }

  section('Drivers with a mind of their own');
  {
    const fixed = new native.AudioIO();
    const o = fixed.open({ api: 'asio', device: TEST_DRIVER + ' (fixed)', sampleRate: 96000, bufferFrames: 64, strips: 1, muted: true });
    check(`a driver that only does one rate and one block size is taken as it is (${o.sampleRate} Hz, ${o.bufferFrames})`,
      o.sampleRate === 44100 && o.bufferFrames === 256 && o.asio.rates.length === 1);
    await wait(300);
    check('and runs', fixed.status().blocks > 20);
    fixed.close();

    const sized = new native.AudioIO();
    const p = sized.open({ api: 'asio', device: TEST_DRIVER, sampleRate: 44100, bufferFrames: 100, strips: 1, muted: true });
    check(`an odd block size is rounded to one the driver allows (${p.bufferFrames})`, p.bufferFrames === 128 && p.sampleRate === 44100);
    const second = new native.AudioIO();
    throws('only one ASIO driver can be open at a time', () => second.open({ api: 'asio', device: TEST_DRIVER + ' (float)', strips: 1 }), /already open/);
    sized.close();

    const moody = new native.AudioIO();
    moody.open({ api: 'asio', device: TEST_DRIVER + ' (resets)', sampleRate: SR, strips: 1, muted: true });
    let asked = false;
    for (let i = 0; i < 40 && !asked; i++) { await wait(50); asked = moody.status().resetWanted; }
    check('a driver whose settings changed asks to be opened again, once', asked === true && moody.status().resetWanted === false);
    moody.close();
  }

  section('Two clocks');
  for (const [pace, how] of [[SR * 1.003, 'fast'], [SR * 0.997, 'slow']]) {
    const dev = new native.AudioIO();
    dev.open({ api: 'asio', device: TEST_DRIVER, sampleRate: SR, bufferFrames: 256, strips: 1, muted: true });
    dev.setStrip(0, { active: true, gain: 1 });
    let n = 0;
    const tone = frames => {
      const l = new Float32Array(frames);
      for (let i = 0; i < frames; i++, n++) l[i] = 0.5 * Math.sin(2 * Math.PI * 1000 * n / SR);
      return lump([[l, l]]);
    };
    await feedFor(dev, 6500, [0], tone, pace);
    const st = dev.status();
    const l = new Float32Array(SR), r = new Float32Array(SR);
    dev.capture(l, r);
    // A frame eased in or out must leave no click: the tone stays a clean tone.
    let jump = 0;
    for (let i = 1; i < l.length; i++) jump = Math.max(jump, Math.abs(l[i] - l[i - 1]));
    const steady = 0.5 * 2 * Math.sin(Math.PI * 1000 / SR);      // the largest step a clean tone of this pitch takes
    check(`a page clock running ${how} is followed by easing single frames ${pace > SR ? 'out' : 'in'} (${st.slips} of them, ${st.underruns} dropouts, ${st.buffered} frames in hand)`,
      st.slips > 350 && st.slips < 750 && st.underruns === 0 && st.lost === 0 && st.buffered > 1000 && st.buffered < 3500);
    check(`without a click (largest step ${jump.toFixed(4)}, a clean tone's is ${steady.toFixed(4)})`, jump < steady * 1.05 && Math.abs(rms(l) - 0.5 / Math.SQRT2) < 2e-3);
    dev.close();
  }

  section('Playing a plugin instrument in time');
  if (!surgePath) skip('Surge XT is not installed');
  else {
    const synth = await load(surgePath);
    const dev = new native.AudioIO();
    dev.open({ api: 'asio', device: TEST_DRIVER, useInput: true, sampleRate: SR, bufferFrames: 256, strips: 2, muted: false });
    dev.setStrip(0, { active: true, gain: 1 });
    dev.setStrip(1, { active: true, gain: 1 });
    dev.setChain(0, [{ id: 3, plugin: synth }]);
    dev.setRecording(true);
    // A click on the second strip at a known place in the stream, and a note written for the same place.
    const CLICK = SR;
    let n = 0;
    dev.schedule([{ plugin: 3, frame: CLICK, on: true, pitch: 57, velocity: 0.9 }, { plugin: 3, frame: CLICK + SR / 2, on: false, pitch: 57 }]);
    const stream = frames => {
      const l = new Float32Array(frames);
      for (let i = 0; i < frames; i++, n++) if (n === CLICK) l[i] = 0.9;
      return lump([[l, l]]);
    };
    const all = new Float32Array(SR * 4);
    let have = 0;
    const gather = setInterval(() => {
      const l = new Float32Array(SR), r = new Float32Array(SR);
      const take = dev.readInput(l, r);
      all.set(l.subarray(0, Math.min(take.frames, all.length - have)), have);
      have = Math.min(all.length, have + take.frames);
    }, 100);
    await feedFor(dev, 2600, [1], stream);
    clearInterval(gather);
    const clickAt = peakAt(all.subarray(0, have));
    check(`the note begins with the click it was written to land on (${rms(all, clickAt - 4800, clickAt - 4).toExponential(1)} just before, ${rms(all, clickAt + 48, clickAt + 4800).toFixed(4)} just after)`,
      all[clickAt] > 0.8 && rms(all, clickAt - 4800, clickAt - 4) < 1e-4 && rms(all, clickAt + 48, clickAt + 4800) > 0.01);
    check('and ends when its end comes', rms(all, clickAt + SR * 1.3, clickAt + SR * 1.4) < rms(all, clickAt + 48, clickAt + 4800) * 0.05);
    dev.clearEvents();
    dev.close();
    synth.dispose();
  }

  section('Hearing the input');
  {
    const dev = new native.AudioIO();
    dev.open({ api: 'asio', device: TEST_DRIVER, useInput: true, sampleRate: SR, bufferFrames: 256, strips: 2, muted: false });
    dev.setStrip(0, { active: true, gain: 1 });
    dev.setStrip(1, { active: true, gain: 1 });
    let n = 0;
    const burst = frames => {
      const l = new Float32Array(frames);
      for (let i = 0; i < frames; i++, n++) if (n > SR / 4 && n < SR / 4 + 2400) l[i] = 0.5 * Math.sin(2 * Math.PI * 500 * n / SR);
      return lump([[l, l]]);
    };
    await feedFor(dev, 900, [0], burst);
    const l = new Float32Array(9600), r = new Float32Array(9600);
    dev.capture(l, r);
    const without = rms(l);
    // The stand-in's input is its own output, so passing the input through a strip makes the burst come round again, quieter each time.
    n = 0;
    dev.setMonitor(1, 0.97);
    await feedFor(dev, 900, [0], burst);
    dev.capture(l, r);
    const withIt = rms(l);
    dev.setMonitor(-1, 1);
    check(`the card's input can be passed through a strip (${without.toExponential(1)} without, ${withIt.toFixed(4)} with)`, without < 1e-6 && withIt > 0.01);
    dev.close();
  }

  section('Playing through Windows');
  const windowsOut = devices.windows.find(w => w.defaultOutput);
  if (!windowsOut) skip('Windows has no output to play through');
  else {
    const dev = new native.AudioIO();
    let o = null;
    try { o = dev.open({ api: 'wasapi', strips: 2, muted: true }); } catch (e) { skip('the default output would not open: ' + e.message); }
    if (o) {
      dev.setStrip(0, { active: true, gain: 1 });
      let n = 0;
      await feedFor(dev, 2000, [0], frames => {
        const l = new Float32Array(frames);
        for (let i = 0; i < frames; i++, n++) l[i] = 0.5 * Math.sin(2 * Math.PI * 440 * n / o.sampleRate);
        return lump([[l, l]]);
      });
      const st = dev.status();
      const l = new Float32Array(4800), r = new Float32Array(4800);
      dev.capture(l, r);
      if (st.blocks < 20) skip(`"${o.device}" opened but is not running (${st.blocks} blocks in two seconds)`);
      else {
        check(`the default output runs, muted (${o.device}, ${o.sampleRate} Hz, ${st.blocks} blocks, ${st.underruns} dropouts)`, st.flowing && st.underruns <= 1);
        check(`and is given the tone at its own level (${rms(l).toFixed(4)})`, Math.abs(rms(l) - 0.5 / Math.SQRT2) < 2e-3);
      }
      dev.close();
    }
    throws('an output Windows does not list is refused by name', () => new native.AudioIO().open({ api: 'wasapi', device: 'No Such Speakers', strips: 1 }), /no longer lists/);
  }
}

(async () => {
  const found = await plugins();
  await desk(found);
  await card(found);
  console.log(`\n${passed} passed, ${failed} failed${skipped ? ', ' + skipped + ' skipped' : ''}`);
  if (failed) {
    console.error('\nFailed checks:');
    failures.forEach(f => console.error('  - ' + f));
  }
  // Plugins and drivers keep threads of their own alive; say goodbye rather than wait for them.
  setTimeout(() => process.exit(failed ? 1 : 0), 100);
})().catch(e => { console.error(e); process.exit(1); });
