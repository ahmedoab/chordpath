/* ChordPath — tests for the native audio host (VST 3 plugins and sound cards).
 * Run with: node tests/native-test.js
 * Needs the host built (npm run build:native). Checks that depend on a
 * particular plugin are skipped where that plugin is not installed; the
 * plugins used are free ones: TDR Nova, Valhalla Supermassive and Surge XT.
 * Nothing is played aloud.
 */
'use strict';

const path = require('path');
const fs = require('fs');
const ROOT = path.join(__dirname, '..');
const BUILT = path.join(ROOT, 'native', 'build', 'Release', 'chordpath_native.node');

let passed = 0, failed = 0, skipped = 0;
const failures = [];
function check(label, cond) {
  if (cond) passed++;
  else { failed++; failures.push(label); console.error('  FAIL: ' + label); }
}
function throws(label, fn, pattern) {
  try { fn(); check(label, false); }
  catch (e) { check(label, !pattern || pattern.test(e.message)); }
}
function section(name) { console.log('\n== ' + name + ' =='); }
function skip(what) { skipped++; console.log('  (skipped: ' + what + ')'); }

if (!fs.existsSync(BUILT)) {
  console.log('The native host has not been built (npm run build:native), so there is nothing to test.');
  process.exit(0);
}
const native = require(BUILT);

const SR = 44100;
const rms = (d, from, to) => { let s = 0; const a = from || 0, b = to == null ? d.length : to; for (let i = a; i < b; i++) s += d[i] * d[i]; return Math.sqrt(s / Math.max(1, b - a)); };
const sine = (hz, n, level) => Float32Array.from({ length: n }, (unused, i) => level * Math.sin(2 * Math.PI * hz * i / SR));
const find = pattern => native.pluginPaths().find(p => pattern.test(p)) || null;
const load = (file, extra) => {
  const d = native.describePlugins(file)[0];
  return new native.Plugin(Object.assign({ path: d.path, uid: d.uid, sampleRate: SR, blockSize: 512 }, extra));
};

// ── Finding plugins ────────────────────────────────────────────────────────
section('Finding plugins');
const paths = native.pluginPaths();
check('the places plugins are installed can be listed', Array.isArray(paths) && paths.every(p => typeof p === 'string' && /\.vst3$/i.test(p)));
throws('a file that is not there is refused with a reason', () => native.describePlugins('C:/no/such/plugin.vst3'), /./);
throws('so is something that is not a plugin', () => native.describePlugins(path.join(ROOT, 'package.json')), /./);
throws('the path has to be text', () => native.describePlugins(42), /text/);
throws('a plugin cannot be made from nothing', () => new native.Plugin(), /path/);
throws('nor from a file that is not a plugin', () => new native.Plugin({ path: path.join(ROOT, 'package.json'), sampleRate: SR }), /./);

// ── An effect ──────────────────────────────────────────────────────────────
section('An effect: TDR Nova');
const novaPath = find(/TDR Nova\.vst3$/i);
if (!novaPath) skip('TDR Nova is not installed');
else {
  const about = native.describePlugins(novaPath);
  check('the file says what is in it', about.length === 1 && /Nova/.test(about[0].name) && about[0].instrument === false && /^[0-9A-F]{32}$/.test(about[0].uid));
  throws('asking for a plugin the file does not hold is refused', () => new native.Plugin({ path: novaPath, uid: '0'.repeat(32), sampleRate: SR }), /not in the file/);
  throws('an impossible sample rate is refused', () => new native.Plugin({ path: novaPath, sampleRate: 5 }), /range/);

  const nova = load(novaPath);
  const info = nova.info();
  check('it is a stereo effect with a window of its own', info.inputs === 2 && info.outputs === 2 && info.hasEditor === true && info.instrument === false);
  check('it says how late its output is', Number.isInteger(info.latency) && info.latency >= 0 && info.latency < SR);

  // Flat, an equaliser changes nothing: a tone comes out as it went in, only later.
  const left = sine(440, SR, 0.5), right = sine(440, SR, 0.25);
  nova.process(left, right);
  check(`a tone passes through at its own level (${rms(left, 8000).toFixed(4)} and ${rms(right, 8000).toFixed(4)})`,
    Math.abs(rms(left, 8000) - 0.5 / Math.SQRT2) < 0.01 && Math.abs(rms(right, 8000) - 0.25 / Math.SQRT2) < 0.005);
  check('by as many samples as it said', (() => {
    const fresh = load(novaPath);
    const a = new Float32Array(4096), b = new Float32Array(4096);
    a[100] = b[100] = 1;
    fresh.process(a, b);
    let peak = 0;
    for (let i = 0; i < a.length; i++) if (Math.abs(a[i]) > Math.abs(a[peak])) peak = i;
    fresh.dispose();
    return Math.abs(peak - (100 + info.latency)) <= 2;
  })());

  // Any length of audio, in one call or many, gives the same result.
  const whole = load(novaPath), pieces = load(novaPath);
  const wl = sine(330, 5000, 0.4), wr = sine(330, 5000, 0.4);
  const pl = Float32Array.from(wl), pr = Float32Array.from(wr);
  whole.process(wl, wr);
  for (const [from, to] of [[0, 1], [1, 700], [700, 713], [713, 5000]]) pieces.process(pl.subarray(from, to), pr.subarray(from, to));
  let apart = 0;
  for (let i = 0; i < wl.length; i++) apart = Math.max(apart, Math.abs(wl[i] - pl[i]));
  check(`odd-sized pieces give what one call gives (off by ${apart.toExponential(1)})`, apart < 1e-5);
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

  // State: a second instance given the first one's state holds the same settings.
  const saved = nova.getState();
  const twin = load(novaPath);
  check('its state can be saved and given to another instance', saved.length > 16 && twin.setState(saved) === true &&
    (!gain || Math.abs(twin.getParam(gain.id) - nova.getParam(gain.id)) < 1e-6));
  check('rubbish is not accepted as a state', twin.setState(new Uint8Array([1, 2, 3])) === false && twin.setState(new Uint8Array(64)) === false);
  throws('nor anything that is not bytes', () => twin.setState('state'), /bytes/);
  twin.dispose();

  // Bypassed, the audio is left exactly as it came.
  nova.setBypassed(true);
  const bl = sine(200, 2048, 0.3), br = sine(200, 2048, 0.3), keep = Float32Array.from(bl);
  nova.process(bl, br);
  check('bypassed, the audio is left exactly as it came', nova.info().bypassed === true && bl.every((v, i) => v === keep[i]));
  nova.setBypassed(false);

  throws('audio has to come as two equal Float32Arrays', () => nova.process(new Float32Array(8), new Float32Array(9)), /same length/);
  throws('and nothing else', () => nova.process([0, 0], [0, 0]), /Float32Array/);

  // Its window, opened out of sight.
  check('its window opens', nova.openEditor({ title: 'Test', visible: false }) === true);
  native.pumpMessages(250);
  const editor = nova.editor();
  check(`at the size the plugin wants (${editor.width} x ${editor.height})`, editor.open === true && editor.width > 100 && editor.height > 100);
  nova.closeEditor();
  check('and closes', nova.editor().open === false);

  nova.dispose();
  throws('once closed, a plugin answers no more calls', () => nova.info(), /closed/);
}

// ── An effect with a tail ──────────────────────────────────────────────────
section('An effect that rings on: Valhalla Supermassive');
const massivePath = find(/ValhallaSupermassive\.vst3$/i);
if (!massivePath) skip('Valhalla Supermassive is not installed');
else {
  const verb = load(massivePath);
  const mix = verb.parameters().find(p => p.title === 'Mix');
  const burst = () => { const d = new Float32Array(SR * 2); d.set(sine(440, 4410, 0.5)); return d; };
  let left = burst(), right = burst();
  verb.process(left, right);
  const ringing = rms(left, SR, SR * 2);
  check(`a tenth of a second of tone is still ringing a second later (${ringing.toFixed(4)})`, ringing > 0.001);
  if (mix) {
    verb.setParam(mix.id, 0);
    const dry = load(massivePath);
    dry.setParam(mix.id, 0);
    left = burst(); right = burst();
    dry.process(left, right);
    check(`turned fully dry, it does not (${rms(left, SR, SR * 2).toExponential(1)})`, rms(left, SR, SR * 2) < ringing * 0.01);
    dry.dispose();
  }
  verb.dispose();
}

// ── An instrument ──────────────────────────────────────────────────────────
section('An instrument: Surge XT');
const surgePath = find(/Surge XT\.vst3$/i);
if (!surgePath) skip('Surge XT is not installed');
else {
  const about = native.describePlugins(surgePath)[0];
  check('it is recognised as an instrument', about.instrument === true);
  const synth = load(surgePath);
  const quiet = [new Float32Array(SR / 2), new Float32Array(SR / 2)];
  synth.process(quiet[0], quiet[1]);
  check('with no note it is silent', rms(quiet[0]) < 1e-4);

  // A note placed 4410 samples into the call starts there, not at once.
  const played = [new Float32Array(SR), new Float32Array(SR)];
  synth.noteOn(57, 0.9, 4410);
  synth.process(played[0], played[1]);
  check(`a note makes sound (${rms(played[0], 8820).toFixed(4)})`, rms(played[0], 8820) > 0.01);
  check('starting where in the block it was placed', rms(played[0], 0, 4300) < 1e-4);

  synth.noteOff(57, 0);
  const after = [new Float32Array(SR * 4), new Float32Array(SR * 4)];
  synth.process(after[0], after[1]);
  check('and dies away once the note is let go', rms(after[0], SR * 3) < rms(played[0], 8820) * 0.05);
  throws('a note outside the keyboard is refused', () => synth.noteOn(200, 0.5, 0), /0 to 127/);
  synth.dispose();
}

console.log(`\n${passed} passed, ${failed} failed${skipped ? ', ' + skipped + ' skipped' : ''}`);
if (failed) {
  console.error('\nFailed checks:');
  failures.forEach(f => console.error('  - ' + f));
  process.exit(1);
}
