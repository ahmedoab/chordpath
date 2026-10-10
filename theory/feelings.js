/* ChordPath — feelings.js
 * The feeling engine: turns "what do I want the listener to feel" into
 * concrete musical decisions — key, scale, tempo, chord progressions,
 * arrangement patterns, and instrument rosters — per genre and per section.
 *
 * Every feeling references an emotion id in Emotions (the pure scoring
 * engine); this module is the generator that drives it.
 */
(function (global) {
  'use strict';

  // ── Taxonomy ─────────────────────────────────────────────────────────────
  // modeBias: 'major' | 'minor' | 'either' — forces the scale family.
  // scaleBias: ordered preference, intersected with the genre profile.
  // keyBias: guitar-friendly keys first (the user reads guitar tab).
  // tempoNudge: BPM added to the genre's default tempo.
  // tensionShape: 'resolve' | 'unresolved' | 'build' | 'plateau'.
  // openingDegrees: preferred first-chord scale degrees (0-based).
  // vocalRegister: nudges which vocal patterns fit ('low'|'mid'|'high').
  const FEELINGS = [
    // Longing
    { id:'yearning', name:'Yearning', group:'Longing',
      vibe:'The question that never quite gets answered.',
      emotionId:'yearning', modeBias:'either', scaleBias:['major','mixolydian','dorian','natural_minor'],
      keyBias:['C','G','D','A','E'], tempoNudge:-4, progressionLength:[4,6],
      tensionShape:'unresolved', openingDegrees:[0,3,5], vocalRegister:'mid',
      rosterBias:{ add:['pad'], drop:[] },
      tip:'End phrases on IV, V, or a sus chord; let the chorus answer what the verse asks.' },
    { id:'nostalgic', name:'Nostalgic', group:'Longing',
      vibe:'A warm photograph of a time you cannot return to.',
      emotionId:'nostalgic', modeBias:'major', scaleBias:['major','mixolydian','lydian'],
      keyBias:['G','C','D','E','A'], tempoNudge:-6, progressionLength:[4,6],
      tensionShape:'resolve', openingDegrees:[0,5], vocalRegister:'mid',
      rosterBias:{ add:['e_piano'], drop:[] },
      tip:'Major 7ths and add9s are the sound of memory; resolve home but softly.' },
    { id:'wistful', name:'Wistful', group:'Longing',
      vibe:'Sweet sadness — the good thing that ended.',
      emotionId:'wistful', modeBias:'either', scaleBias:['major','dorian','natural_minor'],
      keyBias:['C','G','Em','D','A'], tempoNudge:-8, progressionLength:[4,6],
      tensionShape:'resolve', openingDegrees:[0,5,3], vocalRegister:'mid',
      rosterBias:{ add:[], drop:[] },
      tip:'Mix major and minor chords in the same phrase; the ambivalence is the feeling.' },
    { id:'homesick', name:'Homesick', group:'Longing',
      vibe:'Everything here reminds you of somewhere else.',
      emotionId:'wistful', modeBias:'either', scaleBias:['mixolydian','major','dorian'],
      keyBias:['D','G','C','E'], tempoNudge:-6, progressionLength:[3,5],
      tensionShape:'unresolved', openingDegrees:[0,4], vocalRegister:'mid',
      rosterBias:{ add:['acoustic_gtr'], drop:[] },
      tip:'The bVII chord is the sound of looking back over your shoulder.' },

    // Sorrow
    { id:'melancholic', name:'Melancholic', group:'Sorrow',
      vibe:'Sitting with the rain; minor with grace, not despair.',
      emotionId:'melancholic', modeBias:'minor', scaleBias:['natural_minor','dorian','harmonic_minor'],
      keyBias:['Am','Em','Dm','Bm','F#m'], tempoNudge:-10, progressionLength:[4,6],
      tensionShape:'resolve', openingDegrees:[0,5,3], vocalRegister:'mid',
      rosterBias:{ add:['strings'], drop:[] },
      tip:'Keep the melody falling; land phrases on the 3rd of the minor tonic.' },
    { id:'grieving', name:'Grieving', group:'Sorrow',
      vibe:'The weight that will not lift.',
      emotionId:'grieving', modeBias:'minor', scaleBias:['natural_minor','harmonic_minor'],
      keyBias:['Am','Dm','Em','Cm'], tempoNudge:-16, progressionLength:[3,5],
      tensionShape:'plateau', openingDegrees:[0], vocalRegister:'low',
      rosterBias:{ add:['strings'], drop:['lead_gtr'] },
      tip:'Slow everything down and repeat; grief circles rather than progresses.' },
    { id:'lonely', name:'Lonely', group:'Sorrow',
      vibe:'An empty room after everyone has left.',
      emotionId:'lonely', modeBias:'minor', scaleBias:['natural_minor','dorian'],
      keyBias:['Em','Am','Bm','Dm'], tempoNudge:-12, progressionLength:[2,4],
      tensionShape:'plateau', openingDegrees:[0,5], vocalRegister:'low',
      rosterBias:{ add:[], drop:['pad','harmony_vocals'] },
      tip:'Use fewer instruments than feels safe; the emptiness is the arrangement.' },
    { id:'hollow', name:'Hollow', group:'Sorrow',
      vibe:'Numb; the feeling of not feeling.',
      emotionId:'lonely', modeBias:'minor', scaleBias:['natural_minor','dorian','phrygian'],
      keyBias:['Em','Am','Dm'], tempoNudge:-8, progressionLength:[2,4],
      tensionShape:'plateau', openingDegrees:[0], vocalRegister:'low',
      rosterBias:{ add:['fx_texture'], drop:['lead_gtr','harmony_vocals'] },
      tip:'Open fifths and sus2 chords — no thirds, no commitment to happy or sad.' },

    // Warmth
    { id:'tender', name:'Tender', group:'Warmth',
      vibe:'A quiet word said close.',
      emotionId:'tender', modeBias:'major', scaleBias:['major','lydian','mixolydian'],
      keyBias:['C','G','F','D'], tempoNudge:-10, progressionLength:[4,6],
      tensionShape:'resolve', openingDegrees:[0,3], vocalRegister:'mid',
      rosterBias:{ add:['piano'], drop:['lead_gtr'] },
      tip:'Keep dynamics small; the intimacy dies the moment anything gets loud.' },
    { id:'romantic', name:'Romantic', group:'Warmth',
      vibe:'The slow dance; the room disappears.',
      emotionId:'romantic', modeBias:'major', scaleBias:['major','lydian'],
      keyBias:['F','C','G','Eb'], tempoNudge:-8, progressionLength:[4,8],
      tensionShape:'resolve', openingDegrees:[0,5,1], vocalRegister:'mid',
      rosterBias:{ add:['strings','e_piano'], drop:[] },
      tip:'Major 9ths and 6/9 chords; let ii-V motion carry the swoon.' },
    { id:'serene', name:'Serene', group:'Warmth',
      vibe:'Still water at dawn; nothing to resolve.',
      emotionId:'serene', modeBias:'major', scaleBias:['major','lydian','major_pent'],
      keyBias:['C','G','D','A'], tempoNudge:-14, progressionLength:[2,4],
      tensionShape:'plateau', openingDegrees:[0,3], vocalRegister:'mid',
      rosterBias:{ add:['pad'], drop:['drums'] },
      tip:'Two chords may be enough. Movement is the enemy of stillness.' },
    { id:'cozy', name:'Cozy', group:'Warmth',
      vibe:'Warm light, closed curtains, nowhere to be.',
      emotionId:'tender', modeBias:'major', scaleBias:['major','mixolydian','dorian'],
      keyBias:['C','F','G','Bb'], tempoNudge:-6, progressionLength:[4,6],
      tensionShape:'resolve', openingDegrees:[0,5], vocalRegister:'mid',
      rosterBias:{ add:['e_piano'], drop:[] },
      tip:'Soft sevenths, swung hats, and nothing brighter than mezzo-forte.' },

    // Light
    { id:'hopeful', name:'Hopeful', group:'Light',
      vibe:'The clouds break; something good is finally possible.',
      emotionId:'hopeful', modeBias:'major', scaleBias:['major','lydian','mixolydian'],
      keyBias:['C','G','D','A','E'], tempoNudge:0, progressionLength:[4,6],
      tensionShape:'build', openingDegrees:[0,3,5], vocalRegister:'mid',
      rosterBias:{ add:['pad'], drop:[] },
      tip:'Rise: melodies climb, the IV chord lifts, and the last chord opens rather than closes.' },
    { id:'playful', name:'Playful', group:'Light',
      vibe:'Skipping rhythm; a grin in chord form.',
      emotionId:'playful', modeBias:'major', scaleBias:['major','mixolydian','major_pent'],
      keyBias:['C','G','D','F'], tempoNudge:+8, progressionLength:[4,6],
      tensionShape:'resolve', openingDegrees:[0,3,4], vocalRegister:'high',
      rosterBias:{ add:[], drop:['pad'] },
      tip:'Major 6 chords, quick changes, and space for the rhythm to bounce.' },
    { id:'euphoric', name:'Euphoric', group:'Light',
      vibe:'The lights come up and everything peaks at once.',
      emotionId:'euphoric', modeBias:'major', scaleBias:['major','lydian','mixolydian'],
      keyBias:['C','G','D','A'], tempoNudge:+10, progressionLength:[4,4],
      tensionShape:'resolve', openingDegrees:[0,3,5], vocalRegister:'high',
      rosterBias:{ add:['harmony_vocals','pad'], drop:[] },
      tip:'Repeat the best four chords forever and stack octaves; euphoria is repetition plus size.' },
    { id:'triumphant', name:'Triumphant', group:'Light',
      vibe:'Arms-up chorus; the pay-off after the struggle.',
      emotionId:'triumphant', modeBias:'major', scaleBias:['major','mixolydian'],
      keyBias:['D','G','C','E','A'], tempoNudge:+4, progressionLength:[4,6],
      tensionShape:'resolve', openingDegrees:[0,4,3], vocalRegister:'high',
      rosterBias:{ add:['harmony_vocals'], drop:[] },
      tip:'Save the tonic for the downbeat of the chorus; the arrival IS the triumph.' },

    // Drive
    { id:'defiant', name:'Defiant', group:'Drive',
      vibe:'Knocked down, standing back up anyway.',
      emotionId:'defiant', modeBias:'minor', scaleBias:['natural_minor','dorian','mixolydian'],
      keyBias:['Em','Am','Dm','Bm','E'], tempoNudge:+8, progressionLength:[4,5],
      tensionShape:'build', openingDegrees:[0,5], vocalRegister:'mid',
      rosterBias:{ add:['lead_gtr'], drop:['pad'] },
      tip:'Minor verse, major-lift chorus (bVI-bVII-i or i-bVII-IV); the lift is the defiance.' },
    { id:'restless', name:'Restless', group:'Drive',
      vibe:'Cannot sit still; the pulse keeps pushing.',
      emotionId:'restless', modeBias:'either', scaleBias:['dorian','natural_minor','mixolydian'],
      keyBias:['Am','Em','D','G'], tempoNudge:+12, progressionLength:[3,5],
      tensionShape:'build', openingDegrees:[1,0,4], vocalRegister:'mid',
      rosterBias:{ add:['arp'], drop:[] },
      tip:'Suspensions everywhere and never fully land; motion is the message.' },
    { id:'heroic', name:'Heroic', group:'Drive',
      vibe:'Forward through the storm; borrowed strength.',
      emotionId:'heroic', modeBias:'major', scaleBias:['major','mixolydian','lydian'],
      keyBias:['D','G','C','Eb','E'], tempoNudge:+6, progressionLength:[4,6],
      tensionShape:'build', openingDegrees:[0,4], vocalRegister:'high',
      rosterBias:{ add:['strings','brass'], drop:[] },
      tip:'Fifths motion and borrowed bVI-bVII into I — the movie-trailer engine.' },
    { id:'urgent', name:'Urgent', group:'Drive',
      vibe:'No time; every bar leans into the next.',
      emotionId:'restless', modeBias:'minor', scaleBias:['natural_minor','phrygian','dorian'],
      keyBias:['Em','Am','Bm','F#m'], tempoNudge:+16, progressionLength:[3,4],
      tensionShape:'build', openingDegrees:[0,1], vocalRegister:'mid',
      rosterBias:{ add:[], drop:['pad'] },
      tip:'Short loop, driving 8ths, and a bass line that never stops moving.' },

    // Shadow
    { id:'menacing', name:'Menacing', group:'Shadow',
      vibe:'Something circling closer in the dark.',
      emotionId:'menacing', modeBias:'minor', scaleBias:['phrygian','natural_minor','harmonic_minor','phrygian_dom'],
      keyBias:['Em','Am','Dm','Cm'], tempoNudge:-4, progressionLength:[2,4],
      tensionShape:'plateau', openingDegrees:[0,1], vocalRegister:'low',
      rosterBias:{ add:['sub_drone','fx_texture'], drop:['harmony_vocals'] },
      tip:'The bII chord is the threat; keep it low, slow, and repetitive.' },
    { id:'anxious', name:'Anxious', group:'Shadow',
      vibe:'Pulse in the chest; what comes next is unknown.',
      emotionId:'anxious', modeBias:'minor', scaleBias:['natural_minor','harmonic_minor','locrian'],
      keyBias:['Am','Em','Bm','Dm'], tempoNudge:+6, progressionLength:[3,5],
      tensionShape:'build', openingDegrees:[1,6,0], vocalRegister:'mid',
      rosterBias:{ add:['arp'], drop:[] },
      tip:'Diminished colours and chromatic bass steps; resolve nothing until the chorus.' },
    { id:'mysterious', name:'Mysterious', group:'Shadow',
      vibe:'Walking through fog; nothing is what it seems.',
      emotionId:'mysterious', modeBias:'either', scaleBias:['dorian','whole_tone','lydian','natural_minor'],
      keyBias:['Dm','Am','E','C'], tempoNudge:-8, progressionLength:[3,5],
      tensionShape:'unresolved', openingDegrees:[2,5,0], vocalRegister:'mid',
      rosterBias:{ add:['pad','fx_texture'], drop:['rhythm_gtr'] },
      tip:'Augmented and sus chords blur the tonal centre — never confirm the key.' },
    { id:'haunted', name:'Haunted', group:'Shadow',
      vibe:'The past is in the room with you.',
      emotionId:'tense_foreboding', modeBias:'minor', scaleBias:['harmonic_minor','natural_minor','phrygian'],
      keyBias:['Am','Dm','Em','Gm'], tempoNudge:-12, progressionLength:[3,5],
      tensionShape:'unresolved', openingDegrees:[0,5], vocalRegister:'low',
      rosterBias:{ add:['strings','fx_texture'], drop:['drums'] },
      tip:'The V in harmonic minor aches; let reverb tails outlast every note.' },

    // Wide
    { id:'epic', name:'Epic', group:'Wide',
      vibe:'The mountain reveals itself; wide-screen.',
      emotionId:'epic', modeBias:'either', scaleBias:['major','lydian','natural_minor','dorian'],
      keyBias:['D','C','Em','G'], tempoNudge:-6, progressionLength:[4,8],
      tensionShape:'build', openingDegrees:[0,5,2], vocalRegister:'high',
      rosterBias:{ add:['strings','brass','choir'], drop:[] },
      tip:'Chromatic mediants (I-bVI, I-bIII) are instant scale; build over 8 bars, not 2.' },
    { id:'dreamy', name:'Dreamy', group:'Wide',
      vibe:'Floating; the melody you cannot quite remember from a dream.',
      emotionId:'dreamy', modeBias:'major', scaleBias:['lydian','major','dorian'],
      keyBias:['C','E','G','A','D'], tempoNudge:-10, progressionLength:[2,4],
      tensionShape:'plateau', openingDegrees:[0,3,5], vocalRegister:'high',
      rosterBias:{ add:['pad','fx_texture'], drop:[] },
      tip:'Maj7#11 and add9 over a static bass; blur every edge with reverb.' },
  ];

  // What the chorus/bridge should feel like when the song's main feeling is X.
  // The chorus "answers" the verse; the bridge contrasts both.
  const CONTRAST = {
    yearning:    { chorus:'nostalgic',  bridge:'melancholic' },
    nostalgic:   { chorus:'hopeful',    bridge:'wistful' },
    wistful:     { chorus:'nostalgic',  bridge:'lonely' },
    homesick:    { chorus:'yearning',   bridge:'tender' },
    melancholic: { chorus:'hopeful',    bridge:'lonely' },
    grieving:    { chorus:'melancholic', bridge:'serene' },
    lonely:      { chorus:'yearning',   bridge:'hollow' },
    hollow:      { chorus:'lonely',     bridge:'menacing' },
    tender:      { chorus:'romantic',   bridge:'wistful' },
    romantic:    { chorus:'euphoric',   bridge:'tender' },
    serene:      { chorus:'hopeful',    bridge:'dreamy' },
    cozy:        { chorus:'tender',     bridge:'nostalgic' },
    hopeful:     { chorus:'triumphant', bridge:'yearning' },
    playful:     { chorus:'euphoric',   bridge:'hopeful' },
    euphoric:    { chorus:'euphoric',   bridge:'dreamy' },
    triumphant:  { chorus:'triumphant', bridge:'heroic' },
    defiant:     { chorus:'triumphant', bridge:'menacing' },
    restless:    { chorus:'defiant',    bridge:'anxious' },
    heroic:      { chorus:'triumphant', bridge:'epic' },
    urgent:      { chorus:'defiant',    bridge:'anxious' },
    menacing:    { chorus:'defiant',    bridge:'haunted' },
    anxious:     { chorus:'restless',   bridge:'lonely' },
    mysterious:  { chorus:'yearning',   bridge:'haunted' },
    haunted:     { chorus:'grieving',   bridge:'menacing' },
    epic:        { chorus:'triumphant', bridge:'mysterious' },
    dreamy:      { chorus:'euphoric',   bridge:'mysterious' },
  };

  // Chord-source filters per feeling group: which harmonic colours the
  // progression generator may draw from.
  const FILTERS_BY_GROUP = {
    Longing: { diatonic:true, borrowed:true, secondary:false, ttSub:false, dimPassing:false, chromatic:false, neapolitan:false },
    Sorrow:  { diatonic:true, borrowed:true, secondary:false, ttSub:false, dimPassing:false, chromatic:false, neapolitan:false },
    Warmth:  { diatonic:true, borrowed:false, secondary:true, ttSub:false, dimPassing:false, chromatic:false, neapolitan:false },
    Light:   { diatonic:true, borrowed:true, secondary:false, ttSub:false, dimPassing:false, chromatic:false, neapolitan:false },
    Drive:   { diatonic:true, borrowed:true, secondary:false, ttSub:false, dimPassing:false, chromatic:false, neapolitan:false },
    Shadow:  { diatonic:true, borrowed:true, secondary:true, ttSub:false, dimPassing:true, chromatic:true, neapolitan:true },
    Wide:    { diatonic:true, borrowed:true, secondary:false, ttSub:false, dimPassing:false, chromatic:true, neapolitan:false },
  };

  // Core roster per genre id (fallback 'default'). Instrument ids match
  // Instruments.INSTRUMENTS; feelings then add/drop on top.
  const GENRE_ROSTERS = {
    default:       ['drums','bass','rhythm_gtr','lead_vocal'],
    pop:           ['drums','bass','rhythm_gtr','piano','lead_vocal'],
    indie:         ['drums','bass','rhythm_gtr','lead_gtr','lead_vocal'],
    classic_rock:  ['drums','bass','rhythm_gtr','lead_gtr','lead_vocal'],
    hardrock:      ['drums','bass','rhythm_gtr','lead_gtr','lead_vocal'],
    metal:         ['drums','bass','rhythm_gtr','lead_gtr','lead_vocal'],
    jazz:          ['drums','bass','piano','lead_vocal'],
    bossa:         ['drums','bass','acoustic_gtr','lead_vocal'],
    blues:         ['drums','bass','rhythm_gtr','lead_gtr','lead_vocal'],
    funk:          ['drums','bass','rhythm_gtr','e_piano','lead_vocal'],
    soul:          ['drums','bass','e_piano','rhythm_gtr','lead_vocal','harmony_vocals'],
    gospel:        ['drums','bass','piano','organ','lead_vocal','harmony_vocals'],
    folk:          ['acoustic_gtr','bass','lead_vocal'],
    country:       ['drums','bass','acoustic_gtr','lead_gtr','lead_vocal'],
    celtic:        ['acoustic_gtr','bass','lead_vocal'],
    flamenco:      ['acoustic_gtr','percussion','lead_vocal'],
    cinematic:     ['strings','piano','pad','sub_drone'],
    lofi:          ['drums','bass','e_piano','fx_texture'],
    house:         ['drums','synth_bass','pad','arp','lead_vocal'],
    synthwave:     ['drums','synth_bass','pad','arp','synth_lead','lead_vocal'],
    baroque:       ['piano','strings','bass'],
    impressionist: ['piano','strings'],
    reggae:        ['drums','bass','rhythm_gtr','organ','lead_vocal'],
    shoegaze:      ['drums','bass','rhythm_gtr','lead_gtr','fx_texture','lead_vocal'],
    goth_postpunk: ['drums','bass','rhythm_gtr','synth_lead','lead_vocal'],
    jangle_indie:  ['drums','bass','rhythm_gtr','lead_gtr','lead_vocal'],
    dream_pop:     ['drums','bass','rhythm_gtr','pad','lead_vocal'],
    slowcore:      ['drums','bass','rhythm_gtr','lead_vocal'],
    alt_folk:      ['acoustic_gtr','bass','drums','lead_vocal'],
  };

  // rand() can return exactly 1.0 (the LCG divides by its own max), so a
  // plain Math.floor(rand()*len) may index past the end. Always clamp.
  function pick(list, rand) {
    if (!list || !list.length) return null;
    return list[Math.min(list.length - 1, Math.floor(rand() * list.length))];
  }

  function getFeeling(id) { return FEELINGS.find(f => f.id === id) || null; }

  function groupedFeelings() {
    const groups = {};
    FEELINGS.forEach(f => { (groups[f.group] = groups[f.group] || []).push(f); });
    return groups;
  }

  function contrastFor(feelingId, role) {
    const c = CONTRAST[feelingId];
    if (!c) return feelingId;
    if (role === 'chorus') return c.chorus;
    if (role === 'bridge') return c.bridge;
    return feelingId;
  }

  // ── Key / scale / tempo ──────────────────────────────────────────────────
  function isMinorScale(scaleId) {
    return /minor|phrygian|locrian|dorian/.test(scaleId) && scaleId !== 'dorian_b2';
  }

  function chooseKeyAndScale(feelingId, genreId, seed) {
    const S = global.Scales;
    const A = global.Arrangements;
    const f = getFeeling(feelingId) || FEELINGS[0];
    const profile = A.profileFor(genreId);
    const rand = global.Melody.rng(seed || 1);

    // Scale: first feeling bias that the genre also likes; honour modeBias.
    const genreScales = profile.scales || ['major'];
    let candidates = f.scaleBias.filter(s => genreScales.includes(s));
    if (candidates.length === 0) candidates = f.scaleBias.slice();
    if (f.modeBias === 'minor') {
      const minors = candidates.filter(isMinorScale);
      if (minors.length) candidates = minors;
      else candidates = ['natural_minor'];
    } else if (f.modeBias === 'major') {
      const majors = candidates.filter(s => !isMinorScale(s));
      if (majors.length) candidates = majors;
      else candidates = ['major'];
    }
    const scale = pick(candidates, rand) || 'major';

    // Key: keyBias entries like 'Am' mean "A" in a minor context.
    const minorish = isMinorScale(scale);
    const pool = f.keyBias
      .filter(k => minorish === k.endsWith('m'))
      .map(k => k.replace(/m$/, ''));
    const fallback = minorish ? ['A','E','D','B'] : ['C','G','D','A'];
    const keys = pool.length ? pool : fallback;
    const key = pick(keys, rand);
    return { key, scale };
  }

  function chooseTempo(feelingId, genreId, energy) {
    const A = global.Arrangements;
    const f = getFeeling(feelingId) || FEELINGS[0];
    const profile = A.profileFor(genreId);
    const energyMul = energy === 'low' ? 0.88 : energy === 'high' ? 1.1 : 1.0;
    let tempo = Math.round((profile.defaultTempo + (f.tempoNudge || 0)) * energyMul);
    // Clamp into the default rhythm's advertised bpm window when available.
    const rhythm = A.byId(A.RHYTHMS, profile.defaultRhythm);
    if (rhythm && rhythm.bpm) {
      const m = String(rhythm.bpm).match(/(\d+)\s*-\s*(\d+)/);
      if (m) tempo = Math.max(+m[1], Math.min(+m[2], tempo));
    }
    return Math.max(40, Math.min(200, tempo));
  }

  // ── Progression generation ───────────────────────────────────────────────
  function tensionTarget(shape, pos, len) {
    const t = len <= 1 ? 1 : pos / (len - 1);   // 0..1 through the phrase
    switch (shape) {
      case 'build':      return 2 + t * 5;       // 2 → 7
      case 'resolve':    return 4 - t * 3;       // 4 → 1
      case 'unresolved': return 2 + t * 3;       // 2 → 5, ends leaning
      case 'plateau':
      default:           return 2;
    }
  }

  function tensionShapeBonus(candidate, key, shape, pos, len) {
    const A = global.Analysis;
    if (!A) return 0;
    const target = tensionTarget(shape, pos, len);
    const t = A.tensionScore(candidate, key);
    return -Math.abs(t - target) * 0.6;
  }

  function pickOpeningChord(key, scale, feeling, rand, sevenths) {
    const C = global.Chords;
    const diatonics = C.diatonicChords(key, scale, { sevenths });
    if (!diatonics.length) return C.buildChord(key, 'maj');
    const degrees = feeling.openingDegrees || [0];
    const deg = pick(degrees, rand);
    const found = diatonics.find(d => (d.scaleDegree - 1) === deg);
    return found || diatonics[0];
  }

  function genreLikesSevenths(genreId) {
    return ['jazz','bossa','soul','gospel','lofi','impressionist','shoegaze','dream_pop'].includes(genreId);
  }

  function buildProgression(opts) {
    const P = global.Progressions;
    const E = global.Emotions;
    const f = getFeeling(opts.feelingId) || FEELINGS[0];
    const rand = global.Melody.rng(opts.seed || 1);
    const role = opts.role || 'verse';

    // Role overrides the feeling's default arc where the section's job is clear.
    let shape = f.tensionShape;
    if (role === 'prechorus') shape = 'build';
    else if (role === 'chorus' && shape !== 'unresolved') shape = 'resolve';
    else if (role === 'intro' || role === 'outro') shape = 'plateau';

    const lenRange = f.progressionLength || [4, 4];
    let length = opts.length ||
      (lenRange[0] + Math.floor(rand() * (lenRange[1] - lenRange[0] + 1)));
    if (role === 'intro' || role === 'outro') length = Math.min(length, 2 + Math.floor(rand() * 2));

    const sevenths = opts.sevenths != null ? opts.sevenths : genreLikesSevenths(opts.genreId);
    const progression = [pickOpeningChord(opts.key, opts.scale, f, rand, sevenths)];

    while (progression.length < length) {
      const pool = P.getNextChordOptions({
        key: opts.key, scale: opts.scale, progression, sevenths,
        filters: FILTERS_BY_GROUP[f.group],
      });
      if (!pool.length) break;
      const considered = pool.slice(0, 14);
      let best = null, bestScore = -Infinity;
      for (const cand of considered) {
        const trial = progression.concat([cand]);
        const score =
          E.scoreProgressionForEmotion(trial, f.emotionId)
          + tensionShapeBonus(cand, opts.key, shape, progression.length, length)
          - (cand.scoreRank || 0) * 0.15     // keep the engine's musical ranking in play
          + rand() * 1.5;                     // seeded variety between rerolls
        if (score > bestScore) { bestScore = score; best = cand; }
      }
      if (!best) break;
      progression.push(best);
    }

    enforceEnding(progression, shape, opts.key, opts.scale, sevenths);
    return progression;
  }

  // Nudge the last chord toward (resolve) or away from (unresolved) home.
  function enforceEnding(progression, shape, key, scale, sevenths) {
    const C = global.Chords;
    const S = global.Scales;
    if (progression.length < 2) return;
    const keyPc = S.noteIndex(key);
    const last = progression[progression.length - 1];

    if (shape === 'resolve' && last.rootPc !== keyPc) {
      const diatonics = C.diatonicChords(key, scale, { sevenths });
      const tonic = diatonics.find(d => d.rootPc === keyPc);
      // Only force it when the current ending is not already a classic
      // pre-tonic sound left hanging on purpose (V or IV feel fine too when
      // the loop repeats) — keep it simple: chorus/resolve wants home.
      if (tonic) progression[progression.length - 1] = tonic;
    } else if (shape === 'unresolved' && last.rootPc === keyPc) {
      const diatonics = C.diatonicChords(key, scale, { sevenths });
      const leaning = diatonics.find(d => (d.scaleDegree - 1) === 4)   // V
        || diatonics.find(d => (d.scaleDegree - 1) === 3);             // IV
      if (leaning) progression[progression.length - 1] = leaning;
    }
  }

  // ── Arrangement + roster ─────────────────────────────────────────────────
  const DRUM_WEIGHT = { intro: 0.4, verse: 0.55, prechorus: 0.75, chorus: 1.0, bridge: 0.5, outro: 0.4 };

  function bpmInRange(bpmStr, tempo) {
    const m = String(bpmStr || '').match(/(\d+)\s*-\s*(\d+)/);
    if (!m) return true;
    return tempo >= +m[1] - 8 && tempo <= +m[2] + 8;
  }

  function density(drum) {
    return drum.kick.length + drum.snare.length + drum.hhClosed.length + drum.hhOpen.length;
  }

  function pickArrangement(opts) {
    const A = global.Arrangements;
    const profile = A.profileFor(opts.genreId);
    const f = getFeeling(opts.feelingId) || FEELINGS[0];
    const rand = global.Melody.rng(opts.seed || 1);
    const role = opts.role || 'verse';
    const tempo = opts.tempo || profile.defaultTempo;
    const fams = new Set(profile.families || []);

    // Rhythm: same family, bpm window contains the tempo.
    let rhythms = A.RHYTHMS.filter(r => fams.has(r.family) && bpmInRange(r.bpm, tempo));
    if (!rhythms.length) rhythms = A.RHYTHMS.filter(r => fams.has(r.family));
    if (!rhythms.length) rhythms = [A.byId(A.RHYTHMS, profile.defaultRhythm)];
    const rhythm = pick(rhythms, rand);

    // Drums: same family (Space always allowed); density steered by role and
    // the section's energy weight.
    const targetWeight = (DRUM_WEIGHT[role] != null ? DRUM_WEIGHT[role] : 0.6) *
      (opts.energy === 'high' ? 1.15 : opts.energy === 'low' ? 0.8 : 1);
    let drums = A.DRUMS.filter(d => fams.has(d.family));
    if (!drums.length) drums = [A.byId(A.DRUMS, profile.defaultDrums)];
    const maxDensity = Math.max.apply(null, drums.map(density)) || 1;
    let bestDrum = drums[0], bestDist = Infinity;
    for (const d of drums) {
      const dist = Math.abs(density(d) / maxDensity - targetWeight) + rand() * 0.25;
      if (dist < bestDist) { bestDist = dist; bestDrum = d; }
    }
    if (role === 'intro' && rand() < 0.5) bestDrum = A.byId(A.DRUMS, 'none');

    // Vocal: prefer the profile default; chorus gets the lift pattern when the
    // feeling wants a high register.
    let vocal = A.byId(A.VOCAL_MELODIES, profile.defaultVocal);
    if (role === 'chorus' && (f.vocalRegister === 'high' || rand() < 0.5)) {
      vocal = A.byId(A.VOCAL_MELODIES, 'chorus_lift');
    }

    const under = A.byId(A.UNDER_MELODIES, profile.defaultUnder);

    return {
      rhythmPattern: rhythm.id,
      drumPattern: bestDrum.id,
      vocalPattern: vocal.id,
      underPattern: under ? under.id : 'none',
      textureTone: profile.defaultTextureTone,
      drumTone: profile.defaultDrumTone,
      melodyTone: profile.defaultMelodyTone,
    };
  }

  function defaultRoster(genreId, feelingId, role, energy) {
    const f = getFeeling(feelingId) || FEELINGS[0];
    const base = (GENRE_ROSTERS[genreId] || GENRE_ROSTERS.default).slice();
    const set = new Set(base);
    (f.rosterBias && f.rosterBias.add || []).forEach(id => set.add(id));
    (f.rosterBias && f.rosterBias.drop || []).forEach(id => set.delete(id));
    if (role === 'intro') set.delete('lead_vocal');
    if (role === 'intro' || role === 'outro') set.delete('harmony_vocals');
    if (role === 'chorus' && energy !== 'low' && set.has('lead_vocal')) set.add('harmony_vocals');
    if (energy === 'low') set.delete('percussion');
    return Array.from(set);
  }

  // ── Whole-song generation ────────────────────────────────────────────────
  const SECTION_PLANS = {
    low:  ['intro', 'verse', 'chorus', 'verse', 'chorus', 'outro'],
    mid:  ['intro', 'verse', 'prechorus', 'chorus', 'verse', 'prechorus', 'chorus', 'outro'],
    high: ['intro', 'verse', 'prechorus', 'chorus', 'verse', 'prechorus', 'chorus', 'bridge', 'chorus', 'outro'],
  };

  function generateSectionSpec(song, role, feelingId, seed) {
    const Song = global.Song;
    const progression = buildProgression({
      key: song.key, scale: song.scale, feelingId, role,
      genreId: song.genreId, seed,
    });
    const arr = pickArrangement({
      genreId: song.genreId, feelingId, role,
      energy: song.energy, tempo: song.tempo, seed: seed + 101,
    });
    const section = Song.createSection(Object.assign({
      role,
      feelingId: feelingId === song.feelingId ? null : feelingId,
      melodySeed: (seed * 7919 + 17) & 0xffff,
      underSeed: (seed * 104729 + 31) & 0xffff,
      roster: defaultRoster(song.genreId, feelingId, role, song.energy),
    }, arr));
    Song.setProgression(section, progression);
    return section;
  }

  function generateSongSpec(opts) {
    const Song = global.Song;
    const feelingId = opts.feelingId || 'nostalgic';
    const genreId = opts.genreId || 'pop';
    const energy = opts.energy || 'mid';
    const seed = opts.seed != null ? opts.seed : (Date.now() & 0xffff);

    const ks = chooseKeyAndScale(feelingId, genreId, seed);
    const song = Song.createSong({
      title: opts.title || 'Untitled song',
      genreId, feelingId, energy,
      key: ks.key, scale: ks.scale,
      tempo: chooseTempo(feelingId, genreId, energy),
    });

    const plan = SECTION_PLANS[energy] || SECTION_PLANS.mid;
    // Reuse generated specs for repeated roles so verse 2 = verse 1 (the
    // arrangement can then diverge by hand), but choruses stay identical by
    // design — repetition is what makes a chorus a chorus.
    const cache = {};
    plan.forEach((role, i) => {
      const secFeeling = contrastFor(feelingId, role);
      if (cache[role]) {
        // Deep clone so editing verse 2 never silently edits verse 1.
        const dupe = Song.createSection(JSON.parse(JSON.stringify(cache[role])));
        dupe.id = Song.newId('sec');
        song.sections.push(dupe);
        return;
      }
      const section = generateSectionSpec(song, role, secFeeling, seed + i * 37);
      cache[role] = section;
      song.sections.push(section);
    });
    Song.autoNameSections(song);
    return song;
  }

  global.Feelings = {
    FEELINGS, CONTRAST, FILTERS_BY_GROUP, GENRE_ROSTERS, SECTION_PLANS,
    getFeeling, groupedFeelings, contrastFor,
    chooseKeyAndScale, chooseTempo,
    buildProgression, pickArrangement, defaultRoster,
    generateSectionSpec, generateSongSpec,
  };
})(typeof window !== 'undefined' ? window : globalThis);
