/* ChordPath — descriptions.js
 * Two layers:
 *   1. Named-progression library — Roman-numeral sequence → handcrafted blurb
 *      that's templated with the actual chord names the user picked.
 *   2. Narrative generator — for novel sequences, builds a sentence from
 *      analysis output (tension change, cadence, modal interchange, etc.).
 */
(function (global) {
  'use strict';

  const S = global.Scales;
  const C = global.Chords;
  const A = global.Analysis;

  // Strip extensions from a Roman numeral down to its bare form for matching
  function stripRoman(r) {
    if (!r) return '';
    return r.replace(/maj7|m7b5|7b9|7s9|7s11|maj9|m9|13|11|9|7|°|ø|\+/g, '');
  }

  function romanSequence(progression) {
    return progression.map(c => stripRoman(c.roman || '')).filter(Boolean).join('-');
  }

  // ── Named progression library ────────────────────────────────────────────
  // Each entry: pattern (roman sequence) → narrative function (chords) → string
  const NAMED = [
    { pattern:'I-V-vi-IV', name:'The Axis Progression',
      describe:(p) => `${p[0].shortName} → ${p[1].shortName} → ${p[2].shortName} → ${p[3].shortName} — the "Axis of Awesome". Powers thousands of pop hits, from "Let It Be" to "Don't Stop Believin'". Uplifting and instantly familiar.` },
    { pattern:'vi-IV-I-V', name:'Axis Rotated',
      describe:(p) => `${p[0].shortName} → ${p[1].shortName} → ${p[2].shortName} → ${p[3].shortName} — the Axis starting on vi. Sad-then-anthemic; the move from vi to IV is the emotional core of countless ballads.` },
    { pattern:'I-vi-IV-V', name:'50s Doo-wop',
      describe:(p) => `${p[0].shortName} → ${p[1].shortName} → ${p[2].shortName} → ${p[3].shortName} — the classic doo-wop / "Stand By Me" / "Earth Angel" progression. Warm, nostalgic, every chord pulls smoothly to the next.` },
    { pattern:'I-IV-V', name:'Three-Chord Rock',
      describe:(p) => `${p[0].shortName} → ${p[1].shortName} → ${p[2].shortName} — the foundation of nearly every blues, country and rock song. Three chords, infinite songs.` },
    { pattern:'ii-V-I', name:'ii–V–I',
      describe:(p) => `${p[0].shortName} → ${p[1].shortName} → ${p[2].shortName} — the harmonic engine of jazz. The ii sets up the V, the V tightens the screw, and the I rewards you. Learn it in 12 keys.` },
    { pattern:'iii-vi-ii-V', name:'Turnaround',
      describe:(p) => `${p[0].shortName} → ${p[1].shortName} → ${p[2].shortName} → ${p[3].shortName} — a classic jazz turnaround. Circles back to the I with a feeling of perpetual motion.` },
    { pattern:'I-vi-ii-V', name:'Rhythm Changes A',
      describe:(p) => `${p[0].shortName} → ${p[1].shortName} → ${p[2].shortName} → ${p[3].shortName} — the A-section of "I Got Rhythm". A staple of bebop heads. Smooth circle-of-fifths motion.` },
    { pattern:'i-bVII-bVI-V', name:'Andalusian Cadence',
      describe:(p) => `${p[0].shortName} → ${p[1].shortName} → ${p[2].shortName} → ${p[3].shortName} — the Andalusian cadence. Walking down the Phrygian scale: passionate, Spanish, used in flamenco and prog rock alike.` },
    { pattern:'i-bIII-bVII-IV', name:'Modal Vamp',
      describe:(p) => `${p[0].shortName} → ${p[1].shortName} → ${p[2].shortName} → ${p[3].shortName} — a Dorian-flavoured vamp. Cool, modal, found in everything from "So What" to film cues.` },
    { pattern:'I-bVII-IV', name:'Mixolydian Rock',
      describe:(p) => `${p[0].shortName} → ${p[1].shortName} → ${p[2].shortName} — the Mixolydian rock move. The ♭VII gives that "Sweet Home Alabama" / classic-rock attitude.` },
    { pattern:'I-V-vi-iii-IV-I-IV-V', name:'Pachelbel Canon',
      describe:(p) => `Pachelbel's canon progression — eight chords that have been recycled in pop hits for 300 years. Each chord steps confidently to the next.` },
    { pattern:'I-IV-I-V', name:'12-Bar Lead-In',
      describe:(p) => `${p[0].shortName} → ${p[1].shortName} → ${p[2].shortName} → ${p[3].shortName} — the opening of a 12-bar blues. Stable, then a quick subdominant flash, back home, then the dominant pulls you out.` },
    { pattern:'I-IV-V-I', name:'Authentic Resolution',
      describe:(p) => `${p[0].shortName} → ${p[1].shortName} → ${p[2].shortName} → ${p[3].shortName} — textbook authentic. T → PD → D → T. Every cadence ever owes something to this shape.` },
    { pattern:'i-iv-V-i', name:'Minor Authentic',
      describe:(p) => `${p[0].shortName} → ${p[1].shortName} → ${p[2].shortName} → ${p[3].shortName} — the classical minor cadence. The V (often borrowed from harmonic minor) gives that dramatic pull home.` },
    { pattern:'vi-ii-V-I', name:'Circle-of-fifths Descent',
      describe:(p) => `${p[0].shortName} → ${p[1].shortName} → ${p[2].shortName} → ${p[3].shortName} — falling fifths. The strongest root motion in tonal harmony.` },
    { pattern:'I-IV', name:'Plagal Opening',
      describe:(p) => `${p[0].shortName} → ${p[1].shortName} — the gentle "amen" move. Hymn-like, hopeful, suspended in time.` },
    { pattern:'I-V', name:'Tonic–Dominant',
      describe:(p) => `${p[0].shortName} → ${p[1].shortName} — the most fundamental harmonic motion in Western music. Stable then unstable; the V wants to come home.` },
    { pattern:'i-bVI-bIII-bVII', name:'Synthwave Vamp',
      describe:(p) => `${p[0].shortName} → ${p[1].shortName} → ${p[2].shortName} → ${p[3].shortName} — the 80s synthwave / cinematic minor vamp. Dark but driving.` },
    { pattern:'I-iii-IV-iv', name:'Line Cliché (descending)',
      describe:(p) => `${p[0].shortName} → ${p[1].shortName} → ${p[2].shortName} → ${p[3].shortName} — a descending line cliché. The borrowed iv brings tears.` },
    { pattern:'I-Imaj7-I7-IV', name:'Beatles Line',
      describe:(p) => `${p[0].shortName} → ${p[1].shortName} → ${p[2].shortName} → ${p[3].shortName} — descending inner-voice cliché à la "Something" by the Beatles.` },
    { pattern:'I-bIII-IV', name:'Aeolian Rock',
      describe:(p) => `${p[0].shortName} → ${p[1].shortName} → ${p[2].shortName} — borrowed ♭III lands hard. Hard-rock and grunge live here.` },
    { pattern:'I-bVII-bVI', name:'Heroic Descent',
      describe:(p) => `${p[0].shortName} → ${p[1].shortName} → ${p[2].shortName} — heroic minor-3rd descent. Stairway begins here.` },
    { pattern:'I-V-bVII-IV', name:'Wonderwall',
      describe:(p) => `${p[0].shortName} → ${p[1].shortName} → ${p[2].shortName} → ${p[3].shortName} — the Wonderwall move. ♭VII slipped in for that swung modal flavour.` },
    { pattern:'i-V', name:'Hotel California Opening',
      describe:(p) => `${p[0].shortName} → ${p[1].shortName} — minor tonic to major dominant. Cinematic, classical.` },
    { pattern:'i-bII', name:'Phrygian Lurch',
      describe:(p) => `${p[0].shortName} → ${p[1].shortName} — the half-step pull of Phrygian. Spaghetti western or shark theme.` },
    { pattern:'i-IV', name:'Dorian Vamp',
      describe:(p) => `${p[0].shortName} → ${p[1].shortName} — i to IV major — the Dorian fingerprint ("Eleanor Rigby", "Get Lucky").` },
    { pattern:'I-bVI', name:'Star Wars Move',
      describe:(p) => `${p[0].shortName} → ${p[1].shortName} — a chromatic-mediant lift. The fanfare that launched a thousand soundtracks.` },
    { pattern:'I-bIII', name:'E.T. Lift',
      describe:(p) => `${p[0].shortName} → ${p[1].shortName} — minor-3rd chromatic-mediant. Innocent wonder, every Spielberg cue ever.` },
    { pattern:'i-bVI-bIII-bVII', name:'Synthwave / Cheap Thrills',
      describe:(p) => `${p[0].shortName} → ${p[1].shortName} → ${p[2].shortName} → ${p[3].shortName} — the modern minor pop loop. Smooth, Cheap Thrills, every 2010s synth-driven hit.` },
    { pattern:'IV-iv-I', name:'Beatles Line Cliché',
      describe:(p) => `${p[0].shortName} → ${p[1].shortName} → ${p[2].shortName} — IV becomes minor before resting on I. The signature "In My Life" sigh.` },
    { pattern:'IV-I-V-vi', name:'Rotated Axis',
      describe:(p) => `${p[0].shortName} → ${p[1].shortName} → ${p[2].shortName} → ${p[3].shortName} — Axis starting on IV. Pop-anthem opening, used by Rihanna's "Umbrella" among many.` },
    { pattern:'I-V-vi-iii', name:'Soft Cascade',
      describe:(p) => `${p[0].shortName} → ${p[1].shortName} → ${p[2].shortName} → ${p[3].shortName} — gentle stepwise descent — Mr. Brightside, Streets of London.` },
    { pattern:'I-IV-vi-V', name:'Beatles Pop',
      describe:(p) => `${p[0].shortName} → ${p[1].shortName} → ${p[2].shortName} → ${p[3].shortName} — 60s-pop classic — "She Loves You" energy.` },
    { pattern:'iim7-V7-Imaj7', name:'Bossa ii-V-I',
      describe:(p) => `${p[0].shortName} → ${p[1].shortName} → ${p[2].shortName} — the bossa-nova heartbeat. Sun-drenched, Girl from Ipanema.` },
    { pattern:'Imaj7-vi7-ii7-V7', name:'Smooth Jazz Loop',
      describe:(p) => `${p[0].shortName} → ${p[1].shortName} → ${p[2].shortName} → ${p[3].shortName} — extended Rhythm Changes A. Every standard's bridge.` },
    { pattern:'i-bVI-IV', name:'Grunge Lift',
      describe:(p) => `${p[0].shortName} → ${p[1].shortName} → ${p[2].shortName} — minor with a borrowed major IV. Smells Like Teen Spirit, Otherside.` },
    { pattern:'i-bVII-bVI-bVII', name:'Aeolian Pendulum',
      describe:(p) => `${p[0].shortName} → ${p[1].shortName} → ${p[2].shortName} → ${p[3].shortName} — descend, reach, return. Losing My Religion's chorus shape.` },
    { pattern:'I-iii-vi-IV', name:'Indie Cascade',
      describe:(p) => `${p[0].shortName} → ${p[1].shortName} → ${p[2].shortName} → ${p[3].shortName} — softer cousin of the Axis. Indie-folk warmth.` },
    { pattern:'I-bVI-bVII-I', name:'Flash Returns',
      describe:(p) => `${p[0].shortName} → ${p[1].shortName} → ${p[2].shortName} → ${p[3].shortName} — Queen-style triumphal return through borrowed chords.` },
    { pattern:'i-bVI-III-bVII', name:'Toto Africa',
      describe:(p) => `${p[0].shortName} → ${p[1].shortName} → ${p[2].shortName} → ${p[3].shortName} — Africa's verse — bright major III lifts the Aeolian gloom.` },
    { pattern:'i7-IV7', name:'Modal Funk Vamp',
      describe:(p) => `${p[0].shortName} → ${p[1].shortName} — two dom7 sevenths a 4th apart. Cantaloupe Island, Chameleon — the funk vamp.` },
    { pattern:'bII7-I', name:'Tritone-sub Resolution',
      describe:(p) => `${p[0].shortName} → ${p[1].shortName} — the chromatically sliding ♭II7 → I. Velvet, sophisticated.` },
    { pattern:'I7-IV7-I7-V7-IV7-I7', name:'12-Bar Blues',
      describe:(p) => `12-bar blues skeleton. The most-played form in popular music. Repeat it forever.` },
    { pattern:'i-bVII', name:'Pumped-Up Vamp',
      describe:(p) => `${p[0].shortName} → ${p[1].shortName} — two-chord minor vamp; modern indie ("Pumped Up Kicks").` },
  ];

  // ── Color tags by chord quality ──────────────────────────────────────────
  const QUALITY_COLOR = {
    maj:'bright', m:'melancholic', dim:'tense', aug:'unsettled',
    sus2:'open', sus4:'suspenseful', pow:'driving',
    maj7:'dreamy', m7:'cool', '7':'expectant', m7b5:'haunting',
    dim7:'spooky', mMaj7:'noir', augMaj7:'mysterious',
    '6':'sunny', m6:'plaintive', '6/9':'lush',
    maj9:'lush', '9':'soulful', m9:'jazzy', '11':'open jazz', m11:'velvety',
    '13':'rich', m13:'velvety', maj13:'cinematic',
    '7b9':'dramatic', '7s9':'gritty', '7s11':'futuristic', '7alt':'maximum tension', '13b9':'urgent',
    add9:'shimmering', madd9:'haunting', add11:'wide',
    quartal:'modern', so_what:'modal jazz',
    '7sus4':'gospel', '7b5':'spy-movie', '7s5':'sci-fi',
    'maj7s11':'lydian shimmer',
  };

  // ── Main API ─────────────────────────────────────────────────────────────
  function describe(progression, key, scaleId) {
    if (!progression || progression.length === 0) {
      return 'Pick a starting chord. Every chord in the scale tells a different story — try the I for stability, the vi for emotion, or the V for tension.';
    }

    // 1. Try named-progression match
    const seq = romanSequence(progression);
    for (const np of NAMED) {
      if (seq === np.pattern || seq.endsWith('-' + np.pattern)) {
        // Slice progression to the matched length
        const span = np.pattern.split('-').length;
        const slice = progression.slice(-span);
        return `${np.name}: ${np.describe(slice)}`;
      }
    }

    // 2. Narrative generator
    return narrativeDescription(progression, key, scaleId);
  }

  function narrativeDescription(progression, key, scaleId) {
    const last = progression[progression.length - 1];
    const prev = progression.length >= 2 ? progression[progression.length - 2] : null;
    const colour = QUALITY_COLOR[last.quality] || 'colourful';
    const tension = A.tensionScore(last, key);
    const prevTension = prev ? A.tensionScore(prev, key) : 0;
    const tensionDirection = tension > prevTension + 1 ? 'rising' : tension < prevTension - 1 ? 'falling' : 'steady';
    const vl = A.voiceLeadingSummary(prev, last);
    const cad = A.detectCadence(progression, key, scaleId);

    const parts = [];

    if (progression.length === 1) {
      parts.push(`Starting on ${last.fullName} sets a ${colour} foundation.`);
      if (last.category !== 'diatonic') {
        parts.push(`Notice this isn't a typical home chord — it's ${last.categoryNote.toLowerCase()}, which already adds character.`);
      }
      return parts.join(' ');
    }

    // Multi-chord narrative
    const moveDesc = describeMove(prev, last);
    parts.push(moveDesc);

    if (last.category === 'secondary') {
      parts.push(`${last.shortName} is a secondary dominant — it temporarily makes ${last.resolvesTo ? last.resolvesTo.shortName : 'the next chord'} feel like its own tonic.`);
    } else if (last.category === 'borrowed') {
      parts.push(`${last.shortName} is ${last.categoryNote.toLowerCase()} — a colour outside the home key.`);
    } else if (last.category === 'tt-sub') {
      parts.push(`${last.shortName} is a tritone substitution — same tritone as the original dominant, but a chromatically descending bass.`);
    } else if (last.category === 'dim-passing') {
      parts.push(`${last.shortName} is a chromatic passing diminished chord — pure motion, no destination.`);
    } else if (last.category === 'neapolitan') {
      parts.push(`${last.shortName} is the Neapolitan — a powerful flat-side colour, usually setting up the V.`);
    }

    if (vl.common.length) {
      parts.push(`The two chords share ${vl.common.length === 1 ? 'one common tone' : vl.common.length + ' common tones'} (${vl.common.join(', ')}) — that's why the transition feels smooth.`);
    }

    if (tensionDirection === 'rising') {
      parts.push(`Tension is rising — the music wants somewhere to go.`);
    } else if (tensionDirection === 'falling') {
      parts.push(`Tension is releasing — a moment of breath.`);
    }

    if (cad) {
      parts.push(`✓ ${cad.label} — ${cad.detail}`);
    }

    return parts.join(' ');
  }

  function describeMove(prev, last) {
    const pcDiff = ((last.rootPc - prev.rootPc) % 12 + 12) % 12;
    const intervalName = {
      0:'staying on the same root',
      1:'moving up a half-step',
      2:'moving up a whole step',
      3:'rising a minor third',
      4:'rising a major third',
      5:'rising a perfect fourth',
      6:'tritone leap',
      7:'rising a perfect fifth',
      8:'rising a minor sixth',
      9:'rising a major sixth (or down a minor third)',
      10:'rising a minor seventh (or down a whole step)',
      11:'rising a major seventh (or down a half-step)',
    }[pcDiff];
    return `From ${prev.fullName} to ${last.fullName} — ${intervalName}.`;
  }

  global.Descriptions = { describe, narrativeDescription, QUALITY_COLOR };
})(typeof window !== 'undefined' ? window : globalThis);
