/* ChordPath — muse.js
 * Muse, the app's own AI. It is a small learning model that lives entirely
 * in the app: you teach it songs (chords plus how they feel to you), it
 * remembers them, learns your vocabulary, and drafts new progressions from
 * the songs closest to what you ask for.
 *
 * How it works: every stored loop is kept as key-relative degrees. A request
 * is compared with every song by feeling and by shared words; those
 * similarities weight a chord-to-chord transition model, and a beam search
 * writes a new loop from it. Taught songs outweigh the built-in library.
 */
(function (global) {
  'use strict';

  const FORMAT = 'chordpath-muse';
  const STORE_KEY = 'chordpath:muse:memory';
  const LIMITS = { songs: 5000, title: 120, text: 2000, sections: 12, chords: 32, token: 40 };
  const SPEC_RE = /^[A-G][#b]?:[A-Za-z0-9_/]{1,12}$/;
  const NOTE_RE = /^[A-G][#b]?$/;
  const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
  const TAUGHT_WEIGHT = 3;
  const CLOSENESS = {
    close: { seed: 14, heat: 0.35 },
    near:  { seed: 5,  heat: 1.0 },
    loose: { seed: 1.5, heat: 1.8 },
  };

  const CP = () => global.ChordParse;
  const Lx = () => global.Lexicon;
  const F = () => global.Feelings;

  let store = null;
  let songs = [];          // what the user taught
  let libraryCache = null;
  let learnedCache = null;
  let idfCache = null;

  // ── Small helpers ────────────────────────────────────────────────────────
  function newId() {
    return 'mem_' + Date.now().toString(36) + Math.floor(Math.random() * 46656).toString(36).padStart(3, '0');
  }
  function str(v, max) { return typeof v === 'string' ? v.slice(0, max) : ''; }

  function norm(text) {
    return String(text || '').toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/\([^)]*\)/g, ' ')
      .replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function sameSong(entry, title, artist) {
    if (norm(entry.title) !== norm(title)) return false;
    const a = norm(artist), b = norm(entry.artist);
    return !a || !b || a === b || a.includes(b) || b.includes(a);
  }

  function cleanFeelings(raw) {
    const out = {};
    if (!raw || typeof raw !== 'object') return out;
    for (const id of Object.keys(raw)) {
      const w = raw[id];
      if (typeof w === 'number' && w > 0 && F().getFeeling(id)) out[id] = Math.min(1, w);
    }
    return out;
  }

  function invalidate() { learnedCache = null; idfCache = null; }

  // ── Building an entry ────────────────────────────────────────────────────
  // Sections arrive as { role, label, specs } and leave with degrees added.
  function finishEntry(base, sections, keyHint, modeHint) {
    const P = CP();
    const parsedSections = sections.map(sec => ({
      role: sec.role, label: sec.label,
      chords: sec.specs.map(sp => { const [root, quality] = sp.split(':'); return { root, quality, spec: sp }; }),
    })).filter(sec => sec.chords.length > 0).slice(0, LIMITS.sections);

    const all = [].concat(...parsedSections.map(s => s.chords));
    let key = '', mode = null, scale = null;
    if (all.length) {
      const hint = {};
      if (typeof keyHint === 'string' && NOTE_RE.test(keyHint)) hint.key = keyHint;
      if (modeHint === 'major' || modeHint === 'minor') hint.mode = modeHint;
      const found = P.detectKey(all, hint);
      key = hint.key || found.key; mode = found.mode; scale = found.scale;
    } else if (typeof keyHint === 'string' && NOTE_RE.test(keyHint)) {
      key = keyHint;
    }
    base.key = key; base.mode = mode; base.scale = scale;
    base.sections = parsedSections.map(sec => ({
      role: sec.role, label: sec.label,
      specs: sec.chords.map(c => c.spec),
      degrees: P.degrees(sec.chords, key),
    }));
    return base;
  }

  function sectionsFromText(text, key, mode) {
    const P = CP();
    text = String(text || '');
    if (!text.trim()) return [];
    if (P.isRoman(text)) {
      const k = typeof key === 'string' && NOTE_RE.test(key) ? key : (mode === 'minor' ? 'A' : 'C');
      const chords = P.reduceLoop(P.parseRoman(text, k, mode || 'major'));
      return chords.length ? [{ role: 'verse', label: 'Main', specs: chords.map(c => c.spec) }] : [];
    }
    return P.parseSheet(text).sections.map(sec => ({
      role: sec.role, label: str(sec.label, LIMITS.token) || 'Main',
      specs: sec.chords.slice(0, LIMITS.chords).map(c => c.spec),
    }));
  }

  function hearBase(text, explicit) {
    const picked = cleanFeelings(explicit);
    let heard = Lx().analyze(text);
    if (!heard.top.length) heard = Lx().analyze(text, learnedMap());
    return {
      feelings: Object.keys(picked).length ? picked : heard.feelings,
      energy: heard.energy,
    };
  }

  // Anything read from disk or a file is rebuilt field by field.
  function sanitizeEntry(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const title = str(raw.title, LIMITS.title).trim();
    if (!title) return null;
    const feelText = str(raw.feelText, LIMITS.text);
    const sections = (Array.isArray(raw.sections) ? raw.sections : [])
      .filter(sec => sec && typeof sec === 'object')
      .map(sec => ({
        role: global.Song.ROLES.includes(sec.role) ? sec.role : 'verse',
        label: str(sec.label, LIMITS.token) || 'Main',
        specs: (Array.isArray(sec.specs) ? sec.specs : [])
          .filter(sp => typeof sp === 'string' && SPEC_RE.test(sp)).slice(0, LIMITS.chords),
      }));
    const stored = cleanFeelings(raw.feelings);
    const heard = Object.keys(stored).length ? { feelings: stored, energy: 'mid' } : hearBase(feelText, null);
    const tempo = typeof raw.tempo === 'number' && raw.tempo >= 30 && raw.tempo <= 300 ? Math.round(raw.tempo) : null;
    const entry = {
      id: typeof raw.id === 'string' && ID_RE.test(raw.id) ? raw.id : newId(),
      title,
      artist: str(raw.artist, LIMITS.title).trim(),
      year: Number.isInteger(raw.year) && raw.year > 0 && raw.year < 3000 ? raw.year : null,
      genreId: str(raw.genreId, LIMITS.token),
      feelText,
      feelings: heard.feelings,
      energy: ['low', 'mid', 'high'].includes(raw.energy) ? raw.energy : heard.energy,
      tempo,
      source: raw.source === 'library' ? 'library' : 'user',   // where the chords came from
      notes: str(raw.notes, LIMITS.text),
      addedAt: str(raw.addedAt, LIMITS.token) || new Date().toISOString(),
      updatedAt: str(raw.updatedAt, LIMITS.token) || new Date().toISOString(),
    };
    return finishEntry(entry, sections, raw.key, raw.mode);
  }

  // ── Persistence ──────────────────────────────────────────────────────────
  function defaultStore() {
    return {
      read() { try { return global.localStorage.getItem(STORE_KEY); } catch (e) { return null; } },
      write(text) { try { global.localStorage.setItem(STORE_KEY, text); return true; } catch (e) { return false; } },
    };
  }

  function save() {
    invalidate();
    return store.write(JSON.stringify({ format: FORMAT, version: 1, songs }));
  }

  function load() {
    songs = [];
    invalidate();
    let parsed = null;
    try { parsed = JSON.parse(store.read() || 'null'); } catch (e) { parsed = null; }
    if (parsed && parsed.format === FORMAT && Array.isArray(parsed.songs)) {
      songs = parsed.songs.slice(0, LIMITS.songs).map(sanitizeEntry).filter(Boolean);
    }
  }

  function configure(opts) {
    store = (opts && opts.store) || defaultStore();
    load();
  }

  // ── The built-in library, in the same shape as taught songs ──────────────
  function library() {
    if (libraryCache) return libraryCache;
    const D = global.MuseData;
    libraryCache = (D ? D.SONGS : []).map((s, i) => {
      const minor = /m$/.test(s.key);
      const entry = sanitizeEntry({
        id: 'lib_' + i, title: s.title, artist: s.artist, year: s.year, genreId: s.genre,
        feelText: s.feel, tempo: s.tempo, key: s.key.replace(/m$/, ''), mode: minor ? 'minor' : 'major',
        source: 'library',
        sections: Object.entries(s.sections).map(([role, text]) => ({
          role, label: role,
          specs: CP().reduceLoop(CP().parseProgression(text).chords).map(c => c.spec),
        })),
      });
      entry.builtin = true;
      return entry;
    });
    return libraryCache;
  }

  // Taught songs first; a library song is hidden once the user teaches it.
  function corpus() {
    const hidden = lib => songs.some(e => sameSong(e, lib.title, lib.artist));
    return songs.concat(library().filter(lib => !hidden(lib)));
  }

  // ── Memory API ───────────────────────────────────────────────────────────
  function all() {
    return songs.slice().sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }
  function get(id) { return songs.find(e => e.id === id) || null; }
  function find(title, artist) { return songs.find(e => sameSong(e, title, artist)) || null; }

  function knows(title, artist) {
    const mine = find(title, artist);
    if (mine) return { entry: mine, builtin: false };
    const lib = library().find(e => sameSong(e, title, artist));
    return lib ? { entry: lib, builtin: true } : null;
  }

  function build(input, existing) {
    const prev = existing || {};
    const title = str(input.title != null ? input.title : prev.title, LIMITS.title).trim();
    if (!title) throw new Error('A song needs a title before Muse can learn it.');
    const feelText = input.feelText != null ? str(input.feelText, LIMITS.text) : (prev.feelText || '');
    const key = input.key != null ? input.key : prev.key;
    const mode = input.mode != null ? input.mode : prev.mode;
    let sections;
    if (Array.isArray(input.sections)) sections = input.sections;
    else if (input.chordsText != null) sections = sectionsFromText(input.chordsText, key, mode);
    else sections = prev.sections || [];
    const feelingsGiven = input.feelings && Object.keys(cleanFeelings(input.feelings)).length > 0;
    const feelingsKept = !feelingsGiven && input.feelText == null ? prev.feelings : null;
    const entry = sanitizeEntry({
      id: prev.id, title,
      artist: input.artist != null ? input.artist : prev.artist,
      year: input.year != null ? input.year : prev.year,
      genreId: input.genreId != null ? input.genreId : prev.genreId,
      feelText,
      feelings: feelingsGiven ? input.feelings : feelingsKept,
      tempo: input.tempo != null ? input.tempo : prev.tempo,
      key, mode, sections,
      source: input.source || prev.source,
      notes: input.notes != null ? input.notes : prev.notes,
      addedAt: prev.addedAt,
    });
    entry.updatedAt = new Date().toISOString();
    return entry;
  }

  // Learn a song, or update it if Muse already has it.
  function teach(input) {
    input = input || {};
    const existing = input.title ? find(input.title, input.artist) : null;
    // A re-taught song keeps the name it was first given.
    const entry = build(existing ? Object.assign({}, input, { title: existing.title }) : input, existing);
    if (existing) songs[songs.indexOf(existing)] = entry;
    else {
      if (songs.length >= LIMITS.songs) throw new Error('Muse\'s memory is full.');
      songs.push(entry);
    }
    save();
    return entry;
  }

  function update(id, patch) {
    const existing = get(id);
    if (!existing) return null;
    const entry = build(patch || {}, existing);
    songs[songs.indexOf(existing)] = entry;
    save();
    return entry;
  }

  function forget(id) {
    const i = songs.findIndex(e => e.id === id);
    if (i < 0) return false;
    songs.splice(i, 1);
    save();
    return true;
  }

  function clear() { songs = []; save(); }

  // Read chords and key out of what the user typed, without learning it.
  function preview(input) {
    return build(Object.assign({ title: 'preview' }, input || {}), null);
  }

  // An entry's chords as text the user can read and edit again.
  function chordsText(entry) {
    const P = CP();
    const line = sec => P.format(sec.specs.map(sp => { const [root, quality] = sp.split(':'); return { root, quality }; }));
    const secs = (entry && entry.sections) || [];
    if (secs.length <= 1) return secs.length ? line(secs[0]) : '';
    return secs.map(sec => {
      const label = sec.label || sec.role;
      return '[' + label.charAt(0).toUpperCase() + label.slice(1) + ']\n' + line(sec);
    }).join('\n');
  }

  function exportJSON() {
    return JSON.stringify({ format: FORMAT, version: 1, exportedAt: new Date().toISOString(), songs }, null, 2);
  }

  function importJSON(text) {
    let parsed;
    try { parsed = JSON.parse(text); }
    catch (e) { return { added: 0, errors: ['not valid JSON'] }; }
    if (!parsed || parsed.format !== FORMAT || !Array.isArray(parsed.songs)) {
      return { added: 0, errors: ['not a Muse memory file'] };
    }
    let added = 0;
    const errors = [];
    parsed.songs.slice(0, LIMITS.songs).forEach((raw, i) => {
      const entry = sanitizeEntry(raw);
      if (!entry) { errors.push(`song ${i} has no title`); return; }
      if (find(entry.title, entry.artist) || songs.length >= LIMITS.songs) return;
      if (get(entry.id)) entry.id = newId();
      songs.push(entry);
      added++;
    });
    if (added) save();
    return { added, errors };
  }

  // ── Learned vocabulary ───────────────────────────────────────────────────
  // Words the lexicon does not know take on the feelings of the songs you
  // used them for.
  function vocabulary() {
    const acc = {};
    for (const e of songs) {
      const words = new Set(Lx().tokenize(e.feelText).filter(w => w.length >= 3 && !Lx().isKnownWord(w)));
      for (const w of words) {
        const slot = acc[w] = acc[w] || { word: w, count: 0, sums: {} };
        slot.count++;
        for (const id of Object.keys(e.feelings)) slot.sums[id] = (slot.sums[id] || 0) + e.feelings[id];
      }
    }
    return Object.values(acc).map(slot => {
      const max = Math.max(0, ...Object.values(slot.sums));
      const feelings = {};
      for (const id of Object.keys(slot.sums)) {
        if (max > 0 && slot.sums[id] / max >= 0.25) feelings[id] = slot.sums[id] / max;
      }
      return { word: slot.word, count: slot.count, feelings };
    }).sort((a, b) => b.count - a.count || a.word.localeCompare(b.word));
  }

  function learnedMap() {
    if (!learnedCache) {
      learnedCache = {};
      for (const v of vocabulary()) {
        if (Object.keys(v.feelings).length) learnedCache[v.word] = v.feelings;
      }
    }
    return learnedCache;
  }

  function hear(text) { return Lx().analyze(text, learnedMap()); }

  // ── Similarity ───────────────────────────────────────────────────────────
  function idf() {
    if (idfCache) return idfCache;
    const docs = corpus();
    const df = {};
    docs.forEach(e => new Set(Lx().tokenize(e.feelText)).forEach(w => { df[w] = (df[w] || 0) + 1; }));
    idfCache = w => Math.log(1 + docs.length / (1 + (df[w] || 0)));
    return idfCache;
  }

  function textSim(aTokens, bTokens) {
    if (!aTokens.length || !bTokens.length) return { score: 0, shared: [] };
    const weight = idf();
    const a = new Set(aTokens), b = new Set(bTokens);
    const shared = [...a].filter(w => b.has(w));
    const sum = set => [...set].reduce((s, w) => s + weight(w), 0);
    const denom = Math.sqrt(sum(a) * sum(b));
    return { score: denom ? sum(new Set(shared)) / denom : 0, shared };
  }

  function resolveQuery(query) {
    query = query || {};
    const seed = query.seedEntry || (query.seedId ? (get(query.seedId) || library().find(e => e.id === query.seedId)) : null);
    const heard = query.text ? hear(query.text) : null;
    let feelings = cleanFeelings(query.feelings);
    if (!Object.keys(feelings).length) feelings = heard ? heard.feelings : (seed ? seed.feelings : {});
    const tokens = query.text ? Lx().tokenize(query.text) : (seed ? Lx().tokenize(seed.feelText) : []);
    return { seed, heard, feelings, tokens, energy: heard ? heard.energy : (seed ? seed.energy : 'mid') };
  }

  // Raw 0..1 likeness between a resolved query and one stored song.
  function likeness(q, entry) {
    const feel = Lx().cosine(q.feelings, entry.feelings);
    const text = textSim(q.tokens, Lx().tokenize(entry.feelText));
    const hasFeel = Object.keys(q.feelings).length > 0;
    const score = hasFeel && q.tokens.length ? 0.6 * feel + 0.4 * text.score : (hasFeel ? feel : text.score);
    const sharedFeelings = Object.keys(q.feelings).filter(id => entry.feelings[id])
      .sort((a, b) => q.feelings[b] * entry.feelings[b] - q.feelings[a] * entry.feelings[a])
      .slice(0, 3).map(id => F().getFeeling(id).name.toLowerCase());
    return { score, shared: text.shared.concat(sharedFeelings.filter(n => !text.shared.includes(n))) };
  }

  function similar(query, n) {
    const q = resolveQuery(query);
    if (!q.seed && !q.tokens.length && !Object.keys(q.feelings).length) return [];
    const out = [];
    for (const entry of corpus()) {
      const isSeed = q.seed && entry.id === q.seed.id;
      const like = likeness(q, entry);
      const score = isSeed ? 2 : like.score * (entry.builtin ? 0.8 : 1);
      if (score > 0) out.push({ entry, score, shared: like.shared, builtin: !!entry.builtin });
    }
    out.sort((a, b) => b.score - a.score);
    return out.slice(0, n || 8);
  }

  // ── The chord model ──────────────────────────────────────────────────────
  // A chord class is "semitones above the tonic : family" — e.g. "0:m" is any
  // minor-type chord on the tonic. Transitions are learned between classes;
  // the exact colour (m7, madd9…) is chosen afterwards.
  function classOf(degree) {
    const cut = degree.indexOf(':');
    return degree.slice(0, cut) + ':' + CP().family(degree.slice(cut + 1));
  }
  function rootsOf(degrees) { return degrees.map(d => d.slice(0, d.indexOf(':'))); }
  function sameLoop(a, b) {
    if (a.length !== b.length) return false;
    const target = b.join(' ');
    for (let i = 0; i < a.length; i++) {
      if (a.slice(i).concat(a.slice(0, i)).join(' ') === target) return true;
    }
    return false;
  }

  function corpusLoops() {
    const out = [];
    corpus().forEach(e => e.sections.forEach(sec => { if (sec.degrees.length >= 2) out.push(sec.degrees.slice()); }));
    return out;
  }

  function buildModel(weighted, mode, role) {
    const m = { start: {}, uni: {}, bi: {}, emit: {}, len: {}, src: {}, total: 0 };
    const bump = (obj, k, w) => { obj[k] = (obj[k] || 0) + w; };
    for (const { entry, weight } of weighted) {
      if (entry.mode !== mode) continue;
      for (const sec of entry.sections) {
        const n = sec.degrees.length;
        if (n < 2) continue;
        const w = weight * (role && sec.role === role ? 1.6 : 1);
        const cls = sec.degrees.map(classOf);
        bump(m.start, cls[0], w);
        bump(m.len, Math.min(n, 8), w);
        cls.forEach((c, i) => {
          bump(m.uni, c, w); m.total += w;
          const quality = sec.degrees[i].slice(sec.degrees[i].indexOf(':') + 1);
          bump(m.emit[c] = m.emit[c] || {}, quality, w);
          const prev = cls[(i - 1 + n) % n];
          const tw = i === 0 ? w * 0.6 : w;           // the wrap-around counts a little less
          bump(m.bi[prev] = m.bi[prev] || {}, c, tw);
          const key = prev + '>' + c;
          if (!m.src[key] || m.src[key].weight < w) m.src[key] = { weight: w, title: entry.title, builtin: !!entry.builtin };
        });
      }
    }
    m.vocab = Object.keys(m.uni);
    return m;
  }

  function transition(m, prev, next) {
    const row = m.bi[prev];
    const rowTotal = row ? Object.values(row).reduce((s, v) => s + v, 0) : 0;
    const pBi = rowTotal ? (row[next] || 0) / rowTotal : 0;
    const pUni = m.total ? (m.uni[next] || 0) / m.total : 0;
    return Math.log(0.75 * pBi + 0.2 * pUni + 0.05 / Math.max(1, m.vocab.length));
  }

  function pickWeighted(table, rand, fallback) {
    const keys = Object.keys(table);
    if (!keys.length) return fallback;
    const total = keys.reduce((s, k) => s + table[k], 0);
    let r = rand() * total;
    for (const k of keys) { r -= table[k]; if (r <= 0) return k; }
    return keys[keys.length - 1];
  }

  function search(m, length, rand, heat, banned) {
    const startTotal = Object.values(m.start).reduce((s, v) => s + v, 0) || 1;
    let beam = m.vocab.map(c => ({
      seq: [c],
      score: Math.log(((m.start[c] || 0) + 0.02 * startTotal) / startTotal) + rand() * heat,
    }));
    const width = 40;
    beam.sort((a, b) => b.score - a.score);
    beam = beam.slice(0, width);
    for (let pos = 1; pos < length; pos++) {
      const next = [];
      for (const state of beam) {
        const prev = state.seq[state.seq.length - 1];
        for (const c of m.vocab) {
          if (c.split(':')[0] === prev.split(':')[0]) continue;      // no standing still
          const uses = state.seq.filter(x => x === c).length;
          next.push({
            seq: state.seq.concat([c]),
            score: state.score + transition(m, prev, c) - uses * 1.6 + rand() * heat,
          });
        }
      }
      if (!next.length) break;
      next.sort((a, b) => b.score - a.score);
      beam = next.slice(0, width);
    }
    const finished = beam.filter(s => s.seq.length === length).map(s => {
      const first = s.seq[0], last = s.seq[s.seq.length - 1];
      let score = s.score + 0.6 * transition(m, last, first);
      if (first.split(':')[0] === last.split(':')[0]) score -= 1.5;
      if (!s.seq.some(c => c.split(':')[0] === '0')) score -= 1.5;    // keep the tonic in sight
      return { seq: s.seq, score };
    }).sort((a, b) => b.score - a.score);
    const allowed = finished.filter(s => !banned(s.seq.map(c => c.split(':')[0])));
    return (allowed[0] || finished[0] || { seq: [] }).seq;
  }

  const KEY_POOL = { major: ['C', 'G', 'D', 'A', 'E', 'F'], minor: ['A', 'E', 'D', 'B', 'F#'] };

  function pickKey(mode, feelings, avoid, rand) {
    const top = Object.keys(feelings).sort((a, b) => feelings[b] - feelings[a])[0];
    const f = top ? F().getFeeling(top) : null;
    let pool = f ? f.keyBias.filter(k => (mode === 'minor') === k.endsWith('m')).map(k => k.replace(/m$/, '')) : [];
    if (pool.length < 2) pool = KEY_POOL[mode].slice();
    const usable = pool.filter(k => k !== avoid);
    const from = usable.length ? usable : KEY_POOL[mode].filter(k => k !== avoid);
    return from[Math.min(from.length - 1, Math.floor(rand() * from.length))];
  }

  // ── Drafting ─────────────────────────────────────────────────────────────
  // opts: { text, feelings, seedId, seedEntry, closeness, length, seed, key,
  //         mode, role, avoidRoots }
  function draft(opts) {
    opts = opts || {};
    const P = CP();
    const seedNum = opts.seed != null ? opts.seed : (Date.now() & 0xffff);
    const rand = global.Melody.rng(seedNum * 2654435761 + 97);
    const closeness = CLOSENESS[opts.closeness] ? opts.closeness : 'near';
    const dial = CLOSENESS[closeness];
    const q = resolveQuery(opts);

    // Weight every song with chords by how close it is to the request.
    const weighted = [];
    for (const entry of corpus()) {
      if (!entry.sections.length || !entry.mode) continue;
      const like = likeness(q, entry);
      const isSeed = q.seed && entry.id === q.seed.id;
      const weight = isSeed ? dial.seed : (entry.builtin ? 1 : TAUGHT_WEIGHT) * (0.03 + like.score * like.score);
      weighted.push({ entry, weight, like: isSeed ? 1 : like.score, shared: like.shared });
    }
    if (q.seed && q.seed.sections.length && q.seed.mode && !weighted.some(w => w.entry.id === q.seed.id)) {
      weighted.push({ entry: q.seed, weight: dial.seed, like: 1, shared: [] });
    }

    // Major or minor: the similar songs vote, and so do the feelings.
    let mode = opts.mode === 'major' || opts.mode === 'minor' ? opts.mode : null;
    if (!mode && q.seed && q.seed.mode) mode = q.seed.mode;
    if (!mode) {
      let major = 0, minor = 0, fMajor = 0, fMinor = 0;
      weighted.forEach(w => { if (w.entry.mode === 'major') major += w.weight; else minor += w.weight; });
      for (const id of Object.keys(q.feelings)) {
        const bias = F().getFeeling(id).modeBias;
        if (bias === 'major') fMajor += q.feelings[id];
        if (bias === 'minor') fMinor += q.feelings[id];
      }
      const pCorpus = major + minor ? major / (major + minor) : 0.5;
      const pFeel = fMajor + fMinor ? fMajor / (fMajor + fMinor) : pCorpus;
      mode = 0.5 * pCorpus + 0.5 * pFeel >= 0.5 ? 'major' : 'minor';
    }

    const model = buildModel(weighted, mode, opts.role);
    const seedLoops = q.seed ? q.seed.sections.map(s => rootsOf(s.degrees)) : [];
    const everyLoop = [];
    corpus().forEach(e => e.sections.forEach(sec => {
      if (sec.degrees.length < 2) return;
      everyLoop.push(rootsOf(sec.degrees));
    }));
    const extra = (opts.avoidRoots || []).filter(r => Array.isArray(r));
    // A four-chord answer that is really two chords twice is not an answer.
    const stutters = roots => roots.length > 2 && roots.length % 2 === 0 &&
      roots.slice(0, roots.length / 2).join() === roots.slice(roots.length / 2).join();
    const banned = roots => stutters(roots) ||
      seedLoops.concat(extra).some(l => sameLoop(l, roots)) ||
      (closeness !== 'close' && everyLoop.some(l => sameLoop(l, roots)));

    let length = Number.isInteger(opts.length) ? Math.max(2, Math.min(8, opts.length)) : 0;
    if (!length) {
      const lens = {};
      for (const k of Object.keys(model.len)) { if (+k >= 3 && +k <= 6) lens[k] = model.len[k]; }
      length = parseInt(pickWeighted(lens, rand, '4'), 10);
    }

    let classes = model.vocab.length >= 2 ? search(model, length, rand, dial.heat, banned) : [];
    let degrees;
    if (classes.length >= 2) {
      degrees = classes.map(c => {
        const table = model.emit[c] || {};
        let best = null, bestScore = -1;
        for (const quality of Object.keys(table)) {
          const s = table[quality] * (0.6 + rand());
          if (s > bestScore) { bestScore = s; best = quality; }
        }
        return c.split(':')[0] + ':' + (best || (c.endsWith(':m') ? 'm' : 'maj'));
      });
    } else {
      // Nothing learned for this mode yet: let the theory engine write it.
      const key0 = mode === 'minor' ? 'A' : 'C';
      const top = Object.keys(q.feelings)[0] || 'nostalgic';
      const prog = F().buildProgression({ key: key0, scale: mode === 'minor' ? 'natural_minor' : 'major',
        feelingId: top, role: opts.role || 'verse', seed: seedNum, length });
      degrees = P.degrees(prog, key0);
    }

    let key = typeof opts.key === 'string' && NOTE_RE.test(opts.key) ? opts.key : null;
    if (!key) {
      key = q.seed && closeness === 'close' && q.seed.key
        ? q.seed.key
        : pickKey(mode, q.feelings, q.seed && closeness !== 'close' ? q.seed.key : null, rand);
    }
    const scale = P.detectKey(P.realize(degrees, key), { key, mode }).scale;
    const chords = P.realize(degrees, key, scale);

    const ranked = weighted.slice().sort((a, b) => b.weight - a.weight);
    const influences = ranked.filter(w => w.entry.mode === mode || w.like >= 0.3).slice(0, 5).map(w => ({
      id: w.entry.id, title: w.entry.title, artist: w.entry.artist,
      weight: w.weight, match: w.like, shared: w.shared, builtin: !!w.entry.builtin,
    }));
    const moves = [];
    for (let i = 1; i < classes.length; i++) {
      const src = model.src[classes[i - 1] + '>' + classes[i]];
      if (src) moves.push({ from: chords[i - 1].shortName, to: chords[i].shortName, title: src.title, builtin: src.builtin });
    }
    const lead = ranked[0];
    const basis = lead && !lead.entry.builtin && lead.like >= 0.3 ? 'memory'
      : ranked.some(w => w.like >= 0.3) ? 'library' : 'theory';

    return {
      chords, degrees, key, scale, mode,
      specs: chords.map(c => c.root + ':' + c.quality),
      roman: chords.map(c => c.roman),
      influences, moves, basis, closeness, seed: seedNum,
      feelings: q.feelings, energy: q.energy,
    };
  }

  // A whole ChordPath song: Muse writes the verse and chorus, the theory
  // engine fills the connecting sections in the same key and feeling.
  function draftSong(opts) {
    opts = opts || {};
    const Song = global.Song;
    const seedNum = opts.seed != null ? opts.seed : (Date.now() & 0xffff);
    // A draft already on screen becomes the verse as-is.
    const verse = opts.verse && Array.isArray(opts.verse.chords) && opts.verse.chords.length >= 2
      ? opts.verse
      : draft(Object.assign({}, opts, { seed: seedNum, role: 'verse' }));
    let chorus = null;
    for (let tries = 0; tries < 6; tries++) {
      chorus = draft(Object.assign({}, opts, {
        seed: seedNum + 17 + tries * 101, role: 'chorus', key: verse.key, mode: verse.mode,
        avoidRoots: [rootsOf(verse.degrees)],
      }));
      if (chorus.specs.join() !== verse.specs.join()) break;
    }

    const q = resolveQuery(opts);
    const order = Object.keys(verse.feelings).sort((a, b) => verse.feelings[b] - verse.feelings[a]);
    const feelingId = order[0] || 'nostalgic';
    const chorusFeeling = order[1] || F().contrastFor(feelingId, 'chorus');
    const energy = ['low', 'mid', 'high'].includes(opts.energy) ? opts.energy : (verse.energy || 'mid');
    const byId = id => corpus().find(e => e.id === id);
    const sources = verse.influences.map(i => byId(i.id)).filter(Boolean);
    const genreVotes = {};
    verse.influences.forEach(i => {
      const e = byId(i.id);
      if (e && global.Genres.byId(e.genreId)) genreVotes[e.genreId] = (genreVotes[e.genreId] || 0) + i.weight;
    });
    const genreId = global.Genres.byId(opts.genreId) ? opts.genreId
      : (Object.keys(genreVotes).sort((a, b) => genreVotes[b] - genreVotes[a])[0] || 'indie');
    const tempos = sources.filter(e => e.tempo).slice(0, 3).map(e => e.tempo);
    const tempo = typeof opts.tempo === 'number' ? opts.tempo
      : tempos.length ? Math.round(tempos.reduce((s, t) => s + t, 0) / tempos.length)
      : F().chooseTempo(feelingId, genreId, energy);

    const names = verse.influences.slice(0, 3).map(i => i.title + (i.artist ? ' — ' + i.artist : ''));
    const song = Song.createSong({
      title: str(opts.title, LIMITS.title) || (q.seed ? 'After ' + q.seed.title : 'Muse sketch'),
      genreId, feelingId, energy,
      key: verse.key, scale: verse.scale,
      tempo: Math.max(50, Math.min(180, tempo)),
      notes: 'Drafted by Muse' + (names.length ? ' from what it learned in: ' + names.join('; ') + '.' : '.') +
        (opts.text ? ' You asked for: "' + str(opts.text, 200) + '".' : ''),
    });

    const plan = F().SECTION_PLANS[energy] || F().SECTION_PLANS.mid;
    const cache = {};
    plan.forEach((role, i) => {
      if (cache[role]) {
        const dupe = Song.createSection(JSON.parse(JSON.stringify(cache[role])));
        dupe.id = Song.newId('sec');
        song.sections.push(dupe);
        return;
      }
      const secFeeling = role === 'chorus' ? chorusFeeling : F().contrastFor(feelingId, role);
      const section = F().generateSectionSpec(song, role, role === 'chorus' ? chorusFeeling : (role === 'bridge' ? secFeeling : feelingId), seedNum + i * 37);
      if (role === 'verse') Song.setProgression(section, verse.chords);
      else if (role === 'chorus') Song.setProgression(section, chorus.chords);
      else if (role === 'intro') Song.setProgression(section, verse.chords.slice(0, 2));
      else if (role === 'outro') Song.setProgression(section, chorus.chords.slice(-2));
      cache[role] = section;
      song.sections.push(section);
    });
    Song.autoNameSections(song);
    return song;
  }

  function stats() {
    const moves = new Set();
    corpusLoops().forEach(loop => {
      const roots = rootsOf(loop);
      roots.forEach((r, i) => moves.add(r + '>' + roots[(i + 1) % roots.length]));
    });
    return {
      taught: songs.length,
      library: library().length,
      words: vocabulary().filter(v => Object.keys(v.feelings).length).length,
      moves: moves.size,
    };
  }

  configure({});

  global.Muse = {
    configure, load,
    all, get, find, knows, teach, update, forget, clear,
    preview, chordsText,
    exportJSON, importJSON,
    vocabulary, hear, similar,
    draft, draftSong, corpusLoops, stats,
  };
})(typeof window !== 'undefined' ? window : globalThis);
