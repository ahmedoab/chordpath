/* ChordPath — progressions.js
 * Next-chord recommendation engine.
 * Categories: diatonic, borrowed (modal interchange), secondary dominants,
 * tritone substitutions, diminished passing chords, Neapolitan, chromatic
 * mediants. Each returned option carries a category + theoretical label.
 */
(function (global) {
  'use strict';

  const S = global.Scales;
  const C = global.Chords;

  // Reasons by Roman numeral target — used for the “why this works” tagline
  const DIATONIC_REASONS = {
    1: 'Returns home — strong resolution.',
    2: 'Predominant — sets up the dominant.',
    3: 'Soft turn — shares two notes with the tonic.',
    4: 'Subdominant — opens up the harmony.',
    5: 'Dominant — pulls strongly toward the tonic.',
    6: 'Relative minor — adds emotional depth.',
    7: 'Leading — wants to resolve up to the tonic.',
  };

  // ── Whole-progression fit helpers ────────────────────────────────────────
  // Build a "palette" summary of the progression so far: which pitch classes
  // have appeared, which modes are implied, what categories dominate, what
  // the tension trajectory has been.
  function computeProgressionFit(progression, key, scaleId) {
    const rootIdx = S.noteIndex(key);
    const palette = new Set();
    const degreeHits = new Set();
    const categoryCounts = { diatonic:0, borrowed:0, secondary:0, 'tt-sub':0, 'dim-passing':0, neapolitan:0, chromatic:0, aug6:0 };
    progression.forEach(ch => {
      ch.intervals.forEach(iv => palette.add((ch.rootPc + iv) % 12));
      const deg = ((ch.rootPc - rootIdx) % 12 + 12) % 12;
      degreeHits.add(deg + ':' + ch.quality);
      if (categoryCounts[ch.category] != null) categoryCounts[ch.category]++;
    });
    // Implied mode: which scale's pitch-classes best contain `palette`?
    // We only check a few common candidates for speed.
    const candidateModes = ['major','natural_minor','dorian','mixolydian','lydian','phrygian','harmonic_minor'];
    let impliedMode = scaleId, bestOverlap = -1;
    for (const m of candidateModes) {
      const ivs = S.getIntervals(m);
      if (ivs.length !== 7) continue;
      const pcs = new Set(ivs.map(iv => (rootIdx + iv) % 12));
      let overlap = 0;
      palette.forEach(pc => { if (pcs.has(pc)) overlap++; });
      // Penalize palette tones outside the mode
      const inside = overlap, outside = palette.size - overlap;
      const score = inside - outside * 1.2;
      if (score > bestOverlap) { bestOverlap = score; impliedMode = m; }
    }
    // Did the progression already establish a non-diatonic flavour?
    const total = progression.length || 1;
    const adventurous = (categoryCounts.borrowed + categoryCounts.secondary +
                         categoryCounts['tt-sub'] + categoryCounts.chromatic +
                         categoryCounts.neapolitan + categoryCounts.aug6) / total;
    // Tension trajectory: differences across the recent chords
    return {
      palette, impliedMode, categoryCounts, adventurous,
      length: progression.length, key, scaleId,
      // The set of (degree:quality) tuples already present — penalise reusing
      // the same one immediately
      degreeHits,
    };
  }

  // Score a single candidate in the context of the progression so far.
  // Smaller = better. We try to capture global musical sense, not just local.
  function scoreChoiceInContext(candidate, progression, key, scaleId, fit) {
    let score = 0;
    const rootIdx = S.noteIndex(key);
    const last = progression[progression.length - 1] || null;
    const window = progression.slice(-3); // last three chords

    // 1. Voice-leading distance, weighted average over the window
    if (last) {
      score += vlDistance(last, candidate) * 1.0;
      if (window.length >= 2) score += vlDistance(window[window.length - 2], candidate) * 0.35;
      if (window.length >= 3) score += vlDistance(window[window.length - 3], candidate) * 0.15;
    }

    // 2. Modal palette consistency — pitch classes outside the implied mode
    //    cost score (the bigger the palette break, the bigger the penalty).
    if (fit && fit.length > 1) {
      const modeIvs = S.getIntervals(fit.impliedMode);
      const modePcs = new Set(modeIvs.map(iv => (rootIdx + iv) % 12));
      let outside = 0;
      candidate.intervals.forEach(iv => {
        const pc = (candidate.rootPc + iv) % 12;
        if (!modePcs.has(pc)) outside++;
      });
      // If the progression is already adventurous, half the penalty
      const penaltyMul = fit.adventurous > 0.3 ? 0.6 : 1.4;
      score += outside * penaltyMul;
    }

    // 3. Category coherence
    const catBonus = {
      diatonic: 0, borrowed: 1.0, secondary: 1.0, 'tt-sub': 2.5,
      'dim-passing': 1.2, chromatic: 3.0, neapolitan: 2.0, 'aug6': 2.5,
    };
    let catPenalty = catBonus[candidate.category] || 0;
    // If progression has been adventurous, chromatic categories cost less
    if (fit && fit.adventurous > 0.3 && (candidate.category === 'chromatic' || candidate.category === 'tt-sub')) {
      catPenalty *= 0.5;
    }
    // If the user has never used borrowed and this is borrowed, that's fine but
    // sudden chromatic is not.
    score += catPenalty;

    // 4. Cadence opportunity — strong bonus if this completes a cadence
    if (last) {
      const lastDeg = ((last.rootPc - rootIdx) % 12 + 12) % 12;
      const candDeg = ((candidate.rootPc - rootIdx) % 12 + 12) % 12;
      const lastIsDom = lastDeg === 7;
      const lastIsBII = lastDeg === 1;
      const lastIsBVII = lastDeg === 10;
      const lastIsIV = lastDeg === 5;
      const candIsTonic = candDeg === 0;
      const candIsDom = candDeg === 7;
      // V → I, ♭II → I, ♭VII → I, IV → I
      if (lastIsDom && candIsTonic) score -= 3.5;
      if (lastIsBII && candIsTonic) score -= 3.0;
      if (lastIsBVII && candIsTonic) score -= 2.0;
      if (lastIsIV && candIsTonic) score -= 1.5;
      // ii → V sets up a cadence
      if (lastDeg === 2 && candIsDom) score -= 1.5;
    }

    // 5. Avoid immediate repetition (same root + quality as previous)
    if (last && last.rootPc === candidate.rootPc && last.quality === candidate.quality) score += 5;
    // …and same chord 2 back (creates "A-B-A-B" feel) — neutral, no penalty

    // 6. Tension-arc shape — if the progression has been climbing, candidates
    //    that release tension score; if it's been flat, candidates that lift
    //    tension score (so the music has *somewhere to go*).
    const A = global.Analysis;
    if (A && progression.length >= 2) {
      const arc = progression.map(ch => A.tensionScore(ch, key));
      const trend = arc[arc.length - 1] - arc[Math.max(0, arc.length - 3)];
      const candTension = A.tensionScore(candidate, key);
      const candDelta = candTension - arc[arc.length - 1];
      if (trend > 1.5 && candDelta < 0) score -= 1.2;        // resolves a climb
      else if (trend > 1.5 && candDelta > 0) score += 0.8;    // piles on
      else if (Math.abs(trend) <= 1 && Math.abs(candDelta) >= 2) score -= 0.6; // adds interest to flat line
    }

    // 7. Functional motion bonus: T→PD, PD→D, D→T are textbook smooth
    if (A && last) {
      const lf = A.functionalLabel(last, key, scaleId);
      const cf = A.functionalLabel(candidate, key, scaleId);
      const goodTransitions = ['T→PD','PD→D','D→T','T→D','T→T','PD→T'];
      if (goodTransitions.includes(lf + '→' + cf)) score -= 0.4;
    }

    return score;
  }

  // ── Helpers ──────────────────────────────────────────────────────────────
  function pcOf(noteName) { return S.noteIndex(noteName); }

  // Hamming-style voicing distance: sum of minimal semitone moves between
  // each pitch class of the new chord and the closest in the previous chord.
  function vlDistance(prevChord, nextChord) {
    if (!prevChord) return 0;
    const prevPcs = prevChord.notes.map(pcOf);
    let total = 0;
    for (const n of nextChord.notes) {
      const pc = pcOf(n);
      let best = 12;
      for (const p of prevPcs) {
        const d = Math.min((pc - p + 12) % 12, (p - pc + 12) % 12);
        if (d < best) best = d;
      }
      total += best;
    }
    return total;
  }

  function commonTones(prevChord, nextChord) {
    if (!prevChord) return [];
    const prev = new Set(prevChord.notes.map(pcOf));
    const out = [];
    for (const n of nextChord.notes) {
      if (prev.has(pcOf(n))) out.push(n);
    }
    return out;
  }

  function dedupe(chords) {
    const seen = new Set();
    return chords.filter(ch => {
      const k = ch.root + ':' + ch.quality;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  // Quality-aware seventh upgrade — when sevenths mode is on, lift triads
  function upgradeWithSevenths(chord, sevenths) {
    if (!sevenths) return chord;
    if (['maj','m','dim','aug'].indexOf(chord.quality) === -1) return chord;
    const map = { maj:'maj7', m:'m7', dim:'m7b5', aug:'augMaj7' };
    return C.buildChord(chord.root, map[chord.quality], { preferFlats: chord.preferFlats, category: chord.category, categoryNote: chord.categoryNote });
  }

  // ── Borrowed chords (modal interchange) ──────────────────────────────────
  // For a major key, common borrowed chords come from parallel minor, Mixolydian,
  // Phrygian, Lydian, Dorian. For a minor key, from parallel major, Dorian, etc.
  function borrowedChords(key, scaleId, sevenths) {
    const preferFlats = S.FLAT_KEYS.has(key) || key.includes('b');
    const isMinor = scaleId === 'natural_minor' || scaleId === 'harmonic_minor' || scaleId === 'melodic_minor';
    const rootIdx = S.noteIndex(key);
    const list = [];

    function add(semi, qual, srcMode, note) {
      const rootName = S.noteName(rootIdx + semi, preferFlats);
      const ch = C.buildChord(rootName, qual, {
        preferFlats,
        category:'borrowed',
        categoryNote: `Borrowed from ${srcMode}${note ? ' — ' + note : ''}`,
      });
      list.push(ch);
    }

    if (!isMinor) {
      // From parallel minor (Aeolian)
      add(3,  'maj', 'parallel minor', '♭III');
      add(5,  'm',   'parallel minor', 'iv — minor subdominant');
      add(8,  'maj', 'parallel minor', '♭VI');
      add(10, 'maj', 'parallel minor', '♭VII');
      // From Mixolydian
      add(10, '7',   'Mixolydian', '♭VII7');
      // From Phrygian
      add(1,  'maj', 'Phrygian', '♭II (Neapolitan area)');
      // From Lydian
      add(6,  'dim', 'Lydian', '♯iv°');
      // Picardy / Dorian
      add(9,  'maj', 'Dorian', 'IV (major) → vi (major) flavour');
    } else {
      // From parallel major
      add(4,  'maj', 'parallel major', 'III (major)');
      add(9,  'maj', 'parallel major', 'VI (major)');
      add(11, 'dim', 'parallel major', 'vii°');
      // Picardy third
      add(0,  'maj', 'parallel major', 'Picardy third — bright finish');
    }

    return list.map(c => upgradeWithSevenths(c, sevenths));
  }

  // ── Secondary dominants ──────────────────────────────────────────────────
  // V7 of each diatonic chord (except diminished ones).
  function secondaryDominants(diatonics) {
    const out = [];
    for (const tgt of diatonics) {
      // No V7 of a diminished/half-diminished chord (rare/awkward)
      if (tgt.quality === 'dim' || tgt.quality === 'dim7' || tgt.quality === 'm7b5') continue;
      // The dominant of the target is a major triad / dom7 a perfect 5th above.
      const domPc = (tgt.rootPc + 7) % 12;
      const rootName = S.noteName(domPc, tgt.preferFlats);
      const ch = C.buildChord(rootName, '7', {
        preferFlats: tgt.preferFlats,
        category:'secondary',
        categoryNote: `V7/${tgt.roman.replace(/[°ø+].*/,'')} — secondary dominant of ${tgt.shortName}`,
      });
      ch.resolvesTo = tgt;
      out.push(ch);
    }
    return out;
  }

  // ── Tritone substitutions ────────────────────────────────────────────────
  // Replace each V7 (real or secondary) with the dom7 a tritone away.
  function tritoneSubs(dominantList) {
    return dominantList.map(dom => {
      const subPc = (dom.rootPc + 6) % 12;
      const rootName = S.noteName(subPc, dom.preferFlats);
      const tgtLabel = dom.resolvesTo ? dom.resolvesTo.shortName : '';
      const ch = C.buildChord(rootName, '7', {
        preferFlats: dom.preferFlats,
        category:'tt-sub',
        categoryNote: `Tritone sub of ${dom.shortName}${tgtLabel ? ' → ' + tgtLabel : ''}`,
      });
      ch.resolvesTo = dom.resolvesTo;
      return ch;
    });
  }

  // ── Diminished passing chords ────────────────────────────────────────────
  // ♯i°7 between I and ii, ♯ii°7 between ii and iii, ♯iv°7 between IV and V.
  function diminishedPassing(key) {
    const rootIdx = S.noteIndex(key);
    const preferFlats = S.FLAT_KEYS.has(key) || key.includes('b');
    const passing = [
      { offset:1,  desc:'♯i°7 — chromatic step between I and ii' },
      { offset:3,  desc:'♯ii°7 — chromatic between ii and iii' },
      { offset:6,  desc:'♯iv°7 — chromatic between IV and V' },
      { offset:8,  desc:'♯v°7 — chromatic into vi' },
    ];
    return passing.map(p => {
      const rootName = S.noteName(rootIdx + p.offset, preferFlats);
      return C.buildChord(rootName, 'dim7', {
        preferFlats,
        category:'dim-passing',
        categoryNote: p.desc,
      });
    });
  }

  // ── Chromatic mediants ───────────────────────────────────────────────────
  // From the current chord root, jump by major or minor third with switched
  // major↔minor quality. Strong but startling colour.
  function chromaticMediants(currentChord) {
    if (!currentChord) return [];
    const out = [];
    const root = currentChord.rootPc;
    const flat = currentChord.preferFlats;
    const isMaj = currentChord.quality === 'maj' || currentChord.quality === 'maj7';
    const newQual = isMaj ? 'maj' : 'm';
    [3, 4, 8, 9].forEach(off => {
      const rn = S.noteName(root + off, flat);
      out.push(C.buildChord(rn, newQual, {
        preferFlats: flat, category:'chromatic',
        categoryNote: `Chromatic mediant from ${currentChord.shortName}`,
      }));
    });
    return out;
  }

  // ── Neapolitan & backdoor ────────────────────────────────────────────────
  function neapolitan(key) {
    const rootIdx = S.noteIndex(key);
    const preferFlats = S.FLAT_KEYS.has(key) || key.includes('b');
    const rootName = S.noteName(rootIdx + 1, true);
    return C.buildChord(rootName, 'maj', {
      preferFlats:true,
      category:'neapolitan',
      categoryNote: '♭II — Neapolitan, often resolves to V or I',
    });
  }

  function backdoor(key, sevenths) {
    const rootIdx = S.noteIndex(key);
    const preferFlats = S.FLAT_KEYS.has(key) || key.includes('b');
    const rootName = S.noteName(rootIdx + 10, preferFlats);
    return C.buildChord(rootName, '7', {
      preferFlats,
      category:'borrowed',
      categoryNote: '♭VII7 — backdoor dominant, resolves to I',
    });
  }

  // ── Main entry point ─────────────────────────────────────────────────────
  function getNextChordOptions(opts) {
    // opts: { key, scale, progression, sevenths, filters }
    const key      = opts.key;
    const scaleId  = opts.scale;
    const sevenths = opts.sevenths !== false;
    const filters  = opts.filters || {
      diatonic:true, borrowed:true, secondary:true, ttSub:true,
      dimPassing:true, chromatic:false, neapolitan:true,
    };
    const progression = opts.progression || [];
    const currentChord = progression[progression.length - 1] || null;

    const diatonics = C.diatonicChords(key, scaleId, { sevenths });

    let pool = [];

    if (filters.diatonic) {
      pool = pool.concat(diatonics.map(d => ({ ...d, category:'diatonic', categoryNote: d.scaleDegree ? `${d.roman}` : '' })));
    }
    if (filters.borrowed) {
      pool = pool.concat(borrowedChords(key, scaleId, sevenths));
      pool.push(backdoor(key, sevenths));
    }
    let secs = [];
    if (filters.secondary || filters.ttSub) {
      secs = secondaryDominants(diatonics);
      if (filters.secondary) pool = pool.concat(secs);
    }
    if (filters.ttSub) {
      pool = pool.concat(tritoneSubs(secs));
    }
    if (filters.dimPassing) {
      pool = pool.concat(diminishedPassing(key));
    }
    if (filters.chromatic && currentChord) {
      pool = pool.concat(chromaticMediants(currentChord));
    }
    if (filters.neapolitan) {
      pool.push(neapolitan(key));
    }
    if (filters.aug6) {
      pool = pool.concat(augmentedSixths(key));
    }

    // Drop chords with the same root+quality as the current chord (no repeats)
    if (currentChord) {
      pool = pool.filter(ch => !(ch.rootPc === currentChord.rootPc && ch.quality === currentChord.quality));
    }

    pool = dedupe(pool);

    // ── Whole-progression fit scoring ────────────────────────────────────────
    // The engine now reasons over the entire progression, not just the last
    // chord. We score each candidate by simulating "what would the progression
    // look like if we added this?" and computing several global signals:
    //
    //   1. Voice leading: weighted average of vl-distance from the last 3 chords
    //   2. Modal palette consistency: chords drawn from the implied mode score
    //      higher; chords that break the established palette score lower
    //   3. Category-mix coherence: if the progression has been all-diatonic,
    //      sudden chromatic is jarring; if it's been mixed, more freedom
    //   4. Tension-arc shape: rewards chords that extend an arc, penalises
    //      flatlining and chaotic jumps
    //   5. Cadence opportunity: chords that complete a recognisable cadence
    //      (V→I, ii→V, IV→I, ♭II→I) get a strong boost
    //   6. Functional motion: T→PD→D→T is the gold standard
    //   7. Common-tone coverage: shared notes with the recent chord-window
    const progFit = computeProgressionFit(progression, key, scaleId);
    for (const ch of pool) {
      ch.scoreRank = scoreChoiceInContext(ch, progression, key, scaleId, progFit);
      // Keep the legacy fields for any UI that uses them
      ch.vlDistance  = vlDistance(currentChord, ch);
      ch.commonTones = commonTones(currentChord, ch);
    }

    // Compute reasons for diatonic
    for (const ch of pool) {
      if (ch.category === 'diatonic' && typeof ch.scaleDegree === 'number') {
        const reason = DIATONIC_REASONS[ch.scaleDegree];
        if (reason && !ch.categoryNote.includes('—')) {
          ch.categoryNote = `${ch.roman} — ${reason}`;
        } else if (reason) {
          ch.categoryNote = `${ch.roman} • ${reason}`;
        }
      }
    }

    // Sort by scoreRank only (whole-progression fit). Category is encoded
    // into the score via catBonus, so sorting by score alone surfaces the
    // best-fitting chord regardless of category — diatonic-only ranking
    // was hiding strong borrowed/secondary picks behind weak diatonic ones.
    pool.sort((a, b) => a.scoreRank - b.scoreRank);

    return pool;
  }

  // ── Augmented sixth chords (Italian, French, German) ─────────────────────
  // All resolve to V (in major) or i (via cadential 6/4) — bass on ♭6, top
  // voices forming a tritone or aug6 interval that splits outward.
  function augmentedSixths(key) {
    const rootIdx = S.noteIndex(key);
    const preferFlats = S.FLAT_KEYS.has(key) || key.includes('b');
    const flat6Pc = (rootIdx + 8) % 12; // ♭6 = bass note
    const sharp4Pc = (rootIdx + 6) % 12; // #4 = augmented 6th above ♭6 = top
    const bass = S.noteName(flat6Pc, preferFlats);

    function build(extraIvs, fullName, note) {
      // Italian: ♭6 - 1 - #4 (intervals from ♭6: 0, 5, 10)... but easier to
      // construct as a chord rooted on ♭6 with custom interval set.
      const intervals = [0, ...extraIvs];
      // We hand-roll the chord object since this isn't in our QUALITIES map
      const ch = C.buildChord(bass, 'maj', { preferFlats, category:'aug6', categoryNote: note });
      ch.intervals = intervals;
      ch.quality = 'aug6';
      ch.qualityFull = fullName;
      ch.fullName = bass + ' ' + fullName;
      ch.shortName = bass + (extraIvs.length === 3 ? '+6' : (extraIvs.length === 3 ? '+6' : '+6'));
      // Recompute notes from intervals
      ch.notes = intervals.map(iv => S.noteName(flat6Pc + iv, preferFlats));
      ch.symbol = ch.shortName;
      return ch;
    }
    return [
      build([4, 10],         'Italian augmented 6th',  'It+6 — resolves to V'),
      build([4, 6, 10],      'French augmented 6th',   'Fr+6 — has an added #4, dreamier'),
      build([4, 7, 10],      'German augmented 6th',   'Gr+6 — like a V7/♭II, resolves to I 6/4 → V'),
    ];
  }

  // ── Common-tone diminished — pivots via shared note ──────────────────────
  function commonToneDim(currentChord) {
    if (!currentChord) return [];
    // Build a dim7 sharing the root of the current chord — strong colour over a pedal
    const ch = C.buildChord(currentChord.root, 'dim7', {
      preferFlats: currentChord.preferFlats,
      category:'chromatic',
      categoryNote: `Common-tone °7 — same root as ${currentChord.shortName}, pure colour pivot`,
    });
    return [ch];
  }

  // ── Pump-it-up pop-punk + cinematic minor add-ons ────────────────────────
  function bonusBorrowed(key) {
    const rootIdx = S.noteIndex(key);
    const preferFlats = S.FLAT_KEYS.has(key) || key.includes('b');
    const list = [];
    function add(semi, qual, note) {
      const rn = S.noteName(rootIdx + semi, preferFlats);
      list.push(C.buildChord(rn, qual, { preferFlats, category:'borrowed', categoryNote: note }));
    }
    // ♭III major (in major key — Mixolydian/Aeolian borrow)
    add(3, 'maj', '♭III — bright in minor, surprising in major');
    // iv in minor → IV in major Picardy
    add(5, 'maj', 'IV major — open subdominant');
    return list;
  }

  global.Progressions = {
    getNextChordOptions, vlDistance, commonTones,
    borrowedChords, secondaryDominants, tritoneSubs,
    diminishedPassing, chromaticMediants, neapolitan, backdoor,
    augmentedSixths, commonToneDim, bonusBorrowed,
  };
})(typeof window !== 'undefined' ? window : globalThis);
