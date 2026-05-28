/* ChordPath — genres.js
 * Genre scoring and rhythmic tips. Each genre has a fingerprint of
 * preferred chord qualities, scales, cadences, and extension density.
 * `matchGenre(progression, scaleId)` returns the top primary + influences.
 */
(function (global) {
  'use strict';

  const S = global.Scales;

  // ── Genre fingerprints ───────────────────────────────────────────────────
  // Each genre lists: qualities that score points, scales it favours,
  // characteristic moves (e.g. "♭VII","ii-V-I","iv-borrow"), and a rhythm tip.
  const GENRES = [
    { id:'pop', name:'Pop',
      qualities:['maj','m','sus2','sus4','add9','maj7','m7'],
      scales:['major','minor','mixolydian'],
      moves:['I-V-vi-IV','vi-IV-I-V','I-IV-V'],
      rhythm:{ time:'4/4', bpm:'90–120', tip:'8th-note strum: down-up-down-up. Hi-hat on every 8th, snare on 2 and 4. Add syncopation by tying the “and” of 2.' },
      pattern:{ drums:{ kick:[0,8], snare:[4,12], hhClosed:[0,2,4,6,8,10,12,14], hhOpen:[] }, bass:'root', chords:'block' },
    },
    { id:'indie', name:'Indie',
      qualities:['sus2','sus4','add9','maj7','m9','m7'],
      scales:['major','mixolydian','lydian','dorian'],
      moves:['I-iii-vi-IV','IV-vi-I-V'],
      rhythm:{ time:'4/4', bpm:'95–130', tip:'Let chords ring. Picking pattern: thumb on root, fingers on 1 & 3. Reverb-heavy lead voicings.' },
      pattern:{ drums:{ kick:[0,8], snare:[4,12], hhClosed:[0,4,8,12], hhOpen:[6,14] }, bass:'root', chords:'arp' },
    },
    { id:'classic_rock', name:'Classic Rock',
      qualities:['maj','m','7','sus4','pow'],
      scales:['mixolydian','major','minor_pent','blues_minor'],
      moves:['I-bVII-IV','I-IV-V','I-bVII-bVI-V'],
      rhythm:{ time:'4/4', bpm:'110–140', tip:'Power chords + open strings. 8th-note driving rhythm, snare on 2 and 4, kick on 1 & “and” of 3.' },
      pattern:{ drums:{ kick:[0,6,10], snare:[4,12], hhClosed:[0,2,4,6,8,10,12,14], hhOpen:[] }, bass:'root-fifth', chords:'block' },
    },
    { id:'jazz', name:'Jazz',
      qualities:['maj7','m7','7','m7b5','dim7','7b9','7s9','7s11','7alt','13','9','m9','maj9','13b9','m11'],
      scales:['major','melodic_minor','bebop_dom','bebop_major','dorian','altered','lydian_dom'],
      moves:['ii-V-I','iii-vi-ii-V','tt-sub','secondary','backdoor'],
      rhythm:{ time:'4/4', bpm:'100–180', tip:'Swing 8ths. Comp on the “and” of 2 and 4. Walk the bass in quarters. Use rootless voicings (3-5-7-9) on piano.' },
      pattern:{ drums:{ kick:[0], snare:[], hhClosed:[0,4,7,8,12,15], hhOpen:[4,12] }, bass:'walking', chords:'comp', swing:true },
    },
    { id:'bossa', name:'Bossa Nova',
      qualities:['maj7','m7','7','m7b5','7b9','m9','maj9','6','9','m6','add9'],
      scales:['major','dorian','melodic_minor'],
      moves:['ii-V-I','I-vi-ii-V'],
      rhythm:{ time:'4/4', bpm:'120–140', tip:'3-2 partido alto clave. Thumb: bass on beat 1 and “and” of 2. Fingers: chord stabs on 2, 3, 4. Brushes on snare cross-stick.' },
      pattern:{ drums:{ kick:[0,6,10], snare:[4,11,14], hhClosed:[0,2,4,6,8,10,12,14], hhOpen:[] }, bass:'tumbao', chords:'comp' },
    },
    { id:'blues', name:'Blues',
      qualities:['7','9','13','m7','m7b5'],
      scales:['blues_minor','minor_pent','mixolydian','bebop_dom'],
      moves:['I7-IV7-V7','12-bar'],
      rhythm:{ time:'12/8 or 4/4 shuffle', bpm:'70–120', tip:'Shuffle feel — swing 8ths hard. Boom-chick on guitar. Snare on 2 and 4, bass walks quarter notes.' },
      pattern:{ drums:{ kick:[0,8], snare:[4,12], hhClosed:[0,3,4,7,8,11,12,15], hhOpen:[] }, bass:'walking', chords:'block', swing:true },
    },
    { id:'funk', name:'Funk',
      qualities:['m7','7','9','m9','13','7s9','sus4'],
      scales:['minor_pent','dorian','mixolydian'],
      moves:['Im7 vamp','I7-IV7'],
      rhythm:{ time:'4/4', bpm:'90–115', tip:'16th-note muted strums. Lock with the kick on 1 and “e” of 3. Snare on 2 and 4. Keep voicings tight (3 notes max).' },
      pattern:{ drums:{ kick:[0,6,10], snare:[4,11,12,14], hhClosed:[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15], hhOpen:[] }, bass:'funk-16th', chords:'comp' },
    },
    { id:'soul', name:'Soul / R&B',
      qualities:['maj7','m7','7','m9','maj9','11','13','7b9'],
      scales:['major','dorian','minor_pent'],
      moves:['I-iii-IV-V','ii-V-I','I-vi-IV-V'],
      rhythm:{ time:'4/4', bpm:'70–100', tip:'Behind-the-beat groove. 16th hat with ghost-snares between 2 and 4. Sit chords on beats 1 & 3 in Rhodes voicings.' },
      pattern:{ drums:{ kick:[0,7], snare:[4,12], hhClosed:[0,2,4,6,8,10,12,14], hhOpen:[] }, bass:'root', chords:'comp' },
    },
    { id:'gospel', name:'Gospel',
      qualities:['maj7','m7','7','m9','13','7b9','add9','m7b5'],
      scales:['major','minor_pent','blues_minor'],
      moves:['I-IV-I','plagal','passing-dim','tritone-sub'],
      rhythm:{ time:'12/8 or 4/4', bpm:'60–100', tip:'12/8 ballad feel. Use passing diminished chords between every diatonic. Bass walks chromatically. Hammond + tambourine.' },
      pattern:{ drums:{ kick:[0,8], snare:[4,12], hhClosed:[0,2,4,6,8,10,12,14], hhOpen:[] }, bass:'walking', chords:'sustained' },
    },
    { id:'folk', name:'Folk / Acoustic',
      qualities:['maj','m','sus2','sus4','add9'],
      scales:['major','mixolydian','dorian'],
      moves:['I-IV-V','I-V-vi-IV','I-bVII-IV'],
      rhythm:{ time:'4/4 or 3/4', bpm:'80–120', tip:'Travis picking: thumb alternates bass on beats 1 & 3, fingers pluck on 2 & 4. Capo for higher voicings.' },
      pattern:{ drums:{ kick:[0,8], snare:[4,12], hhClosed:[0,4,8,12], hhOpen:[] }, bass:'root-fifth', chords:'travis' },
    },
    { id:'country', name:'Country',
      qualities:['maj','m','7','sus4','add9'],
      scales:['major','mixolydian','major_pent'],
      moves:['I-IV-V','I-V-IV-V'],
      rhythm:{ time:'4/4', bpm:'90–130', tip:'Boom-chick: bass on 1 & 3, chord stab on 2 & 4. Brush snare on 2 & 4. Add walking bass between chord changes.' },
      pattern:{ drums:{ kick:[0,8], snare:[4,12], hhClosed:[0,4,8,12], hhOpen:[] }, bass:'root-fifth', chords:'block' },
    },
    { id:'metal', name:'Metal',
      qualities:['pow','m','dim','7','m7b5','dim7'],
      scales:['phrygian','phrygian_dom','harmonic_minor','minor_pent','locrian'],
      moves:['i-bVII-bVI-V','i-bII-i','tritone'],
      rhythm:{ time:'4/4 or 7/8', bpm:'120–200', tip:'Palm-muted 16th-note chugs on E or drop-D. Double-kick gallop. Open-string drone + tritone riffs for menace.' },
      pattern:{ drums:{ kick:[0,2,4,6,8,10,12,14], snare:[4,12], hhClosed:[0,2,4,6,8,10,12,14], hhOpen:[] }, bass:'root', chords:'block' },
    },
    { id:'flamenco', name:'Flamenco / Spanish',
      qualities:['maj','m','7','7b9','dim'],
      scales:['phrygian','phrygian_dom','spanish_gypsy','harmonic_minor'],
      moves:['Andalusian (i-bVII-bVI-V)','phrygian-half'],
      rhythm:{ time:'12/8 (compás)', bpm:'100–180', tip:'Compás of 12: accents on 3, 6, 8, 10, 12. Rasgueado (fan strum) + golpe (tap on guitar top). Hand-claps (palmas) on the off-beats.' },
      pattern:{ drums:{ kick:[0], snare:[6,10,14], hhClosed:[2,6,10,14], hhOpen:[] }, bass:'root', chords:'arp' },
    },
    { id:'cinematic', name:'Cinematic / Film Score',
      qualities:['maj','m','sus2','sus4','maj7','m7','add9','aug','maj7s11'],
      scales:['lydian','phrygian','dorian','harmonic_minor','melodic_minor','whole_tone'],
      moves:['chromatic-mediant','i-bVI','I-bIII'],
      rhythm:{ time:'4/4, 3/4, or free', bpm:'40–90', tip:'Slow, sustained pads. Arpeggiate one note per beat. Use silence as an instrument. Build dynamics across 8 bars, not 2.' },
      pattern:{ drums:{ kick:[0], snare:[], hhClosed:[], hhOpen:[] }, bass:'sustained', chords:'sustained' },
    },
    { id:'lofi', name:'Lo-fi Hip-Hop',
      qualities:['maj7','m7','m9','maj9','7','13','m11','sus2'],
      scales:['major','dorian','minor_pent'],
      moves:['ii-V-I','vamp','Imaj7-IVmaj7'],
      rhythm:{ time:'4/4', bpm:'70–90', tip:'Slightly swung 16ths, hat slightly behind. Snare on 3, kick on 1 and “and” of 2. Tape-warble on the chord track for that classic feel.' },
      pattern:{ drums:{ kick:[0,11], snare:[8], hhClosed:[0,2,4,6,8,10,12,14], hhOpen:[] }, bass:'root', chords:'sustained', swing:true },
    },
    { id:'house', name:'House / EDM',
      qualities:['m7','maj7','m9','sus4','add9','7'],
      scales:['minor','dorian','major'],
      moves:['Im-bIII-bVII-IV','vamp'],
      rhythm:{ time:'4/4', bpm:'120–128', tip:'Four-on-the-floor kick. Open hat on the “and”. Sidechain pad to kick. Stab chords on the “and” of every beat.' },
      pattern:{ drums:{ kick:[0,4,8,12], snare:[4,12], hhClosed:[0,2,4,6,8,10,12,14], hhOpen:[2,6,10,14] }, bass:'pumping', chords:'four-floor' },
    },
    { id:'baroque', name:'Baroque / Classical',
      qualities:['maj','m','7','dim','dim7','maj7','m7'],
      scales:['major','natural_minor','harmonic_minor'],
      moves:['ii-V-I','I-IV-V','sequences','authentic-cadence'],
      rhythm:{ time:'4/4, 3/4, 6/8', bpm:'60–140', tip:'Walking quarter-note bass. Counterpoint: independent moving voices. Resolve all leading tones up. Avoid parallel fifths.' },
      pattern:{ drums:{ kick:[], snare:[], hhClosed:[], hhOpen:[] }, bass:'walking', chords:'block' },
    },
    { id:'impressionist', name:'Impressionist (Debussy/Ravel)',
      qualities:['maj7','maj9','maj7s11','add9','quartal','7s11','m9','aug','6/9'],
      scales:['lydian','whole_tone','dim_whole_half','major_pent','melodic_minor'],
      moves:['parallel-motion','planing','quartal'],
      rhythm:{ time:'free', bpm:'40–80', tip:'Plane chords in parallel motion. Pedal tones in the bass. Use whole-tone or pentatonic colours over a static bass note.' },
      pattern:{ drums:{ kick:[], snare:[], hhClosed:[], hhOpen:[] }, bass:'sustained', chords:'arp' },
    },
    { id:'reggae', name:'Reggae',
      qualities:['maj','m','7','sus4'],
      scales:['major','minor_pent','mixolydian'],
      moves:['I-V','I-IV-V'],
      rhythm:{ time:'4/4', bpm:'70–90', tip:'Skank on the “and” of every beat (off-beat upstrokes). Bass plays roots on 1 and 3. Drop the 1 of the bar in “one drop” style.' },
      pattern:{ drums:{ kick:[8], snare:[8], hhClosed:[2,6,10,14], hhOpen:[] }, bass:'reggae', chords:'skank' },
    },
    { id:'synthwave', name:'Synthwave / 80s',
      qualities:['m','maj','sus2','add9','m7','maj7'],
      scales:['minor','dorian','phrygian'],
      moves:['Im-bVI-bIII-bVII','vi-IV-I-V'],
      rhythm:{ time:'4/4', bpm:'100–125', tip:'Gated reverb snare on 2 & 4. Arp sequencer in 16ths. Side-chained pad. Lead in a major-7 sustain over the minor-key vamp.' },
      pattern:{ drums:{ kick:[0,8], snare:[4,12], hhClosed:[0,2,4,6,8,10,12,14], hhOpen:[2,10] }, bass:'pumping', chords:'arp' },
    },
    { id:'hardrock', name:'Hard Rock / Grunge',
      qualities:['pow','maj','m','7'],
      scales:['minor_pent','mixolydian','dorian','phrygian'],
      moves:['I-bIII-IV','i-bVII-IV'],
      rhythm:{ time:'4/4', bpm:'100–140', tip:'Heavy 8ths on power chords. Drop the 1 occasionally with a kick rest for impact. Snare slightly compressed, kick punchy.' },
      pattern:{ drums:{ kick:[0,4,8,12], snare:[4,12], hhClosed:[0,2,4,6,8,10,12,14], hhOpen:[] }, bass:'root', chords:'block' },
    },
    { id:'celtic', name:'Celtic / Trad',
      qualities:['maj','m','sus2','sus4'],
      scales:['dorian','mixolydian','major','minor_pent'],
      moves:['I-bVII-IV','I-V-IV'],
      rhythm:{ time:'6/8 or 4/4 (reel)', bpm:'90–130', tip:'In 6/8: emphasise beats 1 and 4 (the dotted-quarters). Drone tonic + fifth. Use bodhrán doubled by guitar in DADGAD tuning.' },
      pattern:{ drums:{ kick:[0,8], snare:[4,12], hhClosed:[0,4,8,12], hhOpen:[] }, bass:'root-fifth', chords:'arp' },
    },
  ];

  // ── Scoring ──────────────────────────────────────────────────────────────
  function matchGenre(progression, scaleId) {
    if (!progression || progression.length === 0) {
      return { primary:null, influences:[], scores:[] };
    }
    const qualities = progression.map(c => c.quality);
    const categories = progression.map(c => c.category);
    const scaleMatch = (g) => g.scales.includes(scaleId) ? 4 : 0;

    const scored = GENRES.map(g => {
      let score = 0;
      score += scaleMatch(g);
      for (const q of qualities) if (g.qualities.includes(q)) score += 2;
      // Reward extensions for "advanced" genres
      const advanced = ['jazz','bossa','soul','gospel','impressionist','lofi'].includes(g.id);
      const extCount = qualities.filter(q => /maj7|m7|7|9|11|13|alt|b9|s9|s11|add9|sus/.test(q)).length;
      if (advanced) score += extCount;
      // Penalty for genre-mismatch: e.g. lots of altered chords shouldn't score 'country'
      const simple = ['pop','country','folk','reggae','hardrock','celtic'].includes(g.id);
      if (simple && extCount > 2) score -= 2;
      // Borrowed / secondary movement boosts jazz / soul / cinematic / gospel
      const fancyCats = categories.filter(c => c === 'borrowed' || c === 'secondary' || c === 'tt-sub' || c === 'dim-passing' || c === 'chromatic' || c === 'neapolitan').length;
      if (['jazz','bossa','soul','gospel','cinematic','impressionist'].includes(g.id)) score += fancyCats * 2;
      return { id: g.id, name: g.name, score, rhythm: g.rhythm };
    });
    scored.sort((a,b)=>b.score - a.score);
    const top = scored[0];
    const influences = scored.slice(1, 4).filter(s => s.score >= Math.max(2, top.score - 4));
    return {
      primary: top.score > 0 ? top : null,
      influences,
      scores: scored,
    };
  }

  function rhythmTip(genreId) {
    const g = GENRES.find(x => x.id === genreId);
    return g ? g.rhythm : null;
  }

  function getPattern(genreId) {
    const g = GENRES.find(x => x.id === genreId);
    return g && g.pattern ? g.pattern : null;
  }

  global.Genres = { GENRES, matchGenre, rhythmTip, getPattern };
})(typeof window !== 'undefined' ? window : globalThis);
