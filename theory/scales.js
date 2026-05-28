/* ChordPath — scales.js
 * Defines every supported scale: intervals from root, descriptive metadata, and
 * an entry point that builds the actual note names for a given key.
 *
 * Heptatonic scales auto-generate diatonic 7th chords by stacking thirds.
 * Non-heptatonic scales (pentatonic, blues, symmetric) supply a chord pool.
 */
(function (global) {
  'use strict';

  // ── Note system ──────────────────────────────────────────────────────────
  const NOTE_NAMES_SHARP = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  const NOTE_NAMES_FLAT  = ['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'];

  // Keys that conventionally use flats vs sharps
  const FLAT_KEYS = new Set(['F','Bb','Eb','Ab','Db','Gb','Cb','Dm','Gm','Cm','Fm','Bbm','Ebm']);

  function noteIndex(name) {
    // Accept C, C#, Db, etc. Normalize.
    name = String(name).trim();
    const sharpIdx = NOTE_NAMES_SHARP.indexOf(name);
    if (sharpIdx >= 0) return sharpIdx;
    const flatIdx = NOTE_NAMES_FLAT.indexOf(name);
    if (flatIdx >= 0) return flatIdx;
    // Try replacing unicode accidentals
    const cleaned = name.replace('♯','#').replace('♭','b');
    const a = NOTE_NAMES_SHARP.indexOf(cleaned);
    if (a >= 0) return a;
    const b = NOTE_NAMES_FLAT.indexOf(cleaned);
    if (b >= 0) return b;
    return 0;
  }

  function noteName(idx, preferFlats) {
    idx = ((idx % 12) + 12) % 12;
    return preferFlats ? NOTE_NAMES_FLAT[idx] : NOTE_NAMES_SHARP[idx];
  }

  // ── Scale catalogue ──────────────────────────────────────────────────────
  // intervals = semitones from root. 7-note scales feed the chord generator;
  // others use chordPool overrides (an array of {degree, quality}).
  // characteristicDegrees: zero-based scale-degree indices whose chord most
  // strongly reveals the mode's identity (e.g. Dorian's IV major shows the
  // natural 6; Lydian's II major shows the #4; Mixolydian's ♭VII shows the b7).
  const SCALES = {
    // Common diatonic
    major:           { name:'Major (Ionian)',  intervals:[0,2,4,5,7,9,11], mood:'bright, stable', genres:['Pop','Classical','Folk','Country'], characteristicDegrees:[0] },
    natural_minor:   { name:'Natural Minor (Aeolian)', intervals:[0,2,3,5,7,8,10], mood:'dark, melancholic', genres:['Rock','Pop','Cinematic'], characteristicDegrees:[0,5] },
    harmonic_minor:  { name:'Harmonic Minor',  intervals:[0,2,3,5,7,8,11], mood:'exotic, tense', genres:['Classical','Metal','Flamenco'], characteristicDegrees:[4] },
    melodic_minor:   { name:'Melodic Minor',   intervals:[0,2,3,5,7,9,11], mood:'smooth, bittersweet', genres:['Jazz','Cinematic'], characteristicDegrees:[0,4] },
    harmonic_major:  { name:'Harmonic Major',  intervals:[0,2,4,5,7,8,11], mood:'unusual, regal', genres:['Jazz','Classical'], characteristicDegrees:[5] },

    // Modes of major
    dorian:          { name:'Dorian',     intervals:[0,2,3,5,7,9,10], mood:'cool, funky', genres:['Jazz','Funk','Rock'], characteristicDegrees:[3] },
    phrygian:        { name:'Phrygian',   intervals:[0,1,3,5,7,8,10], mood:'spanish, dark', genres:['Flamenco','Metal'], characteristicDegrees:[1] },
    lydian:          { name:'Lydian',     intervals:[0,2,4,6,7,9,11], mood:'dreamy, floating', genres:['Cinematic','Jazz Fusion'], characteristicDegrees:[1] },
    mixolydian:      { name:'Mixolydian', intervals:[0,2,4,5,7,9,10], mood:'bluesy, dominant', genres:['Rock','Blues','Country'], characteristicDegrees:[6] },
    locrian:         { name:'Locrian',    intervals:[0,1,3,5,6,8,10], mood:'unstable, eerie', genres:['Metal','Experimental'], characteristicDegrees:[0,1] },

    // Modes of melodic minor
    dorian_b2:       { name:'Dorian ♭2', intervals:[0,1,3,5,7,9,10], mood:'tense, exotic', genres:['Jazz'], characteristicDegrees:[1] },
    lydian_aug:      { name:'Lydian Augmented', intervals:[0,2,4,6,8,9,11], mood:'mystical', genres:['Jazz','Cinematic'], characteristicDegrees:[0,4] },
    lydian_dom:      { name:'Lydian Dominant', intervals:[0,2,4,6,7,9,10], mood:'jazz-fusion bright', genres:['Fusion','Jazz'], characteristicDegrees:[1,6] },
    mixolydian_b6:   { name:'Mixolydian ♭6', intervals:[0,2,4,5,7,8,10], mood:'wistful', genres:['Jazz'], characteristicDegrees:[5] },
    locrian_nat2:    { name:'Locrian ♮2', intervals:[0,2,3,5,6,8,10], mood:'half-diminished', genres:['Jazz'], characteristicDegrees:[0] },
    altered:         { name:'Altered (Super Locrian)', intervals:[0,1,3,4,6,8,10], mood:'maximum tension', genres:['Jazz'], characteristicDegrees:[0] },

    // Modes of harmonic minor
    phrygian_dom:    { name:'Phrygian Dominant', intervals:[0,1,4,5,7,8,10], mood:'middle-eastern, dramatic', genres:['Flamenco','Metal','Klezmer'], characteristicDegrees:[0,1] },
    lydian_s2:       { name:'Lydian ♯2', intervals:[0,3,4,6,7,9,11], mood:'mysterious', genres:['Cinematic'], characteristicDegrees:[1,3] },
    ukrainian_dorian:{ name:'Ukrainian Dorian (Dorian ♯4)', intervals:[0,2,3,6,7,9,10], mood:'gypsy, plaintive', genres:['Klezmer','Eastern European'], characteristicDegrees:[3] },

    // Symmetric & special
    whole_tone:      { name:'Whole Tone', intervals:[0,2,4,6,8,10], mood:'dreamlike, floating', genres:['Impressionist','Cinematic'], characteristicDegrees:[0] },
    dim_half_whole:  { name:'Diminished (Half-Whole)', intervals:[0,1,3,4,6,7,9,10], mood:'jazzy tension', genres:['Jazz Fusion'], characteristicDegrees:[0] },
    dim_whole_half:  { name:'Diminished (Whole-Half)', intervals:[0,2,3,5,6,8,9,11], mood:'tense, symmetric', genres:['Classical','Jazz'], characteristicDegrees:[0] },
    augmented:       { name:'Augmented', intervals:[0,3,4,7,8,11], mood:'symmetric, mysterious', genres:['Jazz','Cinematic'], characteristicDegrees:[0] },

    // Pentatonic / blues
    major_pent:      { name:'Major Pentatonic', intervals:[0,2,4,7,9], mood:'cheerful, simple', genres:['Country','Folk','Pop'], characteristicDegrees:[0] },
    minor_pent:      { name:'Minor Pentatonic', intervals:[0,3,5,7,10], mood:'soulful', genres:['Blues','Rock','R&B'], characteristicDegrees:[0] },
    blues_minor:     { name:'Blues (minor)', intervals:[0,3,5,6,7,10], mood:'gritty, bluesy', genres:['Blues','Rock'], characteristicDegrees:[0,3] },
    blues_major:     { name:'Blues (major)', intervals:[0,2,3,4,7,9], mood:'rolling, country-blues', genres:['Blues','Country'], characteristicDegrees:[0] },
    hirajoshi:       { name:'Hirajoshi', intervals:[0,2,3,7,8], mood:'japanese, austere', genres:['World','Cinematic'], characteristicDegrees:[0] },
    insen:           { name:'In Sen', intervals:[0,1,5,7,10], mood:'pentatonic, eastern', genres:['World'], characteristicDegrees:[0] },

    // Bebop
    bebop_dom:       { name:'Bebop Dominant', intervals:[0,2,4,5,7,9,10,11], mood:'jazz language', genres:['Bebop','Jazz'], characteristicDegrees:[4] },
    bebop_major:     { name:'Bebop Major', intervals:[0,2,4,5,7,8,9,11], mood:'classic jazz', genres:['Bebop'], characteristicDegrees:[0] },
    bebop_dorian:    { name:'Bebop Dorian', intervals:[0,2,3,4,5,7,9,10], mood:'walking-bass jazz', genres:['Bebop'], characteristicDegrees:[0] },

    // World / exotic
    hungarian_minor: { name:'Hungarian Minor', intervals:[0,2,3,6,7,8,11], mood:'gypsy, dramatic', genres:['Eastern European','Cinematic'], characteristicDegrees:[3] },
    double_harmonic: { name:'Double Harmonic (Byzantine/Arabian)', intervals:[0,1,4,5,7,8,11], mood:'middle-eastern, ornate', genres:['Arabic','Klezmer'], characteristicDegrees:[1] },
    neapolitan_min:  { name:'Neapolitan Minor', intervals:[0,1,3,5,7,8,11], mood:'romantic, exotic', genres:['Classical'], characteristicDegrees:[1] },
    neapolitan_maj:  { name:'Neapolitan Major', intervals:[0,1,3,5,7,9,11], mood:'unusual major', genres:['Classical'], characteristicDegrees:[1] },
    persian:         { name:'Persian', intervals:[0,1,4,5,6,8,11], mood:'middle-eastern intense', genres:['World','Cinematic'], characteristicDegrees:[1] },
    enigmatic:       { name:'Enigmatic', intervals:[0,1,4,6,8,10,11], mood:'puzzling, unique', genres:['Experimental'], characteristicDegrees:[1] },
    spanish_gypsy:   { name:'Spanish Gypsy', intervals:[0,1,4,5,7,8,10], mood:'flamenco fire', genres:['Flamenco'], characteristicDegrees:[1] },
    romanian_minor:  { name:'Romanian Minor', intervals:[0,2,3,6,7,9,10], mood:'eastern european plaintive', genres:['Folk'], characteristicDegrees:[3] },
    indian_bhairav:  { name:'Bhairav (Indian)', intervals:[0,1,4,5,7,8,11], mood:'meditative, dawn raga', genres:['Indian Classical'], characteristicDegrees:[1] },
  };

  // Chord pool overrides for non-tertian scales. Triads/sevenths picked from
  // common practice with that scale even if not strictly stacked-thirds.
  const SCALE_CHORD_POOLS = {
    major_pent:  ['1:maj','1:sus2','5:sus4','2:m','6:m','5:maj','4:add9'],
    minor_pent:  ['1:m','1:m7','3:maj','4:m','4:7','5:m','5:7','b7:maj'],
    blues_minor: ['1:7','1:9','4:7','4:9','5:7','5:9','b3:maj','b7:7'],
    blues_major: ['1:7','1:6','4:7','4:9','5:7','6:m'],
    hirajoshi:   ['1:m','1:msus2','b3:maj','5:sus4'],
    insen:       ['1:m','1:sus4','b3:maj','5:m'],
    whole_tone:  ['1:aug','1:7#5','1:7b5','3:aug','3:7b5','b5:7b5','#5:aug'],
    dim_half_whole:['1:7b9','1:13b9','b3:7','b5:7','6:7'],
    dim_whole_half:['1:dim','1:dim7','b3:dim7','b5:dim7','6:dim7'],
    augmented:   ['1:aug','1:augMaj7','3:aug','b6:aug','b6:augMaj7'],
  };

  // ── Public API ───────────────────────────────────────────────────────────

  // Returns array of note names for the scale degrees in the chosen key.
  function buildScale(key, scaleId) {
    const scale = SCALES[scaleId];
    if (!scale) return [];
    const rootIdx = noteIndex(key);
    const preferFlats = FLAT_KEYS.has(key) || key.includes('b');
    return scale.intervals.map(iv => noteName(rootIdx + iv, preferFlats));
  }

  // Returns scale degrees as semitone-from-root integers.
  function getIntervals(scaleId) {
    return (SCALES[scaleId] || {intervals:[]}).intervals.slice();
  }

  function getScaleMeta(scaleId) {
    return SCALES[scaleId] || null;
  }

  function getChordPool(scaleId) {
    return SCALE_CHORD_POOLS[scaleId] || null;
  }

  function isHeptatonic(scaleId) {
    const sc = SCALES[scaleId];
    return sc ? sc.intervals.length === 7 : false;
  }

  function listScales() {
    return Object.keys(SCALES).map(id => ({ id, ...SCALES[id] }));
  }

  // Scale groups for the UI dropdown
  const SCALE_GROUPS = [
    { label:'Common', ids:['major','natural_minor','harmonic_minor','melodic_minor','harmonic_major'] },
    { label:'Modes of Major', ids:['dorian','phrygian','lydian','mixolydian','locrian'] },
    { label:'Modes of Melodic Minor', ids:['dorian_b2','lydian_aug','lydian_dom','mixolydian_b6','locrian_nat2','altered'] },
    { label:'Modes of Harmonic Minor', ids:['phrygian_dom','lydian_s2','ukrainian_dorian'] },
    { label:'Symmetric', ids:['whole_tone','dim_half_whole','dim_whole_half','augmented'] },
    { label:'Pentatonic & Blues', ids:['major_pent','minor_pent','blues_minor','blues_major','hirajoshi','insen'] },
    { label:'Bebop', ids:['bebop_dom','bebop_major','bebop_dorian'] },
    { label:'World & Exotic', ids:['hungarian_minor','double_harmonic','neapolitan_min','neapolitan_maj','persian','enigmatic','spanish_gypsy','romanian_minor','indian_bhairav'] },
  ];

  global.Scales = {
    NOTE_NAMES_SHARP, NOTE_NAMES_FLAT, FLAT_KEYS,
    noteIndex, noteName,
    buildScale, getIntervals, getScaleMeta, getChordPool, isHeptatonic, listScales,
    SCALES, SCALE_GROUPS,
  };
})(typeof window !== 'undefined' ? window : globalThis);
