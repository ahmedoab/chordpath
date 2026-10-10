/* ChordPath — song.js
 * The project model: a Song holds ordered Sections, each with its own
 * feeling, progression, arrangement, and instrument roster. Chord objects are
 * never persisted — sections store "root:quality" specs and rebuild through
 * Chords.buildChord, matching the app-wide convention.
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
      beatsPerChord: 4,
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
      feelingId: 'nostalgic',
      energy: 'mid',
      key: 'C',
      scale: 'major',
      tempo: 100,
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
  function sectionFeeling(song, section) { return (section && section.feelingId) || song.feelingId; }

  function getSection(song, sectionId) {
    return (song.sections || []).find(s => s.id === sectionId) || null;
  }

  // Rebuild chord objects (with roman numerals) from a section's specs.
  function chordsOf(song, section) {
    const C = global.Chords;
    const key = sectionKey(song, section);
    const preferFlats = key.includes('b');
    return (section.progSpecs || []).map(spec => {
      const ch = C.chordFromSpec(spec, preferFlats);
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

  function sectionBeats(section) {
    return (section.progSpecs || []).length * (section.beatsPerChord || 4) * (section.repeat || 1);
  }

  function sectionBars(section) {
    return Math.max(1, Math.round(sectionBeats(section) / 4));
  }

  function songDurationSec(song) {
    return song.sections.reduce((sum, sec) =>
      sum + sectionBeats(sec) * (60 / sectionTempo(song, sec)), 0);
  }

  // ── Playback assembly ─────────────────────────────────────────────────────
  // One playback item per section, in the shape audio.playSong consumes.
  function buildPlayback(song) {
    const A = global.Arrangements;
    const M = global.Melody;
    return song.sections
      .filter(sec => (sec.progSpecs || []).length > 0)
      .map(sec => {
        const chords = chordsOf(song, sec);
        const key = sectionKey(song, sec);
        const vocalPat = A.byId(A.VOCAL_MELODIES, sec.vocalPattern);
        const underPat = A.byId(A.UNDER_MELODIES, sec.underPattern);
        const melody = sec.vocalPattern
          ? M.generatePatternMelody(chords, song.scale, key, vocalPat,
              { beatsPerChord: sec.beatsPerChord, section: sec.role, seed: sec.melodySeed })
          : [];
        const under = underPat && underPat.type !== 'none'
          ? M.generateUnderMelody(chords, song.scale, key, underPat,
              { beatsPerChord: sec.beatsPerChord, seed: sec.underSeed })
          : [];
        return {
          sectionId: sec.id,
          name: sec.name,
          role: sec.role,
          chords,
          melody,
          under,
          pattern: A.makePlaybackPattern(sec.rhythmPattern, sec.drumPattern),
          tempo: sectionTempo(song, sec),
          beatsPerChord: sec.beatsPerChord || 4,
          repeat: sec.repeat || 1,
          levels: sec.levels || { chords: 100, bass: 100, drums: 100, melody: 100 },
          tones: {
            texture: sec.textureTone,
            drums: sec.drumTone,
            melody: sec.melodyTone,
          },
        };
      });
  }

  // ── Validation / migration / serialisation ────────────────────────────────
  function validate(raw) {
    const errors = [];
    if (!raw || typeof raw !== 'object') return { ok: false, errors: ['not an object'] };
    if (!raw.title || typeof raw.title !== 'string') errors.push('missing title');
    if (!Array.isArray(raw.sections)) errors.push('missing sections array');
    else {
      raw.sections.forEach((sec, i) => {
        if (!sec || typeof sec !== 'object') { errors.push(`section ${i} not an object`); return; }
        if (!Array.isArray(sec.progSpecs)) errors.push(`section ${i} missing progSpecs`);
        else if (!sec.progSpecs.every(sp => typeof sp === 'string' && sp.length > 0)) {
          errors.push(`section ${i} has invalid chord specs`);
        }
        if (sec.role && !ROLES.includes(sec.role)) errors.push(`section ${i} unknown role "${sec.role}"`);
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
    raw = raw || {};

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
      return song;
    }

    // v2 (possibly partial): overlay onto fresh defaults so new fields appear.
    const song = createSong({});
    for (const k of Object.keys(raw)) {
      if (k === 'sections') continue;
      song[k] = raw[k];
    }
    song.schemaVersion = SCHEMA_VERSION;
    song.sections = (raw.sections || []).map(sec => createSection(sec));
    song.progress = Object.assign(
      { writing: false, arrangement: false, recording: false, mixing: false },
      raw.progress || {});
    return song;
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
    touch, getSection, sectionKey, sectionTempo, sectionFeeling,
    chordsOf, setProgression, autoNameSections,
    sectionBeats, sectionBars, songDurationSec,
    buildPlayback,
    validate, migrate, serialize, deserialize,
  };
})(typeof window !== 'undefined' ? window : globalThis);
