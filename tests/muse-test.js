/* ChordPath — Muse (the built-in AI) test harness.
 * Run with: node tests/muse-test.js
 * Covers chord-text parsing, key detection, the feeling lexicon, online
 * research parsing (against fixtures — no network), the song memory, and the
 * learning/drafting engine.
 */
'use strict';

const path = require('path');
const ROOT = path.join(__dirname, '..');

let passed = 0, failed = 0;
const failures = [];

function check(label, cond) {
  if (cond) { passed++; }
  else { failed++; failures.push(label); console.error('  FAIL: ' + label); }
}
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) console.error(`    got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);
  check(label, ok);
}
function section(name) { console.log('\n== ' + name + ' =='); }

[
  'theory/scales.js', 'theory/chords.js', 'theory/voicings.js',
  'theory/progressions.js', 'theory/analysis.js', 'theory/genres.js',
  'theory/arrangements.js', 'theory/emotions.js', 'theory/descriptions.js',
  'theory/songs.js', 'theory/melody.js', 'theory/song.js', 'theory/feelings.js',
  'theory/chordparse.js', 'theory/lexicon.js', 'theory/musedata.js', 'theory/muse.js',
].forEach(f => require(path.join(ROOT, f)));

const { Scales, Chords, ChordParse, Genres, Arrangements, Song, Feelings, Lexicon, MuseData, Muse } = globalThis;

// ── Chord symbols ──────────────────────────────────────────────────────────
section('Chord symbols');
const sym = s => { const p = ChordParse.parseSymbol(s); return p ? p.spec : null; };

eq('plain major', sym('C'), 'C:maj');
eq('minor', sym('Am'), 'A:m');
eq('sharp minor seventh', sym('F#m7'), 'F#:m7');
eq('flat major seventh', sym('Bbmaj7'), 'Bb:maj7');
eq('unicode accidentals normalise', sym('E♭'), 'Eb:maj');
eq('unicode sharp minor', sym('F♯m'), 'F#:m');
eq('dominant seventh', sym('G7'), 'G:7');
eq('sus4', sym('Dsus4'), 'D:sus4');
eq('bare sus means sus4', sym('Dsus'), 'D:sus4');
eq('sus2', sym('Asus2'), 'A:sus2');
eq('7sus4', sym('A7sus4'), 'A:7sus4');
eq('add9', sym('Cadd9'), 'C:add9');
eq('minor add9 with parens', sym('Em(add9)'), 'E:madd9');
eq('power chord', sym('E5'), 'E:pow');
eq('sixth', sym('C6'), 'C:6');
eq('minor sixth', sym('Am6'), 'A:m6');
eq('six-nine', sym('C6/9'), 'C:6/9');
eq('ninth', sym('D9'), 'D:9');
eq('major ninth', sym('Fmaj9'), 'F:maj9');
eq('minor ninth', sym('Em9'), 'E:m9');
eq('minor eleventh', sym('Am11'), 'A:m11');
eq('thirteenth', sym('G13'), 'G:13');
eq('diminished', sym('Bdim'), 'B:dim');
eq('diminished with degree sign', sym('B°'), 'B:dim');
eq('diminished seventh', sym('Bdim7'), 'B:dim7');
eq('half-diminished', sym('Bm7b5'), 'B:m7b5');
eq('half-diminished with slashed o', sym('Bø'), 'B:m7b5');
eq('augmented', sym('Caug'), 'C:aug');
eq('augmented plus sign', sym('C+'), 'C:aug');
eq('altered dominants', [sym('E7#9'), sym('E7b9'), sym('C7#11')], ['E:7s9', 'E:7b9', 'C:7s11']);
eq('jazz spellings of minor', [sym('Cmin7'), sym('C-7'), sym('Cmi7')], ['C:m7', 'C:m7', 'C:m7']);
eq('jazz spellings of major seventh', [sym('CM7'), sym('CΔ7'), sym('Cma7')], ['C:maj7', 'C:maj7', 'C:maj7']);
eq('minor-major seventh', sym('Am(maj7)'), 'A:mMaj7');

const slash = ChordParse.parseSymbol('Bb/D');
check('slash chord keeps the chord and records the bass',
  slash && slash.spec === 'Bb:maj' && slash.bass === 'D');
eq('slash chord with a quality', sym('Am7/G'), 'A:m7');

check('unknown extension falls back to the nearest quality and says so',
  (() => { const p = ChordParse.parseSymbol('C7#5#9'); return p && p.root === 'C' && p.approx === true && !!Chords.QUALITIES[p.quality]; })());
check('every parsed quality exists in the chord engine',
  ['C', 'Am', 'F#m7', 'Dsus4', 'A7sus4', 'Cadd9', 'E5', 'C6/9', 'Bø', 'C+', 'E7#9', 'Am(maj7)', 'Gmaj13', 'Dm13']
    .every(s => { const p = ChordParse.parseSymbol(s); return p && !!Chords.QUALITIES[p.quality]; }));

eq('ordinary words are not chords', [sym('hello'), sym('the'), sym('Bridge'), sym('Day'), sym('')], [null, null, null, null, null]);
eq('note names outside A–G are not chords', sym('H7'), null);
eq('N.C. is not a chord', sym('N.C.'), null);

// ── Progressions typed on one line ─────────────────────────────────────────
section('Typed progressions');
const specs = text => ChordParse.parseProgression(text).chords.map(c => c.spec);

eq('space separated', specs('Em7 G Dsus4 A7sus4'), ['E:m7', 'G:maj', 'D:sus4', 'A:7sus4']);
eq('dash separated', specs('Em7 - G - Dsus4 - A7sus4'), ['E:m7', 'G:maj', 'D:sus4', 'A:7sus4']);
eq('en-dash separated, the way Wikipedia writes them', specs('Em7–G–Dsus4–A7sus4'), ['E:m7', 'G:maj', 'D:sus4', 'A:7sus4']);
eq('comma separated', specs('C, G, Am, F'), ['C:maj', 'G:maj', 'A:m', 'F:maj']);
eq('bar lines', specs('| C | G | Am | F |'), ['C:maj', 'G:maj', 'A:m', 'F:maj']);
eq('arrows', specs('C → G → Am → F'), ['C:maj', 'G:maj', 'A:m', 'F:maj']);
eq('repeat marks and N.C. are skipped', specs('C G Am F x2 N.C.'), ['C:maj', 'G:maj', 'A:m', 'F:maj']);
eq('percent sign repeats the previous chord', specs('C % F G'), ['C:maj', 'C:maj', 'F:maj', 'G:maj']);
eq('spaced slashes separate, tight slashes are slash chords', specs('C / G/B / Am'), ['C:maj', 'G:maj', 'A:m']);
eq('unparseable tokens are reported, not silently dropped',
  ChordParse.parseProgression('C G wat F').unknown, ['wat']);
eq('empty text gives no chords', specs('   '), []);

// ── Pasted chord sheets ────────────────────────────────────────────────────
section('Chord sheets');
const sheet = ChordParse.parseSheet([
  '[Verse 1]',
  'Em7          G',
  'Today is gonna be the day',
  '        Dsus4                  A7sus4',
  'That they\'re gonna throw it back to you',
  '',
  '[Chorus]',
  'C     D        Em',
  'And all the roads we have to walk are winding',
  'C     D        Em',
  'And all the lights that lead us there are blinding',
].join('\n'));
eq('sheet splits into labelled sections', sheet.sections.map(s => s.role), ['verse', 'chorus']);
eq('section labels are kept', sheet.sections.map(s => s.label), ['Verse 1', 'Chorus']);
eq('lyric lines are ignored, chord lines kept',
  sheet.sections[0].chords.map(c => c.spec), ['E:m7', 'G:maj', 'D:sus4', 'A:7sus4']);
eq('a repeated line collapses to its loop',
  sheet.sections[1].chords.map(c => c.spec), ['C:maj', 'D:maj', 'E:m']);

const lyricTrap = ChordParse.parseSheet('A long time ago\nAm I blue\nC G Am F');
eq('lyric lines that start with chord-like words are not chords',
  lyricTrap.sections[0].chords.map(c => c.spec), ['C:maj', 'G:maj', 'A:m', 'F:maj']);

const chordpro = ChordParse.parseSheet('{title: Test}\nI [Am]walked a[F]long the [C]shore[G]');
eq('ChordPro inline brackets are read',
  chordpro.sections[0].chords.map(c => c.spec), ['A:m', 'F:maj', 'C:maj', 'G:maj']);

const headers = ChordParse.parseSheet('Intro: Am F\nPre-Chorus\nDm G\nMiddle 8\nF G\nOutro\nAm');
eq('colon headers, pre-chorus, middle 8 and outro map to roles',
  headers.sections.map(s => s.role), ['intro', 'prechorus', 'bridge', 'outro']);
eq('a header can carry chords on its own line',
  headers.sections[0].chords.map(c => c.spec), ['A:m', 'F:maj']);

const plain = ChordParse.parseSheet('C G Am F');
check('a bare progression becomes one unlabelled section',
  plain.sections.length === 1 && plain.sections[0].role === 'verse' && plain.sections[0].chords.length === 4);
eq('sheet with no chords yields no sections', ChordParse.parseSheet('just some words\nand more words').sections, []);

// ── Loop reduction ─────────────────────────────────────────────────────────
section('Loop reduction');
const loop = text => ChordParse.reduceLoop(ChordParse.parseProgression(text).chords).map(c => c.spec);
eq('exact repetition reduces', loop('C G Am F C G Am F'), ['C:maj', 'G:maj', 'A:m', 'F:maj']);
eq('a cut-off final repeat still reduces', loop('C G Am F C G Am F C G'), ['C:maj', 'G:maj', 'A:m', 'F:maj']);
eq('a non-repeating line is left alone', loop('C G Am F Dm G C'), ['C:maj', 'G:maj', 'A:m', 'F:maj', 'D:m', 'G:maj', 'C:maj']);
eq('one chord stays one chord', loop('Am Am Am Am'), ['A:m']);

// ── Roman numerals ─────────────────────────────────────────────────────────
section('Roman numerals');
const roman = (text, key, mode) => ChordParse.parseRoman(text, key, mode).map(c => c.spec);
eq('major-key axis progression', roman('I–V–vi–IV', 'C', 'major'), ['C:maj', 'G:maj', 'A:m', 'F:maj']);
eq('minor-key flat degrees', roman('i-bVII-bVI-V', 'A', 'minor'), ['A:m', 'G:maj', 'F:maj', 'E:maj']);
eq('unicode flats and sevenths', roman('ii7 V7 Imaj7', 'C', 'major'), ['D:m7', 'G:7', 'C:maj7']);
eq('transposes to any key', roman('I-IV-V', 'E', 'major'), ['E:maj', 'A:maj', 'B:maj']);
eq('flat keys spell with flats', roman('I-IV-V', 'Bb', 'major'), ['Bb:maj', 'Eb:maj', 'F:maj']);
eq('diminished and half-diminished', roman('vii° iiø', 'C', 'major'), ['B:dim', 'D:m7b5']);
eq('secondary dominants resolve to the right root', roman('I-V7/ii-ii-V', 'C', 'major'), ['C:maj', 'A:7', 'D:m', 'G:maj']);
eq('a six-nine suffix is not mistaken for a secondary dominant', roman('I6/9', 'C', 'major'), ['C:6/9']);
eq('unflatted III, VI, VII in a minor key are the natural-minor degrees', roman('i-VI-III-VII', 'A', 'minor'), ['A:m', 'F:maj', 'C:maj', 'G:maj']);
eq('borrowed flat degrees in a major key spell with flats', roman('I-bVII-IV', 'C', 'major'), ['C:maj', 'Bb:maj', 'F:maj']);
check('detects roman-numeral text', ChordParse.isRoman('I-V-vi-IV') && ChordParse.isRoman('i bVII bVI V'));
check('does not mistake chord names for roman numerals', !ChordParse.isRoman('C G Am F') && !ChordParse.isRoman('Em7 G D'));

// ── Key detection ──────────────────────────────────────────────────────────
section('Key detection');
const keyOf = text => {
  const k = ChordParse.detectKey(ChordParse.parseProgression(text).chords);
  return k ? k.key + ' ' + k.scale : null;
};
eq('axis progression is C major', keyOf('C G Am F'), 'C major');
eq('same chords starting on the minor are A minor', keyOf('Am F C G'), 'A natural_minor');
eq('minor tonic with a major IV reads as Dorian', keyOf('Em G D A'), 'E dorian');
eq('a suspended IV is not enough to call it Dorian', keyOf('Em7 G Dsus4 A7sus4'), 'E natural_minor');
eq('minor tonic with a major V and no flat VII reads as harmonic minor', keyOf('Am Dm E Am'), 'A harmonic_minor');
eq('major tonic with a flat VII reads as Mixolydian', keyOf('D C G'), 'D mixolydian');
eq('borrowed minor iv does not move the key', keyOf('G B C Cm'), 'G major');
eq('Andalusian cadence stays in A minor', keyOf('Am G F E'), 'A natural_minor');
eq('flat keys', keyOf('F C Dm Bb'), 'F major');
eq('two chords', keyOf('C F'), 'C major');
eq('single minor chord', keyOf('Am'), 'A natural_minor');
eq('no chords, no key', keyOf(''), null);
const hinted = ChordParse.detectKey(ChordParse.parseProgression('Em7 G Dsus4 A7sus4').chords, { key: 'E', mode: 'minor' });
check('a key the user already knows is honoured', hinted.key === 'E' && hinted.mode === 'minor');
check('detectKey reports a mode family and confidence',
  (() => { const k = ChordParse.detectKey(ChordParse.parseProgression('C G Am F').chords); return k.mode === 'major' && k.confidence > 0 && k.confidence <= 1; })());

eq('degrees are relative to the tonic',
  ChordParse.degrees(ChordParse.parseProgression('Em7 G Dsus4 A7sus4').chords, 'E'),
  ['0:m7', '3:maj', '10:sus4', '5:7sus4']);
eq('degrees realise back into any key',
  ChordParse.realize(['0:m7', '3:maj', '10:sus4', '5:7sus4'], 'A').map(c => c.root + ':' + c.quality),
  ['A:m7', 'C:maj', 'G:sus4', 'D:7sus4']);
check('realised chords carry roman numerals for the given scale',
  ChordParse.realize(['0:maj', '7:maj', '9:m', '5:maj'], 'G', 'major').map(c => c.roman).join('-') === 'I-V-vi-IV');

// ── Feeling lexicon ────────────────────────────────────────────────────────
section('Feeling lexicon');
const hear = (text, learned) => Lexicon.analyze(text, learned);

check('every lexicon target is a real feeling',
  Object.values(Lexicon.WORDS).every(w => Object.keys(w).every(id => !!Feelings.getFeeling(id))));
check('every feeling has words that point straight at it',
  Feelings.FEELINGS.every(f => Object.values(Lexicon.WORDS).filter(w => w[f.id] >= 1).length >= 8));
check('the lexicon is big enough to be useful', Object.keys(Lexicon.WORDS).length >= 500);

check('plain words map to feelings',
  (() => { const a = hear('sad and lonely'); return a.top.includes('lonely') && a.top.includes('melancholic'); })());
eq('bittersweet leads with wistful', hear('bittersweet').top[0], 'wistful');
check('a longer description lands on the right family',
  ['nostalgic', 'wistful'].includes(hear('bittersweet nostalgia for summers long gone').top[0]));
eq('anger reads as defiant', hear('angry, defiant and loud').top[0], 'defiant');
check('negation removes the negated feeling',
  (() => { const a = hear('not sad at all, just joyful'); return !a.feelings.melancholic && ['euphoric', 'playful', 'hopeful'].includes(a.top[0]); })());
eq('intensifiers and diminishers shift the balance', hear('very dreamy and only a bit sad').top[0], 'dreamy');
eq('word forms resolve: loneliness', hear('loneliness').top[0], 'lonely');
eq('word forms resolve: yearns', hear('it yearns').top[0], 'yearning');
eq('word forms resolve: hauntingly', hear('hauntingly').top[0], 'haunted');
eq('phrases are understood as a unit', hear('like a slow dance').top[0], 'romantic');
eq('phrases with stop words inside still match', hear('I feel on top of the world').top[0], 'euphoric');
eq('quiet words mean low energy', hear('slow, quiet and gentle').energy, 'low');
eq('loud words mean high energy', hear('fast, loud, driving').energy, 'high');
eq('no energy words means mid', hear('bittersweet').energy, 'mid');
check('words it does not know are reported back',
  hear('petrichor on a sad day').unknown.includes('petrichor'));
check('filler words are never reported as unknown',
  (() => { const u = hear('it feels like the rain on my window').unknown; return !u.includes('the') && !u.includes('feels') && !u.includes('like'); })());
eq('vocabulary learned from the user is applied', hear('petrichor', { petrichor: { nostalgic: 1 } }).top[0], 'nostalgic');
check('a learned word stops being unknown', !hear('petrichor', { petrichor: { nostalgic: 1 } }).unknown.includes('petrichor'));
eq('empty text hears nothing', hear('').top, []);
check('the strongest feeling is normalised to 1',
  Math.max(...Object.values(hear('sad lonely empty').feelings)) === 1);
check('similar descriptions are closer than opposite ones',
  Lexicon.cosine(hear('sad and lonely').feelings, hear('melancholy, alone').feelings) >
  Lexicon.cosine(hear('sad and lonely').feelings, hear('euphoric party').feelings));
eq('similarity with nothing is zero', Lexicon.cosine({}, hear('sad').feelings), 0);
check('a description is its own closest match',
  Math.abs(Lexicon.cosine(hear('hazy and nostalgic').feelings, hear('hazy and nostalgic').feelings) - 1) < 1e-9);
eq('names the top feelings in words', Lexicon.describe({ nostalgic: 1, yearning: 0.6, cozy: 0.2 }), 'nostalgic, yearning, cozy');

// ── Built-in song library ──────────────────────────────────────────────────
section('Built-in library');
check('the starter library is a real head start', MuseData.SONGS.length >= 100);
{
  const seen = new Set();
  let allParse = true, allKeyed = true, allFeel = true, allGenre = true, unique = true;
  for (const s of MuseData.SONGS) {
    const id = (s.title + '|' + s.artist).toLowerCase();
    if (seen.has(id)) { unique = false; console.error('    duplicate: ' + id); }
    seen.add(id);
    for (const [role, text] of Object.entries(s.sections)) {
      const p = ChordParse.parseProgression(text);
      if (!Song.ROLES.includes(role) || p.unknown.length || p.chords.length < 2 || p.chords.some(c => c.approx)) {
        allParse = false; console.error(`    bad chords in "${s.title}" ${role}: ${text}`);
      }
    }
    if (!/^[A-G][#b]?m?$/.test(s.key)) { allKeyed = false; console.error('    bad key: ' + s.title); }
    if (!Lexicon.analyze(s.feel).top.length) { allFeel = false; console.error('    no feelings heard: ' + s.title); }
    if (!Genres.byId(s.genre)) { allGenre = false; console.error('    bad genre: ' + s.title); }
  }
  check('library titles are unique', unique);
  check('every library progression parses cleanly into known roles', allParse);
  check('every library song states its key', allKeyed);
  check('every library description is understood by the lexicon', allFeel);
  check('every library genre exists', allGenre);
  check('library tempos are plausible', MuseData.SONGS.every(s => s.tempo >= 40 && s.tempo <= 200));
}

// ── Muse memory ────────────────────────────────────────────────────────────
section('Muse memory');
function memoryStore() {
  let text = null;
  return { read: () => text, write: v => { text = v; return true; }, peek: () => text };
}
const store = memoryStore();
Muse.configure({ store });

eq('a new Muse has been taught nothing', Muse.all().length, 0);
check('but it starts with the built-in library', Muse.stats().library >= 100);

const ww = Muse.teach({
  title: 'Wonderwall', artist: 'Oasis',
  feelText: 'bittersweet and hopeful, like waiting for someone',
  chordsText: 'Em7 G Dsus4 A7sus4',
});
check('teach returns the stored song', ww && ww.id && ww.title === 'Wonderwall' && ww.artist === 'Oasis');
eq('teaching works out the key', [ww.key, ww.mode, ww.scale], ['E', 'minor', 'natural_minor']);
eq('chords are stored as specs', ww.sections[0].specs, ['E:m7', 'G:maj', 'D:sus4', 'A:7sus4']);
eq('and as key-relative degrees', ww.sections[0].degrees, ['0:m7', '3:maj', '10:sus4', '5:7sus4']);
check('the description becomes feelings', ww.feelings.wistful > 0 && ww.feelings.hopeful > 0);
eq('the description is kept word for word', ww.feelText, 'bittersweet and hopeful, like waiting for someone');
eq('Muse now knows one song', Muse.all().length, 1);

const sheetSong = Muse.teach({
  title: 'Sheet Song', feelText: 'sunny and playful',
  chordsText: '[Verse]\nC G Am F\nsome lyric words here\n[Chorus]\nF G C\nF G C',
});
eq('a pasted sheet keeps its sections', sheetSong.sections.map(s => s.role), ['verse', 'chorus']);
eq('sheet sections are reduced to their loops', sheetSong.sections[1].specs, ['F:maj', 'G:maj', 'C:maj']);

const romanSong = Muse.teach({ title: 'Numerals', feelText: 'dark', chordsText: 'i-bVII-bVI-V', key: 'A', mode: 'minor' });
eq('roman numerals become real chords in the given key', romanSong.sections[0].specs, ['A:m', 'G:maj', 'F:maj', 'E:maj']);

const stated = Muse.teach({ title: 'Stated', feelText: 'cold', chordsText: 'F#m7 A Esus4 B7sus4', key: 'F#', mode: 'minor', tempo: 87, genreId: 'indie', source: 'library' });
eq('a stated key, tempo, genre and source are stored', [stated.key, stated.tempo, stated.genreId, stated.source], ['F#', 87, 'indie', 'library']);
eq('chords you type yourself are marked as yours', ww.source, 'user');

const noChords = Muse.teach({ title: 'Only A Feeling', feelText: 'lonely at night' });
check('a song can be taught with a feeling and no chords yet', noChords.sections.length === 0 && noChords.feelings.lonely > 0);

const explicit = Muse.teach({ title: 'Explicit', feelText: 'sad', feelings: { dreamy: 1, bogus_feeling: 1 }, chordsText: 'C F' });
eq('feelings the user picked override what was heard, unknown ids dropped', explicit.feelings, { dreamy: 1 });

const again = Muse.teach({ title: 'wonderwall!', artist: 'OASIS', feelText: 'hazy and nostalgic', chordsText: 'Em7 G Dsus4 A7sus4' });
check('teaching the same song again updates it instead of duplicating',
  again.id === ww.id && Muse.all().filter(e => /wonderwall/i.test(e.title)).length === 1 && again.feelings.nostalgic > 0);

check('teach refuses a song with no title', (() => { try { Muse.teach({ feelText: 'x' }); return false; } catch (e) { return /title/i.test(e.message); } })());

check('everything taught is written to the store', JSON.parse(store.peek()).songs.length === Muse.all().length);
Muse.configure({ store });   // a fresh start reading the same store
check('memory survives a restart', Muse.all().length === 6 && !!Muse.find('Wonderwall', 'Oasis'));

check('find ignores case and punctuation', Muse.find('WONDERWALL') && Muse.find('wonderwall', 'oasis').id === ww.id);
check('find does not match a different artist', Muse.find('Wonderwall', 'Ryan Adams') === null);
const libHit = Muse.knows('let it be');
check('knows() falls back to the built-in library', libHit && libHit.builtin === true && libHit.entry.sections.length > 0);
check('knows() prefers what the user taught', Muse.knows('Wonderwall', 'Oasis').builtin === false);
check('knows() returns null for a stranger', Muse.knows('Zzzyx Unheard Of Song') === null);

Muse.update(noChords.id, { chordsText: 'Am F', feelText: 'lonely and empty' });
check('update adds chords later', Muse.get(noChords.id).sections[0].specs.join(' ') === 'A:m F:maj' && Muse.get(noChords.id).feelings.hollow > 0);
check('forget removes a song', Muse.forget(explicit.id) === true && Muse.get(explicit.id) === null && Muse.forget('nope') === false);

// Learned vocabulary
Muse.teach({ title: 'Rain One', feelText: 'petrichor, nostalgic', chordsText: 'C Am F G' });
Muse.teach({ title: 'Rain Two', feelText: 'petrichor and wistful nostalgia', chordsText: 'G Em C D' });
check('a word used across taught songs is learned', Muse.hear('petrichor').top[0] === 'nostalgic');
check('the learned vocabulary lists it with a count',
  (() => { const v = Muse.vocabulary().find(x => x.word === 'petrichor'); return v && v.count === 2 && v.feelings.nostalgic > 0; })());
check('words the lexicon already knows are not listed as learned',
  !Muse.vocabulary().some(x => x.word === 'nostalgic' || x.word === 'wistful'));

// Export / import
const exported = Muse.exportJSON();
const store2 = memoryStore();
Muse.configure({ store: store2 });
eq('a second Muse starts empty', Muse.all().length, 0);
const imp = Muse.importJSON(exported);
check('import brings every song across', imp.added === 7 && Muse.all().length === 7 && imp.errors.length === 0);
check('importing the same file again adds nothing', Muse.importJSON(exported).added === 0 && Muse.all().length === 7);
check('import rejects garbage', Muse.importJSON('not json').errors.length > 0 && Muse.importJSON('{"x":1}').errors.length > 0);
{
  const hostile = JSON.stringify({ format: 'chordpath-muse', version: 1, songs: [{
    title: '<img src=x onerror=alert(1)>' + 'x'.repeat(5000), artist: { evil: true },
    feelText: 'y'.repeat(100000), feelings: { dreamy: 'lots', nostalgic: 5, fake: 1 },
    key: '<b>', tempo: 'fast', genreId: { a: 1 },
    sections: [{ role: 'nonsense', specs: ['C:maj', '<script>', 'G:' + 'z'.repeat(99), 'A:m'], degrees: ['99:evil'] }, 'nope'],
  }] }).replace('"title"', '"__proto__":{"polluted":true},"title"');
  const r = Muse.importJSON(hostile);
  const h = Muse.all().find(e => e.title.startsWith('<img'));
  check('a hostile memory file is cleaned on import', r.added === 1 && !!h);
  check('imported titles are bounded', h.title.length <= 120);
  check('imported non-string fields fall back', h.artist === '' && h.genreId === '' && h.tempo === null);
  check('imported descriptions are bounded', h.feelText.length <= 2000);
  check('imported feelings keep only known ids with sane weights',
    JSON.stringify(Object.keys(h.feelings).sort()) === '["nostalgic"]' && h.feelings.nostalgic === 1);
  check('imported chord specs are pattern-checked and degrees recomputed',
    h.sections.length === 1 && h.sections[0].specs.join(',') === 'C:maj,A:m' &&
    h.sections[0].role === 'verse' && h.sections[0].degrees.every(d => /^\d+:\w+$/.test(d)) && h.sections[0].degrees.length === 2);
  check('imported keys that are not note names are re-detected', /^[A-G][#b]?$/.test(h.key));
  check('import never adopts __proto__', h.polluted === undefined && Object.getPrototypeOf(h) === Object.prototype);
  Muse.forget(h.id);
}
Muse.configure({ store });   // back to the main memory

// ── Similarity ─────────────────────────────────────────────────────────────
section('Muse similarity');
Muse.teach({ title: 'Empty Rooms', feelText: 'sad and lonely, an empty house at night', chordsText: 'Am F C G' });
Muse.teach({ title: 'Confetti', feelText: 'euphoric party, dancing all night', chordsText: 'C G Am F' });
const near = Muse.similar({ text: 'lonely night alone' }, 5);
eq('the closest taught song comes first', near[0].entry.title, 'Empty Rooms');
check('results carry a score and what was shared', near[0].score > 0 && near[0].shared.length > 0);
check('an opposite song does not come first', near.findIndex(r => r.entry.title === 'Confetti') !== 0);
eq('a seed song is always its own best match', Muse.similar({ seedId: ww.id }, 3)[0].entry.id, ww.id);
check('library songs take part and are flagged', Muse.similar({ text: 'heartbroken and grieving' }, 20).some(r => r.builtin === true));
check('taught songs outrank library songs of equal fit', Muse.similar({ text: 'sad and lonely' }, 3)[0].builtin === false);
check('a taught song hides its library twin',
  Muse.similar({ text: 'hazy and nostalgic' }, 500).filter(r => /^wonderwall$/i.test(r.entry.title)).length === 1);
eq('asking for nothing returns nothing', Muse.similar({}, 5), []);

// ── Drafting ───────────────────────────────────────────────────────────────
section('Muse drafting');
const d1 = Muse.draft({ text: 'sad and lonely', seed: 1 });
check('a draft is a short progression of real chords',
  d1.chords.length >= 2 && d1.chords.length <= 8 && d1.chords.every(c => c && c.notes.length >= 2 && Chords.QUALITIES[c.quality]));
check('a draft names its key and scale', /^[A-G][#b]?$/.test(d1.key) && !!Scales.SCALES[d1.scale]);
check('draft chords carry roman numerals', d1.chords.every(c => typeof c.roman === 'string' && c.roman.length > 0));
eq('specs and chords describe the same thing', d1.specs, d1.chords.map(c => c.root + ':' + c.quality));
eq('degrees realise back to the same specs',
  ChordParse.realize(d1.degrees, d1.key).map(c => c.root + ':' + c.quality), d1.specs);
eq('the same seed gives the same draft', Muse.draft({ text: 'sad and lonely', seed: 1 }).specs, d1.specs);
check('other seeds give other drafts',
  new Set([1, 2, 3, 4, 5, 6].map(s => Muse.draft({ text: 'sad and lonely', seed: s }).specs.join(' '))).size >= 3);
eq('a grieving description drafts in minor', Muse.draft({ text: 'grieving, heartbroken, devastated', seed: 3 }).mode, 'minor');
eq('a euphoric description drafts in major', Muse.draft({ text: 'euphoric, triumphant, joyful party', seed: 3 }).mode, 'major');
eq('length can be asked for', Muse.draft({ text: 'dreamy', seed: 2, length: 6 }).chords.length, 6);
eq('a requested key is honoured', Muse.draft({ text: 'dreamy', seed: 2, key: 'D' }).key, 'D');
check('the draft explains which songs shaped it',
  d1.influences.length > 0 && d1.influences.every(i => i.title && i.weight > 0 && typeof i.builtin === 'boolean'));
eq('taught songs lead the explanation when they fit', d1.influences[0].title, 'Empty Rooms');
eq('the draft says it came from memory', d1.basis, 'memory');
eq('with nothing similar taught it leans on the library', Muse.draft({ text: 'romantic slow dance, cozy', seed: 4 }).basis, 'library');

// Teaching changes what it writes: three songs with a private word and a
// signature move (i to bII, the Phrygian step) that nothing nearby uses.
['One', 'Two', 'Three'].forEach((n, i) => Muse.teach({
  title: 'Zyx ' + n, feelText: 'zyxfeel', feelings: { mysterious: 1 },
  chordsText: ['Em F Em F', 'Am Bb Am Dm', 'Dm Eb Dm Gm'][i],
}));
const taughtDraft = Muse.draft({ text: 'zyxfeel', seed: 5, closeness: 'close' });
check('what it was taught shows up in what it writes',
  taughtDraft.degrees.some(d => d.startsWith('1:')) && taughtDraft.mode === 'minor');
check('and it credits those songs', taughtDraft.influences.slice(0, 3).every(i => /^Zyx /.test(i.title)));
check('it names the moves it borrowed',
  taughtDraft.moves.length > 0 && taughtDraft.moves.every(m => m.from && m.to && m.title));

// Closeness: how much of the seed survives.
const seedSong = Muse.teach({ title: 'Seed Song', feelText: 'restless and urgent', chordsText: 'Dm Bb F C' });
const roots = degs => degs.map(x => x.split(':')[0]);
const sameLoop = (a, b) => a.length === b.length &&
  a.some((_, i) => a.slice(i).concat(a.slice(0, i)).join(' ') === b.join(' '));
const seedRoots = roots(seedSong.sections[0].degrees);
const sharedMoves = draft => {
  const moves = arr => new Set(arr.map((x, i) => x + '>' + arr[(i + 1) % arr.length]));
  const a = moves(seedRoots), b = moves(roots(draft.degrees));
  return [...b].filter(x => a.has(x)).length;
};
let closeShared = 0, looseShared = 0, copies = 0;
for (let s = 1; s <= 12; s++) {
  const c = Muse.draft({ seedId: seedSong.id, closeness: 'close', seed: s });
  const l = Muse.draft({ seedId: seedSong.id, closeness: 'loose', seed: s });
  closeShared += sharedMoves(c); looseShared += sharedMoves(l);
  if (sameLoop(roots(c.degrees), seedRoots) || sameLoop(roots(l.degrees), seedRoots)) copies++;
}
check('a close draft keeps more of the seed moves than a loose one', closeShared > looseShared);
eq('a draft is never a copy of the song it was seeded with', copies, 0);
eq('a seeded draft keeps the seed mode', Muse.draft({ seedId: seedSong.id, seed: 2 }).mode, seedSong.mode);
check('a loose draft moves to a different key than its seed',
  [1, 2, 3].every(s => Muse.draft({ seedId: seedSong.id, closeness: 'loose', seed: s }).key !== seedSong.key));
check('a loose draft never copies a taught or library loop',
  (() => {
    const loops = Muse.corpusLoops().map(roots);
    for (let s = 1; s <= 10; s++) {
      const d = Muse.draft({ text: 'nostalgic and warm', seed: s, closeness: 'loose' });
      if (loops.some(l => sameLoop(l, roots(d.degrees)))) return false;
    }
    return true;
  })());

// Whole-song drafts
const ds = Muse.draftSong({ text: 'bittersweet and hazy, driving home at night', seed: 9, title: 'Night Drive' });
check('draftSong returns a valid ChordPath song', Song.validate(ds).ok && ds.title === 'Night Drive');
check('the song has a verse and a chorus',
  ds.sections.some(s => s.role === 'verse') && ds.sections.some(s => s.role === 'chorus'));
check('verse and chorus are different progressions',
  ds.sections.find(s => s.role === 'verse').progSpecs.join() !== ds.sections.find(s => s.role === 'chorus').progSpecs.join());
check('every section has chords and a resolvable arrangement',
  ds.sections.every(sec => sec.progSpecs.length >= 2 &&
    Arrangements.RHYTHMS.some(r => r.id === sec.rhythmPattern) &&
    Arrangements.DRUMS.some(d => d.id === sec.drumPattern) &&
    Song.chordsOf(ds, sec).every(c => c.notes.length >= 2)));
check('the song plays back', Song.buildPlayback(ds).length === ds.sections.length);
check('tempo, scale and feeling are usable',
  ds.tempo >= 40 && ds.tempo <= 200 && !!Scales.SCALES[ds.scale] && !!Feelings.getFeeling(ds.feelingId));
check('the song notes say where it came from', /Muse/.test(ds.notes) && ds.notes.length > 20);
check('a drafted song survives save and load unchanged',
  JSON.stringify(Song.migrate(JSON.parse(Song.serialize(ds)).song).sections.map(s => s.progSpecs)) ===
  JSON.stringify(ds.sections.map(s => s.progSpecs)));
{
  const shown = Muse.draft({ text: 'dreamy and floating', seed: 21 });
  const made = Muse.draftSong({ text: 'dreamy and floating', seed: 21, verse: shown });
  eq('a song made from a draft on screen uses exactly that draft for its verse',
    made.sections.find(s => s.role === 'verse').progSpecs, shown.specs);
  eq('and stays in that draft key', [made.key, made.scale], [shown.key, shown.scale]);
}
{
  const before = Muse.all().length;
  const pv = Muse.preview({ chordsText: 'Dm Bb F C' });
  eq('preview reads chords without learning anything', [pv.sections[0].specs.length, pv.key, pv.mode, Muse.all().length], [4, 'D', 'minor', before]);
  eq('preview of unreadable text has no sections', Muse.preview({ chordsText: 'hello there' }).sections, []);
  const sheetText = ['[Verse]', 'C G', '[Chorus]', 'F G C'].join('\n');
  eq('preview formats sections back into editable text',
    Muse.chordsText(Muse.preview({ chordsText: sheetText })), sheetText);
  eq('a single section formats as one line', Muse.chordsText(pv), 'Dm Bb F C');
}
check('a seeded song draft works too', Song.validate(Muse.draftSong({ seedId: seedSong.id, seed: 3 })).ok);
check('drafting with nothing to go on still works', Muse.draft({ seed: 1 }).chords.length >= 2);

eq('stats count what was taught', Muse.stats().taught, Muse.all().length);
check('stats count learned words and moves', Muse.stats().words >= 1 && Muse.stats().moves > 0);

// ── Summary────────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
if (failed) {
  console.error('\nFailed checks:');
  failures.forEach(f => console.error('  - ' + f));
  process.exit(1);
}
