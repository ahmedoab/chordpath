/* ChordPath — tests for the ideas offered to a writer.
 * Run with: node tests/ideas-test.js
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
function section(name) { console.log('\n== ' + name + ' =='); }

[
  'theory/scales.js', 'theory/chords.js', 'theory/voicings.js', 'theory/progressions.js', 'theory/analysis.js',
  'theory/genres.js', 'theory/arrangements.js', 'theory/emotions.js', 'theory/descriptions.js', 'theory/songs.js',
  'theory/melody.js', 'theory/meters.js', 'theory/song.js', 'theory/feelings.js', 'theory/chordparse.js', 'theory/ideas.js',
].forEach(f => require(path.join(ROOT, f)));

const { Ideas, Song, Meters, Arrangements } = globalThis;

section('Chord progressions to try');
{
  const song = Song.createSong({ key: 'G', scale: 'major', tempo: 96 });
  const verse = Song.createSection({ role: 'verse' });
  song.sections.push(verse);

  const ideas = Ideas.progressions(song, verse, { seed: 5 });
  check(`a handful of progressions is offered (${ideas.length})`, ideas.length >= 6 && ideas.length <= 10);
  check('every one is a real progression of two chords or more', ideas.every(i => i.specs.length >= 2 && i.specs.every(sp => /^[A-G][#b]?:/.test(sp))));
  check('no two are the same', new Set(ideas.map(i => i.specs.join(' '))).size === ideas.length);
  check('each says where it comes from or how it leans', ideas.every(i => typeof i.label === 'string' && i.label.length > 3));
  const famous = ideas.filter(i => i.kind === 'song');
  check('some are progressions heard in well-known songs, named', famous.length >= 2 && famous.every(i => /\S/.test(i.song.title)));
  const axis = famous.find(i => i.roman === 'I-V-vi-IV');
  check('played in the song\'s key, not the record\'s', !axis || axis.specs.join(' ') === 'G:maj D:maj E:m C:maj');
  check('with no feeling chosen, the others lean several different ways', new Set(ideas.filter(i => i.kind === 'feeling').map(i => i.feelingId)).size >= 3);

  const again = Ideas.progressions(song, verse, { seed: 5 });
  check('the same seed gives the same ideas', JSON.stringify(again) === JSON.stringify(ideas));
  const fresh = Ideas.progressions(song, verse, { seed: 6 });
  check('another seed gives others', JSON.stringify(fresh.map(i => i.specs)) !== JSON.stringify(ideas.map(i => i.specs)));

  song.feelingId = 'hopeful';
  const leaning = Ideas.progressions(song, verse, { seed: 5 }).filter(i => i.kind === 'feeling');
  check('with a feeling chosen, most lean that way, and one or two the other', leaning.filter(i => i.feelingId === 'hopeful').length >= 2 && leaning.some(i => i.feelingId !== 'hopeful'));

  const minor = Song.createSong({ key: 'A', scale: 'natural_minor' });
  const mv = Song.createSection({ role: 'verse' });
  minor.sections.push(mv);
  const minorSongs = Ideas.progressions(minor, mv, { seed: 2 }).filter(i => i.kind === 'song');
  check('a minor key is offered the progressions of songs in minor', minorSongs.length >= 1 && minorSongs.every(i => i.mode === 'minor'));
  check('and they start on its home chord', minorSongs.every(i => /^A:m/.test(i.specs[0])));

  // Borrowed chords are written the way the key would write them.
  check('a flat six in G is E flat, not D sharp', Ideas.spell({ root: 'D#', quality: 'maj' }, 'G', 'major') === 'Eb:maj');
  check('and the key\'s own notes keep its sharps', Ideas.spell({ root: 'F#', quality: 'dim' }, 'G', 'major') === 'F#:dim');
  check('a flat key keeps its flats', Ideas.spell({ root: 'A#', quality: 'maj' }, 'F', 'major') === 'Bb:maj');
  const many = [];
  for (let seed = 1; seed <= 12; seed++) Ideas.progressions(song, verse, { seed }).forEach(i => many.push(...i.specs));
  check(`no idea in G is spelled with a sharp G does not have (${[...new Set(many.filter(sp => /^[ACDG]#/.test(sp)))].join(', ') || 'none'})`, !many.some(sp => /^[ACDG]#/.test(sp)));
}

section('Rhythms, grooves and times to try');
{
  const song = Song.createSong({ key: 'D', meter: { num: 6, den: 8 } });
  const sec = Song.createSection({ role: 'chorus' });
  song.sections.push(sec);
  const rhythms = Ideas.rhythms(song, sec);
  check('the rhythms offered are the ones for the section\'s time', rhythms.length >= 3 && rhythms.every(r => r.meter === '6/8'));
  const grooves = Ideas.grooves(song, sec);
  check('and the grooves too, with no drums as a choice of its own', grooves.length >= 3 && grooves[0].id === '' && grooves.slice(1).every(g => g.meter === '6/8'));
  const times = Ideas.times(song, sec);
  check('other times are offered, but not the one it is in', times.length >= 6 && !times.some(t => t.id === '6/8'));
  check('each with how it feels', times.every(t => t.feel && t.name));
  const fourSong = Song.createSong({ key: 'D' });
  const fsec = Song.createSection({ role: 'verse' });
  fourSong.sections.push(fsec);
  check('in 4/4 the charts come first', Ideas.rhythms(fourSong, fsec)[0].meter === '4/4');
}

section('Using an idea');
{
  const song = Song.createSong({ key: 'C', meter: { num: 4, den: 4 } });
  const sec = Song.createSection({ role: 'verse', progSpecs: ['C:maj', 'A:m', 'F:maj', 'G:maj'], rhythmPattern: 'folk_strum', drumPattern: 'basic_rock' });
  song.sections.push(sec);
  Ideas.useTime(song, sec, '6/8');
  check('trying a section in another time sets its own time', sec.meterOverride && sec.meterOverride.num === 6 && sec.meterOverride.den === 8);
  check('and swaps its rhythm and drums for ones made for that time', Meters.rhythm(sec.rhythmPattern).meter === '6/8' && Meters.groove(sec.drumPattern).meter === '6/8');
  check('a strum for a strum', /[Uu]/.test(Meters.rhythm(sec.rhythmPattern).chords));
  check('its chords stay as they were', sec.progSpecs.join(' ') === 'C:maj A:m F:maj G:maj');
  Ideas.useTime(song, sec, '4/4');
  check('back in the song\'s own time, the section simply follows the song again', sec.meterOverride === null && Meters.rhythm(sec.rhythmPattern).meter === '4/4');
  const plain = Song.createSection({ role: 'bridge', progSpecs: ['F:maj'] });
  song.sections.push(plain);
  Ideas.useTime(song, plain, '3/4');
  check('a section with no rhythm or drums chosen keeps none', plain.rhythmPattern === '' && plain.drumPattern === '');
  const twoPerBar = Song.createSection({ role: 'chorus', progSpecs: ['C:maj', 'G:maj'], beatsPerChord: 2 });
  song.sections.push(twoPerBar);
  Ideas.useTime(song, twoPerBar, '3/4');
  check('two chords to a bar stay two chords to a bar', twoPerBar.beatsPerChord === 1.5);
  const picked = Song.createSection({ role: 'intro', progSpecs: ['C:maj'], rhythmPattern: 'picked_four', drumPattern: 'sparse_ballad' });
  song.sections.push(picked);
  Ideas.useTime(song, picked, '6/8');
  check('a picked pattern stays picked, a sparse groove sparse', /^[1-6.]+$/.test(Meters.rhythm(picked.rhythmPattern).chords) && picked.drumPattern === 'six_eight_brushes');
  Ideas.useTime(song, picked, 'nonsense');
  check('a time that is not one changes nothing', picked.meterOverride.num === 6);

  // The whole song in another time.
  const whole = Song.createSong({ key: 'E' });
  const a = Song.createSection({ role: 'verse', progSpecs: ['E:maj', 'A:maj'], rhythmPattern: 'eighth_downups', drumPattern: 'basic_rock' });
  const b = Song.createSection({ role: 'bridge', progSpecs: ['C#:m'], meterOverride: { num: 7, den: 8 }, rhythmPattern: 'seven_eight_drive' });
  const c = Song.createSection({ role: 'chorus', progSpecs: ['B:maj'], meterOverride: { num: 3, den: 4 } });
  whole.sections.push(a, b, c);
  Ideas.useSongTime(whole, '3/4');
  check('the song takes the new time', whole.meter.num === 3 && whole.meter.den === 4);
  check('the sections that followed it move with it', Song.sectionMeter(whole, a).num === 3 && Meters.rhythm(a.rhythmPattern).meter === '3/4' && Meters.groove(a.drumPattern).meter === '3/4');
  check('a section with a time of its own keeps it', b.meterOverride.num === 7 && b.rhythmPattern === 'seven_eight_drive');
  check('and one that was already in the new time now simply follows the song', c.meterOverride === null);
}

section('Melodies to hum over it');
{
  const song = Song.createSong({ key: 'D' });
  const chorus = Song.createSection({ role: 'chorus', progSpecs: ['D:maj', 'G:maj'] });
  song.sections.push(chorus);
  const shapes = Ideas.melodies(song, chorus, { seed: 3 });
  check('a few melody shapes are offered', shapes.length === 4 && new Set(shapes.map(m => m.id)).size === 4);
  check('each one a shape ChordPath can sing', shapes.every(m => Arrangements.VOCAL_MELODIES.some(v => v.id === m.id) && m.seed >= 1));
  check('a chorus is offered ones that rise first', /lift|hook|arch|smile/.test(shapes[0].id));
  check('the same seed, the same shapes', JSON.stringify(Ideas.melodies(song, chorus, { seed: 3 })) === JSON.stringify(shapes));
}

section('Plain chords in any time');
{
  const held = Arrangements.makePlaybackPattern('', '', { num: 6, den: 8 });
  check('with no rhythm chosen, a 6/8 section is held chords where each beat starts', held.steps && held.steps.chords === 'D.....D.....');
  check('and with no drums chosen, no drums', held.drums.kick.length === 0 && held.drums.snare.length === 0 && held.drums.hhClosed.length === 0);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) {
  console.error('\nFailed checks:');
  failures.forEach(f => console.error('  - ' + f));
  process.exit(1);
}
