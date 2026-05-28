/* ChordPath — songs.js
 * Famous songs catalogued by their Roman-numeral fingerprint.
 * Match the user's progression (last 2–8 chords) against this library so they
 * can see: "you're playing the chords of [song]".
 * Each entry: { roman, title, artist, year, genre, key (most common), section }
 * The matcher is roman-numeral based, transposition-independent.
 */
(function (global) {
  'use strict';

  // Helper: keep things compact. roman is a hyphen-separated sequence.
  const SONGS = [
    // ── I–V–vi–IV (the "Axis") ─────────────────────────────────────────────
    { roman:'I-V-vi-IV', title:"Let It Be",                 artist:'The Beatles',           year:1970, genre:'Pop' },
    { roman:'I-V-vi-IV', title:"With Or Without You",       artist:'U2',                    year:1987, genre:'Rock' },
    { roman:'I-V-vi-IV', title:"Don't Stop Believin'",      artist:'Journey',               year:1981, genre:'Rock' },
    { roman:'I-V-vi-IV', title:"No Woman, No Cry",          artist:'Bob Marley',            year:1974, genre:'Reggae' },
    { roman:'I-V-vi-IV', title:"Someone Like You",          artist:'Adele',                 year:2011, genre:'Pop' },
    { roman:'I-V-vi-IV', title:"She Will Be Loved",         artist:'Maroon 5',              year:2002, genre:'Pop' },
    { roman:'I-V-vi-IV', title:"Take Me Home, Country Roads", artist:'John Denver',         year:1971, genre:'Country', section:'chorus' },
    { roman:'I-V-vi-IV', title:"Africa",                    artist:'Toto',                  year:1982, genre:'Pop', section:'chorus' },

    // ── vi–IV–I–V (Axis rotated) ───────────────────────────────────────────
    { roman:'vi-IV-I-V', title:"Apologize",                 artist:'OneRepublic',           year:2007, genre:'Pop' },
    { roman:'vi-IV-I-V', title:"What's Up?",                artist:'4 Non Blondes',         year:1992, genre:'Rock' },
    { roman:'vi-IV-I-V', title:"Save Tonight",              artist:'Eagle-Eye Cherry',      year:1997, genre:'Pop' },
    { roman:'vi-IV-I-V', title:"Self Esteem",               artist:'The Offspring',         year:1994, genre:'Rock' },
    { roman:'vi-IV-I-V', title:"Numb",                      artist:'Linkin Park',           year:2003, genre:'Rock' },
    { roman:'vi-IV-I-V', title:"Zombie",                    artist:'The Cranberries',       year:1994, genre:'Rock' },
    { roman:'vi-IV-I-V', title:"Grenade",                   artist:'Bruno Mars',            year:2010, genre:'Pop' },

    // ── IV–I–V–vi ──────────────────────────────────────────────────────────
    { roman:'IV-I-V-vi', title:"Umbrella",                  artist:'Rihanna',               year:2007, genre:'Pop' },
    { roman:'IV-I-V-vi', title:"Demons",                    artist:'Imagine Dragons',       year:2012, genre:'Rock' },

    // ── I–vi–IV–V (50s doo-wop) ────────────────────────────────────────────
    { roman:'I-vi-IV-V', title:"Stand By Me",               artist:'Ben E. King',           year:1961, genre:'Soul' },
    { roman:'I-vi-IV-V', title:"Earth Angel",               artist:'The Penguins',          year:1954, genre:'Doo-wop' },
    { roman:'I-vi-IV-V', title:"Heart and Soul",            artist:'Hoagy Carmichael',      year:1938, genre:'Standard' },
    { roman:'I-vi-IV-V', title:"Why Do Fools Fall in Love", artist:'Frankie Lymon',         year:1956, genre:'Doo-wop' },
    { roman:'I-vi-IV-V', title:"Blue Moon",                 artist:'Rodgers/Hart',          year:1934, genre:'Standard' },
    { roman:'I-vi-IV-V', title:"Eternal Flame",             artist:'The Bangles',           year:1989, genre:'Pop' },
    { roman:'I-vi-IV-V', title:"Crocodile Rock",            artist:'Elton John',            year:1972, genre:'Rock' },

    // ── I–IV–V ─────────────────────────────────────────────────────────────
    { roman:'I-IV-V',   title:"Wild Thing",                 artist:'The Troggs',            year:1966, genre:'Rock' },
    { roman:'I-IV-V',   title:"Louie Louie",                artist:'The Kingsmen',          year:1963, genre:'Rock' },
    { roman:'I-IV-V',   title:"La Bamba",                   artist:'Ritchie Valens',        year:1958, genre:'Latin Rock' },
    { roman:'I-IV-V',   title:"Twist and Shout",            artist:'The Beatles',           year:1963, genre:'Rock' },

    // ── ii–V–I (jazz) ──────────────────────────────────────────────────────
    { roman:'ii-V-I',   title:"Autumn Leaves",              artist:'Joseph Kosma',          year:1945, genre:'Jazz Standard' },
    { roman:'ii-V-I',   title:"All The Things You Are",     artist:'Jerome Kern',           year:1939, genre:'Jazz Standard' },
    { roman:'ii-V-I',   title:"Satin Doll",                 artist:'Duke Ellington',        year:1953, genre:'Jazz Standard' },
    { roman:'ii-V-I',   title:"Tune Up",                    artist:'Miles Davis',           year:1953, genre:'Jazz' },
    { roman:'ii-V-I',   title:"Misty",                      artist:'Erroll Garner',         year:1954, genre:'Jazz Standard' },
    { roman:'ii-V-I',   title:"Take Five",                  artist:'Dave Brubeck',          year:1959, genre:'Jazz', section:'A section' },

    // ── I–vi–ii–V (Rhythm Changes A) ───────────────────────────────────────
    { roman:'I-vi-ii-V', title:"I Got Rhythm",              artist:'Gershwin',              year:1930, genre:'Jazz Standard' },
    { roman:'I-vi-ii-V', title:"Heart and Soul",            artist:'Hoagy Carmichael',      year:1938, genre:'Standard', section:'B section' },
    { roman:'I-vi-ii-V', title:"Anthropology",              artist:'Charlie Parker',        year:1946, genre:'Bebop' },

    // ── iii-vi-ii-V (turnaround) ───────────────────────────────────────────
    { roman:'iii-vi-ii-V', title:"Fly Me to the Moon",      artist:'Bart Howard',           year:1954, genre:'Jazz Standard' },
    { roman:'iii-vi-ii-V', title:"There Will Never Be Another You", artist:'Harry Warren',  year:1942, genre:'Jazz Standard' },

    // ── i–♭VII–♭VI–V (Andalusian) ──────────────────────────────────────────
    { roman:'i-bVII-bVI-V', title:"Hit the Road Jack",      artist:'Ray Charles',           year:1961, genre:'R&B' },
    { roman:'i-bVII-bVI-V', title:"Stray Cat Strut",        artist:'Stray Cats',            year:1981, genre:'Rockabilly' },
    { roman:'i-bVII-bVI-V', title:"Hava Nagila",            artist:'trad.',                 year:1918, genre:'Klezmer' },
    { roman:'i-bVII-bVI-V', title:"Sultans of Swing (riff)",artist:'Dire Straits',          year:1978, genre:'Rock' },

    // ── I–♭VII–IV (Mixolydian rock) ────────────────────────────────────────
    { roman:'I-bVII-IV', title:"Sweet Home Alabama",        artist:'Lynyrd Skynyrd',        year:1974, genre:'Rock' },
    { roman:'I-bVII-IV', title:"Sympathy for the Devil",    artist:'Rolling Stones',        year:1968, genre:'Rock' },
    { roman:'I-bVII-IV', title:"Sweet Child o' Mine",       artist:"Guns N' Roses",         year:1987, genre:'Rock', section:'verse' },
    { roman:'I-bVII-IV', title:"Royals",                    artist:'Lorde',                 year:2013, genre:'Pop' },
    { roman:'I-bVII-IV', title:"Centerfield",               artist:'John Fogerty',          year:1985, genre:'Rock' },

    // ── i–♭VI–♭III–♭VII (synthwave / pop-punk) ─────────────────────────────
    { roman:'i-bVI-bIII-bVII', title:"Don't Stop Me Now",   artist:'Queen',                 year:1978, genre:'Rock' },
    { roman:'i-bVI-bIII-bVII', title:"Save Yourself",       artist:'Stabbing Westward',     year:1998, genre:'Rock' },
    { roman:'i-bVI-bIII-bVII', title:"Save Tonight",        artist:'Eagle-Eye Cherry',      year:1997, genre:'Pop' },

    // ── i–♭III–♭VII–IV (Dorian vamp) ───────────────────────────────────────
    { roman:'i-bIII-bVII-IV', title:"So What",              artist:'Miles Davis',           year:1959, genre:'Modal Jazz' },
    { roman:'i-bIII-bVII-IV', title:"Oye Como Va",          artist:'Santana',               year:1970, genre:'Latin Rock' },
    { roman:'i-bIII-bVII-IV', title:"Mad World",            artist:'Tears for Fears',       year:1982, genre:'New Wave' },
    { roman:'i-bIII-bVII-IV', title:"Evil Ways",            artist:'Santana',               year:1969, genre:'Latin Rock' },

    // ── i–♭VII–♭VI (descending minor) ──────────────────────────────────────
    { roman:'i-bVII-bVI', title:"Stairway to Heaven",       artist:'Led Zeppelin',          year:1971, genre:'Rock', section:'verse' },
    { roman:'i-bVII-bVI', title:"All Along the Watchtower", artist:'Dylan / Hendrix',       year:1968, genre:'Rock' },

    // ── I–iii–IV–V (descending bass / soul) ────────────────────────────────
    { roman:'I-iii-IV-V', title:"Sherry",                   artist:'The Four Seasons',      year:1962, genre:'Pop' },

    // ── I–IV–vi–V ──────────────────────────────────────────────────────────
    { roman:'I-IV-vi-V', title:"She Loves You",             artist:'The Beatles',           year:1963, genre:'Pop' },

    // ── ii–V–I–vi (extended turnaround) ────────────────────────────────────
    { roman:'ii-V-I-vi', title:"Blue Bossa",                artist:'Kenny Dorham',          year:1963, genre:'Jazz' },

    // ── I–♭III–IV (Aeolian rock) ───────────────────────────────────────────
    { roman:'I-bIII-IV', title:"Highway to Hell",           artist:'AC/DC',                 year:1979, genre:'Hard Rock' },

    // ── I–V–♭VII–IV ────────────────────────────────────────────────────────
    { roman:'I-V-bVII-IV', title:"Wonderwall",              artist:'Oasis',                 year:1995, genre:'Britpop' },

    // ── I–IV (plagal vamp) ─────────────────────────────────────────────────
    { roman:'I-IV',     title:"Hey Jude (na-na-na coda)",   artist:'The Beatles',           year:1968, genre:'Pop' },
    { roman:'I-IV',     title:"What I Got",                 artist:'Sublime',               year:1996, genre:'Reggae Rock' },

    // ── I-V-vi-iii-IV-I-IV-V (Pachelbel) ───────────────────────────────────
    { roman:'I-V-vi-iii-IV-I-IV-V', title:"Canon in D",     artist:'Pachelbel',             year:1680, genre:'Baroque' },
    { roman:'I-V-vi-iii-IV-I-IV-V', title:"Basket Case",    artist:'Green Day',             year:1994, genre:'Punk', section:'verse' },
    { roman:'I-V-vi-iii-IV-I-IV-V', title:"Graduation (Friends Forever)", artist:'Vitamin C', year:1999, genre:'Pop' },
    { roman:'I-V-vi-iii-IV-I-IV-V', title:"Cryin'",          artist:'Aerosmith',             year:1993, genre:'Rock' },

    // ── I–iii–IV–iv (line cliché, borrowed iv) ─────────────────────────────
    { roman:'I-iii-IV-iv', title:"Creep",                    artist:'Radiohead',             year:1992, genre:'Rock' },
    { roman:'I-iii-IV-iv', title:"Radioactive",              artist:'Imagine Dragons',       year:2012, genre:'Rock' },

    // ── Imaj7-VImaj7 (lofi / chill) ────────────────────────────────────────
    { roman:'Imaj7-IVmaj7', title:"Sunday Morning",          artist:'Maroon 5',              year:2004, genre:'Pop' },
    { roman:'Imaj7-IVmaj7', title:"Just the Two of Us",      artist:'Bill Withers',          year:1981, genre:'Soul' },

    // ── Imaj7-vi7-ii7-V7 (smooth jazz) ─────────────────────────────────────
    { roman:'Imaj7-vi7-ii7-V7', title:"In a Sentimental Mood", artist:'Duke Ellington',      year:1935, genre:'Jazz' },

    // ── i-iv-V (minor authentic) ───────────────────────────────────────────
    { roman:'i-iv-V',    title:"House of the Rising Sun",    artist:'The Animals',           year:1964, genre:'Folk Rock', section:'A' },
    { roman:'i-iv-V',    title:"Black Magic Woman",          artist:'Santana',               year:1970, genre:'Rock' },

    // ── i–♭VI–III–♭VII (minor Aeolian) ─────────────────────────────────────
    { roman:'i-bVI-III-bVII', title:"Africa",                artist:'Toto',                  year:1982, genre:'Pop', section:'verse' },

    // ── vi-ii-V-I (descending fifths) ──────────────────────────────────────
    { roman:'vi-ii-V-I', title:"Fly Me to the Moon",         artist:'Frank Sinatra',         year:1964, genre:'Jazz' },
    { roman:'vi-ii-V-I', title:"All of Me",                  artist:'Gerald Marks',          year:1931, genre:'Standard' },

    // ── I–♭VI–♭VII–I ───────────────────────────────────────────────────────
    { roman:'I-bVI-bVII-I', title:"Flash's Theme",            artist:'Queen',                 year:1980, genre:'Rock' },

    // ── i–♭II ──────────────────────────────────────────────────────────────
    { roman:'i-bII',     title:"Jaws Theme",                  artist:'John Williams',          year:1975, genre:'Cinematic' },
    { roman:'i-bII',     title:"Misirlou",                    artist:'Dick Dale',              year:1962, genre:'Surf' },

    // ── i-V-i (minor i-V) ──────────────────────────────────────────────────
    { roman:'i-V',       title:"Hotel California",            artist:'Eagles',                 year:1976, genre:'Rock', section:'verse start' },

    // ── i-♭VII (Aeolian vamp) ──────────────────────────────────────────────
    { roman:'i-bVII',    title:"Pumped Up Kicks",             artist:'Foster the People',      year:2010, genre:'Indie' },

    // ── I-IV-I-V (blues lead-in) ───────────────────────────────────────────
    { roman:'I-IV-I-V',  title:"Johnny B. Goode",             artist:'Chuck Berry',            year:1958, genre:'Rock & Roll' },

    // ── 12-bar blues skeleton ──────────────────────────────────────────────
    { roman:'I7-IV7-I7-V7-IV7-I7', title:"Sweet Home Chicago", artist:'Robert Johnson',       year:1936, genre:'Blues' },

    // ── Phrygian: i-bII-i ──────────────────────────────────────────────────
    { roman:'i-bII-i',   title:"War Pigs (intro)",            artist:'Black Sabbath',          year:1970, genre:'Metal' },

    // ── Dorian: i-IV ───────────────────────────────────────────────────────
    { roman:'i-IV',      title:"Eleanor Rigby",               artist:'The Beatles',            year:1966, genre:'Pop' },
    { roman:'i-IV',      title:"Get Lucky",                   artist:'Daft Punk',              year:2013, genre:'Disco' },

    // ── Cinematic chromatic mediants ───────────────────────────────────────
    { roman:'I-bIII',    title:"E.T. theme",                  artist:'John Williams',          year:1982, genre:'Cinematic' },
    { roman:'I-bVI',     title:"Star Wars main theme",        artist:'John Williams',          year:1977, genre:'Cinematic' },

    // ── Modern pop minor: i-VI-III-VII (with major III/VII in nat. minor) ──
    { roman:'i-bVI-bIII-bVII', title:"Smooth",                artist:'Santana / Rob Thomas',   year:1999, genre:'Latin Rock' },
    { roman:'i-bVI-bIII-bVII', title:"Cheap Thrills",         artist:'Sia',                    year:2016, genre:'Pop' },

    // ── Bossa nova standard: ii7-V7-Imaj7 ──────────────────────────────────
    { roman:'iim7-V7-Imaj7', title:"Girl from Ipanema",       artist:'Jobim',                  year:1962, genre:'Bossa Nova' },
    { roman:'iim7-V7-Imaj7', title:"Wave",                    artist:'Jobim',                  year:1967, genre:'Bossa Nova' },

    // ── Lofi vamp: Imaj7-iii7-vi7-V7 ───────────────────────────────────────
    { roman:'Imaj7-iii7-vi7-V7', title:"Christmas Time Is Here", artist:'Vince Guaraldi',      year:1965, genre:'Jazz' },

    // ── Soul: I-iii-IV-V ───────────────────────────────────────────────────
    { roman:'I-iii-IV-V', title:"Build Me Up Buttercup",      artist:'The Foundations',       year:1968, genre:'Soul' },

    // ── i7-IV7 (Dorian funk vamp) ──────────────────────────────────────────
    { roman:'i7-IV7',    title:"Chameleon",                   artist:'Herbie Hancock',         year:1973, genre:'Jazz Funk' },
    { roman:'i7-IV7',    title:"Cantaloupe Island",           artist:'Herbie Hancock',         year:1964, genre:'Jazz' },

    // ── i-VI-iv-V (minor pop) ──────────────────────────────────────────────
    { roman:'i-bVI-iv-V', title:"Carol of the Bells",         artist:'Leontovych',             year:1914, genre:'Classical' },

    // ── Beatles line cliché ────────────────────────────────────────────────
    { roman:'I-Imaj7-I7-IV', title:"Something",                artist:'The Beatles',            year:1969, genre:'Pop' },
    { roman:'I-Imaj7-I7-IV', title:"My Funny Valentine",       artist:'Rodgers/Hart',           year:1937, genre:'Standard', section:'A' },

    // ── Hard rock i-bVI-IV ─────────────────────────────────────────────────
    { roman:'i-bVI-IV',  title:"Smells Like Teen Spirit",     artist:'Nirvana',                year:1991, genre:'Grunge', section:'verse' },
    { roman:'i-bVI-IV',  title:"Otherside",                   artist:'Red Hot Chili Peppers',  year:1999, genre:'Rock' },

    // ── i-V-iv (minor V-i with dominant) ───────────────────────────────────
    { roman:'i-V-iv',    title:"Bad Romance",                 artist:'Lady Gaga',              year:2009, genre:'Pop' },

    // ── House of the Rising Sun extended ───────────────────────────────────
    { roman:'i-III-IV-VI', title:"House of the Rising Sun (full)", artist:'The Animals',       year:1964, genre:'Folk Rock' },

    // ── jazz: I-V/ii-ii-V (secondary V7 of ii) ─────────────────────────────
    { roman:'I-V7/ii-ii-V', title:"Lullaby of Birdland",      artist:'George Shearing',         year:1952, genre:'Jazz' },

    // ── Tritone-sub: ♭II7-I ────────────────────────────────────────────────
    { roman:'bII7-I',    title:"How High the Moon",           artist:'Morgan Lewis',           year:1940, genre:'Jazz Standard', section:'turnaround' },

    // ── R&B: I-V-vi-iii ────────────────────────────────────────────────────
    { roman:'I-V-vi-iii', title:"Streets of London",           artist:'Ralph McTell',          year:1969, genre:'Folk' },
    { roman:'I-V-vi-iii', title:"Mr. Brightside",              artist:'The Killers',           year:2004, genre:'Indie Rock', section:'verse' },

    // ── Bridge / Beatles ────────────────────────────────────────────────────
    { roman:'IV-iv-I',    title:"In My Life (turn)",           artist:'The Beatles',           year:1965, genre:'Pop' },
    { roman:'IV-iv-I',    title:"Here, There and Everywhere",  artist:'The Beatles',           year:1966, genre:'Pop' },

    // ── i-bVII-bVI-bVII (Aeolian descend then return) ──────────────────────
    { roman:'i-bVII-bVI-bVII', title:"Losing My Religion",     artist:'R.E.M.',                year:1991, genre:'Alt Rock', section:'chorus' },
  ];

  // ── Lookup index, keyed by roman pattern ──────────────────────────────────
  const SONG_INDEX = {};
  for (const s of SONGS) {
    (SONG_INDEX[s.roman] = SONG_INDEX[s.roman] || []).push(s);
  }

  // Strip extensions in the roman numeral down to its bare form for matching
  // (we keep the explicit 7-versions in the catalogue so we can match either).
  function stripExtensions(rom) {
    if (!rom) return '';
    return rom.replace(/maj7|m7b5|7b9|7s9|7s11|maj9|m9|11|13|9|7|°|ø|\+/g, '').replace(/\s+/g,'');
  }

  function romanSequence(progression, stripExt) {
    return progression.map(c => {
      let r = c.roman || '';
      if (stripExt) r = stripExtensions(r);
      return r;
    }).filter(Boolean).join('-');
  }

  // Find best matches: try the full sequence first, then try suffix windows
  // of length 8, 7, ..., 2. Two passes: (1) with extensions, (2) stripped.
  function matchSongs(progression, opts) {
    opts = opts || {};
    const max = opts.max || 5;
    if (!progression || progression.length === 0) return [];

    const tries = [];
    for (let stripExt = 0; stripExt <= 1; stripExt++) {
      const fullSeq = romanSequence(progression, !!stripExt);
      if (!fullSeq) continue;
      const tokens = fullSeq.split('-');
      // Slide a window of decreasing size across the END of the progression
      for (let win = Math.min(tokens.length, 8); win >= 2; win--) {
        const sub = tokens.slice(-win).join('-');
        if (SONG_INDEX[sub]) {
          tries.push({ pattern: sub, win, songs: SONG_INDEX[sub], stripped: !!stripExt });
        }
      }
    }

    // Prefer matches with longer windows; dedupe by song title
    tries.sort((a, b) => b.win - a.win || (a.stripped - b.stripped));

    const seen = new Set();
    const out = [];
    for (const t of tries) {
      for (const s of t.songs) {
        const key = s.title + '||' + s.artist;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ ...s, matchedPattern: t.pattern, windowLen: t.win });
        if (out.length >= max) return out;
      }
    }
    return out;
  }

  // Total catalogue size, for debug / pride
  function size() { return SONGS.length; }

  global.Songs = { SONGS, matchSongs, romanSequence, stripExtensions, size };
})(typeof window !== 'undefined' ? window : globalThis);
