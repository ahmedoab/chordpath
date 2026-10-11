/* ChordPath — DAW test harness (the parts that need no sound card).
 * Run with: node tests/daw-test.js
 * Covers WAV encoding, turning a song into note events, and the DAW project
 * model with its editing operations. The audio engine and the screen are
 * exercised by tests/e2e.js in the real app.
 */
'use strict';

const path = require('path');
const ROOT = path.join(__dirname, '..');

let passed = 0, failed = 0;
const failures = [];
function check(label, cond) {
  if (cond) passed++;
  else { failed++; failures.push(label); console.error('  FAIL: ' + label); }
}
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) console.error(`    got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);
  check(label, ok);
}
function throws(label, fn, pattern) {
  try { fn(); check(label, false); }
  catch (e) { check(label, !pattern || pattern.test(e.message)); }
}
function section(name) { console.log('\n== ' + name + ' =='); }

[
  'theory/scales.js', 'theory/chords.js', 'theory/voicings.js',
  'theory/progressions.js', 'theory/analysis.js', 'theory/genres.js',
  'theory/arrangements.js', 'theory/emotions.js', 'theory/descriptions.js',
  'theory/songs.js', 'theory/melody.js', 'theory/song.js', 'theory/feelings.js',
  'theory/tabs.js', 'theory/instruments.js', 'theory/midi.js',
  'theory/parts.js', 'daw/wav.js', 'daw/project.js',
].forEach(f => require(path.join(ROOT, f)));

const { Arrangements, Song, Feelings, Chords, Parts, Wav, DawProject } = globalThis;

// ── WAV files ──────────────────────────────────────────────────────────────
section('WAV');
{
  const mono = Wav.encode([new Float32Array([0, 0.5, -0.5, 1])], 44100, 16);
  const str = (b, i, n) => String.fromCharCode(...b.slice(i, i + n));
  const u16 = (b, i) => b[i] | (b[i + 1] << 8);
  const u32 = (b, i) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;
  check('encode returns bytes', mono instanceof Uint8Array);
  eq('RIFF/WAVE/fmt/data markers', [str(mono, 0, 4), str(mono, 8, 4), str(mono, 12, 4), str(mono, 36, 4)], ['RIFF', 'WAVE', 'fmt ', 'data']);
  eq('header describes mono 16-bit 44.1k PCM',
    [u16(mono, 20), u16(mono, 22), u32(mono, 24), u32(mono, 28), u16(mono, 32), u16(mono, 34)],
    [1, 1, 44100, 88200, 2, 16]);
  eq('file and data sizes are right', [mono.length, u32(mono, 4), u32(mono, 40)], [52, 44, 8]);

  const loud = Wav.decode(Wav.encode([new Float32Array([2, -2])], 8000, 16));
  check('samples beyond full scale are clipped, not wrapped',
    loud.channels[0][0] > 0.999 && loud.channels[0][1] < -0.999);

  const L = new Float32Array([0.1, 0.2, 0.3]), R = new Float32Array([-0.1, -0.2, -0.3]);
  const stereo = Wav.decode(Wav.encode([L, R], 48000, 16));
  eq('stereo round trip keeps rate, depth and channel count', [stereo.sampleRate, stereo.bitDepth, stereo.channels.length], [48000, 16, 2]);
  check('16-bit round trip is accurate to one step',
    [0, 1, 2].every(i => Math.abs(stereo.channels[0][i] - L[i]) < 1 / 32000 && Math.abs(stereo.channels[1][i] - R[i]) < 1 / 32000));
  const deep = Wav.decode(Wav.encode([L], 44100, 24));
  check('24-bit round trip is finer', deep.bitDepth === 24 && [0, 1, 2].every(i => Math.abs(deep.channels[0][i] - L[i]) < 1 / 8000000));
  eq('channels of unequal length are cut to the shortest',
    Wav.decode(Wav.encode([new Float32Array(5), new Float32Array(3)], 44100, 16)).channels[0].length, 3);

  // A file with an extra chunk before the audio, as other programs write.
  const withList = (() => {
    const base = Wav.encode([new Float32Array([0.25, -0.25])], 44100, 16);
    const extra = new Uint8Array([0x4c, 0x49, 0x53, 0x54, 4, 0, 0, 0, 1, 2, 3, 4]);   // "LIST" + 4 bytes
    const out = new Uint8Array(base.length + extra.length);
    out.set(base.slice(0, 36)); out.set(extra, 36); out.set(base.slice(36), 36 + extra.length);
    const size = out.length - 8;
    out[4] = size & 255; out[5] = (size >> 8) & 255; out[6] = (size >> 16) & 255; out[7] = (size >> 24) & 255;
    return out;
  })();
  check('unknown chunks before the audio are skipped', Math.abs(Wav.decode(withList).channels[0][0] - 0.25) < 0.001);
  eq('decode accepts an ArrayBuffer as well', Wav.decode(mono.buffer.slice(0)).channels[0].length, 4);

  throws('decode refuses a file that is not a WAV', () => Wav.decode(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])), /WAV/);
  throws('decode refuses a truncated file', () => Wav.decode(mono.slice(0, 30)), /WAV|truncated/i);
  throws('encode refuses an unsupported bit depth', () => Wav.encode([new Float32Array(2)], 44100, 12), /bit depth/i);
  throws('encode refuses no channels', () => Wav.encode([], 44100, 16), /channel/i);

  const pk = Wav.peaks(new Float32Array([0, 0.5, -0.9, 0.1, 0.2, -0.3, 0, 0]), 4);
  check('peaks reports the loudest sample in each slice',
    pk.length === 4 && Math.abs(pk[0] - 0.5) < 1e-6 && Math.abs(pk[1] - 0.9) < 1e-6 && Math.abs(pk[2] - 0.3) < 1e-6 && pk[3] === 0);
  eq('peaks of nothing is all zeros', Array.from(Wav.peaks(new Float32Array(0), 3)), [0, 0, 0]);
}

// ── Song → note events ─────────────────────────────────────────────────────
section('Parts');
const demo = Feelings.generateSongSpec({ feelingId: 'yearning', genreId: 'jangle_indie', energy: 'mid', seed: 11 });
const items = Song.buildPlayback(demo);
{
  const item = items.find(it => it.role === 'verse');
  const p = Parts.fromItem(item);
  const total = item.chords.length * item.beatsPerChord;
  eq('a section lasts its chords times beats per chord', p.beats, total);
  for (const name of ['chords', 'bass', 'drums', 'vocal']) {
    check(`the ${name} part has notes`, p[name].length > 0);
    check(`${name} notes are valid MIDI with positive length and velocity`,
      p[name].every(n => Number.isInteger(n.n) && n.n >= 24 && n.n <= 108 && n.d > 0 && n.v > 0 && n.v <= 1));
    check(`${name} notes start inside the section`, p[name].every(n => n.t >= 0 && n.t < total));
    check(`${name} notes are in time order`, p[name].every((n, i) => i === 0 || n.t >= p[name][i - 1].t));
  }
  check('every chord gets chord notes',
    item.chords.every((_, ci) => p.chords.some(n => n.t >= ci * 4 && n.t < ci * 4 + 4)));
  eq('the vocal part is the generated melody, note for note',
    p.vocal.map(n => [n.t, n.n]), item.melody.map(ev => [ev.beatStart, ev.midi]));
  check('drum notes use the standard kit numbers', p.drums.every(n => [36, 38, 42, 46].includes(n.n)));
  eq('the same section always gives the same notes', Parts.fromItem(item), p);
}
{
  // Every chord rhythm and bass style in the catalogue must produce notes.
  const chords = ['C:maj', 'A:m', 'F:maj', 'G:maj'].map(sp => Chords.chordFromSpec(sp));
  const styles = [...new Set(Arrangements.RHYTHMS.map(r => r.chords))];
  const base = { chords, melody: [], under: [], tempo: 100, beatsPerChord: 4, repeat: 1 };
  for (const style of styles) {
    const p = Parts.fromItem(Object.assign({}, base, { pattern: { chords: style, bass: 'root', drums: {}, swing: 0 } }));
    check(`chord rhythm "${style}" plays on every chord`,
      [0, 1, 2, 3].every(ci => p.chords.some(n => n.t >= ci * 4 && n.t < ci * 4 + 4)) && p.chords.every(n => n.t < 16));
  }
  for (const style of [...new Set(Arrangements.RHYTHMS.map(r => r.bass))]) {
    const p = Parts.fromItem(Object.assign({}, base, { pattern: { chords: 'block', bass: style, drums: {}, swing: 0 } }));
    check(`bass style "${style}" produces a line`, p.bass.length > 0 && p.bass.every(n => n.n < 60));
  }
  const kit = { kick: [0, 8], snare: [4, 12], hhClosed: [1, 3], hhOpen: [] };
  const straight = Parts.fromItem(Object.assign({}, base, { pattern: { chords: 'block', bass: 'root', drums: kit, swing: 0 } }));
  const swung = Parts.fromItem(Object.assign({}, base, { pattern: { chords: 'block', bass: 'root', drums: kit, swing: 0.2 } }));
  eq('a plain kit puts each hit on its sixteenth', straight.drums.filter(n => n.t < 4).map(n => n.t), [0, 0.25, 0.75, 1, 2, 3]);
  check('swing pushes the off-sixteenths late and leaves the beats alone',
    swung.drums.find(n => n.n === 42).t > 0.25 && swung.drums.find(n => n.n === 36).t === 0);
  eq('a kit pattern repeats every bar', straight.drums.length, 6 * 4);
  eq('an empty kit is silent', Parts.fromItem(Object.assign({}, base, { pattern: { chords: 'block', bass: 'root', drums: { kick: [], snare: [], hhClosed: [], hhOpen: [] } } })).drums, []);
  const long = Parts.fromItem(Object.assign({}, base, { beatsPerChord: 8, pattern: { chords: 'block', bass: 'root', drums: kit, swing: 0 } }));
  check('eight beats per chord fills both bars of each chord',
    long.beats === 32 && long.chords.some(n => n.t >= 4 && n.t < 8) && long.drums.some(n => n.t >= 28));
}
const whole = Parts.fromSong(demo);
{
  eq('song tempo carries over', whole.tempo, demo.tempo);
  eq('sections follow one another without gaps',
    whole.sections.map(s => s.start), whole.sections.map((s, i) => whole.sections.slice(0, i).reduce((sum, x) => sum + x.beats, 0)));
  eq('the song length is the sum of its sections', whole.totalBeats, demo.sections.reduce((sum, sec) => sum + Song.sectionBeats(sec), 0));
  eq('section names and roles carry over', whole.sections.map(s => s.name), demo.sections.map(s => s.name));
  const rep = JSON.parse(JSON.stringify(demo));
  rep.sections[1].repeat = 2;
  const twice = Parts.fromSong(Song.migrate(rep));
  eq('a repeated section appears once per repeat', twice.sections.length, demo.sections.length + 1);
  eq('and makes the song longer by exactly that section', twice.totalBeats - whole.totalBeats, Song.sectionBeats(demo.sections[1]));
}

// ── DAW project ────────────────────────────────────────────────────────────
section('Project from a song');
const proj = DawProject.fromSong(demo);
{
  eq('the project takes the song title, tempo and key', [proj.title, proj.tempo, proj.key, proj.scale], [demo.title, demo.tempo, demo.key, demo.scale]);
  eq('it remembers which song it came from', proj.songId, demo.id);
  eq('tracks are chords, bass, drums and the melodies',
    proj.tracks.map(t => t.name).slice(0, 4), ['Chords', 'Bass', 'Drums', 'Vocal melody']);
  eq('the drum track is a drum track', proj.tracks.find(t => t.name === 'Drums').kind, 'drums');
  check('every other generated track is an instrument', proj.tracks.filter(t => t.name !== 'Drums').every(t => t.kind === 'instrument'));
  eq('one marker per section', proj.markers.map(m => [m.beat, m.name]), whole.sections.map(s => [s.start, s.name]));
  const chordsTrack = proj.tracks[0];
  eq('one clip per section, placed at the section start',
    chordsTrack.clips.map(c => [c.start, c.length]), whole.sections.map(s => [s.start, s.beats]));
  eq('clips are named after their sections', chordsTrack.clips.map(c => c.name), whole.sections.map(s => s.name));
  check('notes are stored relative to their clip',
    proj.tracks.every(t => t.clips.every(c => c.notes.every(n => n.t >= 0 && n.t < c.length))));
  const ids = [];
  proj.tracks.forEach(t => { ids.push(t.id); t.clips.forEach(c => { ids.push(c.id); c.notes.forEach(n => ids.push(n.id)); }); });
  eq('every track, clip and note has a unique id', new Set(ids).size, ids.length);
  eq('the project ends where the song ends', DawProject.endBeat(proj), whole.totalBeats);
  check('tracks start with sane mixer settings',
    proj.tracks.every(t => t.volume <= 0 && t.volume >= -30 && t.pan >= -1 && t.pan <= 1 && t.mute === false && t.solo === false));
  check('each track has its own colour', new Set(proj.tracks.map(t => t.color)).size === proj.tracks.length);
  check('sections without drums leave no drum clip',
    proj.tracks.find(t => t.name === 'Drums').clips.every(c => c.notes.length > 0));
  eq('the loop starts off, spanning the first section', [proj.loop.on, proj.loop.start, proj.loop.end], [false, 0, whole.sections[0].beats]);
}

section('Editing');
{
  const p = DawProject.fromSong(demo);
  const track = p.tracks[1];
  const clip = track.clips[1];
  const found = DawProject.findClip(p, clip.id);
  check('findClip returns the clip and its track', found.clip === clip && found.track === track);
  eq('findClip of nothing is null', DawProject.findClip(p, 'nope'), null);

  DawProject.moveClip(p, clip.id, 100);
  eq('a clip can be moved in time', clip.start, 100);
  DawProject.moveClip(p, clip.id, -5);
  eq('but never before the start', clip.start, 0);
  DawProject.moveClip(p, clip.id, 40, p.tracks[0].id);
  check('a clip can move to another instrument track', p.tracks[0].clips.includes(clip) && !track.clips.includes(clip));
  const drums = p.tracks.find(t => t.kind === 'drums');
  DawProject.moveClip(p, clip.id, 40, drums.id);
  check('but notes written for an instrument do not move onto the drum kit', !drums.clips.includes(clip));

  DawProject.resizeClip(p, clip.id, 2);
  eq('a clip can be shortened', clip.length, 2);
  DawProject.resizeClip(p, clip.id, 0);
  check('but not to nothing', clip.length >= 0.25);
  DawProject.resizeClip(p, clip.id, 8);

  const c2 = DawProject.addClip(p.tracks[0], { start: 200, length: 8, name: 'Scratch' });
  const a = DawProject.addNote(c2, { t: 0, d: 2, n: 60, v: 0.8 });
  const b = DawProject.addNote(c2, { t: 3, d: 2, n: 64, v: 0.8 });
  const c = DawProject.addNote(c2, { t: 6, d: 1, n: 67, v: 0.8 });
  eq('notes are kept in time order', c2.notes.map(n => n.n), [60, 64, 67]);
  const clamped = DawProject.addNote(c2, { t: -3, d: 0, n: 300, v: 9 });
  eq('a wild note is pulled into range', [clamped.t, clamped.d > 0, clamped.n, clamped.v], [0, true, 127, 1]);
  DawProject.removeNote(c2, clamped.id);
  DawProject.updateNote(c2, b.id, { n: 65, d: 0.5 });
  eq('a note can be changed', [b.n, b.d], [65, 0.5]);
  check('removing a note that is not there does nothing', DawProject.removeNote(c2, 'nope') === false && c2.notes.length === 3);

  const [left, right] = DawProject.splitClip(p, c2.id, 204);
  eq('splitting gives two clips that meet at the cut', [left.start, left.length, right.start, right.length], [200, 4, 204, 4]);
  eq('notes go to the side they start on', [left.notes.map(n => n.n), right.notes.map(n => n.n)], [[60, 65], [67]]);
  eq('notes on the right are re-timed to their new clip', right.notes[0].t, 2);
  eq('splitting outside the clip does nothing', DawProject.splitClip(p, left.id, 999), null);
  const long = DawProject.addNote(left, { t: 3, d: 4, n: 72, v: 0.5 });
  const cut = DawProject.splitClip(p, left.id, 202);
  check('a note that crosses the cut is trimmed to it', cut[1].notes.find(n => n.n === 72).d === 1 || cut[0].notes.every(n => n.t + n.d <= 2 + 1e-9));
  void long; void a; void c;

  const dupe = DawProject.duplicateClip(p, right.id);
  eq('a duplicate lands straight after the original', [dupe.start, dupe.length], [right.start + right.length, right.length]);
  check('and shares nothing with it', dupe.id !== right.id && dupe.notes[0].id !== right.notes[0].id && dupe.notes[0] !== right.notes[0]);
  dupe.notes[0].n = 1;
  check('editing the duplicate leaves the original alone', right.notes[0].n === 67);

  const q = DawProject.addClip(p.tracks[0], { start: 300, length: 4 });
  DawProject.addNote(q, { t: 0.13, d: 0.5, n: 60, v: 0.7 });
  DawProject.addNote(q, { t: 0.9, d: 0.5, n: 62, v: 0.7 });
  DawProject.quantize(q, 0.25);
  eq('quantize pulls notes onto the grid', q.notes.map(n => n.t), [0.25, 1]);
  DawProject.transpose(q, 12);
  eq('transpose moves every note', q.notes.map(n => n.n), [72, 74]);
  DawProject.transpose(q, 100);
  check('transpose stops at the top of the range', q.notes.every(n => n.n === 127));
  eq('snap rounds to the grid', [DawProject.snap(1.13, 0.25), DawProject.snap(1.13, 1), DawProject.snap(1.13, 0)], [1.25, 1, 1.13]);

  check('removeClip removes it', DawProject.removeClip(p, q.id) === true && DawProject.findClip(p, q.id) === null);

  const audio = DawProject.addTrack(p, 'audio', { name: 'Guitar take' });
  eq('an audio track can be added', [audio.kind, audio.name, audio.clips.length, audio.armed], ['audio', 'Guitar take', 0, false]);
  const take = DawProject.addClip(audio, { start: 8, length: 16, audioId: 'aud_abc123', offset: 0.05 });
  eq('audio clips point at a recording', [take.audioId, take.offset, take.notes], ['aud_abc123', 0.05, undefined]);
  DawProject.moveClip(p, take.id, 12, p.tracks[0].id);
  check('a recording cannot be dropped on an instrument track', audio.clips.includes(take));
  const inst = DawProject.addTrack(p, 'instrument', { instrument: 'pad' });
  eq('an instrument track can be added', [inst.kind, inst.instrument], ['instrument', 'pad']);
  eq('an unknown instrument falls back to piano', DawProject.addTrack(p, 'instrument', { instrument: 'kazoo' }).instrument, 'piano');
  check('removeTrack removes it', DawProject.removeTrack(p, inst.id) === true && !p.tracks.includes(inst));
  eq('the end follows the last clip', DawProject.endBeat(p), 212);
}

section('Saving and loading');
{
  const text = DawProject.serialize(proj);
  const back = DawProject.deserialize(text);
  check('a project round-trips through its file format', back.errors.length === 0 && JSON.stringify(back.project) === JSON.stringify(proj));
  check('garbage is refused', DawProject.deserialize('not json').project === null && DawProject.deserialize('{"x":1}').project === null);

  const hostile = JSON.parse(text).project;
  hostile.title = '<img src=x onerror=alert(1)>' + 'x'.repeat(9000);
  hostile.tempo = 'fast';
  hostile.key = '<b>';
  hostile.loop = { on: 'yes', start: -50, end: 'later' };
  hostile.markers = [{ beat: 'x', name: 5 }, { beat: 4, name: 'ok' }, 'nope'];
  hostile.master = 500;
  hostile.tracks[0].volume = 9999;
  hostile.tracks[0].pan = 'left';
  hostile.tracks[0].kind = 'nonsense';
  hostile.tracks[1].instrument = { evil: 1 };
  hostile.tracks[1].color = 'url(javascript:alert(1))';
  hostile.tracks[1].fx = { low: 900, reverb: -4, comp: 'on' };
  hostile.tracks[1].clips[0].notes = [{ t: 'a', d: -1, n: 1e9, v: 'loud' }, 'x', { t: 1, d: 1, n: 60, v: 0.5 }];
  hostile.tracks[1].clips[0].start = -100;
  hostile.tracks[1].clips.push({ start: 4, length: 4, audioId: '../../etc/passwd' });
  hostile.tracks.push('nope');
  const clean = DawProject.sanitize(hostile);
  check('titles are bounded', clean.title.length <= 120);
  eq('a nonsense tempo and key fall back', [clean.tempo, clean.key], [100, 'C']);
  eq('the loop is made sane', [clean.loop.on, clean.loop.start >= 0, clean.loop.end > clean.loop.start], [false, true, true]);
  eq('bad markers are dropped', clean.markers.map(m => m.name), ['ok']);
  eq('the master fader is clamped', clean.master, 6);
  check('a track of an unknown kind is dropped', clean.tracks.every(t => ['instrument', 'drums', 'audio'].includes(t.kind)));
  const t1 = clean.tracks.find(t => t.name === 'Bass');
  eq('mixer values are clamped', [t1.fx.low, t1.fx.reverb, t1.fx.comp], [18, 0, false]);
  eq('instrument and colour fall back to known values', [t1.instrument, /^#[0-9a-f]{6}$/.test(t1.color)], ['piano', true]);
  check('bad notes are dropped and good ones kept', t1.clips[0].notes.length === 1 && t1.clips[0].notes[0].n === 60);
  check('clip positions are clamped', t1.clips[0].start === 0);
  check('an audio reference that is not a plain id is dropped', t1.clips.every(c => c.audioId === undefined));
  const polluted = DawProject.sanitize(JSON.parse('{"title":"p","tracks":[],"__proto__":{"polluted":true}}'));
  check('sanitize never adopts __proto__', polluted.polluted === undefined && Object.getPrototypeOf(polluted) === Object.prototype);
  const huge = { title: 'big', tracks: Array.from({ length: 500 }, () => ({ kind: 'instrument', clips: [] })) };
  check('the number of tracks is capped', DawProject.sanitize(huge).tracks.length <= 64);
}

section('Undo');
{
  const p = DawProject.fromSong(demo);
  const h = new DawProject.History(3);
  h.push(p);
  check('nothing to undo at the start', !h.canUndo() && !h.canRedo());
  p.tempo = 111; h.push(p);
  p.tempo = 122; h.push(p);
  eq('undo steps back', h.undo().tempo, 111);
  eq('and back again', h.undo().tempo, demo.tempo);
  check('no further', h.undo() === null);
  eq('redo steps forward', h.redo().tempo, 111);
  const fork = h.redo(); fork.tempo = 133; h.push(fork);
  check('a new edit after undo discards the redo branch', !h.canRedo());
  p.tempo = 144; h.push(p); p.tempo = 155; h.push(p);
  let steps = 0;
  while (h.undo()) steps++;
  eq('history keeps only its limit of states', steps, 2);
  check('undo hands back a copy, not the live project', h.redo() !== h.redo());
}

section('MIDI export');
{
  const bytes = DawProject.toMidi(proj);
  const str = (i, n) => String.fromCharCode(...bytes.slice(i, i + n));
  check('toMidi writes a standard MIDI file', bytes instanceof Uint8Array && str(0, 4) === 'MThd');
  const ntrks = (bytes[10] << 8) | bytes[11];
  eq('format 1 with a conductor track plus one per track with notes',
    [(bytes[8] << 8) | bytes[9], ntrks], [1, 1 + proj.tracks.filter(t => t.clips.some(c => c.notes && c.notes.length)).length]);
  check('drums go out on channel 10', Array.from(bytes).some((b, i) => b === 0x99 && bytes[i + 1] === 36));
  let off = 14, chunks = 0;
  while (off < bytes.length) {
    if (str(off, 4) !== 'MTrk') break;
    off += 8 + (((bytes[off + 4] << 24) | (bytes[off + 5] << 16) | (bytes[off + 6] << 8) | bytes[off + 7]) >>> 0);
    chunks++;
  }
  check('every track chunk is well formed', chunks === ntrks && off === bytes.length);
  const edited = DawProject.fromSong(demo);
  edited.tracks[1].clips.forEach(c => { c.notes = []; });
  eq('a track with no notes is left out', (DawProject.toMidi(edited)[10] << 8) | DawProject.toMidi(edited)[11], ntrks - 1);
}

// ── Working on several notes together ──────────────────────────────────────
section('Several notes at once');
{
  const P = DawProject;
  const fresh = () => {
    const clip = P.addClip(P.addTrack(P.createProject({ tempo: 120 }), 'instrument', {}), { start: 0, length: 8 });
    const made = [[0, 1, 60, 0.8], [1, 1, 64, 0.6], [2, 2, 67, 0.4], [6, 1, 72, 0.9]]
      .map(([t, d, n, v]) => P.addNote(clip, { t, d, n, v }).id);
    return { clip, a: made[0], b: made[1], c: made[2], d: made[3] };
  };
  const shape = clip => clip.notes.map(n => [n.t, n.d, n.n]);
  const snapshot = (clip, ids) => clip.notes.filter(n => ids.includes(n.id)).map(n => ({ id: n.id, t: n.t, d: n.d, n: n.n }));

  let w = fresh();
  const every = Array.from({ length: 128 }, (unused, i) => i);
  eq('a box picks up every note it touches', P.notesWithin(w.clip, 0.5, 2.5, [60, 64, 67]), [w.a, w.b, w.c]);
  eq('only on the rows it covers', P.notesWithin(w.clip, 0, 8, [64, 72]), [w.b, w.d]);
  eq('a note that only ends where the box begins is not in it', P.notesWithin(w.clip, 1, 2, every), [w.b]);
  eq('a box drawn backwards works the same', P.notesWithin(w.clip, 2.5, 0.5, [67, 64, 60]), [w.a, w.b, w.c]);
  eq('an empty stretch picks up nothing', P.notesWithin(w.clip, 4, 5, every), []);
  eq('drum hits count as one step wide however long they ring', [P.notesWithin(w.clip, 0.3, 0.4, every), P.notesWithin(w.clip, 0.3, 0.4, every, 0.25)], [[w.a], []]);

  let base = snapshot(w.clip, [w.a, w.b]);
  eq('a group moves together in time and pitch', [P.shiftNotes(w.clip, base, 2, 3), shape(w.clip)],
    [{ dt: 2, dn: 3 }, [[2, 1, 63], [2, 2, 67], [3, 1, 67], [6, 1, 72]]]);
  eq('moving again from the same starting point does not add up', [P.shiftNotes(w.clip, base, 1, 0).dt, shape(w.clip)[0], shape(w.clip)[1]],
    [1, [1, 1, 60], [2, 1, 64]]);
  eq('the group stops at the start of the clip as one', [P.shiftNotes(w.clip, base, -5, 0).dt, shape(w.clip).slice(0, 2)],
    [0, [[0, 1, 60], [1, 1, 64]]]);
  w = fresh();
  base = snapshot(w.clip, [w.c, w.d]);
  eq('and at the end, keeping its shape', [P.shiftNotes(w.clip, base, 9, 0, { step: 0.25 }).dt, shape(w.clip).slice(2)],
    [1.75, [[3.75, 2, 67], [7.75, 1, 72]]]);
  w = fresh();
  base = snapshot(w.clip, [w.a, w.d]);
  eq('pitch is held inside the range given', [P.shiftNotes(w.clip, base, 0, 40, { low: 24, high: 96 }).dn, shape(w.clip)[0][2], shape(w.clip)[3][2]],
    [24, 84, 96]);
  eq('downwards too', P.shiftNotes(w.clip, base, 0, -99, { low: 24, high: 96 }).dn, -36);

  w = fresh();
  base = snapshot(w.clip, [w.a, w.c]);
  P.stretchNotes(w.clip, base, 0.5, 0.25);
  eq('a group lengthens together', shape(w.clip).map(n => n[1]), [1.5, 1, 2.5, 1]);
  P.stretchNotes(w.clip, base, -5, 0.25);
  eq('and shortens no further than one step', shape(w.clip).map(n => n[1]), [0.25, 1, 0.25, 1]);
  P.stretchNotes(w.clip, snapshot(w.clip, [w.d]), 9, 0.25);
  eq('nor past the end of the clip', shape(w.clip)[3], [6, 2, 72]);

  w = fresh();
  P.setVelocity(w.clip, [w.a, w.b], 0.33);
  eq('velocity is set on all of them', w.clip.notes.map(n => n.v), [0.33, 0.33, 0.4, 0.9]);
  P.transpose(w.clip, 12, [w.a]);
  P.quantize(w.clip, 4, [w.c]);
  eq('transpose and quantize can be kept to the chosen notes', shape(w.clip), [[0, 1, 72], [1, 1, 64], [4, 2, 67], [6, 1, 72]]);
  P.transpose(w.clip, -12);
  eq('or, with none chosen, take the whole clip', shape(w.clip).map(n => n[2]), [60, 52, 55, 60]);

  w = fresh();
  const copied = P.copyNotes(w.clip, [w.b, w.c]);
  eq('a copy keeps the notes relative to the first of them', copied, { span: 3, notes: [{ t: 0, d: 1, n: 64, v: 0.6 }, { t: 1, d: 2, n: 67, v: 0.4 }] });
  eq('copying nothing gives nothing', P.copyNotes(w.clip, []), null);
  const pasted = P.pasteNotes(w.clip, copied, 4);
  eq('paste puts them down where asked', [pasted.length, shape(w.clip)], [2, [[0, 1, 60], [1, 1, 64], [2, 2, 67], [4, 1, 64], [5, 2, 67], [6, 1, 72]]]);
  check('and hands back the new notes, not the old ones', pasted.every(id => ![w.a, w.b, w.c, w.d].includes(id)) && new Set(pasted).size === 2);
  const late = P.pasteNotes(w.clip, copied, 6.5);
  eq('what would start after the clip is left out, what overhangs is trimmed',
    [late.length, w.clip.notes.filter(n => late.includes(n.id)).map(n => [n.t, n.d, n.n])], [2, [[6.5, 1, 64], [7.5, 0.5, 67]]]);
  eq('pasting past the end adds nothing', P.pasteNotes(w.clip, copied, 8).length, 0);
  eq('several notes are removed in one go', [P.removeNotes(w.clip, pasted.concat(late, ['no-such-note'])), w.clip.notes.length], [4, 4]);
  const audio = { id: 'c1', start: 0, length: 4, audioId: 'aud_1' };
  eq('a recording has no notes to pick, copy or paste',
    [P.notesWithin(audio, 0, 4, every), P.copyNotes(audio, ['x']), P.pasteNotes(audio, copied, 0), P.removeNotes(audio, ['x'])], [[], null, [], 0]);
}

// ── What may be imported ───────────────────────────────────────────────────
section('Audio file limits');
{
  const MB = 1024 * 1024;
  const problem = DawProject.audioFileProblem;
  eq('a short recording is welcome', problem('riff.wav', 5 * MB), '');
  eq('so is a song-length MP3', problem('demo.mp3', 9 * MB), '');
  check('an MP3 the size of a whole concert is not', /too long/.test(problem('whole gig.mp3', 26 * MB)));
  eq('the same size as a WAV is only a few minutes', problem('take.WAV', 26 * MB), '');
  check('a WAV has its own, larger limit', /too long/.test(problem('rehearsal.wav', 261 * MB)));
  check('and so does FLAC, in between', problem('song.flac', 100 * MB) === '' && /too long/.test(problem('album.flac', 131 * MB)));
  check('a file of an unknown kind is judged as if compressed', /too long/.test(problem('mystery', 26 * MB)));
  check('an empty file is refused', /empty/.test(problem('nothing.wav', 0)));
  eq('twenty minutes is the most a project takes in one piece',
    [DawProject.audioLengthProblem(1200), /too long/.test(DawProject.audioLengthProblem(1200.5))], ['', true]);
}

// ── Tab of a clip's notes, chords included ─────────────────────────────────
section('Tab from notes');
{
  const { Tabs } = globalThis;
  const spots = placed => placed.notes.map(n => [n.string, n.fret]);

  eq('one note goes where it is easiest: open high e', spots(Tabs.placeNotes([64])), [[5, 0]]);
  eq('an open C chord comes out as the shape every guitarist knows',
    spots(Tabs.placeNotes([48, 52, 55, 60, 64])), [[1, 3], [2, 2], [3, 0], [4, 1], [5, 0]]);
  eq('so does an open E', spots(Tabs.placeNotes([40, 47, 52, 56, 59, 64])), [[0, 0], [1, 2], [2, 2], [3, 1], [4, 0], [5, 0]]);
  eq('the order the notes arrive in does not matter', spots(Tabs.placeNotes([64, 48, 60, 55, 52])), spots(Tabs.placeNotes([48, 52, 55, 60, 64])));

  // The same C spread over three octaves, the way the chord track voices it.
  const wide = Tabs.placeNotes([48, 60, 64, 67, 72, 76]);
  eq('a chord spread wider than a hand is gathered into the octave where it can be held',
    [spots(wide), wide.folded, wide.dropped], [[[1, 3], [2, 2], [3, 0], [4, 1], [5, 0]], true, 0]);
  const upTop = Tabs.placeNotes([67, 72, 76]);
  eq('its top three notes alone come out as the top three strings of that shape',
    [spots(upTop), upTop.folded], [[[3, 0], [4, 1], [5, 0]], true]);
  eq('where the hand was before makes no difference to a chord',
    spots(Tabs.placeNotes([48, 60, 64, 67, 72, 76], { near: 11 })), spots(wide));
  eq('a D keeps its own bass note rather than borrow a lower one',
    spots(Tabs.placeNotes([50, 57, 62, 66])), [[2, 0], [3, 2], [4, 3], [5, 2]]);
  eq('a single high note is left where it is written', spots(Tabs.placeNotes([76], { near: 12 })), [[5, 12]]);

  const cluster = Tabs.placeNotes([60, 61, 62, 63]);
  const held = cluster.notes.filter(n => n.fret > 0).map(n => n.fret);
  check('a chord no hand could hold loses notes rather than become unplayable',
    cluster.dropped > 0 && cluster.notes.length >= 2 && Math.max(...held) - Math.min(...held) <= 3);
  check('what is kept sits on separate strings, low notes on low strings',
    cluster.notes.every((n, i) => i === 0 || (n.string > cluster.notes[i - 1].string && n.midi > cluster.notes[i - 1].midi)));
  check('and the bass note is one of the notes kept', cluster.notes[0].midi % 12 === 0);
  const barre = Tabs.placeNotes([41, 48, 53, 57, 60, 65]);
  eq('six fretted notes are held with a barre', spots(barre), [[0, 1], [1, 3], [2, 3], [3, 2], [4, 1], [5, 1]]);

  const doubled = Tabs.placeNotes([60, 60, 64]);
  check('a pitch given twice is played once', doubled.notes.length === 2 && doubled.dropped === 0);
  const low = Tabs.placeNotes([28]);
  eq('a note below the guitar is moved up to its range', [spots(low), low.shifted], [[[0, 0]], 1]);
  const high = Tabs.placeNotes([100]);
  check('a note above it is moved down', high.shifted === 1 && high.notes.length === 1 && high.notes[0].fret <= 15);
  eq('the bass register keeps to the low strings', spots(Tabs.placeNotes([55], { register: 'bass' })), [[2, 5]]);
  eq('left alone, G4 is played low on the neck', spots(Tabs.placeNotes([67])), [[5, 3]]);
  eq('but stays near the hand when it is already up the neck', spots(Tabs.placeNotes([67], { near: 8 })), [[4, 8]]);
  eq('nothing in, nothing out', Tabs.placeNotes([]).notes, []);

  const lines = text => {
    const out = {};
    text.split('\n').forEach(l => { const m = /^([EADGBe]) \|(.*)$/.exec(l); if (m && out[m[1]] == null) out[m[1]] = m[2]; });
    return out;
  };
  // An open C strummed slowly: each string a little after the one before.
  const strum = [48, 52, 55, 60, 64].map((midi, i) => ({ midi, beatStart: i * 0.08 }));
  const chordTab = Tabs.renderNotesTab(strum, { totalBeats: 4, tempo: 120 });
  const cl = lines(chordTab);
  eq('a strummed chord is written as one stack, where the strum starts',
    [cl.e[0], cl.B[0], cl.G[0], cl.D[0], cl.A[0], cl.E[0]], ['0', '1', '0', '2', '3', '-']);
  check('and nowhere else', ['e', 'B', 'G', 'D', 'A', 'E'].every(s => !/\d/.test(cl[s].slice(1))));
  check('a bar is sixteen steps wide and closed by a bar line', /^[\d-]{32}\|$/.test(cl.e));
  check('the beat count runs under the strings', /1 e \+ a 2 e \+ a 3 e \+ a 4 e \+ a/.test(chordTab));

  const run = Tabs.renderNotesTab([64, 65, 67, 69].map((midi, i) => ({ midi, beatStart: i * 0.25 })), { totalBeats: 4, tempo: 120 });
  check('sixteenth notes in a row stay apart', lines(run).e.startsWith('0-1-3-5-'));
  const highRun = Tabs.renderNotesTab([74, 76, 77].map((midi, i) => ({ midi, beatStart: i * 0.25 })), { totalBeats: 4, tempo: 120, near: 10 });
  const hl = Object.values(lines(highRun)).join('\n');
  check('two-digit frets get room so that numbers never run together', /10-12-13/.test(hl) && !/\d{3}/.test(hl));
  check('and the count row widens with them', /1  e  \+  a  2/.test(highRun));

  const two = Tabs.renderNotesTab([{ midi: 60, beatStart: 4 }, { midi: 64, beatStart: 4 }], { totalBeats: 8, tempo: 120 });
  const tl = lines(two);
  check('notes that start together are stacked, in the bar they belong to',
    tl.B.split('|')[1][0] === '1' && tl.e.split('|')[1][0] === '0' && !/\d/.test(tl.e.split('|')[0]));
  check('a chord written an octave down says so',
    /easiest to hold/.test(Tabs.renderNotesTab([48, 60, 64, 67, 72, 76].map(midi => ({ midi, beatStart: 0 })), { totalBeats: 4, tempo: 120 })));
  check('a chord that loses notes says how many',
    /\d notes? left out/.test(Tabs.renderNotesTab([60, 61, 62, 63].map(midi => ({ midi, beatStart: 0 })), { totalBeats: 4, tempo: 120 })));
  // The same chord struck four times, fully and in part, down and up.
  const strums = [];
  [[0, [48, 60, 64, 67, 72, 76]], [1.5, [67, 76, 72]], [2, [48, 60, 64, 67, 72, 76]], [3.5, [76, 72, 67, 64]]]
    .forEach(([at, notes]) => notes.forEach((midi, i) => strums.push({ midi, beatStart: at + i * 0.05 })));
  const sl = lines(Tabs.renderNotesTab(strums, { totalBeats: 4, tempo: 120 }));
  const column = step => ['E', 'A', 'D', 'G', 'B', 'e'].map(s => sl[s][step * 2]).join('');
  eq('one chord strummed several ways keeps one shape throughout',
    [column(0), column(6), column(8), column(14)], ['-32010', '---010', '-32010', '--2010']);
  check('a moved note is mentioned too', /octave/.test(Tabs.renderNotesTab([{ midi: 28, beatStart: 0 }], { totalBeats: 4, tempo: 120 })));
  check('a triplet is rounded and the tab says so', /nearest sixteenth/.test(
    Tabs.renderNotesTab([0, 1 / 3, 2 / 3].map(t => ({ midi: 64, beatStart: t })), { totalBeats: 4, tempo: 120 })));
  eq('no notes, a plain message', Tabs.renderNotesTab([], { totalBeats: 4 }), '(no notes)');

  // Every clip of a real song: the tab must be readable whatever the part plays.
  const proj = DawProject.fromSong(Feelings.generateSongSpec({ feelingId: 'yearning', genreId: 'jangle_indie', energy: 'mid', seed: 11 }));
  let clips = 0, clean = 0, inRange = 0, bassLow = 0, bassClips = 0;
  proj.tracks.filter(t => t.kind === 'instrument').forEach(track => {
    track.clips.forEach(clip => {
      const bass = track.instrument === 'bass';
      const text = Tabs.renderNotesTab(clip.notes.map(n => ({ midi: n.n, beatStart: n.t })),
        { totalBeats: clip.length, tempo: proj.tempo, register: bass ? 'bass' : 'full' });
      const rows = text.split('\n').filter(l => /^[EADGBe] \|/.test(l));
      clips++;
      if (rows.length && rows.every(l => !/\d{3}/.test(l))) clean++;
      if (rows.every(l => (l.match(/\d+/g) || []).every(f => Number(f) <= 15))) inRange++;
      if (bass) { bassClips++; if (rows.filter(l => /^[GBe] /.test(l)).every(l => !/\d/.test(l))) bassLow++; }
    });
  });
  check(`every clip of a real song gives a tab (${clips} clips)`, clips > 20);
  check('with no fret numbers run together anywhere', clean === clips);
  check('and none beyond the fifteenth fret', inRange === clips);
  check('bass clips stay on the three low strings', bassClips > 0 && bassLow === bassClips);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) {
  console.error('\nFailed checks:');
  failures.forEach(f => console.error('  - ' + f));
  process.exit(1);
}
