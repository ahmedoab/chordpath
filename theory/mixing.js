/* ChordPath — mixing.js
 * DAW-neutral mixing knowledge: a concrete effect chain per instrument
 * (with real numbers — Hz, ratios, ms, dB), pair tips for common clashes,
 * and a rough-balance order. Works with any EQ/compressor/reverb.
 */
(function (global) {
  'use strict';

  // chain steps: { fx, setting, why } — read top to bottom as a channel strip.
  const MIX_GUIDES = [
    { instrumentId:'lead_vocal', pan:'center', levelHint:'The loudest melodic element. If you ever lose a word, the vocal is too quiet or the mids are too crowded.',
      chain:[
        { fx:'High-pass filter', setting:'80–100 Hz, 12 dB/oct', why:'removes rumble, plosive thumps, and mic handling noise' },
        { fx:'Subtractive EQ', setting:'cut 2–4 dB around 250–400 Hz if boxy; sweep 2–4 kHz and cut the harsh spot 2–3 dB', why:'clears mud and harshness before compression makes them louder' },
        { fx:'Compressor', setting:'3:1 ratio, attack 15–30 ms, release 100–150 ms, 3–6 dB gain reduction', why:'evens phrases so quiet words survive the band' },
        { fx:'De-esser (or dynamic EQ band)', setting:'5–8 kHz, 2–4 dB reduction on esses', why:'compression makes S sounds spiky; tame them after' },
        { fx:'Gentle top boost', setting:'+1.5–3 dB shelf at 10–12 kHz', why:'air and presence without harshness' },
        { fx:'Reverb on a send', setting:'plate-style, 1.2–1.8 s decay, 60–80 ms pre-delay, high-pass the return at 300 Hz', why:'space without washing out the words — pre-delay keeps consonants dry' },
        { fx:'Slap or 1/8 delay on a send', setting:'80–120 ms slap or tempo-synced 1/8, low feedback, darker than the voice', why:'thickens choruses without obvious echo' },
      ],
      tip:'Ride the vocal fader (or automate) BEFORE compressing harder — automation sounds human, compression sounds squeezed.' },

    { instrumentId:'harmony_vocals', pan:'pairs at 30–60% left/right', levelHint:'6–10 dB under the lead; felt more than heard.',
      chain:[
        { fx:'High-pass filter', setting:'120–150 Hz', why:'stacked voices multiply low-mid mud fast' },
        { fx:'EQ', setting:'cut 2–3 dB at 3–4 kHz (presence)', why:'keeps them behind the lead — presence belongs to the lead only' },
        { fx:'Compressor', setting:'4:1, faster attack (5–10 ms), 4–6 dB reduction', why:'stacks should be flat and steady, like a pad' },
        { fx:'More reverb than the lead', setting:'same reverb send, 20–30% higher', why:'pushes them behind the lead in depth' },
      ],
      tip:'Record every harmony twice and pan the takes opposite — free width, free thickness.' },

    { instrumentId:'drums', pan:'kick/snare center, hats slightly off, overheads wide', levelHint:'Kick and snare nearly as loud as the vocal in energetic genres; much lower for folk/ballads.',
      chain:[
        { fx:'Kick EQ', setting:'boost +2–3 dB at 50–60 Hz (weight) and +2–3 dB at 3–4 kHz (click); cut 300–400 Hz', why:'weight plus definition, minus cardboard' },
        { fx:'Snare EQ', setting:'+2 dB at 200 Hz (body), +2–3 dB at 5 kHz (crack)', why:'full and snappy' },
        { fx:'Drum bus compressor', setting:'4:1, attack 10–30 ms, release 100 ms (or auto), 2–4 dB reduction', why:'glues the kit into one instrument' },
        { fx:'Optional parallel crush', setting:'duplicate the drum bus, compress 10+ dB, blend under at −10 to −15 dB', why:'energy and sustain without losing punch' },
        { fx:'Short room reverb', setting:'0.4–0.8 s, on snare/toms only', why:'realism; keep the kick dry' },
      ],
      tip:'Tune the kick to the song key when possible — a kick ringing at the tonic feels "right" for free.' },

    { instrumentId:'bass', pan:'center, always', levelHint:'Set kick first, then bring bass up until the low end feels even on the chorus.',
      chain:[
        { fx:'High-pass filter', setting:'30–40 Hz', why:'removes sub-rumble your speakers cannot play but your headroom pays for' },
        { fx:'Compressor', setting:'4:1, attack 10–20 ms, release 100–150 ms, 3–6 dB reduction', why:'bass must be even or the whole mix wobbles' },
        { fx:'Saturation', setting:'light drive, "keep low" style if available', why:'adds 700 Hz–2 kHz harmonics so bass reads on small speakers' },
        { fx:'EQ vs kick', setting:'if kick owns 50–60 Hz, boost bass at 80–100 Hz (or vice versa); cut the other instrument 2–3 dB where the first one lives', why:'they must interlock, not overlap' },
        { fx:'No reverb', setting:'—', why:'reverb on bass = mud; use a short chorus for width if anything' },
      ],
      tip:'Check the mix in mono: if the low end collapses, the bass (not the kick) is usually to blame.' },

    { instrumentId:'rhythm_gtr', pan:'double-track and pan 80L/80R; single takes at 30–50%', levelHint:'Under the vocal; loud enough that muting it feels empty.',
      chain:[
        { fx:'High-pass filter', setting:'80–120 Hz', why:'the low strings clash with bass; let the bass own that lane' },
        { fx:'EQ', setting:'cut 2–4 dB at 300–500 Hz if woolly; gentle presence +2 dB at 3 kHz for clean tones', why:'clarity without harshness' },
        { fx:'Compressor (clean tones)', setting:'3:1, medium attack, 2–4 dB reduction — skip for distorted tones', why:'distortion is already compression' },
        { fx:'Amp sim (if DI)', setting:'edge-of-breakup patch, then turn the gain DOWN one notch from where it sounds cool alone', why:'less gain always sits better in a band' },
        { fx:'Reverb/delay', setting:'shared room send; shoegaze/dream-pop: huge reverb PLUS modulation (chorus) before it', why:'the wash is a chain, not one pedal' },
      ],
      tip:'Two takes panned hard beats any stereo-widener plugin. Play it twice, even if take two is 95% as good.' },

    { instrumentId:'acoustic_gtr', pan:'solo act: center; in a band: 40–70% one side (mirror with another element)', levelHint:'Main instrument in folk; a texture layer in full arrangements.',
      chain:[
        { fx:'High-pass filter', setting:'70–90 Hz solo, 100–120 Hz in a band', why:'body resonance eats headroom fast' },
        { fx:'EQ', setting:'cut 2–4 dB at 200–300 Hz (boom); +2 dB shelf at 8–10 kHz (sparkle)', why:'openness without boominess' },
        { fx:'Compressor', setting:'3:1, attack 20–30 ms, release 150 ms, 2–4 dB', why:'keeps fingerpicking even while strums still pop' },
        { fx:'Reverb', setting:'small room or plate, 0.8–1.2 s', why:'acoustics want space, not caves' },
      ],
      tip:'Mic at the 12th fret, NOT at the soundhole — the soundhole is all boom.' },

    { instrumentId:'lead_gtr', pan:'center for the solo, or opposite the busiest element', levelHint:'Vocal-level during its moments, tucked otherwise — automate it.',
      chain:[
        { fx:'High-pass filter', setting:'120–150 Hz', why:'leads need no low end' },
        { fx:'EQ', setting:'cut the 2–4 kHz harsh spot 2–3 dB if icepick-y', why:'especially with amp sims' },
        { fx:'Delay before reverb', setting:'tempo-synced 1/4 or dotted-1/8, 2–4 repeats', why:'delay keeps clarity; reverb blurs — lean on delay' },
        { fx:'Reverb', setting:'same send as the vocal', why:'shared spaces glue a mix' },
      ],
      tip:'Double the melody an octave up at low volume for choruses that need to soar.' },

    { instrumentId:'piano', pan:'center, or gentle stereo (player perspective)', levelHint:'The bed in ballads; a mid-range guest in full bands.',
      chain:[
        { fx:'High-pass filter', setting:'60 Hz solo, 100–150 Hz in a band', why:'left hand vs bass guitar is the classic mud fight' },
        { fx:'EQ', setting:'cut 2–3 dB at 250–350 Hz in dense mixes; +1–2 dB at 4 kHz for note definition', why:'keeps chords readable' },
        { fx:'Compressor', setting:'2:1, slow attack 30 ms, 1–3 dB', why:'gentle — piano dynamics are the performance' },
        { fx:'Reverb', setting:'hall 1.5–2.5 s for ballads, small room in bands', why:'match the space to the arrangement size' },
      ],
      tip:'In a full band, play less piano: chords in the right hand only, above middle C, and nobody fights.' },

    { instrumentId:'e_piano', pan:'center or 30% off', levelHint:'Sits under vocals beautifully at modest levels.',
      chain:[
        { fx:'High-pass filter', setting:'80–100 Hz', why:'EPs have surprising sub content' },
        { fx:'Chorus or tremolo', setting:'slow rate, subtle depth', why:'the classic EP shimmer' },
        { fx:'Compressor', setting:'3:1, 2–3 dB', why:'evens the bark of harder-played notes' },
        { fx:'Reverb', setting:'plate, 1–1.5 s', why:'silk' },
      ],
      tip:'A touch of saturation turns a polite EP into a soulful one.' },

    { instrumentId:'organ', pan:'center or slow stereo rotary', levelHint:'Feel-it-not-hear-it glue; if you clearly hear the organ, it is loud.',
      chain:[
        { fx:'High-pass filter', setting:'100–150 Hz', why:'organs stack low harmonics fast' },
        { fx:'Rotary/chorus', setting:'slow, subtle', why:'movement keeps sustains alive' },
        { fx:'EQ', setting:'cut 2–3 dB wherever the vocal lives (2–4 kHz)', why:'sustained mids mask vocals' },
      ],
      tip:'Fade the organ in over the last chorus — instant "the song grew" feeling.' },

    { instrumentId:'pad', pan:'wide stereo', levelHint:'Should disappear when soloed off; audible only by its absence.',
      chain:[
        { fx:'High-pass filter', setting:'150–200 Hz', why:'pads add mud faster than any other layer' },
        { fx:'Low-pass filter', setting:'8–12 kHz if it fights vocal air', why:'keep the sparkle lane clear' },
        { fx:'Sidechain to kick', setting:'2–4 dB duck, fast release', why:'the pad breathes with the pulse instead of smearing it' },
        { fx:'Slow chorus/ensemble', setting:'subtle', why:'width and motion' },
      ],
      tip:'If the mix feels "full but small", the pad is too loud. It happens to everyone.' },

    { instrumentId:'strings', pan:'wide, or sections placed like a stage', levelHint:'Swell into choruses; automate rises rather than leaving them static.',
      chain:[
        { fx:'High-pass filter', setting:'100–150 Hz (celli lower if they carry the bass)', why:'sampled strings pile up low-mids' },
        { fx:'EQ', setting:'cut 2–3 dB at 1–2 kHz if honky/synthetic', why:'the "fake strings" band' },
        { fx:'Reverb', setting:'hall, 1.8–2.6 s', why:'strings live in halls; dry strings sound like a demo' },
      ],
      tip:'Real-sounding string parts move less than you think: long notes, few leaps.' },

    { instrumentId:'brass', pan:'center for stabs, spread for sections', levelHint:'Stabs briefly louder than everything except the vocal.',
      chain:[
        { fx:'EQ', setting:'+2 dB at 3–5 kHz for bite; high-pass 100 Hz', why:'brass reads through bite, not volume' },
        { fx:'Compressor', setting:'4:1, fast attack, 3–5 dB on stabs', why:'consistent punches' },
        { fx:'Short room reverb', setting:'0.6–1 s', why:'stabs want a room, not a cathedral' },
      ],
      tip:'Arrange silence around brass stabs — the gap is what makes them hit.' },

    { instrumentId:'synth_lead', pan:'center, width from delay not stereo spread', levelHint:'Hook-level: as loud as a vocal when it IS the vocal.',
      chain:[
        { fx:'EQ', setting:'high-pass 150 Hz; tame 2–4 kHz if piercing', why:'leads get harsh at loud cutoffs' },
        { fx:'OTT-style multiband', setting:'20–30% depth', why:'modern sheen and sustain' },
        { fx:'Ping-pong delay', setting:'1/8 synced, 20–35% feedback', why:'size without losing mono focus' },
        { fx:'Reverb', setting:'small, dark', why:'the delay is already the space' },
      ],
      tip:'Glide/portamento of 20–60 ms makes a plain lead line feel expensive.' },

    { instrumentId:'synth_bass', pan:'center', levelHint:'Same rules as bass guitar: steady, even, interlocked with the kick.',
      chain:[
        { fx:'Split the sub', setting:'keep below 100 Hz mono and clean; saturate only above', why:'clean sub + dirty mids = readable everywhere' },
        { fx:'Sidechain to kick', setting:'3–6 dB duck in four-on-floor genres', why:'the pump IS the genre' },
        { fx:'Compressor', setting:'4:1, 2–4 dB', why:'evenness' },
      ],
      tip:'One octave down is not always better — a bass an octave higher with saturation often reads louder.' },

    { instrumentId:'arp', pan:'40–70% one side, or ping-ponging', levelHint:'Texture level: below the hooks, above the pads.',
      chain:[
        { fx:'High-pass filter', setting:'200 Hz+', why:'arps are motion, not weight' },
        { fx:'Synced delay', setting:'dotted-1/8, low mix', why:'turns 16ths into lace' },
        { fx:'Filter automation', setting:'open the cutoff across the section', why:'free build-up energy' },
      ],
      tip:'Mute the arp in the verse and bring it back for the chorus — motion reads as lift.' },

    { instrumentId:'bells', pan:'wherever there is space, often 30% off-center', levelHint:'Quieter than you think; sparkle carries.',
      chain:[
        { fx:'High-pass filter', setting:'300 Hz+', why:'bells only need their top' },
        { fx:'Long reverb', setting:'2–4 s, generous', why:'bells are 20% attack, 80% tail' },
      ],
      tip:'One bell note on beat 1 of each bar, an octave above everything, is the dream-pop secret.' },

    { instrumentId:'choir', pan:'very wide', levelHint:'Under the lead vocal always — it is a cathedral, not a singer.',
      chain:[
        { fx:'High-pass filter', setting:'150 Hz', why:'stacked voices boom' },
        { fx:'EQ', setting:'cut 2–4 dB at 2–3 kHz', why:'keep intelligibility for the LEAD vocal' },
        { fx:'Big reverb', setting:'2–3 s hall', why:'choirs live in space' },
      ],
      tip:'Blur the words (oohs/aahs); a choir singing clear lyrics fights the lead.' },

    { instrumentId:'fx_texture', pan:'wide or drifting', levelHint:'Mixed so you only notice it when muted.',
      chain:[
        { fx:'High-pass + low-pass', setting:'keep roughly 500 Hz–10 kHz', why:'textures should never own an extreme' },
        { fx:'Huge reverb', setting:'send it away', why:'depth layer' },
      ],
      tip:'A single vinyl-crackle or room-tone track under everything hides digital silence between phrases.' },

    { instrumentId:'percussion', pan:'spread pieces around the kit', levelHint:'Felt in the groove, never spotlighted.',
      chain:[
        { fx:'High-pass filter', setting:'150–300 Hz', why:'keep the low lane for kick and bass' },
        { fx:'Transient control or comp', setting:'light, 1–3 dB', why:'consistency across hits' },
      ],
      tip:'Shakers slightly ahead of the beat push a song forward; tambourines slightly behind relax it.' },

    { instrumentId:'shaker_hats', pan:'30–50% off-center', levelHint:'Just audible; it works subliminally.',
      chain:[
        { fx:'High-pass filter', setting:'500 Hz+', why:'only the tick matters' },
        { fx:'EQ', setting:'shelf down above 12 kHz if fizzy', why:'let the vocal own the air' },
      ],
      tip:'Program 16ths with alternating velocity (loud-soft-medium-soft) so it breathes.' },

    { instrumentId:'sub_drone', pan:'center, mono', levelHint:'Low and steady; check on headphones AND speakers.',
      chain:[
        { fx:'Low-pass filter', setting:'120 Hz', why:'a drone is only its fundamental' },
        { fx:'No reverb, no chorus', setting:'—', why:'mono sub or mud' },
      ],
      tip:'Mute the drone when the bass plays a line — two low-end owners is one too many.' },
  ];

  // Symmetric pair tips for the most common clashes.
  const PAIR_TIPS = [
    { a:'bass', b:'drums', tip:'Kick vs bass is mix decision #1: give the kick 50–60 Hz and the bass 80–100 Hz (or swap), and cut each 2–3 dB where the other lives. Sidechain the bass to the kick 1–2 dB if they still blur.' },
    { a:'synth_bass', b:'drums', tip:'Sidechain the synth bass to the kick (3–6 dB in electronic styles) and keep the sub below 100 Hz mono.' },
    { a:'bass', b:'synth_bass', tip:'Two bass instruments in one section is one too many. Pick one per section, or give one ONLY the sub band and the other only mids.' },
    { a:'bass', b:'sub_drone', tip:'Mute the drone whenever the bass moves; hand the low end back to the drone in breakdowns.' },
    { a:'rhythm_gtr', b:'piano', tip:'Both live in the low-mids: high-pass the guitar at 120 Hz, keep the piano left hand above C3, and pan them 30L/30R.' },
    { a:'rhythm_gtr', b:'acoustic_gtr', tip:'Electric takes 250–500 Hz body, acoustic takes 8–10 kHz sparkle: EQ each toward its strength and pan them opposite.' },
    { a:'rhythm_gtr', b:'lead_gtr', tip:'Rhythm wide, lead center. Duck the rhythm 1–2 dB during lead phrases (or just play lighter there).' },
    { a:'rhythm_gtr', b:'organ', tip:'Organ sustains mask strums: low-pass the organ at 5 kHz and drop it 2 dB whenever both play.' },
    { a:'rhythm_gtr', b:'pad', tip:'A pad plus a wall of guitars is instant mud: high-pass the pad at 300 Hz so it becomes air above the guitars.' },
    { a:'piano', b:'pad', tip:'Cut the pad 2–3 dB at 500 Hz–1 kHz — the piano needs that band for note definition.' },
    { a:'piano', b:'e_piano', tip:'Two keyboards need two registers: piano above middle C, EP below, or alternate sections.' },
    { a:'piano', b:'strings', tip:'Strings take the long notes, piano takes the rhythm. If both sustain, cut strings 2 dB at 1–2 kHz.' },
    { a:'pad', b:'strings', tip:'These are the same layer in different clothes. Use one at a time, or high-pass the pad at 400 Hz and let strings own the body.' },
    { a:'lead_vocal', b:'lead_gtr', tip:'The oldest fight in rock: arrange them call-and-response. Where they must overlap, dip the guitar 2–3 dB at 2–4 kHz (dynamic EQ shines here).' },
    { a:'lead_vocal', b:'synth_lead', tip:'Same lane as vocal-vs-guitar: alternate phrases, and duck the synth 2–3 dB at 2–5 kHz under the voice.' },
    { a:'lead_vocal', b:'harmony_vocals', tip:'Keep harmonies darker (shelf down 3 dB above 8 kHz) and more reverbed than the lead so depth separates them.' },
    { a:'lead_vocal', b:'choir', tip:'Choir sings vowels, lead sings words. Carve the choir at 2–3 kHz so consonants always win.' },
    { a:'lead_vocal', b:'piano', tip:'In piano ballads, dip the piano 1–2 dB at 1–3 kHz only while the vocal sings (dynamic EQ or light sidechain).' },
    { a:'drums', b:'percussion', tip:'Percussion decorates the kit: keep it 6+ dB under the drums and pan it where the kit is empty.' },
    { a:'drums', b:'shaker_hats', tip:'If the kit already has busy hats, the shaker replaces them rather than doubling — pick one 16th-note voice.' },
    { a:'arp', b:'synth_lead', tip:'Arp is texture, lead is melody: high-pass the arp at 400 Hz and keep it 4–6 dB down so the lead reads.' },
    { a:'bells', b:'arp', tip:'Both are sparkle: offset them (bells on the downbeat, arp on 16ths) and pan them opposite.' },
    { a:'strings', b:'brass', tip:'Strings sustain underneath, brass punches on top. If both sustain, the orchestra turns to soup.' },
    { a:'acoustic_gtr', b:'piano', tip:'Both percussive and mid-heavy: acoustic gets 8 kHz+ sparkle and a side of the field, piano keeps the center.' },
    { a:'e_piano', b:'pad', tip:'The EP already is a pad with attack. Drop the pad entirely, or high-pass it at 500 Hz.' },
  ];

  function guideFor(instrumentId) {
    return MIX_GUIDES.find(g => g.instrumentId === instrumentId) || null;
  }

  function pairTip(aId, bId) {
    const hit = PAIR_TIPS.find(p =>
      (p.a === aId && p.b === bId) || (p.a === bId && p.b === aId));
    return hit ? hit.tip : null;
  }

  // Rough-balance order: build the mix in this sequence.
  function levelOrder() {
    return [
      'Start with everything muted.',
      'Drums first: kick, then snare, then the rest of the kit around them.',
      'Bass until the low end feels even with the kick (check the chorus, not the verse).',
      'Lead vocal until every word is clear over drums + bass.',
      'Main harmony instrument (guitar/piano/keys) under the vocal.',
      'Everything else one at a time — each new layer must earn its place without burying the last.',
      'Finally: pads, textures, and FX at "notice it when muted" level.',
    ];
  }

  global.Mixing = { MIX_GUIDES, PAIR_TIPS, guideFor, pairTip, levelOrder };
})(typeof window !== 'undefined' ? window : globalThis);
