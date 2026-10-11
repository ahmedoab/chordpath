/* ChordPath — tests for Muse's online lookup (no network needed).
 * Run with: node tests/research-test.js
 * Covers what the shell may ask Wikipedia and what it lets back in
 * (desktop/lookup.js), and how Muse reads an article (theory/research.js).
 * The articles below are made up for the purpose.
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
  'theory/genres.js', 'theory/emotions.js', 'theory/feelings.js', 'theory/chordparse.js', 'theory/lexicon.js',
  'theory/research.js',
].forEach(f => require(path.join(ROOT, f)));
const Lookup = require(path.join(ROOT, 'desktop/lookup.js'));
const { Research } = globalThis;

// ── What may be asked, and what is let back in ─────────────────────────────
section('The way out: desktop/lookup.js');
{
  const search = new URL(Lookup.buildUrl('search', 'Lantern Road The Hollow Pines song'));
  eq('a search goes to Wikipedia and nowhere else', [search.protocol, search.host, search.pathname], ['https:', 'en.wikipedia.org', '/w/api.php']);
  eq('asking for a handful of matches', [search.searchParams.get('list'), search.searchParams.get('srsearch'), search.searchParams.get('srlimit')],
    ['search', 'Lantern Road The Hollow Pines song', '6']);
  const page = new URL(Lookup.buildUrl('page', 'Lantern Road (song)'));
  eq('an article is asked for as plain text', [page.host, page.searchParams.get('titles'), page.searchParams.get('explaintext'), page.searchParams.get('prop')],
    ['en.wikipedia.org', 'Lantern Road (song)', '1', 'extracts|info']);
  eq('words cannot bend the address towards another site',
    new URL(Lookup.buildUrl('page', 'x&titles=y#@evil.example/')).host, 'en.wikipedia.org');
  check('and stay inside one parameter', new URL(Lookup.buildUrl('search', 'a&list=allusers&b=c')).searchParams.get('srsearch') === 'a&list=allusers&b=c');
  eq('no other kind of question exists', [Lookup.buildUrl('fetch', 'x'), Lookup.buildUrl('page', ''), Lookup.buildUrl('search', 'x'.repeat(201)), Lookup.buildUrl('search', 42)],
    [null, null, null, null]);
  eq('line breaks and control characters are taken out of the words', Lookup.clean('  Lantern\r\n\tRoad\u0000 '), 'Lantern Road');

  eq('only https on that one host is allowed out',
    ['https://en.wikipedia.org/w/api.php?x=1', 'http://en.wikipedia.org/w/api.php', 'https://en.wikipedia.org.evil.example/', 'https://evil.example/en.wikipedia.org',
      'https://user:pw@en.wikipedia.org/', 'file:///c:/secrets', 'not a url'].map(Lookup.allowed),
    [true, false, false, false, false, false, false]);

  const hits = Lookup.parse('search', { query: { search: [
    { title: 'Lantern Road (song)', snippet: '<span class="searchmatch">Lantern</span> Road is a song by &quot;The Hollow Pines&quot; &amp; friends' },
    { title: 12 }, null, { title: 'Second', snippet: '<img src=x onerror=alert(1)>plain' },
  ] } });
  eq('search results come back as plain text', hits, [
    { title: 'Lantern Road (song)', snippet: 'Lantern Road is a song by "The Hollow Pines" & friends' },
    { title: 'Second', snippet: 'plain' },
  ]);
  const article = Lookup.parse('page', { query: { pages: [{ title: 'Lantern Road (song)', fullurl: 'https://en.wikipedia.org/wiki/Lantern_Road_(song)', extract: 'A song.\n\n== Composition ==\nIn E minor.' }] } });
  eq('an article comes back with its title, address and text', article,
    { title: 'Lantern Road (song)', url: 'https://en.wikipedia.org/wiki/Lantern_Road_(song)', text: 'A song.\n\n== Composition ==\nIn E minor.' });
  eq('an address that points elsewhere is replaced with the article\'s own',
    Lookup.parse('page', { query: { pages: [{ title: 'A B', fullurl: 'https://evil.example/x', extract: 'text' }] } }).url, 'https://en.wikipedia.org/wiki/A_B');
  eq('no such article, nothing back', [Lookup.parse('page', { query: { pages: [{ title: 'X', missing: true }] } }), Lookup.parse('page', {}), Lookup.parse('page', null),
    Lookup.parse('search', 'nonsense'), Lookup.parse('other', {})], [null, null, null, [], null]);
  check('a very long article is cut short', Lookup.parse('page', { query: { pages: [{ title: 'Long', extract: 'x'.repeat(900000) }] } }).text.length === Lookup.LIMITS.text);
}

// ── Choosing the article ───────────────────────────────────────────────────
section('Choosing the article');
{
  const hits = [
    { title: 'Lantern Road (album)', snippet: 'Lantern Road is the third studio album by The Hollow Pines' },
    { title: 'Lantern Road (The Hollow Pines song)', snippet: '"Lantern Road" is a song by the English rock band The Hollow Pines' },
    { title: 'Lantern', snippet: 'A lantern is a portable source of lighting' },
  ];
  eq('the song is preferred to the album and to the word', Research.pickArticle(hits, 'Lantern Road', 'The Hollow Pines').title, 'Lantern Road (The Hollow Pines song)');
  eq('an article named just as the song is, about a single, will do',
    Research.pickArticle([{ title: 'Paper Kites', snippet: '"Paper Kites" is a 2011 single by American singer-songwriter Jo Vance' }], 'paper kites', '').title, 'Paper Kites');
  eq('the artist settles it between two songs of the same name', Research.pickArticle([
    { title: 'Hold On (Ash Row song)', snippet: '"Hold On" is a song by Ash Row' },
    { title: 'Hold On (Mira Dune song)', snippet: '"Hold On" is a song by Mira Dune' },
  ], 'Hold On', 'Mira Dune').title, 'Hold On (Mira Dune song)');
  eq('nothing to do with the song, nothing chosen', Research.pickArticle([{ title: 'Lantern', snippet: 'A lantern is a portable light' },
    { title: 'Road', snippet: 'A road is a thoroughfare' }], 'Lantern Road', ''), null);
  eq('a list of other meanings is not an article about the song',
    Research.pickArticle([{ title: 'Lantern Road (disambiguation)', snippet: 'Lantern Road may refer to a song or an album' }], 'Lantern Road', ''), null);
  eq('no results, nothing chosen', [Research.pickArticle([], 'x', ''), Research.pickArticle(null, 'x', '')], [null, null]);
  eq('the question put to the search', [Research.queryFor('Lantern Road', 'The Hollow Pines'), Research.queryFor('  Lantern   Road ', '')],
    ['Lantern Road The Hollow Pines song', 'Lantern Road song']);
}

// ── Reading an article ─────────────────────────────────────────────────────
section('Reading an article');
const LANTERN = `"Lantern Road" is a song by the English rock band The Hollow Pines, released in 1994 as the second single from their album Slow Weather. Written by singer Mara Quill, it is an alternative rock ballad with elements of dream pop.

== Composition ==
"Lantern Road" is written in the key of E minor and moves at a tempo of 76 beats per minute. The verses follow a chord progression of Em–C–G–D, while the chorus shifts to C–G–D–Em. Critics have described the song as melancholic and haunting, with a bittersweet, yearning chorus.

== Reception ==
The song was praised for its atmospheric production. One reviewer called it "a slow, aching anthem". The band signed to a major label the following year.

== Track listing ==
7-inch single: A. "Lantern Road" – 4:12, B. "Harbour" – 3:40`;
{
  const f = Research.read(LANTERN, { title: 'Lantern Road', artist: '' });
  check('it is recognised as an article about a song', f.about === true);
  eq('who it is by and when', [f.artist, f.year], ['The Hollow Pines', 1994]);
  eq('the styles it names', f.genres, ['alternative rock', 'dream pop']);
  eq('and the one of ChordPath\'s own genres that comes closest', f.genreId, 'indie');
  eq('the key and the tempo', [f.key, f.tempo], [{ key: 'E', mode: 'minor' }, 76]);
  eq('the chords it spells out, in the order it gives them', f.progressions, ['Em C G D', 'C G D Em']);
  check('the words it uses for how the song feels', ['melancholic', 'haunting', 'bittersweet', 'yearning'].every(w => f.feelWords.includes(w)));
  check('and nothing from the track listing or the business side', !f.feelWords.includes('major') && f.progressions.length === 2);
  check('a short summary in its own first words', f.summary.startsWith('"Lantern Road" is a song by the English rock band The Hollow Pines') && f.summary.length <= 320);
  check('the feelings come out the way Muse hears those words', f.feelText.includes('melancholic') && f.feelText.length < 200);

  const paper = Research.read(`"Paper Kites" is a 2011 single by American singer-songwriter Jo Vance. It is an indie folk song.

== Music ==
The song is composed in A major with a tempo of 120 BPM and follows the I–V–vi–IV progression throughout, which has been called uplifting and warm.`, { title: 'Paper Kites', artist: 'Jo Vance' });
  eq('a single counts as a song, and numerals count as chords', [paper.about, paper.year, paper.artist, paper.key, paper.tempo, paper.progressions],
    [true, 2011, 'Jo Vance', { key: 'A', mode: 'major' }, 120, ['I-V-vi-IV']]);
  eq('indie folk is a style it knows', [paper.genres, paper.genreId], [['indie folk'], 'alt_folk']);
  eq('no style named, no genre guessed', Research.read('"Plain" is a song by Someone.', { title: 'Plain' }).genreId, null);

  const words = Research.read(`"Grey Harbour" is a song by Irish band Tidewrack. Its verse alternates between the chords A minor, F major, C major and G major, and the bridge moves to B♭ major. It is in the key of C.`, { title: 'Grey Harbour' });
  eq('chords written out in words are read too', words.progressions, ['Am F C G']);
  eq('a key given without major or minor is kept as far as it goes', words.key, { key: 'C', mode: null });

  const flats = Research.read(`"Low Tide" is a song by Tidewrack in the key of B-flat minor, built on B♭m–G♭–D♭–A♭ and later i–♭VII–♭VI–V.`, { title: 'Low Tide' });
  eq('flats and sharps in any spelling', [flats.key, flats.progressions], [{ key: 'Bb', mode: 'minor' }, ['Bbm Gb Db Ab', 'i-bVII-bVI-V']]);

  const traps = Research.read(`"Big Deal" is a song by the band Northgate. The band signed to a major label in 1990 and it played a minor role in their career. It reached number 120 on the chart and sold 90 copies per minute. A–B testing and the A–Z of touring followed. The single ran to 4–5–6 minutes in versions I–II.`, { title: 'Big Deal' });
  eq('ordinary uses of "major", "minor" and numbers are not mistaken for music', [traps.key, traps.tempo, traps.progressions], [null, null, []]);

  // Things the real encyclopedia does that a careless reader trips over.
  const country = Research.read(`"Far Country" is a song by English rock band the Marrows. It topped the charts in every country and paid for the singer's first house. It is a pop song with country influences, and the band toured the country and western states.`, { title: 'Far Country' });
  eq('a style is only a style where it is used as one', country.genres, ['rock', 'pop', 'country']);
  eq('"the" in front of a band\'s name is put right', country.artist, 'The Marrows');
  const mood = Research.read(`"Cold Light" is a song by Vale.

== Reception ==
Critics called it a huge success and a morning anthem for a sea of fans who remember the night; its sound is mournful and dark, with a triumphant final chorus. One review heard anger and longing in the lyric.`, { title: 'Cold Light' });
  eq('only words of mood are taken as describing the feel', mood.feelWords, ['mournful', 'dark', 'triumphant', 'anger', 'longing']);

  const film = Research.read('Lantern Road is a 1987 British drama film directed by Ann Verity. It stars two actors.', { title: 'Lantern Road' });
  check('an article about something else is flagged as such', film.about === false);
  eq('reading nothing gives nothing', [Research.read('', {}).about, Research.read(null, {}).progressions, Research.read('   ', {}).summary], [false, [], '']);
  const huge = Research.read('"Long" is a song by Someone. ' + 'It is very long indeed. '.repeat(40000) + 'It is in the key of F minor.', { title: 'Long' });
  check('a very long article is read without trouble, as far as it is read', huge.about === true && huge.summary.length <= 320);
  const hostile = Research.read('"Bad" is a song by <script>alert(1)</script> in the key of G major. Chords: G–C–D.', { title: 'Bad' });
  check('whatever it finds is handed over as plain strings', typeof hostile.artist === 'string' && hostile.progressions.every(p => /^[A-Ga-g#b0-9 /susmdimaugj-]+$/.test(p)));
}

// ── The whole lookup ───────────────────────────────────────────────────────
section('Looking a song up');
(async () => {
  const asked = [];
  const wikipedia = async (kind, text) => {
    asked.push(kind + ': ' + text);
    if (kind === 'search') return [{ title: 'Lantern Road (The Hollow Pines song)', snippet: '"Lantern Road" is a song by the English rock band The Hollow Pines' }];
    return { title: 'Lantern Road (The Hollow Pines song)', url: 'https://en.wikipedia.org/wiki/Lantern_Road_(The_Hollow_Pines_song)', text: LANTERN };
  };
  const found = await Research.find('Lantern Road', 'The Hollow Pines', wikipedia);
  eq('it searches, then reads the article it chose', asked, ['search: Lantern Road The Hollow Pines song', 'page: Lantern Road (The Hollow Pines song)']);
  eq('and reports what it found, with where it found it', [found.status, found.article, found.facts.key, found.facts.progressions[0]],
    ['found', { title: 'Lantern Road (The Hollow Pines song)', url: 'https://en.wikipedia.org/wiki/Lantern_Road_(The_Hollow_Pines_song)' }, { key: 'E', mode: 'minor' }, 'Em C G D']);

  eq('no article: it says so', (await Research.find('Nothing Here', '', async kind => (kind === 'search' ? [] : null))).status, 'none');
  eq('an article that is not there after all: the same', (await Research.find('Lantern Road', '', async kind => (kind === 'search'
    ? [{ title: 'Lantern Road (song)', snippet: 'a song' }] : null))).status, 'none');
  eq('an article about something else is not passed off as the song',
    (await Research.find('Lantern Road', '', async kind => (kind === 'search' ? [{ title: 'Lantern Road', snippet: 'a song by someone' }]
      : { title: 'Lantern Road', url: 'https://en.wikipedia.org/wiki/Lantern_Road', text: 'Lantern Road is a 1987 British drama film.' }))).status, 'none');
  eq('no connection: it says that instead', (await Research.find('Lantern Road', '', async () => { throw new Error('offline'); })).status, 'offline');
  eq('a link that is not to Wikipedia is not passed on', (await Research.find('Lantern Road', '', async kind => (kind === 'search'
    ? [{ title: 'Lantern Road (song)', snippet: 'a song' }] : { title: 'Lantern Road (song)', url: 'javascript:alert(1)', text: LANTERN }))).article.url, '');

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) {
    console.error('\nFailed checks:');
    failures.forEach(f => console.error('  - ' + f));
    process.exit(1);
  }
})();
