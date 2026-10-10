/* ChordPath — headless playback-scheduling test.
 * Run with: node tests/audio-test.js
 * Stubs Tone.js so audio.js loads in Node, then checks that playSong chains
 * sections in order, honours repeats, fires onDone, and that stop() halts
 * the chain. Uses real (fast) timers.
 */
'use strict';

const path = require('path');
const ROOT = path.join(__dirname, '..');

let passed = 0, failed = 0;
function check(label, cond) {
  if (cond) passed++;
  else { failed++; console.error('  FAIL: ' + label); }
}

// ── Tone stub ──────────────────────────────────────────────────────────────
class StubNode {
  constructor() { this.volume = { value: 0 }; this.envelope = {}; }
  connect() { return this; }
  toDestination() { return this; }
  disconnect() { return this; }
  dispose() {}
  triggerAttackRelease() {}
}
globalThis.Tone = new Proxy({ start: async () => {} }, {
  get(target, prop) {
    if (prop in target) return target[prop];
    return StubNode; // any constructor: Limiter, Reverb, PolySynth, ...
  },
});

// ── Load modules ───────────────────────────────────────────────────────────
[
  'theory/scales.js', 'theory/chords.js', 'theory/voicings.js',
  'theory/progressions.js', 'theory/analysis.js', 'theory/genres.js',
  'theory/arrangements.js', 'theory/emotions.js', 'theory/descriptions.js',
  'theory/songs.js', 'theory/melody.js', 'theory/song.js', 'theory/feelings.js',
  'audio.js',
].forEach(f => require(path.join(ROOT, f)));

const { Audio, Song, Feelings } = globalThis;

async function main() {
  check('playSong exported', typeof Audio.playSong === 'function');
  check('playBacking still exported', typeof Audio.playBacking === 'function');

  const song = Feelings.generateSongSpec({ feelingId: 'yearning', genreId: 'pop', energy: 'low', seed: 3 });
  let items = Song.buildPlayback(song).slice(0, 3);
  // One chord per section at tempo 240 → 16 steps x 62.5ms = 1000ms/section.
  items = items.map(it => Object.assign({}, it, { tempo: 240, chords: it.chords.slice(0, 1) }));

  // Order + completion.
  const seen = [];
  let done = false;
  Audio.playSong(items, {
    onSectionStart: (i, item) => seen.push(i),
    onDone: () => { done = true; },
  });
  await new Promise(r => setTimeout(r, 3500));
  check('sections chain in order', seen.join(',') === '0,1,2');
  check('onDone fires after the last section', done);

  // Repeat expansion.
  const seen2 = [];
  const rep = items.map(it => Object.assign({}, it, { repeat: 2 }));
  let done2 = false;
  Audio.playSong(rep, {
    onSectionStart: i => seen2.push(i),
    onDone: () => { done2 = true; },
  });
  await new Promise(r => setTimeout(r, 6800));
  check('repeat: 2 plays each section twice in order', seen2.join(',') === '0,0,1,1,2,2');
  check('onDone fires after repeats', done2);

  // stop() halts the chain.
  const seen3 = [];
  Audio.playSong(items, { onSectionStart: i => seen3.push(i) });
  await new Promise(r => setTimeout(r, 300));
  Audio.stop();
  const atStop = seen3.length;
  await new Promise(r => setTimeout(r, 1500));
  check('stop() halts section chaining', seen3.length === atStop && atStop < 3);

  // Loop restarts from the first section.
  const seen4 = [];
  let loopOn = true;
  Audio.playSong(items.slice(0, 2), {
    loop: () => loopOn,
    onSectionStart: i => seen4.push(i),
  });
  await new Promise(r => setTimeout(r, 3300));
  loopOn = false;
  Audio.stop();
  check('loop re-enters section 0 after the last section',
    seen4.length >= 3 && seen4.slice(0, 3).join(',') === '0,1,0');

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
