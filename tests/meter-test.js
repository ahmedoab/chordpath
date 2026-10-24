/* ChordPath — tests for time signatures and the rhythms written for each.
 * Run with: node tests/meter-test.js
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
function section(name) { console.log('\n== ' + name + ' =='); }

[
  'theory/scales.js', 'theory/chords.js', 'theory/voicings.js', 'theory/progressions.js', 'theory/analysis.js',
  'theory/genres.js', 'theory/arrangements.js', 'theory/emotions.js', 'theory/descriptions.js', 'theory/songs.js',
  'theory/melody.js', 'theory/meters.js', 'theory/song.js', 'theory/feelings.js', 'theory/tabs.js',
  'theory/instruments.js', 'theory/midi.js', 'theory/parts.js',
].forEach(f => require(path.join(ROOT, f)));

const { Meters, Song, Arrangements, Chords, Parts, Tabs } = globalThis;

// ── The time signatures ────────────────────────────────────────────────────
section('Time signatures');
{
  const ids = Meters.LIST.map(m => m.id);
  eq('the familiar and the unusual are all on offer', ids, ['4/4', '3/4', '2/4', '6/8', '9/8', '12/8', '5/4', '7/4', '7/8']);
  check('each says what it feels like, in words a writer would use', Meters.LIST.every(m => typeof m.feel === 'string' && m.feel.length > 30 && typeof m.name === 'string'));
  check('and how to count it', Meters.LIST.every(m => typeof m.count === 'string' && m.count.length > 0));

  const of = id => Meters.get(id);
  eq('a bar of 4/4 is four quarter beats, sixteen sixteenths', [Meters.barQuarters(of('4/4')), Meters.stepsPerBar(of('4/4'))], [4, 16]);
  eq('3/4 is three and twelve', [Meters.barQuarters(of('3/4')), Meters.stepsPerBar(of('3/4'))], [3, 12]);
  eq('6/8 is three quarters long, twelve sixteenths', [Meters.barQuarters(of('6/8')), Meters.stepsPerBar(of('6/8'))], [3, 12]);
  eq('7/8 is three and a half quarters, fourteen sixteenths', [Meters.barQuarters(of('7/8')), Meters.stepsPerBar(of('7/8'))], [3.5, 14]);
  eq('12/8 is six quarters, twenty-four sixteenths', [Meters.barQuarters(of('12/8')), Meters.stepsPerBar(of('12/8'))], [6, 24]);

  // Where the strong beats fall: what a drummer or a strumming hand leans on.
  eq('4/4 leans on every beat, 1 hardest', Meters.pulses(of('4/4')), [{ step: 0, strong: true }, { step: 4, strong: false }, { step: 8, strong: false }, { step: 12, strong: false }]);
  eq('6/8 sways in two big beats', Meters.pulses(of('6/8')).filter(p => p.strong).map(p => p.step), [0, 6]);
  eq('5/4 is felt as three and two', Meters.pulses(of('5/4')).filter(p => p.strong).map(p => p.step), [0, 12]);
  eq('7/8 as two, two and three', Meters.pulses(of('7/8')).filter(p => p.strong).map(p => p.step), [0, 4, 8]);

  eq('a time signature can be read from text', Meters.parse(' 6/8 '), { num: 6, den: 8 });
  eq('and not from nonsense', [Meters.parse('6/7'), Meters.parse('0/4'), Meters.parse('x'), Meters.parse(null)], [null, null, null, null]);
  eq('one that is not on the list still counts if it is sound', Meters.parse('11/8'), { num: 11, den: 8 });
  check('the list shows where each is heard', of('3/4').examples.length > 0 && of('6/8').examples.some(e => /Rising Sun/.test(e)));
}

// ── Rhythms written for each time ──────────────────────────────────────────
section('Rhythms for each time signature');
{
  Meters.LIST.forEach(m => {
    const steps = Meters.stepsPerBar(m);
    const rhythms = Meters.rhythmsFor(m);
    const grooves = Meters.groovesFor(m);
    check(`${m.id}: several strums and patterns to try (${rhythms.length})`, rhythms.length >= 3);
    check(`${m.id}: several drum grooves (${grooves.length})`, grooves.length >= 2);
    check(`${m.id}: every pattern is exactly one bar long`,
      rhythms.every(r => r.chords.length === steps && r.bass.length === steps) &&
      grooves.every(g => ['kick', 'snare', 'hat', 'open'].every(lane => g[lane].length === steps)));
    check(`${m.id}: and written only in the letters a chart uses`,
      rhythms.every(r => /^[DdUux.\-1-6]+$/.test(r.chords) && /^[R5 83>.\-]+$/.test(r.bass.replace(/ /g, ''))) &&
      grooves.every(g => ['kick', 'snare', 'hat', 'open'].every(lane => /^[x.X]+$/.test(g[lane]))));
    check(`${m.id}: every pattern starts the bar with something`, rhythms.every(r => r.chords[0] !== '.' || r.bass[0] !== '.'));
    check(`${m.id}: each has a name and a word on when to use it`, rhythms.concat(grooves).every(p => p.name && p.tip && p.id && p.meter === m.id));
  });
  const ids = Meters.LIST.flatMap(m => Meters.rhythmsFor(m).concat(Meters.groovesFor(m))).map(p => p.id);
  check('no two patterns share a name', new Set(ids).size === ids.length);
  check('a pattern can be found by its name, and knows its time', Meters.rhythm('waltz_strum').meter === '3/4' && Meters.groove('six_eight_ballad').meter === '6/8');
  check('the default for a time is one of its own', Meters.LIST.every(m => Meters.rhythm(Meters.defaultRhythm(m)).meter === m.id && Meters.groove(Meters.defaultGroove(m)).meter === m.id));

  // A chart read as hits: where, which way, how hard.
  const hits = Meters.chordHits('D...D.U...U.D.U.');
  eq('a strum chart reads as hits in time', hits.map(h => [h.step, h.kind]), [[0, 'down'], [4, 'down'], [6, 'up'], [10, 'up'], [12, 'down'], [14, 'up']]);
  check('capital letters are the hard strokes', hits[0].accent === true && Meters.chordHits('d')[0].accent === false);
  check('each hit rings until the next', hits[0].length === 4 && hits[5].length === 2);
  eq('a picked pattern names the strings in turn', Meters.chordHits('1.3.5.3.').map(h => [h.kind, h.tone]), [['pick', 1], ['pick', 3], ['pick', 5], ['pick', 3]]);
  eq('an x is a muted chuck', Meters.chordHits('..x.').map(h => h.kind), ['chuck']);
  eq('a bass chart reads as notes', Meters.bassHits('R.....5.....').map(h => [h.step, h.degree, h.length]), [[0, 'root', 6], [6, 'fifth', 6]]);
  eq('a drum lane reads as steps', Meters.laneSteps('x.....x.....'), [0, 6]);
  eq('a chart can be shown with arrows, for reading at a glance', Meters.arrows('D...u.'), '↓   ↑ ');
}

// ── Songs in other times ───────────────────────────────────────────────────
section('A song in another time');
{
  const song = Song.createSong({ key: 'G', scale: 'major', tempo: 90, meter: { num: 6, den: 8 } });
  eq('a song has a time signature, 4/4 unless it says', [Song.createSong({}).meter, song.meter], [{ num: 4, den: 4 }, { num: 6, den: 8 }]);
  const verse = Song.createSection({ role: 'verse' });
  song.sections.push(verse);
  eq('its sections follow it', Song.sectionMeter(song, verse), { num: 6, den: 8 });
  const bridge = Song.createSection({ role: 'bridge', meterOverride: { num: 7, den: 8 } });
  song.sections.push(bridge);
  eq('unless a section has a time of its own', Song.sectionMeter(song, bridge), { num: 7, den: 8 });
  eq('a chord lasts a bar of its section unless told otherwise', [Song.chordBeats(song, verse), Song.chordBeats(song, bridge)], [3, 3.5]);
  verse.progSpecs = ['G:maj', 'C:maj', 'D:maj', 'G:maj'];
  eq('so four chords of 6/8 are four bars', Song.sectionBars(verse, song), 4);

  const saved = Song.migrate(JSON.parse(JSON.stringify(song)));
  eq('the times survive saving and loading', [saved.meter, saved.sections[1].meterOverride], [{ num: 6, den: 8 }, { num: 7, den: 8 }]);
  const old = Song.migrate({ title: 'Old', sections: [{ role: 'verse', progSpecs: ['C:maj'] }] });
  eq('a song from before time signatures is in 4/4, a chord to a bar', [old.meter, old.sections[0].meterOverride, Song.chordBeats(old, old.sections[0])], [{ num: 4, den: 4 }, null, 4]);
  const odd = Song.migrate({ title: 'Odd', meter: { num: 6, den: 7 }, sections: [{ role: 'verse', meterOverride: '5/4', beatsPerChord: 3.5, progSpecs: [] }] });
  eq('a time that cannot be is put right, and one written as text is understood', [odd.meter, odd.sections[0].meterOverride, odd.sections[0].beatsPerChord], [{ num: 4, den: 4 }, { num: 5, den: 4 }, 3.5]);
  eq('a chord can last half a beat more or less, but not a sliver', Song.migrate({ title: 'x', sections: [{ role: 'verse', beatsPerChord: 3.3, progSpecs: [] }] }).sections[0].beatsPerChord, 3.5);

  // Played: the section's own time, its own rhythm for that time.
  verse.rhythmPattern = 'six_eight_sway';
  verse.drumPattern = 'six_eight_ballad';
  const items = Song.buildPlayback(song).filter(it => it.chords.length);
  eq('playback knows each section\'s time and how long its chords are', [items[0].meter, items[0].beatsPerChord, items[0].stepsPerChord], [{ num: 6, den: 8 }, 3, 12]);
  check('and plays the rhythm written for that time', items[0].pattern.steps && items[0].pattern.steps.chords === Meters.rhythm('six_eight_sway').chords);
  const wrong = Arrangements.makePlaybackPattern('shoegaze_wash', 'hazy_backbeat', { num: 3, den: 4 });
  check('a 4/4 rhythm asked to play in 3/4 gives way to one made for 3/4', wrong.steps && wrong.steps.meter === '3/4');
  const four = Arrangements.makePlaybackPattern('shoegaze_wash', 'hazy_backbeat', { num: 4, den: 4 });
  check('while in 4/4 the style rhythms play as they always have', !four.steps && four.chords === 'shoegaze-wash');
  const chart44 = Arrangements.makePlaybackPattern('folk_strum', 'basic_rock', { num: 4, den: 4 });
  check('and a 4/4 chart plays as a chart', chart44.steps && chart44.steps.chords === Meters.rhythm('folk_strum').chords);

  // The DAW gets the same: bars of the right length and a time signature where each section starts.
  const laid = Parts.fromSong(song);
  const v = laid.sections.find(s => s.name === verse.name || s.role === 'verse');
  check(`laid out for the DAW, a section of four 6/8 bars lasts twelve beats (${v && v.beats})`, v && v.beats === 12);
  const drumHits = v.parts.drums.map(n => n.t);
  check('its drums repeat every 6/8 bar, not every 4/4 one', drumHits.includes(0) && drumHits.includes(3) && drumHits.includes(6) && !drumHits.some(t => t >= 12));
  const chordHits = v.parts.chords.filter(n => n.t < 3).map(n => n.t);
  check('its chords are strummed where the chart says', chordHits.some(t => Math.abs(t) < 0.05) && chordHits.some(t => Math.abs(t - 1.5) < 0.05));
}

// ── Melodies ───────────────────────────────────────────────────────────────
section('Melodies fit the bar');
{
  const chords = ['G:maj', 'C:maj', 'D:maj'].map(sp => Chords.chordFromSpec(sp));
  const shape = Arrangements.VOCAL_MELODIES.find(v => v.id === 'stepwise_haze');
  const waltz = Melody.generatePatternMelody(chords, 'major', 'G', shape, { beatsPerChord: 3, seed: 1 });
  check('in 3/4 a vocal line stays inside each chord\'s bar', waltz.every(n => {
    const bar = Math.floor(n.beatStart / 3 + 1e-9);
    return n.beatStart + n.beats <= (bar + 1) * 3 + 1e-9;
  }));
  const four = Melody.generatePatternMelody(chords, 'major', 'G', shape, { beatsPerChord: 4, seed: 1 });
  check('and in 4/4 it is just as it was', four.map(n => n.beatStart).join(',') === [0, 1, 2].flatMap(ci => [0, 1.5, 2.5, 3.25].map(c => ci * 4 + c)).join(','));
  const bell = Arrangements.UNDER_MELODIES.find(u => u.type === 'chime');
  const under = Melody.generateUnderMelody(chords, 'major', 'G', bell, { beatsPerChord: 3 });
  check('and the notes of an under-melody fall in the chord they belong to', under.length === 12 && under.every((n, i) => Math.floor(n.beatStart / 3 + 1e-9) === Math.floor(i / 4)));
}

// ── MIDI files ─────────────────────────────────────────────────────────────
section('MIDI files keep the time');
{
  const { Midi } = globalThis;
  const song = Song.createSong({ key: 'G', tempo: 90, meter: { num: 6, den: 8 } });
  song.sections.push(Song.createSection({ role: 'verse', progSpecs: ['G:maj', 'C:maj'], rhythmPattern: 'six_eight_sway', drumPattern: 'six_eight_ballad' }));
  song.sections.push(Song.createSection({ role: 'bridge', progSpecs: ['E:m', 'D:maj'], meterOverride: { num: 7, den: 8 } }));
  Song.autoNameSections(song);
  const bytes = Array.from(Midi.buildSongSMF(song));
  const times = [];
  for (let i = 0; i + 6 < bytes.length; i++) {
    if (bytes[i] === 0xff && bytes[i + 1] === 0x58 && bytes[i + 2] === 4) times.push(bytes.slice(i + 3, i + 7).join(','));
  }
  eq('a song in 6/8 with a bridge in 7/8 says so in its MIDI file, where each starts', times, ['6,3,36,8', '7,3,12,8']);
  const one = Array.from(Midi.buildSMF({ tempo: 90, chords: Song.chordsOf(song, song.sections[0]), beatsPerChord: 3, meter: { num: 3, den: 4 } }));
  const at = one.findIndex((b, i) => b === 0xff && one[i + 1] === 0x58);
  eq('and so does a single section exported on its own', one.slice(at + 3, at + 7), [3, 2, 24, 8]);
}

// ── Charts in the tab view ─────────────────────────────────────────────────
section('Seeing a rhythm');
{
  const chart = Tabs.renderStrumChart(Meters.rhythm('waltz_strum'), Meters.get('3/4'));
  check('a strum chart shows the count and the strokes under it', /1\s+&\s+2\s+&\s+3/.test(chart) && /↓/.test(chart));
  const grid = Tabs.renderDrumGrid(Meters.groove('six_eight_ballad'), Meters.get('6/8'));
  check('a groove in 6/8 is drawn twelve steps wide', grid.split('\n').some(line => /^K/.test(line) && (line.match(/[x\-.o]/gi) || []).length >= 12));
}

// ── Chords that last half a bar, or two ────────────────────────────────────
section('Chords half a bar or two bars long');
{
  const C = Chords.chordFromSpec('C:maj'), G = Chords.chordFromSpec('G:maj');
  const inside = (events, bpc) => events.every(e => {
    const end = (Math.floor(e.beatStart / bpc + 1e-9) + 1) * bpc;
    return e.beatStart + e.beats <= end + 1e-9;
  });
  const halves = Tabs.bassEvents([C, G], 'root-fifth', 2);
  check(`a bass line keeps each half-bar chord's notes inside it (${halves.map(e => e.midi + '@' + e.beatStart).join(' ')})`,
    inside(halves, 2) && halves.length === 2 && halves[0].midi === 48 && halves[1].midi === 43);
  const walk = Tabs.bassEvents([C, G], 'walking', 8);
  check(`a walking bass walks every bar of a two-bar chord (${walk.length} notes)`, walk.length === 16 && inside(walk, 8));
  check('leading into the next chord only at the end of the chord',
    walk.find(e => e.beatStart === 3).midi === 60 && walk.find(e => e.beatStart === 7).midi === 42);
  eq('a chord a bar long walks as it always did', Tabs.bassEvents([C, G], 'walking', 4).map(e => e.midi), [48, 52, 55, 42, 43, 47, 50, 47]);

  const song = Song.createSong({ key: 'C', tempo: 100 });
  const sec = Song.createSection({ progSpecs: ['C:maj', 'G:maj', 'A:m', 'F:maj'], rhythmPattern: 'shoegaze_wash', beatsPerChord: 2 });
  song.sections.push(sec);
  const laid = Parts.fromItem(Song.playbackItem(song, sec));
  const ringsOn = laid.chords.filter(n => n.t + n.d > (Math.floor(n.t / 2 + 1e-9) + 1) * 2 + 1e-6);
  check(`in the DAW, no chord rings on into the next one (${ringsOn.length} do)`, laid.chords.length > 0 && ringsOn.length === 0);
  check('and the section is two bars long', laid.beats === 8);
}

// ── A section as tab ───────────────────────────────────────────────────────
section('A section as tab');
{
  const song = Song.createSong({ key: 'G', tempo: 90, meter: { num: 3, den: 4 } });
  const sec = Song.createSection({ progSpecs: ['G:maj', 'C:maj', 'D:maj', 'G:maj'], rhythmPattern: 'waltz_strum', drumPattern: 'waltz_kit', vocalPattern: 'folk_lilt' });
  song.sections.push(sec);
  const chords = Tabs.sectionTab(song, sec, 'chords');
  check('the chord tab is written in bars of 3/4', /^e \|[^|\n]{24}\|/m.test(chords) && !/^e \|[^|\n]{32}\|/m.test(chords));
  check('with the strum chart above it, counted in three', /Count\s+1\s+&\s+2\s+&\s+3/.test(chords) && /Strum/.test(chords));
  check('the drum grid is the waltz groove, a 3/4 bar wide', /^KK\|x-{11}\|$/m.test(Tabs.sectionTab(song, sec, 'drums')));
  const bass = Tabs.sectionTab(song, sec, 'bass');
  check('the bass tab holds the chart\'s notes: G, C and D roots, one to a bar', /^E \|3-{23}\|/m.test(bass) && /^A \|[^|]*\|3-{23}\|/m.test(bass) && /^D \|0-{23}\|/m.test(bass));
  check('the vocal tab is in 3/4 bars too', /^e \|[^|\n]{24}\|/m.test(Tabs.sectionTab(song, sec, 'melody')) || /^B \|[^|\n]{24}\|/m.test(Tabs.sectionTab(song, sec, 'melody')));
  const bare = Song.createSection({ progSpecs: ['G:maj'] });
  song.sections.push(bare);
  check('with no melody chosen it says so, and sings nothing', /no vocal melody/i.test(Tabs.sectionTab(song, bare, 'melody')));
  check('with no drums chosen it says so', /no drums/i.test(Tabs.sectionTab(song, bare, 'drums')));
  check('an empty section has no tab yet', /no chords/i.test(Tabs.sectionTab(song, Song.createSection({}), 'chords')));
  const four = Song.createSong({ key: 'C' });
  const plain = Song.createSection({ progSpecs: ['C:maj', 'A:m'], rhythmPattern: 'pop_eights' });
  four.sections.push(plain);
  eq('a 4/4 section in a style is the chord tab it always was', Tabs.sectionTab(four, plain, 'chords'), Tabs.renderChordTab(Song.chordsOf(four, plain), { beatsPerChord: 4 }));
}

// ── Naming what a section plays ────────────────────────────────────────────
section('Naming what a section plays');
{
  const A = Arrangements;
  check('no rhythm chosen is no rhythm, not the first one on the list', A.rhythmFor('', '4/4') === null && A.rhythmFor(null) === null);
  check('a 4/4 style rhythm is found by its id', (A.rhythmFor('jangle_arp', '4/4') || {}).id === 'jangle_arp');
  check('with no time given, 4/4 is meant', (A.rhythmFor('jangle_arp') || {}).id === 'jangle_arp');
  check('a chart for the time is found by its id', (A.rhythmFor('waltz_strum', '3/4') || {}).id === 'waltz_strum');
  check('a 4/4 style is not the rhythm of a section in 3/4', A.rhythmFor('jangle_arp', '3/4') === null);
  check('nor is a chart written for another time', A.rhythmFor('waltz_strum', '6/8') === null);
  check('a chart made for a time nobody wrote charts for is found', (A.rhythmFor('pulse_11/8', '11/8') || {}).id === 'pulse_11/8');
  check('an unknown rhythm is no rhythm', A.rhythmFor('no_such_rhythm', '4/4') === null);
  check('no drums chosen is no drums', A.drumsFor('', '4/4') === null && A.drumsFor('none', '4/4') === null && A.drumsFor(undefined) === null);
  check('a 4/4 kit is found by its id', (A.drumsFor('motorik_backbeat', '4/4') || {}).id === 'motorik_backbeat');
  check('a groove for the time is found by its id', (A.drumsFor('six_eight_ballad', '6/8') || {}).id === 'six_eight_ballad');
  check('a 4/4 kit is not the drums of a section in 6/8', A.drumsFor('motorik_backbeat', '6/8') === null);
  check('no melody chosen is no melody', A.vocalFor('') === null && A.vocalFor('nope') === null && (A.vocalFor('chorus_lift') || {}).id === 'chorus_lift');
  check('an under-melody of "none" is none', A.underFor('none') === null && A.underFor('') === null && (A.underFor('high_drone') || {}).id === 'high_drone');
  eq('an empty section is described as plain chords and no drums', A.describeCombo('pop', '', '', '', 'none', '4/4'), 'Pop · Plain chords · No drums');
  eq('a section played from charts is described by them', A.describeCombo('folk', 'six_eight_sway', 'six_eight_ballad', 'folk_lilt', 'high_drone', '6/8'),
    'Folk / Acoustic · Swaying strum · 6/8 ballad · Folk lilt · High drone');
  eq('an unknown genre is described as pop, not as the first genre on the list', A.describeCombo('no_such_genre', '', '', '', '', '4/4'), 'Pop · Plain chords · No drums');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) {
  console.error('\nFailed checks:');
  failures.forEach(f => console.error('  - ' + f));
  process.exit(1);
}
