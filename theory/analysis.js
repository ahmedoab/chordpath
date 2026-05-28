/* ChordPath — analysis.js
 * Real-time analysis of the user's progression:
 *   - Cadence detection (authentic, plagal, half, deceptive, phrygian, backdoor, tt-sub)
 *   - Voice-leading score and common-tone summary
 *   - Tension score per chord (dissonance + distance from tonic + alterations)
 *   - Functional label: T / PD / D / chromatic / borrowed / secondary
 *   - Pivot-chord and common-tone modulation suggestions
 */
(function (global) {
  'use strict';

  const S = global.Scales;
  const C = global.Chords;
  const P = global.Progressions;

  // ── Cadence detection ────────────────────────────────────────────────────
  function detectCadence(progression, key, scaleId) {
    if (!progression || progression.length < 2) return null;
    const last  = progression[progression.length - 1];
    const prev  = progression[progression.length - 2];
    const rootIdx = S.noteIndex(key);
    const lastDeg = ((last.rootPc - rootIdx) % 12 + 12) % 12;
    const prevDeg = ((prev.rootPc - rootIdx) % 12 + 12) % 12;

    const lastIsTonic = lastDeg === 0;
    const lastIsDominant = lastDeg === 7;
    const lastIsSubmediant = lastDeg === 9; // vi in major
    const prevIsDominant = prevDeg === 7;
    const prevIsSubdom   = prevDeg === 5;
    const prevIsBII      = prevDeg === 1; // ♭II
    const prevIsBVII     = prevDeg === 10;
    const prevIsIV       = prevDeg === 5;

    const isV7 = prev.quality === '7' || prev.quality === '9' || prev.quality === '13' || prev.quality === '7b9' || prev.quality === '7s9' || prev.quality === '7s11' || prev.quality === '7alt' || prev.quality === '13b9';
    const isMajorLast = last.quality === 'maj' || last.quality === 'maj7' || last.quality === 'maj9';
    const minorScale = scaleId.includes('minor');

    if (prevIsDominant && lastIsTonic) {
      const perfect = isMajorLast && (prev.quality === 'maj' || prev.quality === '7' || isV7);
      return { type:'authentic', label: perfect ? 'Perfect Authentic Cadence' : 'Authentic Cadence', detail:'V → I — strong harmonic resolution.' };
    }
    if (prevIsSubdom && lastIsTonic) {
      return { type:'plagal', label:'Plagal Cadence', detail:'IV → I — the “amen” move. Gentle, hymn-like.' };
    }
    if (lastIsDominant) {
      return { type:'half', label:'Half Cadence', detail:'Ends on V — open question, asks for more.' };
    }
    if (prevIsDominant && lastIsSubmediant) {
      return { type:'deceptive', label:'Deceptive Cadence', detail:'V → vi — the surprise turn. Continues the phrase instead of resting.' };
    }
    if (prevIsBVII && (prev.quality === '7' || prev.quality === 'maj' || prev.quality === 'maj7') && lastIsTonic) {
      return { type:'backdoor', label:'Backdoor Cadence', detail:'♭VII7 → I — smooth, jazzy resolution from outside the key.' };
    }
    if (prevIsBII && (prev.quality === '7' || prev.quality === 'maj' || prev.quality === 'maj7') && lastIsTonic) {
      return { type:'tt-sub', label:'Tritone-sub Authentic', detail:'♭II7 → I — sophisticated jazz cadence by tritone substitution.' };
    }
    if (minorScale && prevIsIV && lastIsDominant) {
      return { type:'phrygian-half', label:'Phrygian Half Cadence', detail:'iv6 → V in minor — Renaissance / Spanish flavour.' };
    }
    if (minorScale && lastIsTonic && isMajorLast) {
      return { type:'picardy', label:'Picardy Third', detail:'Minor key ending on a major I — light through the dark.' };
    }
    return null;
  }

  // ── Tension scoring ──────────────────────────────────────────────────────
  // Rough tension model: dissonance from quality + distance from tonic +
  // chromatic alterations + whether it's borrowed/secondary.
  const QUALITY_TENSION = {
    maj:1, m:2, dim:5, aug:5, sus2:2, sus4:2, pow:1,
    maj7:2, m7:2, '7':4, m7b5:5, dim7:6, mMaj7:5, augMaj7:6,
    '6':2, m6:3, '6/9':2,
    maj9:3, '9':4, m9:3, mMaj9:5, '11':4, m11:4, 'maj7s11':5,
    '13':5, m13:5, maj13:4,
    '7b9':7, '7s9':7, '7s11':7, '7alt':9, '13b9':8,
    add9:2, madd9:3, add11:3,
    quartal:4, so_what:4,
    '7sus4':4, '7b5':6, '7s5':6,
  };

  function tensionScore(chord, key) {
    const rootIdx = S.noteIndex(key);
    const interval = ((chord.rootPc - rootIdx) % 12 + 12) % 12;
    // Distance from tonic, weighted by circle-of-fifths nearness:
    const fifthsDistance = [0,5,2,3,4,1,6,1,4,3,2,5][interval]; // C=0, G=1, ...
    const qualityT = QUALITY_TENSION[chord.quality] || 3;
    const categoryT = { diatonic:0, borrowed:2, secondary:2, 'tt-sub':3, 'dim-passing':3, chromatic:4, neapolitan:3, aug6:3 }[chord.category] || 0;
    const raw = qualityT + fifthsDistance + categoryT;
    return Math.min(10, Math.round(raw));
  }

  // ── Functional label ─────────────────────────────────────────────────────
  // Major-key functions by scale degree (semitones from tonic).
  // 0,4,9 = Tonic; 2,5 = Predominant; 7,11 = Dominant. Borrowed/secondary
  // overridden by their category.
  function functionalLabel(chord, key, scaleId) {
    if (chord.category === 'secondary') return 'V/x';
    if (chord.category === 'borrowed')  return 'Borrowed';
    if (chord.category === 'tt-sub')    return 'TT-sub';
    if (chord.category === 'neapolitan') return '♭II';
    if (chord.category === 'dim-passing') return 'Passing °7';
    if (chord.category === 'chromatic') return 'Chromatic';
    const rootIdx = S.noteIndex(key);
    const interval = ((chord.rootPc - rootIdx) % 12 + 12) % 12;
    const minor = scaleId.includes('minor') || scaleId === 'phrygian' || scaleId === 'aeolian';
    if (!minor) {
      if ([0,4,9].includes(interval)) return 'T';
      if ([2,5].includes(interval)) return 'PD';
      if ([7,11].includes(interval)) return 'D';
    } else {
      if ([0,3,8].includes(interval)) return 'T';
      if ([2,5].includes(interval)) return 'PD';
      if ([7,11].includes(interval)) return 'D';
    }
    return '—';
  }

  // ── Voice leading summary ────────────────────────────────────────────────
  function voiceLeadingSummary(prev, next) {
    if (!prev) return { score:10, common:[], distance:0 };
    const dist = P.vlDistance(prev, next);
    const common = P.commonTones(prev, next);
    // Smaller distance = higher score (10 max for perfect common-tone hold)
    const score = Math.max(0, 10 - dist);
    return { score, common, distance:dist };
  }

  // ── Modulation suggestions ───────────────────────────────────────────────
  // Find closely related keys and propose pivot chords.
  function modulationSuggestions(key, scaleId) {
    const rootIdx = S.noteIndex(key);
    const preferFlats = S.FLAT_KEYS.has(key) || key.includes('b');
    // Related keys: relative, parallel, dominant, subdominant
    const candidates = [
      { semi: 7,  modeShift:'same', label:'Dominant (V) key' },
      { semi: 5,  modeShift:'same', label:'Subdominant (IV) key' },
      { semi: 9,  modeShift:'natural_minor', label:'Relative minor' },
      { semi: 3,  modeShift:'major', label:'Relative major' },
      { semi: 0,  modeShift:'flip', label:'Parallel mode' },
      { semi: 8,  modeShift:'major', label:'♭VI major — Romantic shift' },
    ];
    return candidates.map(c => {
      const newKey = S.noteName(rootIdx + c.semi, preferFlats);
      // Pick a believable pivot chord: vi in the new key, which is often diatonic in both
      const newScale = c.modeShift === 'flip'
        ? (scaleId.includes('minor') ? 'major' : 'natural_minor')
        : (c.modeShift === 'natural_minor' ? 'natural_minor'
        : c.modeShift === 'major' ? 'major' : scaleId);
      const pivot = C.diatonicChords(newKey, newScale, { sevenths:false })[5] || null; // vi
      return {
        key: newKey,
        scale: newScale,
        label: c.label,
        pivot: pivot ? pivot.shortName : null,
        instruction: pivot
          ? `Use ${pivot.shortName} as a pivot — it sits naturally in both keys.`
          : 'Modulate by direct phrase entry.',
      };
    });
  }

  // ── Cumulative emotional arc ─────────────────────────────────────────────
  function tensionArc(progression, key) {
    return progression.map(ch => tensionScore(ch, key));
  }

  // ── Auto-detect mode from progression ───────────────────────────────────
  // Looks at which characteristic chords appear:
  //   ♭VII at all? → Mixolydian likely (in major) or natural minor (in minor)
  //   major IV in a minor context? → Dorian
  //   ♭II at all? → Phrygian
  //   #4-based II major or #iv° in major? → Lydian
  function detectModalColour(progression, key, scaleId) {
    if (!progression || progression.length < 2) return null;
    const rootIdx = S.noteIndex(key);
    const isMajorScale = !scaleId.includes('minor') && scaleId === 'major';
    const isMinorScale = scaleId === 'natural_minor' || scaleId === 'harmonic_minor' || scaleId === 'melodic_minor';

    const degrees = progression.map(ch => ((ch.rootPc - rootIdx) % 12 + 12) % 12);
    const has = (deg, quality) => progression.some((ch, i) => degrees[i] === deg && (!quality || ch.quality === quality));

    const hits = [];
    if (isMajorScale) {
      if (has(10, 'maj') || has(10, '7')) hits.push({ mode:'Mixolydian', because:'♭VII appears — Mixolydian colour' });
      if (has(6, 'maj') || has(6, 'maj7')) hits.push({ mode:'Lydian', because:'II major (or maj7) — Lydian #4' });
      if (has(1, 'maj')) hits.push({ mode:'Phrygian', because:'♭II major — Phrygian dark' });
      if (has(3, 'maj')) hits.push({ mode:'Aeolian / parallel minor', because:'♭III major — Aeolian borrow' });
      if (has(8, 'maj')) hits.push({ mode:'Aeolian / parallel minor', because:'♭VI major — minor-key flavour' });
    } else if (isMinorScale) {
      if (has(9, 'maj') || has(9, 'maj7')) hits.push({ mode:'Dorian', because:'major IV (raised 6) — Dorian' });
      if (has(1, 'maj')) hits.push({ mode:'Phrygian', because:'♭II major — Phrygian shadow' });
      if (has(11, 'maj') || has(11, '7')) hits.push({ mode:'Harmonic minor', because:'V major / V7 — harmonic minor' });
    }
    if (!hits.length) return null;
    // Pick the strongest (first hit wins, but de-dupe modes)
    const seen = new Set();
    return hits.filter(h => seen.has(h.mode) ? false : (seen.add(h.mode), true)).slice(0, 2);
  }

  // ── Detect repeated phrase (looping) ────────────────────────────────────
  // Returns the period length if the progression is a clean repeat of N chords.
  function detectLoop(progression) {
    const n = progression.length;
    if (n < 4) return 0;
    for (let p = 2; p <= Math.floor(n / 2); p++) {
      let ok = true;
      for (let i = 0; i + p < n; i++) {
        const a = progression[i], b = progression[i + p];
        if (a.rootPc !== b.rootPc || a.quality !== b.quality) { ok = false; break; }
      }
      if (ok) return p;
    }
    return 0;
  }

  global.Analysis = {
    detectCadence, tensionScore, tensionArc,
    functionalLabel, voiceLeadingSummary, modulationSuggestions,
    detectModalColour, detectLoop,
  };
})(typeof window !== 'undefined' ? window : globalThis);
