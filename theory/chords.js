/* ChordPath — chords.js
 * Chord construction, naming (full + short + symbol), interval patterns,
 * voicings (root position + smart voice-leading), inversions, and
 * Roman-numeral analysis given a key.
 */
(function (global) {
  'use strict';

  const S = global.Scales;

  // ── Chord quality interval recipes (from root, in semitones) ────────────
  const QUALITIES = {
    // Triads
    maj:    { intervals:[0,4,7],           full:'major',         short:'',       symbol:'' },
    m:      { intervals:[0,3,7],           full:'minor',         short:'m',      symbol:'m' },
    dim:    { intervals:[0,3,6],           full:'diminished',    short:'°',      symbol:'°' },
    aug:    { intervals:[0,4,8],           full:'augmented',     short:'+',      symbol:'+' },
    sus2:   { intervals:[0,2,7],           full:'sus 2',         short:'sus2',   symbol:'sus2' },
    sus4:   { intervals:[0,5,7],           full:'sus 4',         short:'sus4',   symbol:'sus4' },
    pow:    { intervals:[0,7],             full:'power chord',   short:'5',      symbol:'5' },

    // Sevenths
    maj7:   { intervals:[0,4,7,11],        full:'major 7',       short:'maj7',   symbol:'Δ7' },
    m7:     { intervals:[0,3,7,10],        full:'minor 7',       short:'m7',     symbol:'m7' },
    '7':    { intervals:[0,4,7,10],        full:'dominant 7',    short:'7',      symbol:'7' },
    m7b5:   { intervals:[0,3,6,10],        full:'half-diminished 7', short:'m7♭5', symbol:'ø7' },
    dim7:   { intervals:[0,3,6,9],         full:'diminished 7',  short:'°7',     symbol:'°7' },
    mMaj7:  { intervals:[0,3,7,11],        full:'minor-major 7', short:'mMaj7',  symbol:'mΔ7' },
    '7sus4':{ intervals:[0,5,7,10],        full:'7 sus 4',       short:'7sus4',  symbol:'7sus4' },
    augMaj7:{ intervals:[0,4,8,11],        full:'augmented major 7', short:'+Maj7', symbol:'+Δ7' },
    '7b5':  { intervals:[0,4,6,10],        full:'dominant 7 ♭5', short:'7♭5',    symbol:'7♭5' },
    '7s5':  { intervals:[0,4,8,10],        full:'dominant 7 ♯5', short:'7♯5',    symbol:'7♯5' },

    // Sixths
    '6':    { intervals:[0,4,7,9],         full:'6',             short:'6',      symbol:'6' },
    m6:     { intervals:[0,3,7,9],         full:'minor 6',       short:'m6',     symbol:'m6' },
    '6/9':  { intervals:[0,4,7,9,14],      full:'6/9',           short:'6/9',    symbol:'6/9' },

    // Extended (9, 11, 13)
    maj9:   { intervals:[0,4,7,11,14],     full:'major 9',       short:'maj9',   symbol:'Δ9' },
    '9':    { intervals:[0,4,7,10,14],     full:'dominant 9',    short:'9',      symbol:'9' },
    m9:     { intervals:[0,3,7,10,14],     full:'minor 9',       short:'m9',     symbol:'m9' },
    mMaj9:  { intervals:[0,3,7,11,14],     full:'minor-major 9', short:'mMaj9',  symbol:'mΔ9' },
    '11':   { intervals:[0,4,7,10,14,17],  full:'dominant 11',   short:'11',     symbol:'11' },
    m11:    { intervals:[0,3,7,10,14,17],  full:'minor 11',      short:'m11',    symbol:'m11' },
    'maj7s11':{ intervals:[0,4,7,11,18],   full:'major 7 ♯11',   short:'maj7♯11', symbol:'Δ7♯11' },
    '13':   { intervals:[0,4,7,10,14,21],  full:'dominant 13',   short:'13',     symbol:'13' },
    m13:    { intervals:[0,3,7,10,14,21],  full:'minor 13',      short:'m13',    symbol:'m13' },
    maj13:  { intervals:[0,4,7,11,14,21],  full:'major 13',      short:'maj13',  symbol:'Δ13' },

    // Altered dominants
    '7b9':  { intervals:[0,4,7,10,13],     full:'dominant 7 ♭9', short:'7♭9',    symbol:'7♭9' },
    '7s9':  { intervals:[0,4,7,10,15],     full:'dominant 7 ♯9', short:'7♯9',    symbol:'7♯9' },
    '7s11': { intervals:[0,4,7,10,18],     full:'dominant 7 ♯11',short:'7♯11',   symbol:'7♯11' },
    '7alt': { intervals:[0,4,8,10,13,15],  full:'dominant 7 altered', short:'7alt', symbol:'7alt' },
    '13b9': { intervals:[0,4,7,10,13,21],  full:'13 ♭9',         short:'13♭9',   symbol:'13♭9' },

    // Added tones
    add9:   { intervals:[0,4,7,14],        full:'add 9',         short:'add9',   symbol:'add9' },
    madd9:  { intervals:[0,3,7,14],        full:'minor add 9',   short:'m(add9)', symbol:'m(add9)' },
    add11:  { intervals:[0,4,7,17],        full:'add 11',        short:'add11',  symbol:'add11' },

    // Quartal / specials
    quartal:{ intervals:[0,5,10],          full:'quartal',       short:'4ths',   symbol:'4ths' },
    so_what:{ intervals:[0,5,10,15,19],    full:'So-What voicing', short:'So-What', symbol:'So-What' },
  };

  // Map of "scale degree symbol" → semitones-from-tonic.
  // Used by chord-pool entries and progression code.
  const DEGREE_TO_SEMI = {
    '1':0, 'b2':1, '2':2, '#2':3, 'b3':3, '3':4, '4':5, '#4':6, 'b5':6,
    '5':7, '#5':8, 'b6':8, '6':9, 'b7':10, '7':11,
  };

  // Reverse map for chord interval set → quality detection (best-effort)
  function detectQuality(intervalSet) {
    // intervalSet: sorted array of semitones from root (0..)
    const sig = intervalSet.slice().sort((a,b)=>a-b).join(',');
    for (const [q, def] of Object.entries(QUALITIES)) {
      if (def.intervals.slice().sort((a,b)=>a-b).join(',') === sig) return q;
    }
    // Loose: match triad subset
    const has = n => intervalSet.includes(n);
    if (has(0)&&has(3)&&has(6)&&has(10)) return 'm7b5';
    if (has(0)&&has(4)&&has(7)&&has(10)) return '7';
    if (has(0)&&has(4)&&has(7)&&has(11)) return 'maj7';
    if (has(0)&&has(3)&&has(7)&&has(10)) return 'm7';
    if (has(0)&&has(3)&&has(6)&&has(9))  return 'dim7';
    if (has(0)&&has(4)&&has(7))          return 'maj';
    if (has(0)&&has(3)&&has(7))          return 'm';
    if (has(0)&&has(3)&&has(6))          return 'dim';
    if (has(0)&&has(4)&&has(8))          return 'aug';
    return 'maj';
  }

  // ── Build a chord object ─────────────────────────────────────────────────
  function buildChord(rootName, quality, opts) {
    opts = opts || {};
    const q = QUALITIES[quality] || QUALITIES.maj;
    const rootIdx = S.noteIndex(rootName);
    const preferFlats = opts.preferFlats != null ? opts.preferFlats : (rootName.includes('b'));

    const intervals = q.intervals.slice();
    const notes = intervals.map(iv => S.noteName(rootIdx + iv, preferFlats));

    const displayRoot = S.noteName(rootIdx, preferFlats);
    const fullName = displayRoot + (q.full === '' ? '' : ' ' + q.full);
    const shortName = displayRoot + q.short;
    const symbol = displayRoot + q.symbol;

    return {
      root: displayRoot,
      rootPc: rootIdx,
      quality,
      qualityFull: q.full,
      intervals,
      notes,
      fullName,
      shortName,
      symbol,
      bass: opts.bass || null,
      category: opts.category || 'diatonic', // diatonic | borrowed | secondary | tt-sub | dim-passing | chromatic | neapolitan | aug6
      categoryNote: opts.categoryNote || '', // e.g. "V7/ii"
      preferFlats,
    };
  }

  // ── Voicings ─────────────────────────────────────────────────────────────
  // Root-position voicing in an octave range [startOct..startOct+1]
  function rootPositionVoicing(chord, startOct) {
    startOct = startOct == null ? 4 : startOct;
    return chord.intervals.map(iv => {
      const pc = (chord.rootPc + iv) % 12;
      const oct = startOct + Math.floor((chord.rootPc + iv) / 12);
      // Pin root to startOct, others stack upward chromatically
      return S.noteName(pc, chord.preferFlats) + oct;
    });
  }

  // Smart voicing: minimise total semitone movement from previous voicing.
  // Considers inversions / octave adjustments of each note.
  function smartVoicing(chord, previousVoicedNotes, startOct) {
    startOct = startOct == null ? 4 : startOct;
    if (!previousVoicedNotes || previousVoicedNotes.length === 0) {
      return rootPositionVoicing(chord, startOct);
    }
    const prevPitches = previousVoicedNotes.map(noteNameToPitch);
    // For each chord tone, pick the octave that's nearest to *any* prev pitch
    const voiced = [];
    for (const iv of chord.intervals) {
      const pc = (chord.rootPc + iv) % 12;
      // candidate octaves
      let best = null, bestDist = Infinity;
      for (let oct = 2; oct <= 6; oct++) {
        const midi = pc + (oct+1)*12; // MIDI numbering: C-1=0, so C4=60
        const dist = Math.min(...prevPitches.map(p => Math.abs(p - midi)));
        if (dist < bestDist) { bestDist = dist; best = oct; }
      }
      voiced.push(S.noteName(pc, chord.preferFlats) + best);
    }
    // Sort low-to-high for clarity
    voiced.sort((a,b)=>noteNameToPitch(a)-noteNameToPitch(b));
    return voiced;
  }

  function noteNameToPitch(noteOct) {
    const m = noteOct.match(/^([A-G][#b]?)(-?\d+)$/);
    if (!m) return 60;
    const pc = S.noteIndex(m[1]);
    const oct = parseInt(m[2], 10);
    return pc + (oct+1) * 12;
  }

  // ── Diatonic chord generator ─────────────────────────────────────────────
  // For heptatonic scales, build a 4-note diatonic chord on each degree by
  // stacking thirds within the scale, then detect quality.
  function diatonicChords(key, scaleId, opts) {
    opts = opts || {};
    const includeSevenths = opts.sevenths !== false;
    const intervals = S.getIntervals(scaleId);
    const meta = S.getScaleMeta(scaleId);
    const preferFlats = S.FLAT_KEYS.has(key) || key.includes('b');
    const rootIdx = S.noteIndex(key);

    if (!meta) return [];

    // Heptatonic path
    if (intervals.length === 7) {
      const chords = [];
      for (let i = 0; i < 7; i++) {
        const degRoot = intervals[i];
        const setIntervals = [0, 2, 4, 6].map(off => {
          // stack thirds within the scale: scale-degree i, i+2, i+4, i+6 (mod 7)
          const d = intervals[(i + off) % 7] + (i + off >= 7 ? 12 : 0);
          return (d - degRoot + 12) % 12;
        });
        const triad = setIntervals.slice(0, 3);
        const seventh = setIntervals.slice(0, 4);
        const triadQuality = detectQuality(triad);
        const seventhQuality = detectQuality(seventh);
        const useSevenths = includeSevenths;
        const quality = useSevenths ? seventhQuality : triadQuality;
        const rootName = S.noteName(rootIdx + degRoot, preferFlats);
        const chord = buildChord(rootName, quality, { preferFlats, category:'diatonic' });
        chord.scaleDegree = i + 1;
        chord.roman = romanNumeral(chord, key, scaleId);
        chords.push(chord);
      }
      return chords;
    }

    // Chord-pool path for non-heptatonic scales
    const pool = S.getChordPool(scaleId);
    if (!pool) return [];
    return pool.map(spec => {
      const [degSym, qual] = spec.split(':');
      const semi = DEGREE_TO_SEMI[degSym] != null ? DEGREE_TO_SEMI[degSym] : 0;
      const rootName = S.noteName(rootIdx + semi, preferFlats);
      const chord = buildChord(rootName, qual, { preferFlats, category:'diatonic' });
      chord.scaleDegree = degSym;
      chord.roman = romanNumeral(chord, key, scaleId);
      return chord;
    });
  }

  // ── Roman numeral analysis ───────────────────────────────────────────────
  // Given a chord and the home key (always treated as major reference unless
  // scaleId is a minor mode), produce a Roman numeral with quality suffix.
  function romanNumeral(chord, key, scaleId) {
    const rootIdx = S.noteIndex(key);
    const interval = ((chord.rootPc - rootIdx) % 12 + 12) % 12;
    // Pick the natural scale degree for this semitone in the chosen scale,
    // then qualify with flats/sharps if it's chromatic.
    const intervalsArr = S.getIntervals(scaleId);
    const heptaMode = intervalsArr.length === 7;
    const minorMode = scaleId.includes('minor') || scaleId === 'phrygian' || scaleId === 'phrygian_dom' || scaleId === 'locrian' || scaleId === 'aeolian';

    // Map degree → roman base
    const MAJOR_INT = [0,2,4,5,7,9,11];
    const MAJOR_ROM = ['I','II','III','IV','V','VI','VII'];
    let baseRom = '';
    const idxInMajor = MAJOR_INT.indexOf(interval);
    if (idxInMajor >= 0) {
      baseRom = MAJOR_ROM[idxInMajor];
    } else {
      // Try as flat-degree
      const flatMatches = { 1:'♭II', 3:'♭III', 6:'♭V', 8:'♭VI', 10:'♭VII' };
      const sharpMatches = { 1:'♯I', 3:'♯II', 6:'♯IV', 8:'♯V', 10:'♯VI' };
      baseRom = (minorMode ? flatMatches[interval] : flatMatches[interval]) || sharpMatches[interval] || '?';
    }

    // Case-fold for quality
    const isMin = chord.quality === 'm' || chord.quality === 'm7' || chord.quality === 'm9' || chord.quality === 'm11' || chord.quality === 'm13' || chord.quality === 'm6';
    const isDim = chord.quality === 'dim' || chord.quality === 'dim7' || chord.quality === 'm7b5';
    const isAug = chord.quality === 'aug' || chord.quality === 'augMaj7';

    let rom = baseRom;
    if (isMin) rom = rom.toLowerCase().replace('♭','♭');
    if (isDim) rom = rom.toLowerCase() + (chord.quality === 'm7b5' ? 'ø' : '°');
    if (isAug) rom = rom + '+';

    // Suffix for sevenths/extensions
    const q = chord.quality;
    let suffix = '';
    if (q === '7')      suffix = '7';
    else if (q === 'maj7') suffix = 'maj7';
    else if (q === 'm7')   suffix = '7';
    else if (q === 'dim7') suffix = '7';
    else if (q === 'm7b5') suffix = '7';
    else if (q === '9')    suffix = '9';
    else if (q === 'maj9') suffix = 'maj9';
    else if (q === 'm9')   suffix = '9';
    else if (q === '13')   suffix = '13';
    else if (q === '7b9')  suffix = '7♭9';
    else if (q === '7s9')  suffix = '7♯9';
    else if (q === '7s11') suffix = '7♯11';
    else if (q === '7alt') suffix = '7alt';

    return rom + suffix;
  }

  // Convenience: build chord from "root + quality" string
  function chordFromSpec(spec, preferFlats) {
    // spec like "C:maj7", "Eb:m9", "F#:7b9"
    const [root, qual] = spec.split(':');
    return buildChord(root, qual || 'maj', { preferFlats });
  }

  global.Chords = {
    QUALITIES, DEGREE_TO_SEMI,
    buildChord, chordFromSpec,
    diatonicChords, detectQuality, romanNumeral,
    rootPositionVoicing, smartVoicing,
    noteNameToPitch,
  };
})(typeof window !== 'undefined' ? window : globalThis);
