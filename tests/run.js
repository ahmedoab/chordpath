/* ChordPath — headless test harness.
 * Run with: node tests/run.js
 * Loads the theory modules in index.html order (they attach to globalThis in
 * Node) and checks data integrity + engine behaviour. No framework needed.
 */
'use strict';

const path = require('path');
const fs = require('fs');
const ROOT = path.join(__dirname, '..');

let passed = 0, failed = 0;
const failures = [];

function check(label, cond) {
  if (cond) { passed++; }
  else { failed++; failures.push(label); console.error('  FAIL: ' + label); }
}

function section(name) { console.log('\n== ' + name + ' =='); }

// ── Load modules in dependency order ───────────────────────────────────────
[
  'theory/scales.js', 'theory/chords.js', 'theory/voicings.js',
  'theory/progressions.js', 'theory/analysis.js', 'theory/genres.js',
  'theory/arrangements.js', 'theory/emotions.js', 'theory/descriptions.js',
  'theory/songs.js', 'theory/melody.js', 'theory/song.js', 'theory/feelings.js',
  'theory/tabs.js', 'theory/instruments.js', 'theory/plugins.js',
  'theory/mixing.js', 'theory/recording.js',
].forEach(f => require(path.join(ROOT, f)));

const { Scales, Chords, Voicings, Progressions, Analysis, Genres,
        Arrangements, Emotions, Descriptions, Songs, Melody,
        Song, Feelings, Tabs, Instruments, Plugins, Mixing, Recording } = globalThis;

// Case labels that actually exist in audio.js — any pattern data pointing at
// a label outside these silently falls through to a default in playback.
const audioSrc = fs.readFileSync(path.join(ROOT, 'audio.js'), 'utf8');
const AUDIO_CASES = new Set([...audioSrc.matchAll(/case '([^']+)'/g)].map(m => m[1]));

// ── Scales ─────────────────────────────────────────────────────────────────
section('Scales');
check('C major spelled correctly',
  Scales.buildScale('C', 'major').join(' ') === 'C D E F G A B');
check('Eb major uses flats',
  Scales.buildScale('Eb', 'major').join(' ') === 'Eb F G Ab Bb C D');
{
  const names = scale => [1, 3, 6, 8, 10].map(pc => Scales.keyName(pc, scale)).join(' ');
  check(`major keys are named as musicians name them: Db Eb F# Ab Bb (${names('major')})`, names('major') === 'Db Eb F# Ab Bb');
  check(`minor keys too: C# Eb F# G# Bb (${names('natural_minor')})`, names('natural_minor') === 'C# Eb F# G# Bb');
  check('a natural note is just its letter', Scales.keyName(0, 'major') === 'C' && Scales.keyName(4, 'natural_minor') === 'E' && Scales.keyName(11, 'lydian') === 'B');
  check('a mode takes the name with the fewest sharps or flats', Scales.keyName(3, 'phrygian') === 'D#' && Scales.keyName(6, 'lydian') === 'Gb' && Scales.keyName(1, 'dorian') === 'C#' && Scales.keyName(10, 'dorian') === 'Bb');
  check('harmonic and melodic minor are minor keys', Scales.keyName(8, 'harmonic_minor') === 'G#' && Scales.keyName(1, 'melodic_minor') === 'C#');
  check('scales of other sizes follow major or minor', Scales.keyName(1, 'major_pent') === 'Db' && Scales.keyName(1, 'minor_pent') === 'C#' && Scales.keyName(10, 'blues_minor') === 'Bb');
  check('any spelling of a key is understood', Scales.keyName(Scales.noteIndex('A#'), 'major') === 'Bb');
}
for (const g of Scales.SCALE_GROUPS) {
  for (const id of g.ids) {
    check(`scale group "${g.label}" id "${id}" exists`, !!Scales.SCALES[id]);
  }
}
const groupedIds = new Set(Scales.SCALE_GROUPS.flatMap(g => g.ids));
for (const id of Object.keys(Scales.SCALES)) {
  check(`scale "${id}" reachable from a UI group`, groupedIds.has(id));
}
// Chord-pool specs must reference real qualities (unknown ones silently
// become major triads in buildChord).
for (const [sid, pool] of Object.entries({
  major_pent: 1, minor_pent: 1, blues_minor: 1, blues_major: 1, hirajoshi: 1,
  insen: 1, whole_tone: 1, dim_half_whole: 1, dim_whole_half: 1, augmented: 1,
})) {
  const specs = Scales.getChordPool(sid) || [];
  for (const spec of specs) {
    const q = spec.split(':')[1];
    check(`chord pool ${sid} quality "${q}" exists`, !!Chords.QUALITIES[q]);
  }
}

// ── Chords ─────────────────────────────────────────────────────────────────
section('Chords');
check('Cmaj7 notes', Chords.buildChord('C', 'maj7').notes.join(' ') === 'C E G B');
check('Am7 short name', Chords.buildChord('A', 'm7').shortName === 'Am7');
check('roman I for C in C major',
  Chords.romanNumeral(Chords.buildChord('C', 'maj'), 'C', 'major') === 'I');
check('roman vi for Am in C major',
  Chords.romanNumeral(Chords.buildChord('A', 'm'), 'C', 'major') === 'vi');
check('roman for madd9 is lowercase',
  Chords.romanNumeral(Chords.buildChord('A', 'madd9'), 'C', 'major').startsWith('vi'));
check('roman bVII normalised form matches catalogue',
  Songs.romanSequence([Object.assign(Chords.buildChord('Bb', 'maj'),
    { roman: Chords.romanNumeral(Chords.buildChord('Bb', 'maj'), 'C', 'major') })]) === 'bVII');

// ── Genres ─────────────────────────────────────────────────────────────────
section('Genres');
check('combined catalogue has 28 genres', Genres.GENRES.length === 28);
check('focused ids listed first', Genres.GENRES[0].id === 'shoegaze');
const genreIds = new Set();
for (const g of Genres.GENRES) {
  check(`genre "${g.id}" id unique`, !genreIds.has(g.id));
  genreIds.add(g.id);
  for (const s of g.scales) {
    check(`genre "${g.id}" scale "${s}" exists`, !!Scales.SCALES[s]);
  }
  if (g.pattern) {
    check(`genre "${g.id}" chords pattern "${g.pattern.chords}" has an audio case`,
      AUDIO_CASES.has(g.pattern.chords));
    check(`genre "${g.id}" bass pattern "${g.pattern.bass}" has an audio case`,
      AUDIO_CASES.has(g.pattern.bass));
  }
  for (const q of g.qualities) {
    check(`genre "${g.id}" quality "${q}" exists`, !!Chords.QUALITIES[q]);
  }
}
// Build I-V-vi-IV in C and match
function prog(specs, key, scaleId) {
  return specs.map(sp => {
    const c = Chords.chordFromSpec(sp);
    c.roman = Chords.romanNumeral(c, key, scaleId);
    return c;
  });
}
const axis = prog(['C:maj', 'G:maj', 'A:m', 'F:maj'], 'C', 'major');
const gm = Genres.matchGenre(axis, 'major');
check('matchGenre returns a primary for I-V-vi-IV', !!gm.primary);
check('matchGenre scores all 28', gm.scores.length === 28);

// ── Songs ──────────────────────────────────────────────────────────────────
section('Songs');
check('combined song catalogue >= 130 entries (112 classics + studies)', Songs.SONGS.length >= 130);
const axisMatches = Songs.matchSongs(axis, { max: 10 });
check('I-V-vi-IV matches include Let It Be',
  axisMatches.some(s => s.title === 'Let It Be'));
const andalusian = prog(['A:m', 'G:maj', 'F:maj', 'E:maj'], 'A', 'natural_minor');
const andMatches = Songs.matchSongs(andalusian, { max: 10 });
check('i-bVII-bVI-V matches include Hit the Road Jack (flat-degree fix)',
  andMatches.some(s => s.title === 'Hit the Road Jack'));

// ── Emotions ───────────────────────────────────────────────────────────────
section('Emotions');
check('emotion taxonomy expanded to >= 24', Emotions.EMOTIONS.length >= 24);
const emoIds = new Set();
for (const e of Emotions.EMOTIONS) {
  check(`emotion "${e.id}" id unique`, !emoIds.has(e.id));
  emoIds.add(e.id);
  for (const q of e.qualities) {
    check(`emotion "${e.id}" quality "${q}" exists`, !!Chords.QUALITIES[q]);
  }
  check(`emotion "${e.id}" has group/vibe/motion/tension`,
    !!(e.group && e.vibe && e.motion && e.tension));
}
const sadProg = prog(['A:m', 'F:maj', 'C:maj', 'G:maj'], 'A', 'natural_minor');
check('grieving scores a minor progression above 0',
  Emotions.scoreProgressionForEmotion(sadProg, 'grieving') > 0);
check('euphoric prefers major axis over minor lament',
  Emotions.scoreProgressionForEmotion(axis, 'euphoric') >
  Emotions.scoreProgressionForEmotion(sadProg, 'euphoric'));

// ── Progressions engine smoke ──────────────────────────────────────────────
section('Progressions');
const opts = Progressions.getNextChordOptions({
  key: 'C', scale: 'major', progression: axis.slice(0, 2), sevenths: false,
});
check('getNextChordOptions returns candidates', Array.isArray(opts) && opts.length > 0);

// ── Arrangements data integrity ────────────────────────────────────────────
section('Arrangements');
for (const r of Arrangements.RHYTHMS) {
  check(`rhythm "${r.id}" chords style "${r.chords}" has an audio case`,
    AUDIO_CASES.has(r.chords));
  check(`rhythm "${r.id}" bass style "${r.bass}" has an audio case`,
    AUDIO_CASES.has(r.bass));
}
const rhythmIds = new Set(), drumIds = new Set();
for (const r of Arrangements.RHYTHMS) {
  check(`rhythm id "${r.id}" unique`, !rhythmIds.has(r.id));
  rhythmIds.add(r.id);
}
for (const d of Arrangements.DRUMS) {
  check(`drum id "${d.id}" unique`, !drumIds.has(d.id));
  drumIds.add(d.id);
  const all = [...d.kick, ...d.snare, ...d.hhClosed, ...d.hhOpen];
  check(`drum "${d.id}" steps within 0-15`, all.every(s => s >= 0 && s <= 15));
}
const rhythmFamilies = new Set(Arrangements.RHYTHMS.map(r => r.family));
const drumFamilies = new Set([...Arrangements.DRUMS.map(d => d.family), 'Space']);
check('every genre has an arrangement profile with resolvable defaults',
  Genres.GENRES.every(g => {
    const p = Arrangements.profileFor(g.id);
    return p && p.id === g.id;
  }));
for (const p of Arrangements.GENRE_PROFILES) {
  check(`profile "${p.id}" default rhythm resolves`, rhythmIds.has(p.defaultRhythm));
  check(`profile "${p.id}" default drums resolve`, drumIds.has(p.defaultDrums));
  check(`profile "${p.id}" default vocal resolves`,
    Arrangements.VOCAL_MELODIES.some(v => v.id === p.defaultVocal));
  check(`profile "${p.id}" default under resolves`,
    Arrangements.UNDER_MELODIES.some(u => u.id === p.defaultUnder));
  check(`profile "${p.id}" has families`, Array.isArray(p.families) && p.families.length > 0);
  for (const fam of p.families) {
    check(`profile "${p.id}" family "${fam}" has rhythms or drums`,
      rhythmFamilies.has(fam) || drumFamilies.has(fam));
  }
  for (const s of p.scales) {
    check(`profile "${p.id}" scale "${s}" exists`, !!Scales.SCALES[s]);
  }
  // The profile's default rhythm/drums should come from its own families
  // (that's what the wizard filters by), Space always allowed.
  const rFam = Arrangements.RHYTHMS.find(r => r.id === p.defaultRhythm).family;
  const dFam = Arrangements.DRUMS.find(d => d.id === p.defaultDrums).family;
  check(`profile "${p.id}" default rhythm family "${rFam}" in profile families`,
    p.families.includes(rFam));
  check(`profile "${p.id}" default drum family "${dFam}" in profile families or Space`,
    p.families.includes(dFam) || dFam === 'Space');
}
check('profileFor falls back for unknown ids', Arrangements.profileFor('zzz_nope').id === 'pop');

// ── Feelings taxonomy ──────────────────────────────────────────────────────
section('Feelings');
check('feeling taxonomy has >= 24 entries', Feelings.FEELINGS.length >= 24);
const feelIds = new Set();
for (const f of Feelings.FEELINGS) {
  check(`feeling "${f.id}" id unique`, !feelIds.has(f.id));
  feelIds.add(f.id);
  check(`feeling "${f.id}" emotion "${f.emotionId}" exists`, !!Emotions.getEmotion(f.emotionId));
  check(`feeling "${f.id}" has a group filter`, !!Feelings.FILTERS_BY_GROUP[f.group]);
  check(`feeling "${f.id}" has a contrast entry`, !!Feelings.CONTRAST[f.id]);
  for (const s of f.scaleBias) {
    check(`feeling "${f.id}" scale bias "${s}" exists`, !!Scales.SCALES[s]);
  }
  check(`feeling "${f.id}" has vibe + tip`, !!(f.vibe && f.tip));
}
for (const [fid, c] of Object.entries(Feelings.CONTRAST)) {
  check(`contrast "${fid}" chorus feeling exists`, !!Feelings.getFeeling(c.chorus));
  check(`contrast "${fid}" bridge feeling exists`, !!Feelings.getFeeling(c.bridge));
}

// ── Song generation across the whole matrix ────────────────────────────────
section('Song generation');
const vocalIdSet = new Set(Arrangements.VOCAL_MELODIES.map(v => v.id));
const underIdSet = new Set(Arrangements.UNDER_MELODIES.map(u => u.id));
let genChecked = 0;
for (const f of Feelings.FEELINGS) {
  for (const g of Genres.GENRES) {
    const song = Feelings.generateSongSpec({
      feelingId: f.id, genreId: g.id, energy: 'mid', seed: 1234,
    });
    const v = Song.validate(song);
    if (!v.ok) { check(`generateSongSpec(${f.id}, ${g.id}) valid: ${v.errors.join('; ')}`, false); continue; }
    const ok =
      song.sections.length >= 6 &&
      song.sections.every(sec =>
        sec.progSpecs.length >= 2 &&
        rhythmIds.has(sec.rhythmPattern) &&
        drumIds.has(sec.drumPattern) &&
        vocalIdSet.has(sec.vocalPattern) &&
        underIdSet.has(sec.underPattern) &&
        sec.roster.length >= 2 &&
        Song.chordsOf(song, sec).every(c => c && c.notes.length >= 2)) &&
      song.tempo >= 40 && song.tempo <= 200 &&
      !!Scales.SCALES[song.scale];
    if (!ok) check(`generateSongSpec(${f.id}, ${g.id}) produces resolvable sections`, false);
    else genChecked++;
  }
}
check(`all ${Feelings.FEELINGS.length * Genres.GENRES.length} feeling x genre songs generate cleanly`,
  genChecked === Feelings.FEELINGS.length * Genres.GENRES.length);

// Determinism + reroll variety
const s1 = Feelings.generateSongSpec({ feelingId:'yearning', genreId:'dream_pop', energy:'mid', seed:42 });
const s2 = Feelings.generateSongSpec({ feelingId:'yearning', genreId:'dream_pop', energy:'mid', seed:42 });
const s3 = Feelings.generateSongSpec({ feelingId:'yearning', genreId:'dream_pop', energy:'mid', seed:43 });
check('same seed → same chords',
  JSON.stringify(s1.sections.map(s => s.progSpecs)) === JSON.stringify(s2.sections.map(s => s.progSpecs)));
check('different seed → different song somewhere',
  JSON.stringify(s1.sections.map(s => s.progSpecs)) !== JSON.stringify(s3.sections.map(s => s.progSpecs))
  || s1.key !== s3.key || s1.tempo !== s3.tempo);

// Mode bias holds
const sad = Feelings.generateSongSpec({ feelingId:'grieving', genreId:'pop', energy:'low', seed:7 });
check('grieving pop lands in a minor-family scale',
  /minor|dorian|phrygian/.test(sad.scale));
const bright = Feelings.generateSongSpec({ feelingId:'euphoric', genreId:'pop', energy:'high', seed:7 });
check('euphoric pop lands in a major-family scale',
  !/minor|phrygian|locrian/.test(bright.scale));

// Section-level regeneration touches only that section
const song7 = Feelings.generateSongSpec({ feelingId:'yearning', genreId:'jangle_indie', energy:'mid', seed:99 });
const beforeOther = JSON.stringify(song7.sections.filter((s, i) => i !== 1).map(s => s.progSpecs));
const sec1 = song7.sections[1];
const regen = Feelings.generateSectionSpec(song7, sec1.role, 'menacing', 555);
song7.sections[1] = Object.assign(regen, { id: sec1.id, name: sec1.name });
check('regenerating one section leaves the others untouched',
  JSON.stringify(song7.sections.filter((s, i) => i !== 1).map(s => s.progSpecs)) === beforeOther);
check('regenerated section carries the new feeling', song7.sections[1].feelingId === 'menacing');

// Chorus repetition by design; verse clones are independent objects
const roles7 = song7.sections.map(s => s.role);
const chorusIdx = roles7.map((r, i) => r === 'chorus' ? i : -1).filter(i => i >= 0);
if (chorusIdx.length >= 2) {
  const [a, b] = chorusIdx;
  check('choruses share the same chords',
    JSON.stringify(song7.sections[a].progSpecs) === JSON.stringify(song7.sections[b].progSpecs));
  song7.sections[a].roster.push('__test__');
  check('but editing one chorus roster does not edit the other',
    !song7.sections[b].roster.includes('__test__'));
  song7.sections[a].roster.pop();
}

// ── Song model round-trips ─────────────────────────────────────────────────
section('Song model');
const rt = Song.deserialize(Song.serialize(s1));
check('serialize/deserialize round-trips without errors', rt.errors.length === 0 && !!rt.song);
check('round-trip preserves chords',
  JSON.stringify(rt.song.sections.map(s => s.progSpecs)) === JSON.stringify(s1.sections.map(s => s.progSpecs)));
check('deserialize rejects garbage', Song.deserialize('{"nope":1}').song === null);
check('deserialize rejects invalid JSON', Song.deserialize('not json').song === null);

// Legacy v1 migration
const legacy = {
  key: 'E', scale: 'major', progSpecs: ['E:add9', 'A:maj7', 'C#:m7', 'B:sus4'],
  focusStyle: 'shoegaze', sectionRole: 'chorus', rhythmPattern: 'shoegaze_wash',
  drumPattern: 'hazy_backbeat', vocalPattern: 'stepwise_haze', underPattern: 'high_drone',
  instrument: 'guitar', chordLevel: 90, name: 'My old sketch', savedAt: '2026-01-01T00:00:00Z',
};
const migrated = Song.migrate(legacy);
check('legacy save migrates to a valid v2 song', Song.validate(migrated).ok);
check('legacy migration keeps the progression',
  migrated.sections[0].progSpecs.join(',') === 'E:add9,A:maj7,C#:m7,B:sus4');
check('legacy migration keeps the title', migrated.title === 'My old sketch');
check('legacy migration keeps chord level', migrated.sections[0].levels.chords === 90);

// Hostile or corrupt files: everything that loads a song goes through
// migrate(), so it has to hand back sane types whatever it was given.
{
  const hostile = JSON.parse(Song.serialize(s1)).song;
  hostile.title = 'x'.repeat(100000);
  hostile.key = '<img src=x onerror=alert(1)>';
  hostile.scale = 'not_a_scale';
  hostile.energy = { nested: true };
  hostile.sections[0].repeat = 1e9;
  hostile.sections[0].beatsPerChord = -5;
  hostile.sections[0].tempoOverride = '<img src=x onerror=alert(1)>';
  hostile.sections[0].keyOverride = '<b>';
  hostile.sections[0].levels = { chords: 9999, bass: 'loud' };
  hostile.sections[0].roster = ['drums', { evil: 1 }, 'x'.repeat(5000)];
  hostile.sections[1].progSpecs = ['C:maj', '<script>:maj', 'G:' + 'z'.repeat(500), 'A:m'];
  hostile.sections[1].role = 'verse';
  hostile.sections[1].name = { toString: 'nope' };
  const clean = Song.migrate(hostile);
  const sec0 = clean.sections[0], sec1 = clean.sections[1];

  check('migrate caps a runaway repeat count', sec0.repeat >= 1 && sec0.repeat <= 16);
  check('migrate replaces a nonsense beatsPerChord (a chord then lasts a bar)', sec0.beatsPerChord === null && Song.chordBeats(clean, sec0) === 4);
  check('migrate drops a non-numeric tempo override', sec0.tempoOverride === null);
  check('sectionTempo is always a finite number',
    clean.sections.every(sec => Number.isFinite(Song.sectionTempo(clean, sec))));
  check('migrate drops a key override that is not a note name', sec0.keyOverride === null);
  check('migrate replaces a song key that is not a note name', clean.key === 'C');
  check('migrate replaces an unknown scale', clean.scale === 'major');
  check('migrate replaces a non-string energy', clean.energy === 'mid');
  check('migrate truncates an oversized title', clean.title.length <= 120);
  check('migrate clamps mix levels to 0-100',
    sec0.levels.chords === 100 && sec0.levels.bass === 100 && sec0.levels.drums === 100);
  check('migrate keeps only string roster ids of sane length',
    sec0.roster.length === 1 && sec0.roster[0] === 'drums');
  check('migrate drops malformed chord specs but keeps the good ones',
    sec1.progSpecs.join(',') === 'C:maj,A:m');
  check('migrate replaces a non-string section name', typeof sec1.name === 'string' && sec1.name.length > 0);
  check('a sanitised hostile song still plays back',
    Song.buildPlayback(clean).every(it => it.repeat <= 16 && it.beatsPerChord <= 16));

  const polluted = JSON.parse('{"title":"p","sections":[],"__proto__":{"polluted":true}}');
  const safe = Song.migrate(polluted);
  check('migrate never adopts a __proto__ key from the file',
    Object.getPrototypeOf(safe) === Object.prototype && safe.polluted === undefined);

  const huge = JSON.parse(Song.serialize(s1));
  huge.song.sections = Array.from({ length: 5000 }, () => ({ role: 'verse', progSpecs: ['C:maj'] }));
  check('deserialize rejects a file with thousands of sections',
    Song.deserialize(JSON.stringify(huge)).song === null);
  const long = JSON.parse(Song.serialize(s1));
  long.song.sections[0].progSpecs = Array.from({ length: 5000 }, () => 'C:maj');
  check('deserialize rejects a section with thousands of chords',
    Song.deserialize(JSON.stringify(long)).song === null);
  check('migrate leaves a normal generated song untouched',
    JSON.stringify(Song.migrate(JSON.parse(Song.serialize(s1)).song).sections) ===
    JSON.stringify(s1.sections));
}

// Chord spelling: a stored chord keeps the accidental it was written with,
// so a Bb typed into a song in C does not come back as A#.
{
  const spell = (key, spec) => {
    const sng = Song.createSong({ key, scale: 'major' });
    const sec = Song.createSection({ progSpecs: [spec] });
    return Song.chordsOf(sng, sec)[0].shortName;
  };
  check('a flat chord in a sharp-side key keeps its flat', spell('C', 'Bb:maj') === 'Bb');
  check('a sharp chord in a flat key keeps its sharp', spell('F', 'F#:m') === 'F#m');
  check('a sharp-spelled chord in a neutral key is unchanged', spell('C', 'A#:maj') === 'A#');
  check('natural chords are unaffected', spell('Bb', 'C:m') === 'Cm' && spell('C', 'G:7') === 'G7');
}

// buildPlayback
const pb = Song.buildPlayback(s1);
check('buildPlayback yields one item per section', pb.length === s1.sections.length);
check('playback items have chords, patterns, tempo',
  pb.every(it => it.chords.length > 0 && it.pattern && it.pattern.drums && it.tempo > 0));
check('playback melody events look sane',
  pb.every(it => it.melody.every(ev => ev.midi > 30 && ev.midi < 100 && ev.beats > 0)));
check('playbackItem builds one section exactly as the whole song does',
  s1.sections.every((sec, i) => JSON.stringify(Song.playbackItem(s1, sec)) === JSON.stringify(pb[i])));
{
  const item = Song.playbackItem(s1, Song.createSection({ role: 'bridge', vocalPattern: 'chorus_lift' }));
  check('an empty section still has an item: no chords, so nothing to sing', item && item.chords.length === 0 && item.melody.length === 0 && item.under.length === 0);
  const odd = Song.playbackItem(s1, Song.createSection({ progSpecs: ['C:maj', 'G:maj'], vocalPattern: 'from_a_newer_version' }));
  check('a melody this version does not know is not sung as some other melody', odd.melody.length === 0);
}

// Melody seeding
const chordsX = Song.chordsOf(s1, s1.sections[1]);
const vp = Arrangements.byId(Arrangements.VOCAL_MELODIES, s1.sections[1].vocalPattern);
const mA = Melody.generatePatternMelody(chordsX, s1.scale, s1.key, vp, { beatsPerChord: 4, seed: 1 });
const mB = Melody.generatePatternMelody(chordsX, s1.scale, s1.key, vp, { beatsPerChord: 4, seed: 1 });
const mC = Melody.generatePatternMelody(chordsX, s1.scale, s1.key, vp, { beatsPerChord: 4, seed: 2 });
check('melody same seed → identical', JSON.stringify(mA) === JSON.stringify(mB));
check('melody different seed → different take',
  JSON.stringify(mA) !== JSON.stringify(mC));

// ── Tabs ───────────────────────────────────────────────────────────────────
section('Tabs');
{
  // String/fret mapping basics.
  const e4 = Tabs.mapEventsToFrets([{ midi: 64, beatStart: 0, beats: 1 }], { register: 'lead' });
  check('E4 maps to an open string in lead register',
    e4.length === 1 && e4[0].fret === 0);
  const lowE = Tabs.mapEventsToFrets([{ midi: 40, beatStart: 0, beats: 1 }], { register: 'bass' });
  check('E2 maps to open low E in bass register',
    lowE.length === 1 && lowE[0].string === 0 && lowE[0].fret === 0);
  const subBass = Tabs.mapEventsToFrets([{ midi: 28, beatStart: 0, beats: 1 }], { register: 'bass' });
  check('sub-bass note octave-shifts up and is flagged',
    subBass.length === 1 && subBass[0].midi === 40 && subBass.shiftedCount === 1);
  const runEvents = [60, 62, 64, 65, 67].map((m, i) => ({ midi: m, beatStart: i, beats: 1 }));
  const run = Tabs.mapEventsToFrets(runEvents, { register: 'lead' });
  check('scale run stays in one position (max fret distance <= 4)',
    Math.max(...run.map(r => r.fret)) - Math.min(...run.map(r => r.fret)) <= 4);
  check('every mapped fret reproduces its midi note',
    run.every(r => Tabs.TUNING_MIDI[r.string] + r.fret === r.midi));

  // Rendered melody tab structure.
  const tsong = Feelings.generateSongSpec({ feelingId:'yearning', genreId:'jangle_indie', energy:'mid', seed:11 });
  const tsec = tsong.sections.find(s => s.role === 'verse');
  const tchords = Song.chordsOf(tsong, tsec);
  const vpat = Arrangements.byId(Arrangements.VOCAL_MELODIES, tsec.vocalPattern);
  const mel = Melody.generatePatternMelody(tchords, tsong.scale, tsong.key, vpat,
    { beatsPerChord: 4, section: 'verse', seed: tsec.melodySeed });
  const tab = Tabs.renderMelodyTab(mel, { chords: tchords, beatsPerChord: 4 });
  const tabLines = tab.split('\n').filter(l => /^[eBGDAE] \|/.test(l));
  check('melody tab has 6 string rows per system', tabLines.length % 6 === 0 && tabLines.length >= 6);
  check('string rows in a system are equal width', (() => {
    for (let i = 0; i + 5 < tabLines.length; i += 6) {
      const w = tabLines[i].length;
      for (let j = 1; j < 6; j++) if (tabLines[i + j].length !== w) return false;
    }
    return true;
  })());
  check('melody tab contains fret numbers', /\d/.test(tab));
  check('melody tab shows chord symbols', tab.includes(tchords[0].shortName));

  // Bass tab stays on the low strings.
  const btab = Tabs.renderBassTab(tchords, 'walking', { beatsPerChord: 4 });
  const bLines = btab.split('\n').filter(l => /^[eBGDAE] \|/.test(l));
  const topRows = bLines.filter((l, i) => (i % 6) < 3);   // e, B, G rows of each system
  check('bass tab never uses the top three strings',
    topRows.every(l => !/\d/.test(l.slice(3))));
  check('bass walking line has notes', /\d/.test(btab));

  // Chord tab.
  const ctab = Tabs.renderChordTab(tchords, { beatsPerChord: 4 });
  check('chord tab renders 6 rows', ctab.split('\n').filter(l => /^[eBGDAE] \|/.test(l)).length >= 6);
  check('chord tab includes shapes or explicit fallback', /\d|x|\?/.test(ctab));

  // Every bass style renders.
  for (const style of ['root','root-fifth','walking','pumping','funk-16th','tumbao','reggae','sustained']) {
    const evs = Tabs.bassEvents(tchords, style, 4);
    check(`bassEvents "${style}" produces events`, evs.length > 0);
    check(`bassEvents "${style}" beats within section`,
      evs.every(e => e.beatStart >= 0 && e.beatStart < tchords.length * 4));
  }

  // Drum grid.
  const drum = Arrangements.byId(Arrangements.DRUMS, 'pop_backbeat');
  const dgrid = Tabs.renderDrumGrid(drum);
  check('drum grid has 4 instrument rows + count row', dgrid.split('\n').length === 5);
  check('drum grid rows are 16 steps wide',
    dgrid.split('\n').slice(0, 4).every(l => l.length === 'KK|'.length + 16 + 1));
  check('silent kit says so',
    Tabs.renderDrumGrid(Arrangements.byId(Arrangements.DRUMS, 'none')).includes('no drums'));

  // findChordShape still behaves (moved from app.js).
  const cshape = Tabs.findChordShape(Chords.buildChord('C', 'maj').rootPc, Chords.buildChord('C', 'maj').intervals);
  check('C major has a playable shape', !!cshape && cshape.played >= 4);
  check('C major solves to open position, not a barre', cshape.base === 0);
  const gShape = Tabs.findChordShape(Chords.buildChord('G', 'maj').rootPc, Chords.buildChord('G', 'maj').intervals);
  const aShape = Tabs.findChordShape(Chords.buildChord('A', 'm').rootPc, Chords.buildChord('A', 'm').intervals);
  const eShape = Tabs.findChordShape(Chords.buildChord('E', 'maj').rootPc, Chords.buildChord('E', 'maj').intervals);
  check('G, Am, E all solve to open shapes',
    gShape.base === 0 && aShape.base === 0 && eShape.base === 0);
  check('E major open shape is 0-2-2-1-0-0',
    eShape.shape.map(p => (p ? p.fret : 'x')).join('') === '022100');
  // Colour tones must survive: every distinct chord pc reachable in the shape.
  for (const [root, qual] of [['E','maj7'], ['A','m7'], ['C','maj7'], ['D','7'], ['G','add9'], ['E','add9'], ['A','sus4']]) {
    const ch = Chords.buildChord(root, qual);
    const sh = Tabs.findChordShape(ch.rootPc, ch.intervals);
    if (!sh) { check(`${root}${qual} has a shape`, false); continue; }
    const pcs = new Set(ch.intervals.map(iv => (ch.rootPc + iv) % 12));
    const got = new Set(sh.shape.filter(Boolean).map(p => p.pc));
    check(`${root}${qual} shape covers all ${pcs.size} chord tones`,
      [...pcs].every(pc => got.has(pc)));
  }
}

// ── Storage (with a localStorage stub) ─────────────────────────────────────
section('Storage');
(function () {
  const mem = {};
  globalThis.localStorage = {
    getItem: k => (k in mem ? mem[k] : null),
    setItem: (k, v) => { mem[k] = String(v); },
    removeItem: k => { delete mem[k]; },
  };
  require(path.join(ROOT, 'theory/storage.js'));
  const Storage = globalThis.Storage;

  // Seed a legacy save, then migrate.
  mem['chordpath:saved'] = JSON.stringify({
    'Old shoegaze idea': {
      key: 'E', scale: 'major', progSpecs: ['E:add9', 'A:maj7', 'C#:m7'],
      focusStyle: 'shoegaze', sectionRole: 'verse',
      rhythmPattern: 'shoegaze_wash', drumPattern: 'hazy_backbeat',
      vocalPattern: 'stepwise_haze', underPattern: 'high_drone',
      chordLevel: 95, savedAt: '2026-05-01T10:00:00Z',
    },
  });
  const n = Storage.migrateLegacy();
  check('legacy migration converts one save', n === 1);
  check('migration is one-time', Storage.migrateLegacy() === 0);
  check('legacy key kept as backup', mem['chordpath:saved'] != null);
  const projects = Storage.listProjects();
  check('migrated project listed', projects.length === 1 && projects[0].title === 'Old shoegaze idea');

  // Save/load round trip.
  const gen = Feelings.generateSongSpec({ feelingId:'defiant', genreId:'hardrock', energy:'high', seed:5 });
  gen.title = 'Storage test song';
  check('saveProject succeeds', Storage.saveProject(gen));
  const loaded = Storage.loadProject(gen.id);
  check('loadProject round-trips title + sections',
    loaded.title === 'Storage test song' && loaded.sections.length === gen.sections.length);
  check('project index has both', Storage.listProjects().length === 2);

  // Snapshots: immutable, restore-as-copy.
  const snapId = Storage.takeSnapshot(gen.id, 'before edits');
  check('takeSnapshot returns id', !!snapId);
  loaded.title = 'Edited title';
  loaded.sections[0].progSpecs = ['C:maj'];
  Storage.saveProject(loaded);
  const snap = Storage.loadSnapshot(gen.id, snapId);
  check('snapshot unaffected by autosave',
    snap.title === 'Storage test song' && snap.sections[0].progSpecs.length > 1);
  const restoredId = Storage.restoreSnapshot(gen.id, snapId);
  check('restore creates a NEW project', restoredId && restoredId !== gen.id);
  check('restored copy has snapshot content, live project untouched',
    Storage.loadProject(restoredId).sections[0].progSpecs.length > 1 &&
    Storage.loadProject(gen.id).title === 'Edited title');
  check('project count now 3', Storage.listProjects().length === 3);

  // Export / import.
  const text = Storage.exportText(gen.id);
  check('exportText yields chordpath-song JSON', text.includes('"chordpath-song"'));
  const imp = Storage.importJSON(text);
  check('importJSON creates a new project with a new id',
    imp.song && imp.song.id !== gen.id && Storage.listProjects().length === 4);
  check('importJSON rejects garbage', Storage.importJSON('{"x":1}').song === null);

  // Duplicate + delete.
  const dupId = Storage.duplicateProject(gen.id);
  check('duplicate creates independent copy',
    dupId && Storage.loadProject(dupId).title.includes('(copy)'));
  Storage.deleteProject(dupId);
  check('deleteProject removes it', Storage.loadProject(dupId) === null);
  Storage.deleteSnapshot(gen.id, snapId);
  check('deleteSnapshot removes it', Storage.loadSnapshot(gen.id, snapId) === null);

  // Settings.
  Storage.setSettings({ theme: 'dark', singerRange: { low: 'C3', high: 'G4' } });
  check('settings persist and merge',
    Storage.getSettings().theme === 'dark' && Storage.getSettings().singerRange.high === 'G4');

  // Legacy hash decode.
  const hashSong = Storage.decodeLegacyHash('#k=C&s=major&p=C:maj,A:m7,F:maj7&fs=jangle_indie&sec=chorus');
  check('decodeLegacyHash builds a valid one-section song',
    hashSong && Song.validate(hashSong).ok && hashSong.sections[0].progSpecs.length === 3);
  check('decodeLegacyHash ignores router hashes', Storage.decodeLegacyHash('#/songs') === null);
})();

// ── Studio knowledge base ──────────────────────────────────────────────────
section('Studio knowledge base');
const instIds = new Set(Instruments.INSTRUMENTS.map(i => i.id));
const roleIds = new Set(Instruments.ROLES.map(r => r.id));
const slotIds = new Set(Instruments.SLOTS.map(s => s.id));
for (const inst of Instruments.INSTRUMENTS) {
  check(`instrument "${inst.id}" role valid`, roleIds.has(inst.role));
  check(`instrument "${inst.id}" slots valid`,
    Object.keys(inst.slots).every(s => slotIds.has(s)));
  check(`instrument "${inst.id}" has a tip`, !!inst.tip);
  check(`instrument "${inst.id}" has a mix guide`, !!Mixing.guideFor(inst.id));
  check(`instrument "${inst.id}" has a recording guide`, !!Recording.guideFor(inst.id));
}
// Every roster id the feeling engine can emit must exist in the catalog.
for (const [genreId, roster] of Object.entries(Feelings.GENRE_ROSTERS)) {
  for (const id of roster) {
    check(`genre roster "${genreId}" instrument "${id}" exists`, instIds.has(id));
  }
}
for (const f of Feelings.FEELINGS) {
  const bias = f.rosterBias || {};
  for (const id of [...(bias.add || []), ...(bias.drop || [])]) {
    check(`feeling "${f.id}" roster bias "${id}" exists`, instIds.has(id));
  }
}
// Plugins reference real instruments (mix_bus and snare are honorary targets).
const plugTargets = new Set([...instIds, 'mix_bus', 'snare']);
for (const p of Plugins.PLUGINS) {
  check(`plugin "${p.id}" targets exist`,
    p.forInstruments.every(t => plugTargets.has(t)));
  check(`plugin "${p.id}" has why + tip`, !!(p.why && p.tip));
}
// Every real instrument gets at least one plugin suggestion (sound or fx).
for (const inst of Instruments.INSTRUMENTS) {
  const rec = Plugins.forInstrument(inst.id);
  check(`instrument "${inst.id}" has >= 1 plugin suggestion`,
    rec.sound.length + rec.effects.length >= 1);
}
// Pair tips reference real instruments.
for (const pt of Mixing.PAIR_TIPS) {
  check(`pair tip ${pt.a}+${pt.b} instruments exist`, instIds.has(pt.a) && instIds.has(pt.b));
}
check('pairTip is symmetric', Mixing.pairTip('drums', 'bass') === Mixing.pairTip('bass', 'drums'));

// Density analysis behaves.
const sparse = Instruments.analyzeRoster(['lead_vocal'], { role: 'chorus', energy: 'mid' });
check('one instrument in a chorus reads sparse', sparse.verdict === 'sparse');
check('sparse chorus flags missing bass', sparse.missingRoles.includes('bass'));
const crowded = Instruments.analyzeRoster(
  ['drums','bass','rhythm_gtr','acoustic_gtr','piano','e_piano','organ','pad','strings','lead_vocal'],
  { role: 'verse', energy: 'mid' });
check('ten instruments in a verse reads crowded', crowded.verdict === 'crowded');
check('crowded verse names hot slots', crowded.hotSlots.length > 0);
check('crowded verse surfaces clashes with tips', crowded.clashes.length > 0);
const balanced = Instruments.analyzeRoster(
  ['drums','bass','rhythm_gtr','pad','lead_vocal'], { role: 'chorus', energy: 'mid' });
check('a classic five-piece chorus reads balanced', balanced.verdict === 'balanced');
check('every generated roster analyzes without crashing',
  Feelings.FEELINGS.every(f => Genres.GENRES.every(g => {
    const roster = Feelings.defaultRoster(g.id, f.id, 'chorus', 'mid');
    const rep = Instruments.analyzeRoster(roster, { role: 'chorus', energy: 'mid' });
    return rep && rep.verdict && Array.isArray(rep.advice);
  })));

// ── Descriptions ───────────────────────────────────────────────────────────
section('Descriptions');
{
  check('named library combines focused + classic entries', Descriptions.ALL_NAMED.length >= 50);
  const descIds = new Set();
  for (const n of Descriptions.ALL_NAMED) {
    check(`named pattern "${n.pattern}" is ASCII-normalised`, !/[♭♯]/.test(n.pattern));
    check(`named pattern "${n.pattern}" has a name + describe`, !!(n.name && typeof n.describe === 'function'));
  }
  // Axis progression should be recognised by name, not fall through to prose.
  const axisDesc = Descriptions.describe(axis, 'C', 'major');
  check('I-V-vi-IV is recognised as a named progression',
    /Shoegaze lift|Axis/.test(axisDesc));
  // A flat-degree pattern (unicode ♭ from romanNumeral vs ASCII in the library).
  const andalusianDesc = Descriptions.describe(andalusian, 'A', 'natural_minor');
  check('i-bVII-bVI-V matches the Andalusian entry despite unicode flats',
    /Andalusian|descending verse/i.test(andalusianDesc));
  // Longest-match wins: I-IV alone vs the 4-chord shape ending in I-IV.
  const twoChord = prog(['C:maj', 'F:maj'], 'C', 'major');
  check('a bare I-IV still matches the short entry',
    /Plagal|Dorian|:/.test(Descriptions.describe(twoChord, 'C', 'major')));
  const doowop = prog(['C:maj', 'A:m', 'F:maj', 'G:maj'], 'C', 'major');
  check('I-vi-IV-V picks the 4-chord doo-wop entry, not a 2-chord tail',
    /Doo-wop|doo-wop|Jangle pop/i.test(Descriptions.describe(doowop, 'C', 'major')));
  // Every generated section describes without throwing.
  const dsong = Feelings.generateSongSpec({ feelingId:'menacing', genreId:'metal', energy:'high', seed:12 });
  check('every generated section produces a description',
    dsong.sections.every(sec => {
      const text = Descriptions.describe(Song.chordsOf(dsong, sec), dsong.key, dsong.scale);
      return typeof text === 'string' && text.length > 10;
    }));
}

// ── Multi-track MIDI ───────────────────────────────────────────────────────
section('MIDI export');
require(path.join(ROOT, 'theory/midi.js'));
const Midi = globalThis.Midi;
{
  const msong = Feelings.generateSongSpec({ feelingId:'triumphant', genreId:'classic_rock', energy:'mid', seed:77 });
  const bytes = Midi.buildSongSMF(msong);
  check('buildSongSMF returns bytes', bytes && bytes.length > 200);
  const str = (i, n) => String.fromCharCode(...bytes.slice(i, i + n));
  check('SMF header magic', str(0, 4) === 'MThd');
  const format = (bytes[8] << 8) | bytes[9];
  const ntrks = (bytes[10] << 8) | bytes[11];
  const division = (bytes[12] << 8) | bytes[13];
  check('format 1', format === 1);
  check('division 480', division === 480);
  check('conductor + up to 5 part tracks', ntrks >= 4 && ntrks <= 6);
  // Walk chunks.
  let off = 14, chunks = 0;
  const trackData = [];
  while (off < bytes.length) {
    check(`chunk ${chunks} magic MTrk`, str(off, 4) === 'MTrk');
    const len = (bytes[off+4] << 24) | (bytes[off+5] << 16) | (bytes[off+6] << 8) | bytes[off+7];
    trackData.push(bytes.slice(off + 8, off + 8 + len));
    off += 8 + len;
    chunks++;
  }
  check('chunk count matches header', chunks === ntrks);
  const hasBytes = (data, pair) => {
    for (let i = 0; i < data.length - 1; i++) {
      if (data[i] === pair[0] && data[i+1] === pair[1]) return true;
    }
    return false;
  };
  check('conductor has tempo meta (FF 51)', hasBytes(trackData[0], [0xff, 0x51]));
  check('conductor has section markers (FF 06)', hasBytes(trackData[0], [0xff, 0x06]));
  check('a track plays drums on channel 10 (status 0x99)',
    trackData.some(d => d.some(b => b === 0x99)));
  check('a track uses channel 1 note-ons (chords, 0x90)',
    trackData.some(d => hasBytes(d, [0x90, undefined].map((x,i)=>i===0?0x90:0)) || d.includes(0x90)));
  // Marker text includes a section name.
  const condText = String.fromCharCode(...trackData[0]);
  check('markers name the sections', condText.includes('Chorus') || condText.includes('Verse'));
  // Single-section export still works (regression).
  const chordsM = prog(['C:maj','G:maj','A:m','F:maj'], 'C', 'major');
  const single = Midi.buildSMF({ tempo: 100, chords: chordsM });
  check('single-section Type-0 export still works',
    single && String.fromCharCode(...single.slice(0, 4)) === 'MThd');
}

// ── Where test runs open the window ────────────────────────────────────────
section('Desktop: where test windows open');
{
  const Screens = require(path.join(ROOT, 'desktop/screens.js'));
  const tv = { id: 1, internal: false, workArea: { x: 0, y: 0, width: 1536, height: 816 } };
  const laptop = { id: 2, internal: true, workArea: { x: 1536, y: 0, width: 1536, height: 816 } };
  const side = { id: 3, internal: false, workArea: { x: -1920, y: 0, width: 1920, height: 1040 } };
  const at = (displays, primaryId) => Screens.testPlacement(displays, primaryId, 1440);
  const onLaptop = at([tv, laptop], 1);
  check('a test window opens on the laptop screen, not the main one', onLaptop.x >= 1536 && onLaptop.x + 1440 <= 3072 && onLaptop.y === 0);
  check('centred across it', onLaptop.x === 1536 + 48);
  check('on the laptop screen even when it is the main one', at([laptop, side], 2).x >= 1536);
  check('with no built-in screen, on any screen but the main one', at([tv, side], 1).x < 0);
  check('with one screen, on that one', at([tv], 1).x === 48);
  check('a window wider than the screen starts at its left edge', Screens.testPlacement([laptop], 2, 2000).x === 1536);
}

// ── Summary ────────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
if (failed) {
  console.error('\nFailed checks:');
  failures.forEach(f => console.error('  - ' + f));
  process.exit(1);
}
