/* ChordPath — emotions.js
 * Detailed emotional targets the user can pick from. Each emotion has
 * chord-quality affinities, scale-degree preferences, motion rules, and a
 * tension target. `scoreEmotion(chord, emotionId, prevChord)` returns a
 * match score 0–10 used to badge & rank chord options.
 */
(function (global) {
  'use strict';

  const EMOTIONS = [
    { id:'wistful',     label:'Wistful / Bittersweet', group:'Soft',
      vibe:'Sweet sadness; the look back at something good that ended.',
      qualities:['maj7','m7','m9','add9','6'], degrees:[5,1,3], categories:['diatonic'],
      motion:'falling', tension:'low', colorTags:['lush','cool','soulful','dreamy'] },

    { id:'yearning',    label:'Yearning / Unresolved', group:'Soft',
      vibe:'Standing on the edge of a phrase; the question never quite answered.',
      qualities:['sus4','sus2','7sus4','m7','add9'], degrees:[4,1,3], categories:['diatonic','borrowed'],
      motion:'static', tension:'mid', colorTags:['gospel','open','soulful'] },

    { id:'melancholic', label:'Melancholic / Reflective', group:'Dark',
      vibe:'Sitting alone with the rain; minor with grace, not despair.',
      qualities:['m','m7','m9','m11','mMaj7'], degrees:[5,3,1], categories:['diatonic','borrowed'],
      motion:'falling', tension:'low', colorTags:['cool','melancholic','noir'] },

    { id:'nostalgic',   label:'Nostalgic / Hopeful', group:'Soft',
      vibe:'A warm photograph; the feeling of "before".',
      qualities:['maj','maj7','add9','6','sus2'], degrees:[0,5,3,4], categories:['diatonic'],
      motion:'rising', tension:'low', colorTags:['bright','lush','shimmering','sunny'] },

    { id:'triumphant',  label:'Triumphant / Anthemic', group:'Bright',
      vibe:'Arms-up chorus. The pay-off.',
      qualities:['maj','maj7','6'], degrees:[0,4,3,5], categories:['diatonic'],
      motion:'rising', tension:'falling', colorTags:['bright','sunny','triumphant'] },

    { id:'heroic',      label:'Heroic / Determined', group:'Bright',
      vibe:'Drive forward — fifths motion, borrowed strength.',
      qualities:['maj','maj7','pow','7'], degrees:[0,4,3], categories:['diatonic','borrowed'],
      motion:'rising', tension:'mid', colorTags:['bright','driving'] },

    { id:'anxious',     label:'Anxious / Nervous', group:'Tense',
      vibe:'Pulse in the chest; what comes next is unknown.',
      qualities:['dim','dim7','m7b5','7b9','aug'], degrees:[1,4,6], categories:['borrowed','dim-passing','secondary'],
      motion:'chromatic', tension:'rising', colorTags:['tense','haunting','urgent'] },

    { id:'tense_foreboding', label:'Tense / Foreboding', group:'Tense',
      vibe:'Storm clouds on the horizon. Something is coming.',
      qualities:['dim7','m7b5','7b9','7s9','7alt','aug'], degrees:[4,6,1], categories:['borrowed','secondary','tt-sub'],
      motion:'chromatic', tension:'high', colorTags:['tense','dramatic','haunting'] },

    { id:'aggressive',  label:'Aggressive / Driving', group:'Tense',
      vibe:'Foot down. Power chords and pulsing rhythm.',
      qualities:['pow','m','7','m7b5','dim'], degrees:[0,4,1,6], categories:['diatonic','borrowed'],
      motion:'rising', tension:'high', colorTags:['driving','gritty','tense'] },

    { id:'mysterious',  label:'Mysterious / Suspenseful', group:'Dark',
      vibe:'Walking through fog; nothing is what it seems.',
      qualities:['aug','m7b5','dim7','maj7s11','augMaj7'], degrees:[2,5,6], categories:['borrowed','chromatic'],
      motion:'static', tension:'mid', colorTags:['mysterious','unsettled','noir'] },

    { id:'dreamy',      label:'Dreamy / Ethereal', group:'Floating',
      vibe:'Floating. The melody you can\'t quite remember from a dream.',
      qualities:['maj7','maj9','maj7s11','add9','sus2','6/9'], degrees:[0,3,5], categories:['diatonic','borrowed'],
      motion:'static', tension:'low', colorTags:['dreamy','lush','lydian shimmer'] },

    { id:'epic',        label:'Epic / Cinematic', group:'Floating',
      vibe:'The mountain reveals itself. Wide-screen.',
      qualities:['maj','maj7','sus2','m','maj7s11'], degrees:[0,5,3,2], categories:['borrowed','chromatic'],
      motion:'rising', tension:'rising', colorTags:['cinematic','bright','dreamy'] },

    { id:'playful',     label:'Playful / Sunny', group:'Bright',
      vibe:'Skipping rhythm. Major-6 brightness.',
      qualities:['6','maj','add9','maj7'], degrees:[0,3,4], categories:['diatonic'],
      motion:'rising', tension:'low', colorTags:['sunny','bright','shimmering'] },

    { id:'sensual',     label:'Sensual / Smoky', group:'Soft',
      vibe:'Late-night room; minor 9th lounging in low light.',
      qualities:['m7','m9','m11','m7b5','maj7','13'], degrees:[1,4,5], categories:['diatonic','borrowed','secondary'],
      motion:'falling', tension:'mid', colorTags:['jazzy','noir','velvety','soulful'] },
  ];

  // ── Scoring ──────────────────────────────────────────────────────────────
  function scoreEmotion(chord, emotionId, prevChord) {
    const e = EMOTIONS.find(x => x.id === emotionId);
    if (!e) return 0;
    let score = 0;

    if (e.qualities.includes(chord.quality)) score += 4;
    // Scale degree (zero-based)
    const deg = typeof chord.scaleDegree === 'number' ? chord.scaleDegree - 1 : -1;
    if (deg >= 0 && e.degrees.includes(deg)) score += 2;
    if (e.categories.includes(chord.category)) score += 1;

    // Color tags overlap (descriptions.QUALITY_COLOR)
    const QC = (global.Descriptions && global.Descriptions.QUALITY_COLOR) || {};
    const tag = QC[chord.quality];
    if (tag && e.colorTags.some(t => tag.includes(t))) score += 1;

    // Motion check
    if (prevChord) {
      const interval = ((chord.rootPc - prevChord.rootPc) % 12 + 12) % 12;
      const direction = interval < 6 ? 'rising' : 'falling';
      const isChrom = interval === 1 || interval === 11;
      if (e.motion === direction) score += 1;
      if (e.motion === 'chromatic' && isChrom) score += 2;
      if (e.motion === 'static' && interval === 0) score += 1;
    }

    return Math.min(10, score);
  }

  // ── Whole-progression scoring ────────────────────────────────────────────
  // Given a progression and an emotion, how well does the WHOLE progression
  // express that emotion? Considers: average per-chord affinity, motion arc,
  // tension trajectory, category mix, and quality palette consistency.
  function scoreProgressionForEmotion(progression, emotionId) {
    const e = EMOTIONS.find(x => x.id === emotionId);
    if (!e || !progression || progression.length === 0) return 0;

    let total = 0;

    // 1. Per-chord affinity, weighted: tonic (first chord) matters most,
    //    then the latest chord (it's where the listener "is now"),
    //    then everything else.
    progression.forEach((ch, i) => {
      const isFirst = i === 0;
      const isLast  = i === progression.length - 1;
      const weight = isFirst ? 2.0 : (isLast ? 1.5 : 1.0);
      total += scoreEmotion(ch, emotionId, progression[i - 1] || null) * weight;
    });
    total = total / progression.length;   // normalise so length doesn't dominate

    // 1b. Tonic-quality anchor: a minor tonic strongly signals dark/melancholic
    //     palettes; a major tonic signals bright. This is the single biggest
    //     mood cue and the previous "count majors and minors" heuristic was
    //     missing it.
    const tonic = progression[0];
    if (e.qualities.includes(tonic.quality)) total += 3.0;
    // Penalty: if tonic quality clashes with the emotion's palette by mode
    //          (e.g. a major tonic for a sad emotion that wants minor)
    const sadEmotion = ['melancholic','wistful','sensual','mysterious','anxious','tense_foreboding'].includes(e.id);
    const brightEmotion = ['triumphant','heroic','nostalgic','playful','dreamy','epic'].includes(e.id);
    const tonicIsMinor = ['m','m7','m9','m11','mMaj7','m6'].includes(tonic.quality);
    const tonicIsMajor = ['maj','maj7','maj9','6','add9','6/9','sus2'].includes(tonic.quality);
    if (sadEmotion   && tonicIsMajor)  total -= 2.5;
    if (brightEmotion && tonicIsMinor) total -= 2.0;

    // 2. Motion arc — does the bass motion *overall* match the emotion?
    //    rising / falling / chromatic / static
    if (progression.length >= 2) {
      let rising = 0, falling = 0, chromaticSteps = 0, staticSteps = 0;
      for (let i = 1; i < progression.length; i++) {
        const diff = ((progression[i].rootPc - progression[i - 1].rootPc) % 12 + 12) % 12;
        if (diff === 0) staticSteps++;
        else if (diff === 1 || diff === 11) chromaticSteps++;
        else if (diff < 6) rising++;
        else falling++;
      }
      const norm = progression.length - 1;
      if (e.motion === 'rising'   && rising / norm   > 0.5) total += 1.5;
      if (e.motion === 'falling'  && falling / norm  > 0.5) total += 1.5;
      if (e.motion === 'chromatic' && chromaticSteps / norm > 0.3) total += 2;
      if (e.motion === 'static'   && staticSteps / norm > 0.4) total += 1.5;
    }

    // 3. Tension trajectory matches the emotion's wanted shape
    const A = global.Analysis;
    if (A && progression.length >= 2) {
      const arc = progression.map(ch => A.tensionScore(ch, progression[0].root));
      const start = arc[0], end = arc[arc.length - 1];
      const max = Math.max(...arc), min = Math.min(...arc);
      const trend = end - start;
      if (e.tension === 'rising'  && trend > 1) total += 1.2;
      if (e.tension === 'falling' && trend < -1) total += 1.2;
      if (e.tension === 'low'     && max <= 4) total += 1.0;
      if (e.tension === 'mid'     && max >= 3 && max <= 6) total += 0.8;
      if (e.tension === 'high'    && max >= 6) total += 1.2;
    }

    // 4. Category mix matches what the emotion prefers
    const wanted = new Set(e.categories || []);
    let catMatch = 0;
    progression.forEach(ch => { if (wanted.has(ch.category)) catMatch++; });
    total += (catMatch / progression.length) * 1.5;

    // 5. Quality palette — fraction of chords whose quality this emotion likes
    let qMatch = 0;
    progression.forEach(ch => { if (e.qualities.includes(ch.quality)) qMatch++; });
    total += (qMatch / progression.length) * 1.5;

    return total;
  }

  // Updated bestForEmotion: pick the candidate that makes the WHOLE
  // progression-after-appending feel most like the target emotion.
  // `context` can be either a previous chord (legacy) or { progression, prev }.
  function bestForEmotion(options, emotionId, context) {
    if (!emotionId) return [];
    let progression = [];
    let prev = null;
    if (context && Array.isArray(context.progression)) {
      progression = context.progression;
      prev = progression[progression.length - 1] || null;
    } else if (context && context.intervals) {
      // Legacy call: context is a single chord
      prev = context;
    }

    const scored = options.map(c => {
      // Trial-append candidate to progression
      const trial = progression.concat([c]);
      const wholeScore = scoreProgressionForEmotion(trial, emotionId);
      const localScore = scoreEmotion(c, emotionId, prev);
      // Weight: whole-progression matters more once we have context
      const w = Math.min(1, 0.4 + progression.length * 0.15);
      const combined = wholeScore * w + localScore * (1 - w);
      return { c, s: combined };
    });

    // Threshold scales with progression length: shorter prog has fewer
    // accumulated signals so a lower bar is needed to surface candidates.
    const threshold = progression.length === 0 ? 3 : 4;
    return scored
      .filter(x => x.s >= threshold)
      .sort((a, b) => b.s - a.s)
      .slice(0, 4)
      .map(x => x.c);
  }

  function getEmotion(id) { return EMOTIONS.find(e => e.id === id); }

  // Grouped for the <optgroup> picker
  function groupedEmotions() {
    const groups = {};
    EMOTIONS.forEach(e => {
      (groups[e.group] = groups[e.group] || []).push(e);
    });
    return groups;
  }

  global.Emotions = { EMOTIONS, scoreEmotion, scoreProgressionForEmotion, bestForEmotion, getEmotion, groupedEmotions };
})(typeof window !== 'undefined' ? window : globalThis);
