/* ChordPath — theory/research.js
 * What Muse does with an encyclopedia article about a song: picks the right
 * article out of a search, and reads from its text who the song is by, when,
 * in what style, in what key and tempo, any chords it spells out, and the
 * words it uses for how the song feels.
 *
 * Nothing here goes online. find() is handed a function that does the
 * asking (the desktop shell supplies one that reaches Wikipedia and nothing
 * else), so all of this can be tested, and runs, without a network. What
 * comes back from outside is treated as untrusted text: only plain strings
 * and numbers leave this file, and chords only once ChordParse accepts them.
 */
(function (global) {
  'use strict';

  const WIKI = 'https://en.wikipedia.org/wiki/';
  const READ = 120000;              // characters of an article that are read
  const SUMMARY = 320;

  // Styles an article's opening may name, longest first so that "alternative
  // rock" is found before "rock".
  const STYLES = [
    'alternative rock', 'psychedelic rock', 'progressive rock', 'psychedelic pop', 'singer-songwriter', 'gothic rock', 'country rock',
    'garage rock', 'baroque pop', 'electropop', 'indie rock', 'indie folk', 'folk rock', 'blues rock', 'heavy metal', 'bossa nova',
    'synth-pop', 'post-punk', 'power pop', 'jangle pop', 'dream pop', 'indie pop', 'punk rock', 'hard rock', 'soft rock', 'glam rock',
    'art rock', 'pop rock', 'pop punk', 'new wave', 'trip hop', 'synthpop', 'shoegaze', 'slowcore', 'britpop', 'hip hop', 'grunge',
    'gospel', 'reggae', 'techno', 'ambient', 'country', 'disco', 'house', 'blues', 'R&B', 'soul', 'funk', 'folk', 'jazz', 'punk',
    'emo', 'ska', 'pop', 'rock',
  ];
  // The genre of ChordPath's own that each style comes closest to.
  const NEAREST = {
    'shoegaze': 'shoegaze', 'post-punk': 'goth_postpunk', 'gothic rock': 'goth_postpunk', 'new wave': 'goth_postpunk',
    'jangle pop': 'jangle_indie', 'indie pop': 'jangle_indie', 'dream pop': 'dream_pop', 'slowcore': 'slowcore', 'indie folk': 'alt_folk',
    'alternative rock': 'indie', 'indie rock': 'indie', 'britpop': 'indie', 'art rock': 'indie', 'emo': 'indie',
    'pop': 'pop', 'pop rock': 'pop', 'power pop': 'pop', 'soft rock': 'pop', 'baroque pop': 'baroque', 'psychedelic pop': 'pop',
    'synth-pop': 'synthwave', 'synthpop': 'synthwave', 'electropop': 'synthwave',
    'rock': 'classic_rock', 'psychedelic rock': 'classic_rock', 'progressive rock': 'classic_rock', 'glam rock': 'classic_rock', 'garage rock': 'classic_rock',
    'hard rock': 'hardrock', 'grunge': 'hardrock', 'punk rock': 'hardrock', 'pop punk': 'hardrock', 'punk': 'hardrock', 'heavy metal': 'metal',
    'folk': 'folk', 'folk rock': 'folk', 'singer-songwriter': 'folk', 'country': 'country', 'country rock': 'country',
    'blues': 'blues', 'blues rock': 'blues', 'jazz': 'jazz', 'bossa nova': 'bossa', 'funk': 'funk', 'disco': 'funk', 'soul': 'soul', 'R&B': 'soul',
    'gospel': 'gospel', 'reggae': 'reggae', 'ska': 'reggae', 'hip hop': 'lofi', 'trip hop': 'lofi', 'house': 'house', 'techno': 'house',
    'ambient': 'cinematic',
  };
  // A style such as "country" or "house" is also an ordinary word, so it only
  // counts where what follows shows it is meant as a style.
  const EVERYDAY = ['country', 'house', 'soul', 'pop', 'rock', 'folk', 'ambient', 'blues', 'punk', 'funk'];
  const STYLE_FOLLOWS = '(?:-|\\s)(?:song|songs|ballad|track|single|number|anthem|tune|music|band|group|duo|trio|singer|musician|artist|act|record|sound|style|influences?|influenced|elements|tinged|feel|rhythm|beat|guitar|revival|scene|standard)\\b';
  // Words an article uses for the mood of a song. Everyday words that Muse's
  // lexicon also knows as imagery ("sea", "night", "morning") are left out:
  // in an encyclopedia they are usually not about the feel at all.
  const MOOD_WORDS = new Set(('melancholic melancholy melancholia haunting haunted uplifting anthemic bittersweet yearning mournful dark joyous joyful ' +
    'angry anger rage sad sadness wistful nostalgic nostalgia dreamy euphoric euphoria sombre somber brooding tender aggressive hopeful hope bleak ' +
    'romantic eerie triumphant plaintive gloomy upbeat cheerful moody atmospheric ethereal intense raw gentle soothing energetic driving ' +
    'sorrowful sorrow depressing depressed hypnotic ominous menacing playful sensual tense lonely loneliness desperate despair defiant serene ' +
    'peaceful longing grief angst alienation heartbreak heartbroken dread doomy weary apathetic restless tense warm cold bright ' +
    'frantic furious ecstatic blissful mellow soulful passionate bitter sweet delicate fragile aching soaring anguished anguish jubilant ' +
    'reflective introspective contemplative carefree exuberant sinister creepy unsettling claustrophobic lush hazy woozy stark').split(' '));
  const SONG_WORD = /\b(song|single|ballad|composition|instrumental|hymn|carol|anthem|tune|aria|lullaby|piece of music)\b/i;
  const OTHER_THING = /\b(film|movie|novel|album|television|tv series|video game|play|musical|company|band is|book)\b/i;
  const ROLE = /^(band|group|duo|trio|quartet|singer|singer-songwriter|songwriter|musician|rapper|artist|producer|composer|guitarist|pianist|dj|vocalist|ensemble|orchestra|collective)$/i;
  // A sentence has to be about the music before anything in it is read as chords.
  const MUSIC_CUE = /chord|progression|\bkey\b|verse|chorus|bridge|riff|\bbass|guitar|piano|harmon|cadence/i;
  // ...and about how it sounds before its words are taken as describing the feel.
  const FEEL_CUE = /describ|sound|mood|tone|feel|atmospher|ballad|lyric|critic|review|called|praised|characteri[sz]|evok|express|emotion|theme|haunting|uplifting/i;
  const FEEL_SECTIONS = /composition|music|style|lyric|reception|critical|legacy|content|theme|sound|writing|recording/i;

  const ACC = '(?:♯|♭|#|b(?![a-z]))';
  const CHORD = '[A-G]' + ACC + '?(?:maj7|maj9|m7b5|m7|m9|m6|m(?![a-z])|M7|7sus4|sus2|sus4|dim7|dim|aug|add9|6|7|9|11|13|5)?(?:\\/[A-G]' + ACC + '?)?';
  const DASH = '\\s*[–—−→-]\\s*';
  const LETTERS = new RegExp('(?<![A-Za-z0-9♯♭#])' + CHORD + '(?:' + DASH + CHORD + '){2,}(?![A-Za-z0-9♯♭#])', 'g');
  const NUMERAL = '(?:♭|b|♯|#)?(?:VII|VI|IV|V|III|II|I|vii|vi|iv|v|iii|ii|i)(?:°|º|dim|\\+|maj7|7)?';
  const NUMERALS = new RegExp('(?<![A-Za-z0-9♭♯#])' + NUMERAL + '(?:' + DASH + NUMERAL + '){2,}(?![A-Za-z0-9])', 'g');
  const SPELT = '[A-G](?:♯|♭|[-\\s]sharp|[-\\s]flat)?[\\s-](?:major|minor)';
  const SPELT_LIST = new RegExp('(?<![A-Za-z])' + SPELT + '(?:(?:\\s*,\\s*(?:and\\s+)?|\\s+and\\s+|' + DASH + ')' + SPELT + '){2,}', 'g');
  const NOTE = '([A-G])(?:[-\\s]?(sharp|flat)\\b|(♯|#|♭)|(b)(?![a-z]))?';
  const KEYS = [
    new RegExp('\\b[Kk]ey of ' + NOTE + '(?:[\\s-](major|minor)\\b)?'),
    new RegExp('\\b(?:written|composed|performed|played|set|recorded|is|was) in ' + NOTE + '[\\s-](major|minor)\\b'),
  ];

  function tidy(text) {
    return String(text == null ? '' : text).slice(0, READ).replace(/<[^>]*>/g, ' ').replace(/\r/g, '');
  }
  function sentencesOf(text) {
    return text.replace(/\s+/g, ' ').trim().split(/(?<=[.!?]["”']?)\s+(?=["“']?[A-Z0-9])/).filter(Boolean);
  }
  function plainNote(letter, word, sign, flat) {
    const accidental = word ? (word.toLowerCase() === 'sharp' ? '#' : 'b') : sign ? (sign === '♭' ? 'b' : '#') : flat ? 'b' : '';
    return letter + accidental;
  }

  // The article's sections: [{ heading, text }], the opening under ''.
  function sectionsOf(text) {
    const out = [{ heading: '', text: '' }];
    text.split('\n').forEach(line => {
      const heading = /^\s*=+\s*(.*?)\s*=+\s*$/.exec(line);
      if (heading) out.push({ heading: heading[1], text: '' });
      else out[out.length - 1].text += line + '\n';
    });
    return out;
  }

  function findArtist(first) {
    const by = /\bby\s+(.*)$/.exec(first);
    if (!by) return '';
    let words = by[1].split(/\s+/);
    if (/^the$/i.test(words[0])) words = words.slice(1);
    // "the English rock band Radiohead": the name comes after what kind of act it is.
    const role = words.slice(0, 8).findIndex(w => ROLE.test(w.replace(/[^A-Za-z-]/g, '')));
    if (role >= 0) words = words.slice(role + 1);
    // "the Cure" is written with a small "the" in running text.
    const article = words[0] === 'the' && /^[A-Z0-9]/.test(words[1] || '');
    if (article) words = words.slice(1);
    const name = article ? ['The'] : [];
    for (const word of words) {
      const bare = word.replace(/[,.;:()"“”]+$/, '');
      const joins = /^(and|of|the|&|de|la|van|von)$/i.test(bare) && name.length > 0;
      if (!/^[A-Z0-9]/.test(bare) && !joins) break;
      name.push(bare);
      if (bare !== word || name.length >= 7) break;        // punctuation ends the name
    }
    while (name.length && /^(and|of|the|&|de|la|van|von)$/i.test(name[name.length - 1])) name.pop();
    return name.join(' ').slice(0, 120);
  }

  function findStyles(opening) {
    const found = [];
    STYLES.forEach(style => {
      const sure = !EVERYDAY.includes(style);              // "dream pop" or "grunge" can only be the style
      const at = opening.search(new RegExp('(?<![A-Za-z-])' + style.replace(/[-&]/g, '\\$&') + (sure ? '(?![A-Za-z])' : STYLE_FOLLOWS), 'i'));
      if (at >= 0) found.push({ style, at });
    });
    // "rock" adds nothing once "alternative rock" has been found.
    return found
      .filter(f => !found.some(g => g !== f && g.style.toLowerCase().endsWith(' ' + f.style.toLowerCase())) && f.style !== 'singer-songwriter')
      .sort((a, b) => a.at - b.at).map(f => f.style).slice(0, 4);
  }

  function findKey(text) {
    for (const pattern of KEYS) {
      const m = pattern.exec(text);
      if (m) return { key: plainNote(m[1], m[2], m[3], m[4]), mode: m[5] ? m[5].toLowerCase() : null };
    }
    return null;
  }

  function findTempo(text) {
    const m = /\b(\d{2,3})\s*(?:beats per minute|BPM|bpm)\b/.exec(text);
    const bpm = m ? parseInt(m[1], 10) : 0;
    return bpm >= 40 && bpm <= 240 ? bpm : null;
  }

  // Chord sequences the article spells out, as text ChordPath can read:
  // "Em C G D" for chords, "I-V-vi-IV" for numerals.
  function findProgressions(text) {
    const C = global.ChordParse;
    const found = [];
    const plain = s => s.replace(/♯/g, '#').replace(/♭/g, 'b');
    sentencesOf(text).forEach(sentence => {
      if (!MUSIC_CUE.test(sentence)) return;
      const here = [];
      (sentence.match(LETTERS) || []).forEach(run => {
        const chords = plain(run).split(/\s*[–—−→-]\s*/);
        if (chords.every(ch => C.parseSymbol(ch))) here.push({ at: sentence.indexOf(run), text: chords.join(' ') });
      });
      (sentence.match(NUMERALS) || []).forEach(run => {
        const numerals = plain(run).replace(/º/g, '°').split(/\s*[–—−→-]\s*/).join('-');
        if (C.isRoman(numerals)) here.push({ at: sentence.indexOf(run), text: numerals });
      });
      (sentence.match(SPELT_LIST) || []).forEach(run => {
        const chords = (run.match(new RegExp(SPELT, 'g')) || []).map(one => {
          const m = /^([A-G])(?:(♯|♭)|[-\s](sharp|flat))?[\s-](major|minor)$/.exec(one);
          return m ? plainNote(m[1], m[3], m[2], null) + (m[4] === 'minor' ? 'm' : '') : '';
        });
        if (chords.length >= 3 && chords.every(ch => ch && C.parseSymbol(ch))) here.push({ at: sentence.indexOf(run), text: chords.join(' ') });
      });
      here.sort((a, b) => a.at - b.at).forEach(p => { if (!found.includes(p.text)) found.push(p.text); });
    });
    return found.slice(0, 6);
  }

  // The words the article uses about how the song feels: mood words, in the
  // order they come, from the sentences that are about the music. Words that
  // are only there because they are in the song's title do not count.
  function findFeel(sections, title) {
    const inTitle = new Set(norm(title).split(' '));
    const words = [];
    sections.forEach(sec => {
      if (sec.heading && !FEEL_SECTIONS.test(sec.heading)) return;
      sentencesOf(sec.text).forEach((sentence, i) => {
        if (!FEEL_CUE.test(sentence) && !(!sec.heading && i < 2)) return;
        (sentence.toLowerCase().match(/[a-z]+/g) || []).forEach(word => {
          if (MOOD_WORDS.has(word) && !inTitle.has(word) && !words.includes(word)) words.push(word);
        });
      });
    });
    return words.slice(0, 8);
  }

  // Reads an article. wanted: { title, artist } as the user gave them.
  function read(text, wanted) {
    wanted = wanted || {};
    const whole = tidy(text);
    const sections = sectionsOf(whole);
    const opening = sections[0].text.replace(/\s+/g, ' ').trim();
    const sentences = sentencesOf(opening);
    const first = sentences[0] || '';
    const songAt = first.search(SONG_WORD), otherAt = first.search(OTHER_THING);
    const body = sections.map(s => s.text).join('\n');

    let summary = first;
    if (summary.length < 120 && sentences[1]) summary += ' ' + sentences[1];
    if (summary.length > SUMMARY) summary = summary.slice(0, SUMMARY - 1).replace(/\s+\S*$/, '') + '…';
    const year = /\b(1[5-9]\d\d|20[0-4]\d)\b/.exec(opening.slice(0, 600));
    const feelWords = findFeel(sections, wanted.title);
    const genres = findStyles(opening.slice(0, 1500));
    const nearest = genres.map(g => NEAREST[g]).find(id => id && (!global.Genres || global.Genres.byId(id)));
    return {
      about: songAt >= 0 && (otherAt < 0 || songAt < otherAt),
      summary,
      artist: findArtist(first) || String(wanted.artist || '').slice(0, 120),
      year: year ? parseInt(year[1], 10) : null,
      genres,
      genreId: nearest || null,
      key: findKey(body),
      tempo: findTempo(body),
      progressions: findProgressions(body),
      feelWords,
      feelText: feelWords.join(', '),
    };
  }

  // ── Finding the article ──────────────────────────────────────────────────
  function norm(s) { return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }

  function queryFor(title, artist) {
    return [title, artist, 'song'].map(s => String(s || '').trim()).filter(Boolean).join(' ').replace(/\s+/g, ' ');
  }

  // The search result that is the article about this song, or null. The
  // title has to match; "(song)" in the name, the artist, and a mention of a
  // song or single in the snippet count for it, an album or a film against.
  function pickArticle(hits, title, artist) {
    const want = norm(title), who = norm(artist);
    let best = null, bestScore = 0;
    (Array.isArray(hits) ? hits : []).forEach(hit => {
      if (!hit || typeof hit.title !== 'string') return;
      const label = (/\(([^)]*)\)\s*$/.exec(hit.title) || ['', ''])[1].toLowerCase();
      if (norm(hit.title.replace(/\s*\([^)]*\)\s*$/, '')) !== want) return;
      const snippet = norm(hit.snippet);
      let score = 5;
      if (/\b(song|single|composition)\b/.test(label)) score += 4;
      if (/\b(album|film|band|novel|disambiguation|ep|tv series|video game|musical|soundtrack|book)\b/.test(label)) score -= 6;
      if (/\b(song|single)\b/.test(snippet)) score += 3;
      if (/\bmay refer to\b/.test(snippet)) score -= 6;
      if (who && (norm(hit.title).includes(who) || snippet.includes(who))) score += 3;
      if (score > bestScore) { bestScore = score; best = hit; }
    });
    return bestScore >= 6 ? best : null;
  }

  // Looks a song up. ask(kind, words) does the asking and resolves to
  // [{ title, snippet }] for 'search' and { title, url, text } or null for
  // 'page'. Resolves to { status, article, facts }: status is 'found',
  // 'none' (no article about this song) or 'offline' (could not ask).
  async function find(title, artist, ask) {
    const nothing = status => ({ status, article: null, facts: null });
    let page;
    try {
      const pick = pickArticle(await ask('search', queryFor(title, artist)), title, artist);
      if (!pick) return nothing('none');
      page = await ask('page', pick.title);
    } catch (e) {
      return nothing('offline');
    }
    if (!page || typeof page.text !== 'string') return nothing('none');
    const facts = read(page.text, { title, artist });
    if (!facts.about) return nothing('none');
    return {
      status: 'found',
      article: { title: String(page.title || '').slice(0, 255), url: typeof page.url === 'string' && page.url.startsWith(WIKI) ? page.url : '' },
      facts,
    };
  }

  global.Research = { read, pickArticle, queryFor, find };
})(typeof window !== 'undefined' ? window : globalThis);
