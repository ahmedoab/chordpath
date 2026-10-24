/* ChordPath — song.js
 * The project model: a Song holds ordered Sections, each with its own
 * feeling, progression, arrangement, and instrument roster. Chord objects are
 * never persisted — sections store "root:quality" specs and rebuild through
 * Chords.buildChord, matching the app-wide convention.
 *
 * A song has a key and a time signature that its sections follow unless one
 * has its own. A chord lasts a bar of its section's time unless the section
 * says otherwise (beatsPerChord, in quarter-note beats).
 */
(function (global) {
  'use strict';

  const SCHEMA_VERSION = 2;

  const ROLES = ['intro', 'verse', 'prechorus', 'chorus', 'bridge', 'outro'];

  const PROGRESS_STEPS = [
    { id:'writing',     name:'Writing',     tip:'Chords, structure, and melodies sketched for every section.' },
    { id:'arrangement', name:'Arrangement', tip:'Instrument roster picked per section; density feels balanced.' },
    { id:'recording',   name:'Recording',   tip:'All parts tracked in your DAW (see the Studio recording guides).' },
    { id:'mixing',      name:'Mixing',      tip:'Levels, EQ, and effects set (see the Studio mix chains).' },
  ];

  function newId(prefix) {
    return prefix + '_' + Date.now().toString(36) +
      Math.floor(Math.random() * 1296).toString(36).padStart(2, '0');
  }

  function nowISO() { return new Date().toISOString(); }

  function createSection(partial) {
    partial = partial || {};
    return Object.assign({
      id: newId('sec'),
      role: 'verse',
      name: 'Verse',
      feelingId: null,          // null = inherit song.feelingId
      beatsPerChord: null,      // quarter beats; null = a bar of the section's time
      repeat: 1,
      progSpecs: [],
      rhythmPattern: '',
      drumPattern: '',
      vocalPattern: '',
      underPattern: 'none',
      textureTone: 'clean',
      drumTone: 'dry',
      melodyTone: 'soft',
      levels: { chords: 100, bass: 100, drums: 100, melody: 100 },
      melodySeed: 1,
      underSeed: 1,
      roster: [],
      keyOverride: null,
      tempoOverride: null,
      meterOverride: null,      // { num, den }; null = the song's time
      notes: '',
    }, partial);
  }

  function createSong(partial) {
    partial = partial || {};
    const t = nowISO();
    return Object.assign({
      schemaVersion: SCHEMA_VERSION,
      id: newId('song'),
      title: 'Untitled song',
      genreId: 'pop',
      feelingId: null,          // a feeling to aim for, if the writer has one in mind
      energy: 'mid',
      key: 'C',
      scale: 'major',
      tempo: 100,
      meter: { num: 4, den: 4 },
      sections: [],
      progress: { writing: false, arrangement: false, recording: false, mixing: false },
      notes: '',
      createdAt: t,
      updatedAt: t,
    }, partial);
  }

  function touch(song) { song.updatedAt = nowISO(); return song; }

  function sectionKey(song, section) { return (section && section.keyOverride) || song.key; }
  function sectionTempo(song, section) { return (section && section.tempoOverride) || song.tempo; }
  function sectionFeeling(song, section) { return (section && section.feelingId) || song.feelingId || null; }

  // ── Time signatures ──────────────────────────────────────────────────────
  // theory/meters.js knows them in full; these few sums stand in for it where it is not loaded.
  function readMeter(value) {
    if (global.Meters) return global.Meters.parse(value);
    let num, den;
    if (value && typeof value === 'object') { num = value.num; den = value.den; }
    else if (typeof value === 'string' && /^\s*\d{1,2}\s*\/\s*\d{1,2}\s*$/.test(value)) { [num, den] = value.split('/').map(v => parseInt(v, 10)); }
    return Number.isInteger(num) && num >= 1 && num <= 32 && [2, 4, 8, 16].includes(den) ? { num, den } : null;
  }
  function barQuarters(meter) { const m = readMeter(meter) || { num: 4, den: 4 }; return m.num * 4 / m.den; }
  function sectionMeter(song, section) {
    return readMeter(section && section.meterOverride) || readMeter(song && song.meter) || { num: 4, den: 4 };
  }
  // How many quarter beats each chord of the section lasts.
  function chordBeats(song, section) {
    return (section && section.beatsPerChord) || barQuarters(sectionMeter(song, section));
  }

  function getSection(song, sectionId) {
    return (song.sections || []).find(s => s.id === sectionId) || null;
  }

  // Rebuild chord objects (with roman numerals) from a section's specs.
  function chordsOf(song, section) {
    const C = global.Chords;
    const key = sectionKey(song, section);
    const preferFlats = key.includes('b');
    return (section.progSpecs || []).map(spec => {
      // A chord written with its own accidental keeps that spelling.
      const own = spec.charAt(1);
      const ch = C.chordFromSpec(spec, own === 'b' ? true : own === '#' ? false : preferFlats);
      ch.roman = C.romanNumeral(ch, key, song.scale);
      return ch;
    });
  }

  function setProgression(section, chords) {
    section.progSpecs = (chords || []).map(c => `${c.root}:${c.quality}`);
  }

  // Auto-name sections: "Verse 1", "Verse 2", "Chorus 1", ...
  function autoNameSections(song) {
    const counts = {};
    for (const sec of song.sections) {
      counts[sec.role] = (counts[sec.role] || 0) + 1;
    }
    const seen = {};
    for (const sec of song.sections) {
      const A = global.Arrangements;
      const roleName = A ? A.byId(A.SECTIONS, sec.role).name : sec.role;
      seen[sec.role] = (seen[sec.role] || 0) + 1;
      sec.name = counts[sec.role] > 1 ? `${roleName} ${seen[sec.role]}` : roleName;
    }
  }

  // With the song given, the section's own time decides how long a chord and a bar are.
  function sectionBeats(section, song) {
    const each = song ? chordBeats(song, section) : (section.beatsPerChord || 4);
    return (section.progSpecs || []).length * each * (section.repeat || 1);
  }

  function sectionBars(section, song) {
    const bar = song ? barQuarters(sectionMeter(song, section)) : 4;
    return Math.max(1, Math.round(sectionBeats(section, song) / bar));
  }

  function songDurationSec(song) {
    return song.sections.reduce((sum, sec) =>
      sum + sectionBeats(sec, song) * (60 / sectionTempo(song, sec)), 0);
  }

  // ── Playback assembly ─────────────────────────────────────────────────────
  // What one section plays, in the shape audio.playSong consumes.
  function playbackItem(song, sec) {
    const A = global.Arrangements;
    const M = global.Melody;
    const chords = chordsOf(song, sec);
    const key = sectionKey(song, sec);
    const meter = sectionMeter(song, sec);
    const beatsPerChord = chordBeats(song, sec);
    const vocalPat = A.vocalFor(sec.vocalPattern);
    const underPat = A.underFor(sec.underPattern);
    const melody = vocalPat
      ? M.generatePatternMelody(chords, song.scale, key, vocalPat,
          { beatsPerChord, section: sec.role, seed: sec.melodySeed })
      : [];
    const under = underPat
      ? M.generateUnderMelody(chords, song.scale, key, underPat,
          { beatsPerChord, seed: sec.underSeed })
      : [];
    return {
      sectionId: sec.id,
      name: sec.name,
      role: sec.role,
      chords,
      melody,
      under,
      pattern: A.makePlaybackPattern(sec.rhythmPattern, sec.drumPattern, meter),
      tempo: sectionTempo(song, sec),
      meter,
      beatsPerChord,
      stepsPerChord: Math.round(beatsPerChord * 4),
      repeat: sec.repeat || 1,
      levels: sec.levels || { chords: 100, bass: 100, drums: 100, melody: 100 },
      tones: {
        texture: sec.textureTone,
        drums: sec.drumTone,
        melody: sec.melodyTone,
      },
    };
  }

  // One playback item per section that has chords.
  function buildPlayback(song) {
    return song.sections
      .filter(sec => (sec.progSpecs || []).length > 0)
      .map(sec => playbackItem(song, sec));
  }

  // ── Sanitising ────────────────────────────────────────────────────────────
  // Songs arrive from files, old saves, and share links, so nothing about
  // their shape can be trusted. Every load path runs through migrate(), which
  // coerces each field to its type and range here; views can then assume
  // numbers are numbers and strings are bounded.
  const LIMITS = {
    sections: 128, chords: 64, roster: 40,
    title: 120, name: 60, id: 64, token: 40, notes: 8000,
    repeat: 16, beatsPerChord: 24,
  };
  const SPEC_RE = /^[A-G][#b]?:[A-Za-z0-9_/]{1,12}$/;
  const NOTE_RE = /^[A-G][#b]?$/;
  const ID_RE = /^[A-Za-z0-9_-]+$/;
  // Assigning these from parsed JSON would swap the object's prototype.
  const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

  function cleanNum(v, lo, hi, fallback) {
    if (typeof v !== 'number' && typeof v !== 'string') return fallback;
    const n = typeof v === 'string' && v.trim() === '' ? NaN : Number(v);
    return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : fallback;
  }
  function cleanInt(v, lo, hi, fallback) {
    const n = cleanNum(v, lo, hi, null);
    return n === null ? fallback : Math.round(n);
  }
  function cleanStr(v, max, fallback) {
    return typeof v === 'string' ? v.slice(0, max) : fallback;
  }
  function cleanId(v, prefix) {
    return typeof v === 'string' && v.length <= LIMITS.id && ID_RE.test(v) ? v : newId(prefix);
  }
  function cleanNote(v, fallback) {
    return typeof v === 'string' && NOTE_RE.test(v) ? v : fallback;
  }
  // Fields the model does not know: keep simple values so a newer save
  // survives a round trip, drop anything structured.
  function carryUnknown(target, raw, known) {
    for (const k of Object.keys(raw)) {
      if (known.has(k) || UNSAFE_KEYS.has(k) || k.length > LIMITS.token) continue;
      const v = raw[k];
      if (v === null || typeof v === 'boolean') target[k] = v;
      else if (typeof v === 'number' && Number.isFinite(v)) target[k] = v;
      else if (typeof v === 'string') target[k] = v.slice(0, LIMITS.notes);
    }
  }

  const SECTION_KEYS = new Set(Object.keys(createSection({})));

  function sanitizeSection(raw) {
    raw = raw && typeof raw === 'object' ? raw : {};
    const d = createSection({});
    const role = ROLES.includes(raw.role) ? raw.role : d.role;
    const levels = raw.levels && typeof raw.levels === 'object' ? raw.levels : {};
    const sec = {
      id: cleanId(raw.id, 'sec'),
      role,
      name: cleanStr(raw.name, LIMITS.name, '') || role.charAt(0).toUpperCase() + role.slice(1),
      feelingId: typeof raw.feelingId === 'string' && raw.feelingId ? raw.feelingId.slice(0, LIMITS.token) : null,
      // In half beats, so a chord can fill a bar of 7/8; none given means a bar of the section's time.
      beatsPerChord: (() => {
        const n = cleanNum(raw.beatsPerChord, -Infinity, Infinity, null);
        return n === null || n <= 0 ? null : Math.round(Math.min(LIMITS.beatsPerChord, Math.max(0.5, n)) * 2) / 2;
      })(),
      repeat: cleanInt(raw.repeat, 1, LIMITS.repeat, d.repeat),
      progSpecs: (Array.isArray(raw.progSpecs) ? raw.progSpecs : [])
        .filter(sp => typeof sp === 'string' && SPEC_RE.test(sp))
        .slice(0, LIMITS.chords),
      rhythmPattern: cleanStr(raw.rhythmPattern, LIMITS.token, d.rhythmPattern),
      drumPattern: cleanStr(raw.drumPattern, LIMITS.token, d.drumPattern),
      vocalPattern: cleanStr(raw.vocalPattern, LIMITS.token, d.vocalPattern),
      underPattern: cleanStr(raw.underPattern, LIMITS.token, d.underPattern),
      textureTone: cleanStr(raw.textureTone, LIMITS.token, d.textureTone),
      drumTone: cleanStr(raw.drumTone, LIMITS.token, d.drumTone),
      melodyTone: cleanStr(raw.melodyTone, LIMITS.token, d.melodyTone),
      levels: {
        chords: cleanInt(levels.chords, 0, 100, 100),
        bass: cleanInt(levels.bass, 0, 100, 100),
        drums: cleanInt(levels.drums, 0, 100, 100),
        melody: cleanInt(levels.melody, 0, 100, 100),
      },
      melodySeed: cleanInt(raw.melodySeed, 0, 0x7fffffff, d.melodySeed),
      underSeed: cleanInt(raw.underSeed, 0, 0x7fffffff, d.underSeed),
      roster: (Array.isArray(raw.roster) ? raw.roster : [])
        .filter(id => typeof id === 'string' && id.length > 0 && id.length <= LIMITS.token)
        .slice(0, LIMITS.roster),
      keyOverride: cleanNote(raw.keyOverride, null),
      tempoOverride: raw.tempoOverride == null ? null : cleanInt(raw.tempoOverride, 20, 300, null),
      meterOverride: readMeter(raw.meterOverride),
      notes: cleanStr(raw.notes, LIMITS.notes, ''),
    };
    carryUnknown(sec, raw, SECTION_KEYS);
    return sec;
  }

  const SONG_KEYS = new Set(Object.keys(createSong({})));

  function sanitizeSong(raw) {
    raw = raw && typeof raw === 'object' ? raw : {};
    const d = createSong({});
    const S = global.Scales;
    const progress = raw.progress && typeof raw.progress === 'object' ? raw.progress : {};
    const song = {
      schemaVersion: SCHEMA_VERSION,
      id: cleanId(raw.id, 'song'),
      title: cleanStr(raw.title, LIMITS.title, '') || d.title,
      genreId: cleanStr(raw.genreId, LIMITS.token, d.genreId),
      feelingId: cleanStr(raw.feelingId, LIMITS.token, d.feelingId) || null,
      energy: ['low', 'mid', 'high'].includes(raw.energy) ? raw.energy : d.energy,
      key: cleanNote(raw.key, d.key),
      scale: typeof raw.scale === 'string' && (!S || S.SCALES[raw.scale]) ? raw.scale : d.scale,
      tempo: cleanInt(raw.tempo, 20, 300, d.tempo),
      meter: readMeter(raw.meter) || { num: 4, den: 4 },
      sections: (Array.isArray(raw.sections) ? raw.sections : [])
        .slice(0, LIMITS.sections).map(sanitizeSection),
      progress: {
        writing: progress.writing === true,
        arrangement: progress.arrangement === true,
        recording: progress.recording === true,
        mixing: progress.mixing === true,
      },
      notes: cleanStr(raw.notes, LIMITS.notes, ''),
      createdAt: cleanStr(raw.createdAt, LIMITS.token, d.createdAt),
      updatedAt: cleanStr(raw.updatedAt, LIMITS.token, d.updatedAt),
    };
    carryUnknown(song, raw, SONG_KEYS);
    return song;
  }

  // ── Validation / migration / serialisation ────────────────────────────────
  function validate(raw) {
    const errors = [];
    if (!raw || typeof raw !== 'object') return { ok: false, errors: ['not an object'] };
    if (!raw.title || typeof raw.title !== 'string') errors.push('missing title');
    if (!Array.isArray(raw.sections)) errors.push('missing sections array');
    else if (raw.sections.length > LIMITS.sections) {
      errors.push(`too many sections (${raw.sections.length}, the limit is ${LIMITS.sections})`);
    } else {
      raw.sections.forEach((sec, i) => {
        if (!sec || typeof sec !== 'object') { errors.push(`section ${i} not an object`); return; }
        if (!Array.isArray(sec.progSpecs)) errors.push(`section ${i} missing progSpecs`);
        else if (sec.progSpecs.length > LIMITS.chords) {
          errors.push(`section ${i} has too many chords (${sec.progSpecs.length}, the limit is ${LIMITS.chords})`);
        } else if (!sec.progSpecs.every(sp => typeof sp === 'string' && sp.length > 0)) {
          errors.push(`section ${i} has invalid chord specs`);
        }
        if (sec.role && !ROLES.includes(sec.role)) {
          errors.push(`section ${i} unknown role "${String(sec.role).slice(0, LIMITS.token)}"`);
        }
      });
    }
    if (raw.key && typeof raw.key !== 'string') errors.push('invalid key');
    if (raw.tempo != null && (typeof raw.tempo !== 'number' || raw.tempo < 20 || raw.tempo > 300)) {
      errors.push('tempo out of range');
    }
    return { ok: errors.length === 0, errors };
  }

  // Bring any raw object (v1 legacy flat save, partial v2, future minor
  // additions) up to the current schema. Always returns a fresh object.
  function migrate(raw) {
    raw = raw && typeof raw === 'object' ? raw : {};

    // v1 legacy: the flat single-section shape from the old localStorage
    // format ({key, scale, progSpecs, focusStyle, sectionRole, ...}).
    if (!raw.schemaVersion && Array.isArray(raw.progSpecs)) {
      const A = global.Arrangements;
      const genreId = raw.focusStyle || 'shoegaze';
      const profile = A ? A.profileFor(genreId) : null;
      const section = createSection({
        role: ROLES.includes(raw.sectionRole) ? raw.sectionRole : 'verse',
        progSpecs: raw.progSpecs.slice(),
        rhythmPattern: raw.rhythmPattern || (profile ? profile.defaultRhythm : ''),
        drumPattern: raw.drumPattern || (profile ? profile.defaultDrums : ''),
        vocalPattern: raw.vocalPattern || (profile ? profile.defaultVocal : ''),
        underPattern: raw.underPattern || (profile ? profile.defaultUnder : 'none'),
        textureTone: raw.textureTone || (profile ? profile.defaultTextureTone : 'clean'),
        drumTone: raw.drumTone || (profile ? profile.defaultDrumTone : 'dry'),
        melodyTone: raw.melodyTone || (profile ? profile.defaultMelodyTone : 'soft'),
        levels: {
          chords: raw.chordLevel != null ? raw.chordLevel : 100,
          bass: raw.bassLevel != null ? raw.bassLevel : 100,
          drums: raw.drumLevel != null ? raw.drumLevel : 100,
          melody: raw.melodyLevel != null ? raw.melodyLevel : 100,
        },
      });
      const song = createSong({
        title: raw.name || 'Imported sketch',
        genreId,
        feelingId: 'wistful',
        key: raw.key || 'C',
        scale: raw.scale || 'major',
        tempo: profile ? profile.defaultTempo : 100,
        sections: [section],
      });
      autoNameSections(song);
      if (raw.savedAt) song.createdAt = raw.savedAt;
      return sanitizeSong(song);
    }

    // v2 (possibly partial): rebuilt field by field onto fresh defaults, so
    // new fields appear and nothing malformed survives the load.
    return sanitizeSong(raw);
  }

  function serialize(song) {
    return JSON.stringify({ format: 'chordpath-song', schemaVersion: SCHEMA_VERSION, song }, null, 2);
  }

  function deserialize(json) {
    let parsed;
    try { parsed = JSON.parse(json); }
    catch (e) { return { song: null, errors: ['not valid JSON: ' + e.message] }; }
    const raw = parsed && parsed.format === 'chordpath-song' ? parsed.song : parsed;
    const v = validate(raw);
    if (!v.ok) return { song: null, errors: v.errors };
    const song = migrate(raw);
    return { song, errors: [] };
  }

  global.Song = {
    SCHEMA_VERSION, ROLES, PROGRESS_STEPS,
    newId, createSong, createSection,
    touch, getSection, sectionKey, sectionTempo, sectionFeeling, sectionMeter, chordBeats, barQuarters,
    chordsOf, setProgression, autoNameSections,
    sectionBeats, sectionBars, songDurationSec,
    playbackItem, buildPlayback,
    validate, migrate, serialize, deserialize,
  };
})(typeof window !== 'undefined' ? window : globalThis);
