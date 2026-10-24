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
// Every sound asked for is written down: which kind of instrument, which
// note, and when, so the tests can check what would have been heard.
const heard = [];
let clockZero = Date.now();
class StubNode {
  constructor() { this.volume = { value: 0 }; this.envelope = {}; }
  connect() { return this; }
  toDestination() { return this; }
  disconnect() { return this; }
  dispose() {}
  triggerAttackRelease(note) { heard.push({ kind: this.kind, note, at: Date.now() - clockZero }); }
}
const kinds = {};
globalThis.Tone = new Proxy({ start: async () => {} }, {
  get(target, prop) {
    if (prop in target) return target[prop];
    // any constructor: Limiter, Reverb, PolySynth, ... each remembering what it is
    if (!kinds[prop]) kinds[prop] = class extends StubNode { constructor(...a) { super(...a); this.kind = prop; } };
    return kinds[prop];
  },
});

// ── Load modules ───────────────────────────────────────────────────────────
[
  'theory/scales.js', 'theory/chords.js', 'theory/voicings.js',
  'theory/progressions.js', 'theory/analysis.js', 'theory/genres.js',
  'theory/arrangements.js', 'theory/emotions.js', 'theory/descriptions.js',
  'theory/songs.js', 'theory/melody.js', 'theory/meters.js', 'theory/song.js', 'theory/feelings.js',
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

  // ── A section in 6/8, played from its charts ──
  // At 240 bpm a sixteenth is 62.5 ms and a bar of 6/8 (twelve of them) 750 ms.
  const six = Song.createSong({ key: 'G', tempo: 240, meter: { num: 6, den: 8 } });
  const sec = Song.createSection({ role: 'verse', progSpecs: ['G:maj', 'C:maj'], rhythmPattern: 'six_eight_sway', drumPattern: 'six_eight_ballad' });
  six.sections.push(sec);
  const sixItems = Song.buildPlayback(six);
  heard.length = 0;
  clockZero = Date.now();
  let sixDone = 0;
  Audio.playSong(sixItems, { onDone: () => { sixDone = Date.now() - clockZero; } });
  await new Promise(r => setTimeout(r, 1900));
  const near = (list, want) => want.every(w => list.some(t => Math.abs(t - w) <= 35));
  const kicks = heard.filter(h => h.kind === 'MembraneSynth' && h.note === 'C1').map(h => h.at);
  const strums = heard.filter(h => h.kind === 'PolySynth').map(h => h.at);
  const bass = heard.filter(h => h.kind === 'MonoSynth');
  check(`two chords of 6/8 last two 6/8 bars (${sixDone} ms, not the 2000 of 4/4 bars)`, sixDone > 1400 && sixDone < 1700);
  check(`the kick lands on each 6/8 bar (${kicks.join(', ')})`, kicks.length === 2 && near(kicks, [0, 750]));
  check('the strums fall where the chart puts them: 1, the lift before 4, 4, the lift before 1', near(strums, [0, 250, 375, 625, 750, 1000, 1125, 1375]) && !strums.some(t => Math.abs(t - 500) < 20));
  check(`the bass plays the root and then the fifth in each bar (${bass.map(b => b.note).join(' ')})`,
    bass.length === 4 && bass[0].note === 'G2' && bass[1].note === 'D3' && bass[2].note === 'C3' && near(bass.map(b => b.at), [0, 375, 750, 1125]));

  // The plain chord player follows the time too.
  heard.length = 0;
  clockZero = Date.now();
  let plainDone = 0;
  await Audio.playProgression(Song.chordsOf(six, sec), { tempo: 240, style: 'strum', meter: { num: 3, den: 4 }, onDone: () => { plainDone = Date.now() - clockZero; } });
  await new Promise(r => setTimeout(r, 1700));
  check(`chords played on their own in 3/4 last a 3/4 bar each (${plainDone} ms)`, plainDone > 1400 && plainDone < 1700);

  const wait = ms => new Promise(r => setTimeout(r, ms));

  // ── The beat lights count the pulses of the time ──
  const lights = [];
  Audio.playSong(sixItems, { onBeat: b => lights.push(b) });
  await wait(800);
  Audio.stop();
  check(`a bar of 6/8 lights six beats, one after another (${lights.join(',')})`, lights.slice(0, 6).join(',') === '0,1,2,3,4,5');

  // ── Chords half a bar long, in a 4/4 style ──
  // At 240 bpm a 4/4 bar is 1000 ms, so each chord should last 500.
  const half = Song.createSong({ key: 'C', tempo: 240 });
  half.sections.push(Song.createSection({ progSpecs: ['C:maj', 'G:maj'], rhythmPattern: 'pop_eights', drumPattern: 'pop_backbeat', beatsPerChord: 2 }));
  heard.length = 0;
  clockZero = Date.now();
  const chordStarts = [];
  let halfDone = 0;
  Audio.playSong(Song.buildPlayback(half), {
    onChordStart: () => chordStarts.push(Date.now() - clockZero),
    onDone: () => { halfDone = Date.now() - clockZero; },
  });
  await wait(1700);
  const halfBass = heard.filter(h => h.kind === 'MonoSynth');
  check(`two chords half a bar long take one bar (${halfDone} ms, not two)`, halfDone > 900 && halfDone < 1250);
  check(`the second starts half way through it (${chordStarts.join(', ')})`, chordStarts.length === 2 && near(chordStarts, [0, 500]));
  check(`each has its own bass note, and none spills past its chord (${halfBass.map(b => b.note + '@' + b.at).join(' ')})`,
    halfBass.length === 2 && halfBass[0].note === 'C2' && halfBass[1].note === 'G2' && near(halfBass.map(b => b.at), [0, 500]));

  // ── The plain player keeps a strum inside a short chord ──
  heard.length = 0;
  clockZero = Date.now();
  let shortDone = 0;
  await Audio.playProgression(Song.chordsOf(half, half.sections[0]), { tempo: 240, style: 'strum', beatsPerChord: 2, onDone: () => { shortDone = Date.now() - clockZero; } });
  await wait(1500);
  const lateStrums = heard.filter(h => h.kind === 'PolySynth' && h.at > 1000 + 20);
  check(`two chords of two beats last 1000 ms (${shortDone})`, shortDone > 950 && shortDone < 1200);
  check(`and nothing is strummed after the last one ends (${lateStrums.map(h => h.at).join(', ') || 'none'})`, lateStrums.length === 0);

  // ── The plain player keeps long chords long in another time ──
  heard.length = 0;
  clockZero = Date.now();
  let longDone = 0;
  await Audio.playProgression(Song.chordsOf(six, sec).slice(0, 1), { tempo: 240, style: 'block', meter: { num: 3, den: 4 }, beatsPerChord: 6, onDone: () => { longDone = Date.now() - clockZero; } });
  await wait(1900);
  check(`one chord two bars of 3/4 long lasts two bars (${longDone} ms)`, longDone > 1400 && longDone < 1700);

  // ── Playing with the melody follows the time ──
  heard.length = 0;
  clockZero = Date.now();
  const melodyBeats = [];
  let firstChord = -1;
  await Audio.playWithMelody(Song.chordsOf(six, sec), [], {
    tempo: 240, beatsPerChord: 3, meter: { num: 3, den: 4 }, metronome: true, countIn: true,
    onChordStart: i => { if (i === 0 && firstChord < 0) firstChord = Date.now() - clockZero; },
    onBeat: b => melodyBeats.push(b),
  });
  await wait(2500);
  check(`its count-in is a bar of 3/4, not four beats (${firstChord} ms)`, firstChord > 700 && firstChord < 850);
  check(`and its beat lights count three to the bar all the way through (${melodyBeats.join(',')})`, melodyBeats.join(',') === '0,1,2,0,1,2,0,1,2');

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
