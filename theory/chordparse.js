/* ChordPath — chordparse.js
 * Reads chords the way people actually write them — typed on one line, pasted
 * as a chord sheet with lyrics, or given as Roman numerals — and turns them
 * into the app's "root:quality" specs. Also finds the key a set of chords
 * lives in, and converts between real chords and key-relative degrees so a
 * progression can be learned in one key and replayed in another.
 */
(function (global) {
  'use strict';

  const S = global.Scales;
  const C = global.Chords;

  // ── Chord symbols ────────────────────────────────────────────────────────
  // Suffix (canonical form, see canonSuffix) → quality id in Chords.QUALITIES.
  const QUALITY_BY_SUFFIX = {
    '': 'maj', 'maj': 'maj', 'm': 'm', 'dim': 'dim', 'mb5': 'dim', 'aug': 'aug',
    'sus2': 'sus2', 'sus4': 'sus4', '4': 'sus4', '5': 'pow',
    'maj7': 'maj7', 'm7': 'm7', '7': '7', 'm7b5': 'm7b5', 'dim7': 'dim7',
    'mmaj7': 'mMaj7', '7sus4': '7sus4', '9sus4': '7sus4',
    'augmaj7': 'augMaj7', 'maj7s5': 'augMaj7', '7b5': '7b5', '7s5': '7s5', 'aug7': '7s5',
    '6': '6', 'maj6': '6', 'm6': 'm6', '6/9': '6/9', '69': '6/9', '6add9': '6/9',
    'maj9': 'maj9', '9': '9', 'm9': 'm9', 'mmaj9': 'mMaj9',
    '11': '11', 'm11': 'm11', 'maj7s11': 'maj7s11', 'maj9s11': 'maj7s11',
    '13': '13', 'm13': 'm13', 'maj13': 'maj13',
    '7b9': '7b9', '7s9': '7s9', '7s11': '7s11', '7alt': '7alt', 'alt': '7alt', '13b9': '13b9',
    'add9': 'add9', 'add2': 'add9', '2': 'add9', 'madd9': 'madd9', 'madd2': 'madd9',
    'add11': 'add11', 'add4': 'add11',
  };

  // Everything a chord suffix can be built from. A token whose tail contains
  // anything else ("Bridge", "Day", "Fade") is a word, not a chord.
  const SUFFIX_GRAMMAR = /^(?:major|minor|maj|min|dim|aug|sus|add|alt|mi|ma|M|m|[0-9]|[#b+\-/()]|[°ºøΔ])*$/;

  const ENHARMONIC = { Cb: 'B', Fb: 'E', 'E#': 'F', 'B#': 'C' };

  function normalizeAccidentals(text) {
    return String(text).replace(/♯/g, '#').replace(/♭/g, 'b');
  }

  function canonSuffix(rest) {
    let s = rest.replace(/[()\s]/g, '');
    s = s.replace(/Δ(?=\d)/g, 'maj').replace(/Δ/g, 'maj7');
    s = s.replace(/ø7?/g, 'm7b5').replace(/[°º]/g, 'dim');
    s = s.replace(/^major/, 'maj').replace(/^minor/, 'm');
    s = s.replace(/^M(?![a-z])/, 'maj');          // CM7, CM9, CM
    s = s.replace(/^ma(?=\d|$)/, 'maj');          // Cma7
    s = s.replace(/^(?:min|mi(?!n)|-)/, 'm');     // Cmin7, Cmi7, C-7
    s = s.replace(/^m(?:M|\/maj)(?=\d)/, 'mmaj'); // CmM7, Cm/maj7
    s = s.replace(/^\+/, 'aug').replace(/\+$/, 's5');
    s = s.replace(/#/g, 's').replace(/\+(?=\d)/g, 's').replace(/(\d)-(?=\d)/g, '$1b');
    s = s.replace(/sus(?!\d)/, 'sus4');
    return s;
  }

  // "F#m7" → { root:'F#', quality:'m7', bass:null, spec:'F#:m7', approx:false }
  // Returns null for anything that is not a chord symbol.
  function parseSymbol(text) {
    if (typeof text !== 'string') return null;
    const t = normalizeAccidentals(text.trim());
    if (!t || t.length > 16) return null;
    const m = /^([A-G])([#b]?)(.*)$/.exec(t);
    if (!m) return null;
    const root = ENHARMONIC[m[1] + m[2]] || (m[1] + m[2]);
    let rest = m[3];
    let bass = null;
    const slash = /\/([A-G][#b]?)$/.exec(rest);
    if (slash) {
      bass = ENHARMONIC[slash[1]] || slash[1];
      rest = rest.slice(0, slash.index);
    }
    if (!SUFFIX_GRAMMAR.test(rest)) return null;

    const suffix = canonSuffix(rest);
    let quality = QUALITY_BY_SUFFIX[suffix];
    let approx = false;
    if (quality === undefined) {
      // Unusual extension: keep the longest leading part we do understand.
      for (let len = suffix.length - 1; len >= 1 && quality === undefined; len--) {
        quality = QUALITY_BY_SUFFIX[suffix.slice(0, len)];
      }
      if (quality === undefined) return null;
      approx = true;
    }
    return { root, quality, bass, spec: root + ':' + quality, raw: text.trim(), approx };
  }

  function toChord(parsed) {
    return C.buildChord(parsed.root, parsed.quality, { preferFlats: parsed.root.includes('b') });
  }

  function format(chords) {
    return (chords || []).map(c => c.shortName || toChord(c).shortName).join(' ');
  }

  // ── One line of chords ───────────────────────────────────────────────────
  const SKIP_TOKEN = /^(?:\(?[x×]\s?\d+\)?|\d+[x×]|n\.?c\.?|[:.\-/()[\]]+)$/i;

  function splitTokens(line) {
    return normalizeAccidentals(line)
      .replace(/-+>/g, ' ')
      .replace(/[–—−→⇒>|,;]+/g, ' ')
      .replace(/\s\/\s/g, ' ')
      .split(/\s+/)
      .filter(Boolean);
  }

  // Classify every token on a line: chords, things to ignore, and leftovers.
  function scanLine(line) {
    const chords = [];
    const unknown = [];
    for (const rawTok of splitTokens(line)) {
      if (rawTok === '%') {
        if (chords.length) chords.push(Object.assign({}, chords[chords.length - 1]));
        continue;
      }
      if (SKIP_TOKEN.test(rawTok)) continue;
      const tok = rawTok.replace(/^[(["'“‘]+/, '').replace(/[)\]"'”’.,;:!?]+$/, '');
      if (!tok || SKIP_TOKEN.test(tok)) continue;
      const one = parseSymbol(tok) || parseSymbol(rawTok);
      if (one) { chords.push(one); continue; }
      // "Em7-G-Dsus4" written without spaces.
      const parts = tok.split('-').filter(Boolean);
      const parsedParts = parts.length > 1 ? parts.map(parseSymbol) : [];
      if (parsedParts.length && parsedParts.every(Boolean)) chords.push(...parsedParts);
      else unknown.push(tok);
    }
    return { chords, unknown };
  }

  function parseProgression(text) {
    return scanLine(String(text == null ? '' : text).replace(/\r?\n/g, ' '));
  }

  // Shortest unit the sequence keeps repeating (needs one full repeat).
  function reduceLoop(chords) {
    const n = chords.length;
    for (let p = 1; p * 2 <= n; p++) {
      let periodic = true;
      for (let i = p; i < n; i++) {
        if (chords[i].spec !== chords[i - p].spec) { periodic = false; break; }
      }
      if (periodic) return chords.slice(0, p);
    }
    return chords.slice();
  }

  // ── Pasted chord sheets ──────────────────────────────────────────────────
  const ROLE_PATTERNS = [
    ['prechorus', /^(?:pre[\s-]?chorus|prechorus|lift|climb|build[\s-]?up)/i],
    ['intro', /^intro(?:duction)?/i],
    ['verse', /^(?:verse|strophe)/i],
    ['chorus', /^(?:chorus|refrain|hook)/i],
    ['bridge', /^(?:bridge|middle\s?(?:8|eight)|interlude|solo|instrumental|break(?:down)?)/i],
    ['outro', /^(?:outro|coda|ending)/i],
  ];
  // What may follow the section word in a header: a number and a repeat mark.
  const HEADER_TAIL = /^\s*(?:\d+|[ivx]+)?\s*(?:\(?[x×]\s?\d+\)?)?\s*:?\s*$/i;

  function headerRole(label) {
    const text = String(label).trim();
    for (const [role, re] of ROLE_PATTERNS) {
      const m = re.exec(text);
      if (m && HEADER_TAIL.test(text.slice(m[0].length))) return role;
    }
    return null;
  }

  // Splits a line into an optional section header and whatever follows it.
  function splitHeader(line) {
    const bracket = /^\[([^\]]{1,30})\]\s*(.*)$/.exec(line);
    if (bracket && headerRole(bracket[1])) {
      return { label: bracket[1].trim(), role: headerRole(bracket[1]), rest: bracket[2] };
    }
    const colon = /^([A-Za-z][\w \-]{1,24}?)\s*:\s*(.*)$/.exec(line);
    if (colon && headerRole(colon[1])) {
      return { label: colon[1].trim(), role: headerRole(colon[1]), rest: colon[2] };
    }
    if (headerRole(line)) {
      return { label: line.replace(/:\s*$/, '').trim(), role: headerRole(line), rest: '' };
    }
    return null;
  }

  // Chords from one sheet line, or [] when the line is lyrics.
  function chordsOnLine(line) {
    // ChordPro: chords sit in brackets inside the lyric.
    const inline = [];
    line.replace(/\[([^\]]+)\]/g, (whole, inner) => {
      const p = parseSymbol(inner);
      if (p) inline.push(p);
      return whole;
    });
    if (inline.length) return inline;

    const { chords, unknown } = scanLine(line);
    if (!chords.length) return [];
    // A lyric line can start with "A" or "Am"; a chord line is mostly chords.
    return chords.length / (chords.length + unknown.length) >= 0.6 ? chords : [];
  }

  function parseSheet(text) {
    const sections = [];
    let current = null;
    const open = (label, role) => { current = { label, role, chords: [] }; sections.push(current); };

    String(text == null ? '' : text).split(/\r?\n/).forEach(rawLine => {
      let line = rawLine.trim();
      if (!line) return;
      if (/^\{.*\}$/.test(line)) {                 // ChordPro directive
        const dir = /^\{\s*(?:start_of_|so)(chorus|verse|bridge)/i.exec(line);
        if (dir) open(dir[1].charAt(0).toUpperCase() + dir[1].slice(1).toLowerCase(), dir[1].toLowerCase());
        return;
      }
      const header = splitHeader(line);
      if (header) {
        open(header.label, header.role);
        line = header.rest;
        if (!line) return;
      }
      const chords = chordsOnLine(line);
      if (!chords.length) return;
      if (!current) open('Main', 'verse');
      current.chords.push(...chords);
    });

    const kept = sections
      .filter(sec => sec.chords.length > 0)
      .map(sec => ({ label: sec.label, role: sec.role, chords: reduceLoop(sec.chords) }));
    return { sections: kept };
  }

  // ── Roman numerals ───────────────────────────────────────────────────────
  const ROMAN_RE = /^([b#]?)(VII|VI|IV|V|III|II|I|vii|vi|iv|v|iii|ii|i)(.*)$/;
  const ROMAN_INDEX = { i: 0, ii: 1, iii: 2, iv: 3, v: 4, vi: 5, vii: 6 };
  const MAJOR_STEPS = [0, 2, 4, 5, 7, 9, 11];
  const MINOR_STEPS = [0, 2, 3, 5, 7, 8, 10];

  function romanTokens(text) {
    return normalizeAccidentals(text)
      .replace(/[–—−→⇒>|,;-]+/g, ' ')
      .split(/\s+/)
      .filter(Boolean);
  }

  // One numeral → { semis, lower, suffix, flatSpelled } or null.
  function readNumeral(token, minor) {
    const m = ROMAN_RE.exec(token);
    if (!m) return null;
    const idx = ROMAN_INDEX[m[2].toLowerCase()];
    const steps = minor ? MINOR_STEPS : MAJOR_STEPS;
    let semis = steps[idx];
    // In a minor key III, VI and VII are already the lowered degrees, so a
    // written flat on them ("bVII") is a spelling habit, not a second flat.
    const alreadyLow = minor && (idx === 2 || idx === 5 || idx === 6);
    if (m[1] === 'b' && !alreadyLow) semis -= 1;
    if (m[1] === '#') semis += 1;
    return {
      semis: ((semis % 12) + 12) % 12,
      lower: m[2] === m[2].toLowerCase(),
      suffix: m[3],
      flatSpelled: m[1] === 'b' || alreadyLow,
    };
  }

  function isMinorMode(mode) {
    return /minor|dorian|phrygian|locrian|aeolian/.test(String(mode || ''));
  }

  function keyUsesFlats(key, minor) {
    return key.includes('b') || S.FLAT_KEYS.has(minor ? key + 'm' : key);
  }

  // "i-bVII-bVI-V" in A minor → Am G F E (as parsed chords).
  function parseRoman(text, key, mode) {
    const minor = isMinorMode(mode);
    const keyPc = S.noteIndex(key);
    const flatKey = keyUsesFlats(key, minor);
    const out = [];
    for (const token of romanTokens(text)) {
      // "V7/ii": the dominant of another degree.
      const parts = token.split('/');
      const num = readNumeral(parts[0], minor);
      if (!num) continue;
      let semis = num.semis;
      const target = parts.length === 2 ? readNumeral(parts[1], minor) : null;
      if (target && !target.suffix) semis = (target.semis + num.semis) % 12;

      let suffix = target && !target.suffix ? num.suffix : (parts.length === 2 ? num.suffix + '/' + parts[1] : num.suffix);
      suffix = suffix.replace(/^o(?=7|$)/, 'dim');
      let symbolSuffix;
      if (/^(?:°|º|dim)/.test(suffix)) symbolSuffix = suffix;            // vii°, vii°7
      else if (/^ø/.test(suffix) || /^m7b5/.test(suffix)) symbolSuffix = 'm7b5';
      else if (num.lower) symbolSuffix = 'm' + suffix.replace(/^m(?!aj)/, '');
      else symbolSuffix = suffix;
      const rootName = S.noteName(keyPc + semis, flatKey || num.flatSpelled);
      const parsed = parseSymbol(rootName + symbolSuffix) || parseSymbol(rootName + (num.lower ? 'm' : ''));
      if (parsed) out.push(parsed);
    }
    return out;
  }

  function isRoman(text) {
    const tokens = romanTokens(text);
    if (!tokens.length) return false;
    return tokens.every(tok => {
      const m = ROMAN_RE.exec(tok.split('/')[0]);
      return !!m && SUFFIX_GRAMMAR.test(m[3].replace(/^o(?=7|$)/, ''));
    });
  }

  // ── Key detection ────────────────────────────────────────────────────────
  // How comfortably a chord (semitones above the tonic : family) sits in a
  // major or minor key. 1 = diatonic; lower = a familiar borrowed colour.
  const MAJOR_FIT = {
    '0:M': 1, '2:m': 1, '4:m': 1, '5:M': 1, '7:M': 1, '9:m': 1, '11:d': 1,
    '10:M': 0.6, '5:m': 0.55, '8:M': 0.5, '3:M': 0.5, '2:M': 0.45, '4:M': 0.45,
    '7:m': 0.45, '9:M': 0.4, '6:d': 0.3, '1:M': 0.25, '11:M': 0.2, '0:m': 0.1,
  };
  const MINOR_FIT = {
    '0:m': 1, '2:d': 1, '3:M': 1, '5:m': 1, '7:m': 1, '8:M': 1, '10:M': 1,
    '7:M': 0.85, '5:M': 0.7, '11:d': 0.6, '2:m': 0.5, '1:M': 0.5, '9:d': 0.3, '0:M': 0.15,
  };
  const MAJOR_KEY_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
  const MINOR_KEY_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'G#', 'A', 'Bb', 'B'];

  // 'M' major third, 'm' minor third, 'd' diminished, '?' no third (sus, 5).
  function family(quality) {
    const iv = (C.QUALITIES[quality] || C.QUALITIES.maj).intervals;
    if (iv.includes(3)) return iv.includes(6) && !iv.includes(7) ? 'd' : 'm';
    if (iv.includes(4)) return 'M';
    return '?';
  }

  function pcOf(chord) {
    return chord.rootPc != null ? chord.rootPc : S.noteIndex(chord.root);
  }

  function fitOf(table, semis, fam) {
    if (fam !== '?') return table[semis + ':' + fam] || 0;
    return Math.max(table[semis + ':M'] || 0, table[semis + ':m'] || 0) * 0.9;
  }

  function inferScale(items, tonicPc, minor) {
    const has = (semis, fam) => items.some(it => (it.pc - tonicPc + 12) % 12 === semis && it.fam === fam);
    const hasAny = semis => items.some(it => (it.pc - tonicPc + 12) % 12 === semis);
    if (minor) {
      if (has(5, 'M') && !has(8, 'M')) return 'dorian';
      if (has(1, 'M') && !hasAny(2)) return 'phrygian';
      if (has(7, 'M') && !has(10, 'M')) return 'harmonic_minor';
      return 'natural_minor';
    }
    if (has(10, 'M') && !has(7, 'M') && !has(11, 'd')) return 'mixolydian';
    return 'major';
  }

  // chords: parsed symbols or chord objects. hint: { key, mode } when already known.
  function detectKey(chords, hint) {
    const items = (chords || []).map(c => ({ pc: pcOf(c), fam: family(c.quality), root: c.root }));
    if (!items.length) return null;
    hint = hint || {};
    const hintPc = hint.key ? S.noteIndex(normalizeAccidentals(hint.key)) : null;
    const hintMinor = hint.mode ? isMinorMode(hint.mode) : null;

    const candidates = [];
    for (let tonic = 0; tonic < 12; tonic++) {
      if (hintPc !== null && tonic !== hintPc) continue;
      for (const minor of [false, true]) {
        if (hintMinor !== null && minor !== hintMinor) continue;
        const table = minor ? MINOR_FIT : MAJOR_FIT;
        const isTonic = it => it.pc === tonic && (it.fam === (minor ? 'm' : 'M') || it.fam === '?');
        let score = 0;
        items.forEach(it => { score += fitOf(table, (it.pc - tonic + 12) % 12, it.fam); });
        const tonicCount = items.filter(isTonic).length;
        if (isTonic(items[0])) score += 1.2;
        if (isTonic(items[items.length - 1])) score += 0.5;
        if (tonicCount) score += 0.6 + 0.2 * Math.min(tonicCount, 3);
        candidates.push({ tonic, minor, score });
      }
    }
    candidates.sort((a, b) => b.score - a.score);
    const best = candidates[0];
    const second = candidates[1];
    const tonicChord = items.find(it => it.pc === best.tonic);
    const key = tonicChord ? tonicChord.root
      : (best.minor ? MINOR_KEY_NAMES : MAJOR_KEY_NAMES)[best.tonic];
    return {
      key,
      scale: inferScale(items, best.tonic, best.minor),
      mode: best.minor ? 'minor' : 'major',
      confidence: second ? Math.max(0.01, Math.min(1, (best.score - second.score) / Math.max(best.score, 1e-6))) : 1,
    };
  }

  // ── Key-relative degrees ─────────────────────────────────────────────────
  // "0:m7" = a minor seventh chord on the tonic; "10:maj" = major chord a
  // whole step below it. This is the form the learning engine stores.
  function degrees(chords, key) {
    const keyPc = S.noteIndex(key);
    return (chords || []).map(c => ((pcOf(c) - keyPc + 12) % 12) + ':' + c.quality);
  }

  const FLAT_DEGREES = new Set([1, 3, 8, 10]);

  // Degrees → real chord objects in `key`. With a scale they also get roman
  // numerals, a scale degree, and a diatonic/borrowed category.
  function realize(degreeTokens, key, scale) {
    const keyPc = S.noteIndex(key);
    const flatKey = keyUsesFlats(key, false);   // spelling must not depend on the scale
    const diatonic = scale ? C.diatonicChords(key, scale, { sevenths: false }) : [];
    return (degreeTokens || []).map(tok => {
      const cut = tok.indexOf(':');
      const semis = parseInt(tok.slice(0, cut), 10) || 0;
      const quality = C.QUALITIES[tok.slice(cut + 1)] ? tok.slice(cut + 1) : 'maj';
      const preferFlats = flatKey || FLAT_DEGREES.has(semis);
      const chord = C.buildChord(S.noteName(keyPc + semis, preferFlats), quality, { preferFlats });
      if (scale) {
        const home = diatonic.find(d => d.rootPc === chord.rootPc && family(d.quality) === family(quality));
        chord.category = home ? 'diatonic' : 'borrowed';
        if (home) chord.scaleDegree = home.scaleDegree;
        chord.roman = C.romanNumeral(chord, key, scale);
      }
      return chord;
    });
  }

  global.ChordParse = {
    parseSymbol, toChord, format,
    parseProgression, parseSheet, reduceLoop,
    parseRoman, isRoman,
    detectKey, family, isMinorMode,
    degrees, realize,
    headerRole,
  };
})(typeof window !== 'undefined' ? window : globalThis);
