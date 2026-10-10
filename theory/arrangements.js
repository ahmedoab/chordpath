/* ChordPath - focused arrangement palette.
 * Selectable style, section, rhythm, drum, lead-vocal, and under-melody data
 * for shoegaze, gothic post-punk, jangle indie, dream pop, slowcore, and
 * alt-folk writing.
 */
(function (global) {
  'use strict';

  const STYLE_PROFILES = [
    {
      id: 'shoegaze',
      name: 'Shoegaze / Noise Pop',
      defaultTempo: 88,
      subgenres: ['wall of guitars', 'glide-guitar haze', 'noise pop'],
      families: ['Shoegaze', 'Dream Pop', 'Space'],
      scales: ['major', 'natural_minor', 'lydian', 'mixolydian'],
      chordColors: ['add9', 'sus2', 'maj7', 'm7', 'pedal tones'],
      defaultRhythm: 'shoegaze_wash',
      defaultDrums: 'hazy_backbeat',
      defaultVocal: 'stepwise_haze',
      defaultUnder: 'high_drone',
      defaultTextureTone: 'wash',
      defaultDrumTone: 'hazy',
      defaultMelodyTone: 'soft',
      summary: 'Dense sustained rhythm, blurred consonance, small vocal movement, and upper drones that make simple loops feel huge.',
    },
    {
      id: 'goth_postpunk',
      name: 'Gothic Post-Punk / New Wave',
      defaultTempo: 108,
      subgenres: ['chorus bassline', 'cold wave', 'dark jangle'],
      families: ['Post-Punk', 'Electronic', 'Space'],
      scales: ['natural_minor', 'dorian', 'harmonic_minor', 'mixolydian'],
      chordColors: ['i-bVII-bVI', 'iv', 'V in minor', 'sus4', 'madd9'],
      defaultRhythm: 'postpunk_chime',
      defaultDrums: 'motorik_backbeat',
      defaultVocal: 'low_question',
      defaultUnder: 'octave_bell',
      defaultTextureTone: 'clean',
      defaultDrumTone: 'dry',
      defaultMelodyTone: 'grit',
      summary: 'Driving bass, clean chorus guitars, minor-mode lift, and vocal phrases that answer the bassline instead of floating above it.',
    },
    {
      id: 'jangle_indie',
      name: 'Jangle Indie / Literate Guitar Pop',
      defaultTempo: 118,
      subgenres: ['12-string jangle', 'melodic bass', 'major/minor ambiguity'],
      families: ['Jangle', 'Indie Rock', 'Space'],
      scales: ['major', 'mixolydian', 'dorian', 'major_pent'],
      chordColors: ['maj7', 'add9', 'sus2', 'I-vi-IV-V', 'IV-iv-I'],
      defaultRhythm: 'jangle_arp',
      defaultDrums: 'dry_jangle',
      defaultVocal: 'speech_lift',
      defaultUnder: 'thirds_shadow',
      defaultTextureTone: 'clean',
      defaultDrumTone: 'dry',
      defaultMelodyTone: 'bell',
      summary: 'Bright arpeggios, melodic bass motion, quick chord turns, and vocal melodies that sit close to speech rhythm.',
    },
    {
      id: 'dream_pop',
      name: 'Dream Pop / Ethereal Indie',
      defaultTempo: 96,
      subgenres: ['chorused clean guitar', 'slow swirl', 'soft synth pad'],
      families: ['Dream Pop', 'Shoegaze', 'Electronic', 'Space'],
      scales: ['major', 'lydian', 'natural_minor', 'dorian'],
      chordColors: ['maj9', 'm9', 'sus2', 'add9', 'IV over tonic'],
      defaultRhythm: 'dream_pulse',
      defaultDrums: 'soft_sixteenths',
      defaultVocal: 'floating_arch',
      defaultUnder: 'fifth_chime',
      defaultTextureTone: 'wash',
      defaultDrumTone: 'soft',
      defaultMelodyTone: 'airy',
      summary: 'Rounder than shoegaze: the rhythm breathes, the vocal arches wider, and the counter-line supplies sparkle.',
    },
    {
      id: 'slowcore',
      name: 'Slowcore / Sadcore',
      defaultTempo: 72,
      subgenres: ['minimal drums', 'held chords', 'negative space'],
      families: ['Slowcore', 'Space'],
      scales: ['natural_minor', 'major', 'dorian'],
      chordColors: ['m7', 'add9', 'open fifths', 'I-iii-IV-iv'],
      defaultRhythm: 'slowcore_swell',
      defaultDrums: 'minimal_room',
      defaultVocal: 'falling_plain',
      defaultUnder: 'pedal_tonic',
      defaultTextureTone: 'dark',
      defaultDrumTone: 'distant',
      defaultMelodyTone: 'soft',
      summary: 'Sparse hits, long decays, and plain vocal shapes where the section arc matters more than harmonic density.',
    },
    {
      id: 'alt_folk',
      name: 'Alt-Folk / Fingerpicked Indie',
      defaultTempo: 92,
      subgenres: ['open tuning feel', 'drone strings', 'minor folk'],
      families: ['Folk', 'Slowcore', 'Space'],
      scales: ['major', 'mixolydian', 'dorian', 'major_pent', 'minor_pent'],
      chordColors: ['sus2', 'sus4', 'add9', 'I-bVII-IV', 'i-bVII-bVI'],
      defaultRhythm: 'folk_pick',
      defaultDrums: 'brush_folk',
      defaultVocal: 'folk_lilt',
      defaultUnder: 'low_counter',
      defaultTextureTone: 'clean',
      defaultDrumTone: 'soft',
      defaultMelodyTone: 'soft',
      summary: 'Alternating-bass picking, open strings, and simple melodic cells that can survive without drums.',
    },
  ];

  const RHYTHMS = [
    { id:'shoegaze_wash', name:'Shoegaze wash', family:'Shoegaze', time:'4/4', bpm:'72-105', chords:'shoegaze-wash', bass:'sustained', swing:0, tip:'Long chord wash with a second-half shimmer. Best with add9, sus2, maj7, and m7 colors.' },
    { id:'glide_strum', name:'Glide strum', family:'Shoegaze', time:'4/4', bpm:'82-112', chords:'glide-strum', bass:'root-fifth', swing:0.05, tip:'Even 8ths with delayed accents. It keeps the texture moving without making the harmony sound too clean.' },
    { id:'tremolo_haze', name:'Tremolo haze', family:'Shoegaze', time:'4/4', bpm:'78-112', chords:'tremolo-wash', bass:'sustained', swing:0.03, tip:'Held low chord plus repeated high shimmer. Good when the band should feel blurred but still moving.' },
    { id:'halftime_wall', name:'Half-time wall', family:'Shoegaze', time:'4/4', bpm:'68-96', chords:'half-wash', bass:'sustained', swing:0, tip:'Big first hit, long decay, and one late lift. Use for heavy verse or outro sections.' },
    { id:'reverse_swell', name:'Reverse swell feel', family:'Shoegaze', time:'4/4', bpm:'70-98', chords:'reverse-swell', bass:'root', swing:0.04, tip:'Soft pickup into the back half of each chord, like a reverse guitar swell without sounding mechanical.' },
    { id:'noise_pop_drive', name:'Noise-pop drive', family:'Shoegaze', time:'4/4', bpm:'104-136', chords:'noise-pop-drive', bass:'pumping', swing:0.02, tip:'Fast repeated strums under a hook. Brighter and more urgent than the slow wash patterns.' },
    { id:'heavy_downstrokes', name:'Heavy downstrokes', family:'Shoegaze', time:'4/4', bpm:'86-122', chords:'strum', bass:'root-fifth', swing:0.01, tip:'Clear repeated guitar attacks for choruses that need weight instead of blur.' },
    { id:'rolling_glide', name:'Rolling glide', family:'Shoegaze', time:'4/4', bpm:'82-116', chords:'glide-strum', bass:'pumping', swing:0.04, tip:'Glide rhythm with a busier bass pulse underneath.' },
    { id:'feedback_swell', name:'Feedback swell', family:'Shoegaze', time:'4/4', bpm:'64-94', chords:'reverse-swell', bass:'sustained', swing:0.02, tip:'Late bar swell for intros, bridges, and outro repeats.' },
    { id:'postpunk_chime', name:'Post-punk chime', family:'Post-Punk', time:'4/4', bpm:'96-132', chords:'postpunk-chime', bass:'root-fifth', swing:0, tip:'Clean upper-string hits around the backbeat. Works when the bass carries the hook.' },
    { id:'cold_pulse', name:'Cold pulse', family:'Post-Punk', time:'4/4', bpm:'92-124', chords:'cold-pulse', bass:'root-fifth', swing:0, tip:'Sparse top-string pulses, leaving space for a vocal or bass hook.' },
    { id:'chorus_chop', name:'New-wave chop', family:'Post-Punk', time:'4/4', bpm:'108-138', chords:'chorus-chop', bass:'walking', swing:0.02, tip:'Short syncopated guitar hits for a brighter new-wave lift.' },
    { id:'offbeat_stabs', name:'Offbeat stabs', family:'Post-Punk', time:'4/4', bpm:'98-132', chords:'comp', bass:'root-fifth', swing:0.05, tip:'Guitar answers the backbeat instead of filling every beat.' },
    { id:'motor_chime', name:'Motor chime', family:'Post-Punk', time:'4/4', bpm:'104-138', chords:'postpunk-chime', bass:'pumping', swing:0, tip:'Steadier bass with clipped upper guitar hits.' },
    { id:'stiff_new_wave', name:'Stiff new-wave pulse', family:'Post-Punk', time:'4/4', bpm:'112-146', chords:'cold-pulse', bass:'walking', swing:0, tip:'Tighter, more mechanical version for danceable dark-pop loops.' },
    { id:'jangle_arp', name:'Jangle arpeggio', family:'Jangle', time:'4/4', bpm:'104-132', chords:'jangle-arp', bass:'walking', swing:0, tip:'Continuous arpeggio with bright top notes. Good for I-vi-IV-V, I-iii-IV-iv, and Mixolydian loops.' },
    { id:'clean_strum', name:'Clean indie strum', family:'Jangle', time:'4/4', bpm:'96-126', chords:'strum', bass:'walking', swing:0.03, tip:'Clear up-front strums. Use when you need the chord change to be obvious.' },
    { id:'two_step_arp', name:'Two-step arpeggio', family:'Jangle', time:'4/4', bpm:'100-132', chords:'arp', bass:'walking', swing:0.06, tip:'Less constant than jangle arpeggio, with a small bounce in the bar.' },
    { id:'open_indie_strum', name:'Open indie strum', family:'Jangle', time:'4/4', bpm:'92-122', chords:'drone-strum', bass:'root-fifth', swing:0.04, tip:'Ringing top note over simple clean strums.' },
    { id:'tight_pop_comp', name:'Tight pop comp', family:'Jangle', time:'4/4', bpm:'108-136', chords:'chorus-chop', bass:'walking', swing:0.02, tip:'Short clipped chords for verses that need more rhythmic space.' },
    { id:'dream_pulse', name:'Dream-pop pulse', family:'Dream Pop', time:'4/4', bpm:'84-110', chords:'dream-pulse', bass:'root', swing:0.08, tip:'Soft chord pulses under a floating vocal. Let delays fill the empty 16ths.' },
    { id:'soft_arp_cloud', name:'Soft arp cloud', family:'Dream Pop', time:'4/4', bpm:'78-106', chords:'arp', bass:'sustained', swing:0.08, tip:'Slow arpeggio with soft edges. Good when the vocal needs a bed, not a busy guitar part.' },
    { id:'delay_dots', name:'Delay dots', family:'Dream Pop', time:'4/4', bpm:'82-112', chords:'dream-pulse', bass:'root-fifth', swing:0.1, tip:'Small chord dots that leave space for delay and vocal tails.' },
    { id:'wide_swell', name:'Wide swell', family:'Dream Pop', time:'4/4', bpm:'68-98', chords:'shoegaze-wash', bass:'sustained', swing:0.04, tip:'Long soft guitar/pad swell without full shoegaze density.' },
    { id:'pulse_arp', name:'Pulse arpeggio', family:'Dream Pop', time:'4/4', bpm:'90-116', chords:'arp', bass:'root', swing:0.04, tip:'Arpeggio movement with simpler bass so the vocal can float.' },
    { id:'slowcore_swell', name:'Slowcore swell', family:'Slowcore', time:'4/4', bpm:'55-82', chords:'slowcore-swell', bass:'sustained', swing:0, tip:'One main attack per chord, then space. Use this when the vocal lyric needs the foreground.' },
    { id:'slow_pick', name:'Slow picked notes', family:'Slowcore', time:'4/4', bpm:'52-78', chords:'slow-pick', bass:'sustained', swing:0.02, tip:'Three lonely guitar notes per chord. Good when the track should feel exposed.' },
    { id:'empty_downbeat', name:'Empty downbeat', family:'Slowcore', time:'4/4', bpm:'48-76', chords:'block', bass:'sustained', swing:0, tip:'Plain downbeat chords with very little internal movement.' },
    { id:'late_sparse_strum', name:'Late sparse strum', family:'Slowcore', time:'4/4', bpm:'54-84', chords:'drone-strum', bass:'sustained', swing:0.03, tip:'Loose late strum gestures for very bare loops.' },
    { id:'lonely_arp', name:'Lonely arpeggio', family:'Slowcore', time:'4/4', bpm:'50-78', chords:'arp', bass:'sustained', swing:0, tip:'Slow note-by-note motion that keeps the harmony exposed.' },
    { id:'folk_pick', name:'Alt-folk picking', family:'Folk', time:'4/4', bpm:'76-108', chords:'folk-pick', bass:'root-fifth', swing:0.04, tip:'Alternating bass plus upper plucks. Strong for open-string sus and add9 chords.' },
    { id:'drone_strum', name:'Drone strum', family:'Folk', time:'4/4', bpm:'72-104', chords:'drone-strum', bass:'root-fifth', swing:0.04, tip:'Loose strum with a ringing top note. Good for Mixolydian and Dorian folk loops.' },
    { id:'train_pick', name:'Train picking', family:'Folk', time:'4/4', bpm:'82-112', chords:'folk-pick', bass:'pumping', swing:0.03, tip:'More forward-moving folk picking with repeated bass.' },
    { id:'soft_downstrum', name:'Soft downstrum', family:'Folk', time:'4/4', bpm:'68-98', chords:'strum', bass:'root', swing:0.06, tip:'Simple acoustic-style downstrums when fingerpicking is too busy.' },
    { id:'modal_drone_pick', name:'Modal drone pick', family:'Folk', time:'4/4', bpm:'70-104', chords:'drone-strum', bass:'sustained', swing:0.02, tip:'Static low end with ringing top-note motion for Dorian or Mixolydian loops.' },
    // ── Broad-genre families ─────────────────────────────────────────────────
    { id:'pop_eights', name:'Pop 8th strum', family:'Pop', time:'4/4', bpm:'90-125', chords:'strum', bass:'root', swing:0, tip:'Down-up 8th strum with the snare on 2 and 4. The default modern pop bed.' },
    { id:'pop_block', name:'Pop block chords', family:'Pop', time:'4/4', bpm:'85-120', chords:'block', bass:'root', swing:0, tip:'One clear chord hit per change. Best when the vocal is the whole show.' },
    { id:'ballad_sustain', name:'Piano ballad sustain', family:'Pop', time:'4/4', bpm:'60-90', chords:'sustained', bass:'sustained', swing:0, tip:'Held chords and space; automate a build instead of adding busyness.' },
    { id:'rock_drive', name:'Rock 8th drive', family:'Rock', time:'4/4', bpm:'105-145', chords:'strum', bass:'root-fifth', swing:0.01, tip:'Driving 8ths with root-fifth bass. Palm-mute the verses, open up for the chorus.' },
    { id:'rock_anthem', name:'Anthem hits', family:'Rock', time:'4/4', bpm:'95-135', chords:'block', bass:'root-fifth', swing:0, tip:'Big spaced chord hits that leave room for a lead line or gang vocal.' },
    { id:'power_chug', name:'Power-chord chug', family:'Rock', time:'4/4', bpm:'110-180', chords:'block', bass:'root', swing:0, tip:'Tight low chugs; keep chords to roots and fifths and let the drums double the kick pattern.' },
    { id:'swing_comp', name:'Swing comping', family:'Jazz & Blues', time:'4/4', bpm:'100-180', chords:'comp', bass:'walking', swing:0.22, tip:'Comp on the and-of-2 and and-of-4 over a walking bass. Rootless voicings breathe better.' },
    { id:'shuffle_strum', name:'Blues shuffle', family:'Jazz & Blues', time:'4/4', bpm:'70-120', chords:'block', bass:'walking', swing:0.25, tip:'Hard-swung boom-chick. Dominant 7ths and 9ths everywhere; walk the turnaround.' },
    { id:'ballad_comp', name:'Jazz ballad comp', family:'Jazz & Blues', time:'4/4', bpm:'55-85', chords:'comp', bass:'sustained', swing:0.12, tip:'Sparse comping with long bass notes for slow standards and soul-jazz ballads.' },
    { id:'funk_sixteenth', name:'Funk 16th stabs', family:'Groove', time:'4/4', bpm:'90-115', chords:'comp', bass:'funk-16th', swing:0.06, tip:'Short muted stabs; the space between hits IS the groove. Three-note voicings max.' },
    { id:'soul_pocket', name:'Soul pocket', family:'Groove', time:'4/4', bpm:'70-100', chords:'comp', bass:'root', swing:0.08, tip:'Behind-the-beat chords on 1 and 3, Rhodes-style. Let the bass and ghost-snares talk.' },
    { id:'reggae_skank', name:'Reggae skank', family:'Groove', time:'4/4', bpm:'70-90', chords:'skank', bass:'reggae', swing:0.05, tip:'Chop the off-beats, drop beat 1 in the bass, and keep everything short and dry.' },
    { id:'bossa_comp', name:'Bossa comping', family:'Latin', time:'4/4', bpm:'120-140', chords:'comp', bass:'tumbao', swing:0, tip:'Syncopated chord stabs over a tumbao-style bass; keep the dynamics soft and even.' },
    { id:'flamenco_pulse', name:'Flamenco pulse', family:'Latin', time:'4/4', bpm:'100-160', chords:'arp', bass:'root', swing:0, tip:'Rolled arpeggio attacks standing in for rasgueado; accent the phrase ends.' },
    { id:'country_boomchick', name:'Country boom-chick', family:'Country', time:'4/4', bpm:'90-130', chords:'block', bass:'root-fifth', swing:0.04, tip:'Bass note on 1 and 3, chord chick on 2 and 4. Walk the bass into each change.' },
    { id:'travis_porch', name:'Travis picking', family:'Country', time:'4/4', bpm:'80-120', chords:'travis', bass:'root-fifth', swing:0.03, tip:'Alternating thumb plus melody fingers. Capo up for brighter voicings.' },
    { id:'house_four', name:'House four-floor', family:'Electronic', time:'4/4', bpm:'118-128', chords:'four-floor', bass:'pumping', swing:0, tip:'Stab chords off the kick; sidechain the pad so the kick pumps the whole track.' },
    { id:'synth_arp_line', name:'Synth arp sequence', family:'Electronic', time:'4/4', bpm:'100-125', chords:'arp', bass:'pumping', swing:0, tip:'16th arpeggiator over a pumping bass; automate the filter, not the notes.' },
    { id:'lofi_haze', name:'Lo-fi haze', family:'Electronic', time:'4/4', bpm:'70-90', chords:'sustained', bass:'root', swing:0.2, tip:'Held dusty chords, swung hats, and a lazy pocket. Imperfection is the sound.' },
    { id:'cinematic_pad', name:'Cinematic pad', family:'Cinematic', time:'4/4', bpm:'40-90', chords:'sustained', bass:'sustained', swing:0, tip:'Long overlapping pads. Build across 8 bars; use silence as an instrument.' },
    { id:'baroque_walk', name:'Baroque walking bass', family:'Classical', time:'4/4', bpm:'60-140', chords:'block', bass:'walking', swing:0, tip:'Quarter-note bass line under plain chords; think counterpoint, resolve leading tones up.' },
    { id:'planing_arp', name:'Impressionist planing', family:'Classical', time:'4/4', bpm:'40-80', chords:'arp', bass:'sustained', swing:0, tip:'Parallel chord colours arpeggiated over a pedal bass. Whole-tone and lydian shine here.' },
  ];

  const DRUMS = [
    { id:'hazy_backbeat', name:'Hazy backbeat', family:'Shoegaze', kick:[0,6,8,11,14], snare:[4,12], hhClosed:[0,2,5,8,10,13], hhOpen:[6,14], human:20, tip:'Washed backbeat with pushy kick pickups and loose hats. Better for shoegaze than a dry rock loop.' },
    { id:'shoegaze_ridewash', name:'Ride-wash backbeat', family:'Shoegaze', kick:[0,7,8,11], snare:[4,12], hhClosed:[0,2,4,6,8,10,12,14], hhOpen:[2,6,10,14], human:22, tip:'Big smeared cymbal feel around a normal backbeat. Use with wash or glide strum.' },
    { id:'halftime_haze', name:'Half-time haze', family:'Shoegaze', kick:[0,7,10], snare:[12], hhClosed:[0,3,6,8,11,14], hhOpen:[6,14], human:24, tip:'Slow heavy snare on beat 4, good for huge choruses or outro walls.' },
    { id:'tom_cloud', name:'Tom cloud', family:'Shoegaze', kick:[0,5,8,13], snare:[4,11,12], hhClosed:[0,4,8,12], hhOpen:[14], human:20, tip:'Looser tom-like push. Good when straight hats sound too stiff.' },
    { id:'motorik_backbeat', name:'Motorik backbeat', family:'Post-Punk', kick:[0,4,8,12], snare:[4,12], hhClosed:[0,2,4,6,8,10,12,14], hhOpen:[], tip:'Straight, unsentimental drive. Use for darker verse or pre-chorus pressure.' },
    { id:'cold_floor', name:'Cold four-on-floor', family:'Post-Punk', kick:[0,4,8,12], snare:[4,12], hhClosed:[0,4,8,12], hhOpen:[14], human:5, tip:'Stiffer dance-punk pulse. Good when the bassline is the hook.' },
    { id:'tribal_floor', name:'Tribal floor tom feel', family:'Post-Punk', kick:[0,3,8,10,12], snare:[4,12], hhClosed:[0,6,8,14], hhOpen:[], human:10, tip:'More pounding and ritual than shiny. Use for darker bridges.' },
    { id:'dry_jangle', name:'Dry jangle kit', family:'Jangle', kick:[0,7,10], snare:[4,12], hhClosed:[0,4,6,8,12,14], hhOpen:[], tip:'Tight kit with space for guitar arpeggios and melodic bass.' },
    { id:'indie_snap', name:'Indie snap', family:'Jangle', kick:[0,6,10], snare:[4,12], hhClosed:[0,2,4,8,10,12,14], hhOpen:[], human:8, tip:'Dry but more animated than the basic jangle kit.' },
    { id:'soft_sixteenths', name:'Soft 16ths', family:'Dream Pop', kick:[0,8], snare:[4,12], hhClosed:[0,1,2,3,4,6,8,9,10,11,12,14], hhOpen:[6,14], tip:'Light 16th shimmer, not aggressive. Good under wide vocal arcs.' },
    { id:'dream_brush', name:'Dream brush pulse', family:'Dream Pop', kick:[0,8,10], snare:[4,12], hhClosed:[0,3,6,8,11,14], hhOpen:[14], human:14, tip:'Softer, swaying pulse for dream-pop verses.' },
    { id:'minimal_room', name:'Minimal room', family:'Slowcore', kick:[0], snare:[12], hhClosed:[0,8], hhOpen:[], tip:'Almost empty. The missing backbeat makes the chord changes feel heavier.' },
    { id:'slow_heartbeat', name:'Slow heartbeat', family:'Slowcore', kick:[0,9], snare:[12], hhClosed:[], hhOpen:[], human:18, tip:'Two low pulses and one late snare. Very slowcore; leave the guitars alone.' },
    { id:'brush_folk', name:'Brush folk', family:'Folk', kick:[0,8], snare:[4,12], hhClosed:[0,4,8,12], hhOpen:[], tip:'Simple brushed pulse. It supports fingerpicking without turning into rock.' },
    { id:'stomp_clap', name:'Stomp-clap folk', family:'Folk', kick:[0,8,10], snare:[4,12], hhClosed:[0,8], hhOpen:[], human:12, tip:'More body and less cymbal. Good for alt-folk choruses.' },
    { id:'blast_wash', name:'Blast wash', family:'Shoegaze', kick:[0,4,8,12], snare:[4,12], hhClosed:[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15], hhOpen:[7,15], human:18, tip:'Fast cymbal sheet with a normal backbeat under it. Use when the chorus needs to feel bigger immediately.' },
    { id:'lazy_surge', name:'Lazy surge', family:'Shoegaze', kick:[0,5,8,14], snare:[4,12], hhClosed:[0,3,6,8,10,13], hhOpen:[6,15], human:26, tip:'Loose and behind the beat, with uneven hats and a late kick into the next bar.' },
    { id:'breakbeat_haze', name:'Breakbeat haze', family:'Shoegaze', kick:[0,3,7,10,14], snare:[4,11,12], hhClosed:[0,2,4,7,8,10,12,15], hhOpen:[6,14], human:20, tip:'A smeared breakbeat feel for noisy verses or bridges.' },
    { id:'doubletime_noise', name:'Double-time noise pop', family:'Shoegaze', kick:[0,3,6,8,11,14], snare:[4,12], hhClosed:[0,2,4,6,8,10,12,14], hhOpen:[15], human:12, tip:'Faster noise-pop push without changing the project tempo.' },
    { id:'slow_crash_backbeat', name:'Slow crash backbeat', family:'Shoegaze', kick:[0,8,10], snare:[4,12], hhClosed:[0,8], hhOpen:[0,4,8,12,15], human:24, tip:'Big open cymbal hits instead of tight hats. Good under wall-of-sound guitars.' },
    { id:'disco_punk', name:'Disco-punk hats', family:'Post-Punk', kick:[0,4,8,12], snare:[4,12], hhClosed:[0,2,4,6,8,10,12,14], hhOpen:[2,6,10,14], human:5, tip:'Four-on-floor with offbeat open hats. Good for dance-punk and new-wave choruses.' },
    { id:'gallop_floor', name:'Gallop floor', family:'Post-Punk', kick:[0,3,4,8,11,12], snare:[4,12], hhClosed:[0,3,6,8,11,14], hhOpen:[], human:8, tip:'Urgent galloping kick pattern for darker pre-chorus pressure.' },
    { id:'dark_shuffle', name:'Dark shuffle', family:'Post-Punk', kick:[0,6,8,13], snare:[4,12], hhClosed:[0,3,6,8,11,14], hhOpen:[11], human:11, tip:'A lopsided post-punk groove when straight 8ths feel too square.' },
    { id:'kraut_push', name:'Kraut push', family:'Post-Punk', kick:[0,4,8,12,14], snare:[4,12], hhClosed:[0,2,4,6,8,10,12,14], hhOpen:[], human:4, tip:'Very steady motor rhythm with one late kick pushing into the loop.' },
    { id:'tribal_toms_drive', name:'Tribal tom drive', family:'Post-Punk', kick:[0,3,8,10,13], snare:[4,7,12,15], hhClosed:[0,8], hhOpen:[], human:10, tip:'Pounding tom-style accents for bridges and darker outros.' },
    { id:'train_jangle', name:'Train jangle', family:'Jangle', kick:[0,4,8,12], snare:[4,12], hhClosed:[0,2,4,6,8,10,12,14], hhOpen:[], human:7, tip:'Straight moving beat for bright arpeggios and melodic bass.' },
    { id:'skip_backbeat', name:'Skipped backbeat', family:'Jangle', kick:[0,7,10,14], snare:[4,12], hhClosed:[0,2,5,8,10,13], hhOpen:[14], human:9, tip:'Jangle-pop pocket with small skips before the snare.' },
    { id:'tight_shuffle', name:'Tight shuffle', family:'Jangle', kick:[0,6,8,13], snare:[4,12], hhClosed:[0,3,6,8,11,14], hhOpen:[], human:9, tip:'A light shuffle for sunny major progressions that should not become rock-heavy.' },
    { id:'sunny_four', name:'Sunny four', family:'Jangle', kick:[0,4,8,12], snare:[4,12], hhClosed:[0,4,6,8,12,14], hhOpen:[6,14], human:6, tip:'Simple upbeat kit for choruses and clean strumming.' },
    { id:'college_drive', name:'College-radio drive', family:'Jangle', kick:[0,6,8,10,14], snare:[4,12], hhClosed:[0,2,4,6,8,10,12,14], hhOpen:[], human:8, tip:'Busier indie-guitar verse rhythm with enough kick motion to carry plain chords.' },
    { id:'liquid_half', name:'Liquid half-time', family:'Dream Pop', kick:[0,7,10], snare:[12], hhClosed:[0,2,5,8,10,13], hhOpen:[6,14], human:18, tip:'Half-time snare with floating hats for soft choruses.' },
    { id:'glassy_two_step', name:'Glassy two-step', family:'Dream Pop', kick:[0,3,8,10,14], snare:[4,12], hhClosed:[0,2,4,7,8,10,12,15], hhOpen:[6,14], human:12, tip:'A light two-step pulse that keeps dream-pop from dragging.' },
    { id:'soft_breakbeat', name:'Soft breakbeat', family:'Dream Pop', kick:[0,3,7,10], snare:[4,11,12], hhClosed:[0,2,5,7,8,10,13,15], hhOpen:[14], human:15, tip:'Breakbeat motion with reduced attack for airy pads and clean guitars.' },
    { id:'cloud_16ths', name:'Cloud 16ths', family:'Dream Pop', kick:[0,8], snare:[4,12], hhClosed:[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15], hhOpen:[], human:10, tip:'Continuous soft hats, useful when the harmony is slow but needs sparkle.' },
    { id:'breathing_pulse', name:'Breathing pulse', family:'Dream Pop', kick:[0,8,13], snare:[4,12], hhClosed:[0,3,6,9,12,15], hhOpen:[10], human:16, tip:'Sparse pulse with a late open hat, good for verses that should sway.' },
    { id:'empty_two', name:'Empty two', family:'Slowcore', kick:[0], snare:[8], hhClosed:[], hhOpen:[], human:22, tip:'Two hits in the whole bar. Good when the guitar and vocal need all the space.' },
    { id:'funeral_room', name:'Funeral room', family:'Slowcore', kick:[0,10], snare:[12], hhClosed:[0], hhOpen:[], human:26, tip:'Extremely slow-feeling room beat with a late kick before the snare.' },
    { id:'brushed_late', name:'Brushed late snare', family:'Slowcore', kick:[0,8], snare:[13], hhClosed:[0,4,8,12], hhOpen:[], human:20, tip:'Late snare placement for dragging, heavy verses.' },
    { id:'no_hat_room', name:'No-hat room hits', family:'Slowcore', kick:[0,9], snare:[4,12], hhClosed:[], hhOpen:[], human:18, tip:'Only kick and snare. Useful when cymbals make the track feel too busy.' },
    { id:'distant_march', name:'Distant march', family:'Slowcore', kick:[0,8], snare:[4,12], hhClosed:[2,6,10,14], hhOpen:[], human:24, tip:'Slow marching pulse that works with darker minor loops.' },
    { id:'train_brush', name:'Train brush', family:'Folk', kick:[0,4,8,12], snare:[4,12], hhClosed:[0,2,4,6,8,10,12,14], hhOpen:[], human:12, tip:'Brush-like train rhythm for fingerpicked or strummed folk.' },
    { id:'porch_shuffle', name:'Porch shuffle', family:'Folk', kick:[0,6,8,14], snare:[4,12], hhClosed:[0,3,6,8,11,14], hhOpen:[], human:14, tip:'Loose shuffle pocket for Dorian or Mixolydian folk loops.' },
    { id:'handclap_folk', name:'Handclap folk', family:'Folk', kick:[0,8,10], snare:[4,6,12,14], hhClosed:[0,8], hhOpen:[], human:11, tip:'Clap-like snare accents for bigger acoustic choruses.' },
    { id:'rolling_floor', name:'Rolling floor', family:'Folk', kick:[0,3,8,11], snare:[4,12], hhClosed:[0,4,8,12], hhOpen:[14], human:13, tip:'Rolling low pulse under drone-string folk progressions.' },
    { id:'campfire_snap', name:'Campfire snap', family:'Folk', kick:[0,8], snare:[4,7,12], hhClosed:[0,4,8,12,15], hhOpen:[], human:16, tip:'Simple folk beat with one extra snap to keep repeated chords alive.' },
    { id:'indie_drive', name:'Indie drive', family:'Indie Rock', kick:[0,3,8,10,14], snare:[4,12], hhClosed:[0,2,4,6,8,10,12,14], hhOpen:[], human:8, tip:'General indie-rock drive for choruses and faster demos.' },
    { id:'garage_skip', name:'Garage skip', family:'Indie Rock', kick:[0,6,7,10,14], snare:[4,12], hhClosed:[0,2,5,8,10,13], hhOpen:[15], human:10, tip:'Uneven garage-rock kick pattern with a late open hat.' },
    { id:'loud_quarters', name:'Loud quarters', family:'Indie Rock', kick:[0,4,8,12], snare:[4,12], hhClosed:[0,4,8,12], hhOpen:[2,6,10,14], human:6, tip:'Big simple quarter-note drive for rough full-band sketches.' },
    { id:'tom_build', name:'Tom build', family:'Indie Rock', kick:[0,8,10], snare:[4,7,11,12,15], hhClosed:[0,4,8,12], hhOpen:[], human:9, tip:'Build-up groove with extra snare/tom hits near the end of the bar.' },
    { id:'broken_beat', name:'Broken beat', family:'Electronic', kick:[0,3,9,11,14], snare:[4,12], hhClosed:[0,2,5,7,10,13,15], hhOpen:[6], human:6, tip:'Off-grid-feeling programmed rhythm for colder electronic demos.' },
    { id:'minimal_machine', name:'Minimal machine', family:'Electronic', kick:[0,8], snare:[4,12], hhClosed:[0,4,8,12], hhOpen:[], human:2, tip:'Stiff drum-machine pulse when you want the harmony to do the work.' },
    { id:'four_floor_shimmer', name:'Four-floor shimmer', family:'Electronic', kick:[0,4,8,12], snare:[4,12], hhClosed:[0,2,4,6,8,10,12,14], hhOpen:[2,6,10,14], human:3, tip:'Danceable four-on-floor with open-hat shimmer.' },
    { id:'dubby_drop', name:'Dubby drop', family:'Electronic', kick:[0,7,10], snare:[12], hhClosed:[2,6,10,14], hhOpen:[6,14], human:8, tip:'Delayed-feeling one-drop variant for spacious bridges.' },
    // ── Broad-genre families ─────────────────────────────────────────────────
    { id:'pop_backbeat', name:'Pop backbeat', family:'Pop', kick:[0,8], snare:[4,12], hhClosed:[0,2,4,6,8,10,12,14], hhOpen:[], human:6, tip:'The standard modern pop kit: kick 1 and 3, snare 2 and 4, straight 8th hats.' },
    { id:'pop_clap_four', name:'Clap four', family:'Pop', kick:[0,4,8,12], snare:[4,12], hhClosed:[0,2,4,6,8,10,12,14], hhOpen:[14], human:4, tip:'Four-on-the-floor pop chorus with a clap-style snare.' },
    { id:'rock_straight', name:'Straight rock', family:'Rock', kick:[0,6,10], snare:[4,12], hhClosed:[0,2,4,6,8,10,12,14], hhOpen:[], human:7, tip:'Classic rock kit with a pushed kick on the and-of-2.' },
    { id:'metal_double', name:'Double-kick drive', family:'Rock', kick:[0,2,4,6,8,10,12,14], snare:[4,12], hhClosed:[0,2,4,6,8,10,12,14], hhOpen:[], human:4, tip:'Constant 8th kicks under a straight backbeat. Gallop the guitars against it.' },
    { id:'swing_ride', name:'Swing ride', family:'Jazz & Blues', kick:[0], snare:[], hhClosed:[0,4,7,8,12,15], hhOpen:[4,12], human:10, tip:'Ride-pattern feel with a feathered kick; the snare only speaks in ghost accents.' },
    { id:'shuffle_blues', name:'Blues shuffle kit', family:'Jazz & Blues', kick:[0,8], snare:[4,12], hhClosed:[0,3,4,7,8,11,12,15], hhOpen:[], human:12, tip:'Swung triplet-feel hats over a plain backbeat. Everything leans.' },
    { id:'funk_ghost', name:'Funk ghost-note kit', family:'Groove', kick:[0,6,10], snare:[4,11,12,14], hhClosed:[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15], hhOpen:[], human:8, tip:'16th hats with ghost snares around the backbeat. Lock the kick with the bass line.' },
    { id:'soul_pocket_kit', name:'Soul pocket kit', family:'Groove', kick:[0,7], snare:[4,12], hhClosed:[0,2,4,6,8,10,12,14], hhOpen:[], human:12, tip:'Lazy pocket with a late second kick; sits behind the beat on purpose.' },
    { id:'reggae_onedrop', name:'One drop', family:'Groove', kick:[8], snare:[8], hhClosed:[2,6,10,14], hhOpen:[], human:8, tip:'Kick and cross-stick together on beat 3, nothing on 1. The space is the style.' },
    { id:'bossa_kit', name:'Bossa brush kit', family:'Latin', kick:[0,6,10], snare:[4,11,14], hhClosed:[0,2,4,6,8,10,12,14], hhOpen:[], human:6, tip:'Cross-stick clave pattern over steady hats; keep it all quiet and even.' },
    { id:'palmas_kit', name:'Palmas accents', family:'Latin', kick:[0], snare:[6,10,14], hhClosed:[2,6,10,14], hhOpen:[], human:10, tip:'Handclap-style accents standing in for palmas; let the guitar carry the pulse.' },
    { id:'country_train', name:'Train beat', family:'Country', kick:[0,4,8,12], snare:[2,6,10,14], hhClosed:[0,4,8,12], hhOpen:[], human:8, tip:'Brushed train rhythm: constant motion, snare on the off-quarters.' },
    { id:'lofi_knock', name:'Lo-fi knock', family:'Electronic', kick:[0,11], snare:[8], hhClosed:[0,2,4,6,8,10,12,14], hhOpen:[], human:14, tip:'Snare on 3 instead of 2-and-4, late kick, swung hats. Instant head-nod.' },
    { id:'synthwave_gate', name:'Gated 80s kit', family:'Electronic', kick:[0,8], snare:[4,12], hhClosed:[0,2,4,6,8,10,12,14], hhOpen:[2,10], human:3, tip:'Rigid machine backbeat for a huge gated snare; keep the grid perfect.' },
    { id:'cinematic_pulse', name:'Cinematic pulse', family:'Cinematic', kick:[0], snare:[], hhClosed:[], hhOpen:[], human:10, tip:'One low pulse per bar - or mute it entirely and let the pads breathe.' },
    { id:'none', name:'No drums', family:'Space', kick:[], snare:[], hhClosed:[], hhOpen:[], tip:'Use for intro, bridge drop, or a completely guitar-led folk section.' },
  ];

  const VOCAL_MELODIES = [
    { id:'stepwise_haze', name:'Stepwise haze', family:'Shoegaze', range:[62,76], anchor:'third', cells:[0,1.5,2.5,3.25], durations:[1,0.5,0.5,0.75], contour:[0,1,0,-1], tip:'Small movement around chord thirds so the vocal melts into the guitars.' },
    { id:'one_note_murmur', name:'One-note murmur', family:'Shoegaze', range:[60,72], anchor:'fifth', cells:[0.5,1.5,2.5,3.5], durations:[0.75,0.75,0.75,0.75], contour:[0,0,1,0], tip:'Almost one note, with tiny bends around it. Good for buried shoegaze vocals.' },
    { id:'late_phrase_lift', name:'Late phrase lift', family:'Shoegaze', range:[62,79], anchor:'third', cells:[0,1.75,2.75,3.5], durations:[1,0.5,0.5,0.75], contour:[0,0,1,3], tip:'Holds back, then lifts near the bar line so the chord change feels bigger.' },
    { id:'floating_arch', name:'Floating arch', family:'Dream Pop', range:[64,81], anchor:'fifth', cells:[0,1,2.25,3], durations:[0.75,0.75,0.5,1], contour:[0,2,3,1], tip:'Rises through the middle of the bar, then lands softly.' },
    { id:'high_hook', name:'High hook', family:'Dream Pop', range:[67,84], anchor:'third', cells:[0,1,2,3.25], durations:[0.5,0.75,0.75,0.75], contour:[2,4,5,3], tip:'A brighter hook shape for choruses and final repeats.' },
    { id:'sighing_fall', name:'Sighing fall', family:'Dream Pop', range:[62,78], anchor:'seventh', cells:[0,1.25,2.5,3.25], durations:[0.75,0.75,0.75,0.75], contour:[3,2,0,-1], tip:'Starts high and falls back into the track.' },
    { id:'low_question', name:'Low question', family:'Post-Punk', range:[55,69], anchor:'root', cells:[0.5,1.5,2.5,3.5], durations:[0.5,0.5,0.5,0.5], contour:[0,-1,0,1], tip:'Baritone, clipped, and unresolved. Good over bass-led minor progressions.' },
    { id:'deadpan_hook', name:'Deadpan hook', family:'Post-Punk', range:[53,68], anchor:'root', cells:[0,1,2,3], durations:[0.5,0.5,0.5,0.5], contour:[0,0,-1,0], tip:'Flat spoken hook. Good when the bassline carries the melody.' },
    { id:'minor_alarm', name:'Minor alarm', family:'Post-Punk', range:[57,72], anchor:'fifth', cells:[0.5,1.5,2,3], durations:[0.5,0.5,0.75,0.75], contour:[0,2,1,3], tip:'Small urgent jumps that fit darker pre-choruses.' },
    { id:'speech_lift', name:'Speech lift', family:'Jangle', range:[60,74], anchor:'third', cells:[0,0.75,2,3], durations:[0.5,0.5,0.75,0.75], contour:[0,0,1,2], tip:'Starts conversational, then lifts at the end of the line.' },
    { id:'quick_answer', name:'Quick answer', family:'Jangle', range:[61,77], anchor:'third', cells:[0,0.5,1.5,3], durations:[0.4,0.4,0.6,0.8], contour:[0,1,0,2], tip:'Short answering phrase for bright guitar-pop verses.' },
    { id:'major_six_smile', name:'Major-six smile', family:'Jangle', range:[62,79], anchor:'fifth', cells:[0,1,2.5,3.5], durations:[0.75,0.5,0.5,0.75], contour:[0,2,4,2], tip:'A sunnier line for major or Mixolydian loops.' },
    { id:'falling_plain', name:'Falling plainchant', family:'Slowcore', range:[57,70], anchor:'fifth', cells:[0,2], durations:[1.5,1.25], contour:[1,0,-1,-2], tip:'Few notes, mostly descending. The harmony has room to ache.' },
    { id:'two_note_lament', name:'Two-note lament', family:'Slowcore', range:[55,69], anchor:'third', cells:[0,2.75], durations:[1.5,1], contour:[0,-1], tip:'Two long notes per chord. Use when everything should feel bare.' },
    { id:'low_rise', name:'Low slow rise', family:'Slowcore', range:[54,71], anchor:'root', cells:[0,2], durations:[1.25,1.25], contour:[0,1,2,1], tip:'A slow climb that gives sparse chords a direction.' },
    { id:'folk_lilt', name:'Folk lilt', family:'Folk', range:[60,76], anchor:'root', cells:[0,1,1.75,3], durations:[0.75,0.5,0.75,0.75], contour:[0,1,2,1], tip:'Pentatonic-friendly and easy to sing with fingerpicked guitar.' },
    { id:'plain_story', name:'Plain story', family:'Folk', range:[58,73], anchor:'root', cells:[0,1.5,2.5,3.25], durations:[0.75,0.75,0.5,0.75], contour:[0,0,1,0], tip:'Simple verse line that stays out of the way of the words.' },
    { id:'modal_call', name:'Modal call', family:'Folk', range:[60,77], anchor:'fifth', cells:[0,1,2,3], durations:[0.5,0.75,0.75,0.75], contour:[0,2,1,3], tip:'Good for Dorian or Mixolydian folk loops.' },
    { id:'chorus_lift', name:'Chorus lift', family:'Chorus', range:[64,82], anchor:'third', cells:[0,1,2,3], durations:[0.75,0.75,0.75,0.75], contour:[0,2,4,5], tip:'Clear upward motion for a chorus or final repeat.' },
  ];

  const UNDER_MELODIES = [
    { id:'none', name:'None', family:'Space', type:'none', tip:'Leave the vocal alone.' },
    { id:'high_drone', name:'High drone', family:'Shoegaze', type:'drone', degree:'root', octave:5, every:4, tip:'Sustained tonic or fifth above the chords.' },
    { id:'feedback_fifth', name:'Feedback fifth', family:'Shoegaze', type:'drone', degree:'fifth', octave:5, every:4, tip:'One high fifth that behaves like controlled feedback.' },
    { id:'tremolo_top', name:'Tremolo top note', family:'Shoegaze', type:'chime', degree:'root', octave:5, cells:[0.5,1.5,2.5,3.5], tip:'Repeated top note for tremolo-guitar energy.' },
    { id:'octave_bell', name:'Octave bell', family:'Post-Punk', type:'chime', degree:'root', octave:5, cells:[1.5,3.5], tip:'Sparse octave hits that answer the snare.' },
    { id:'flat_answer', name:'Flat answer', family:'Post-Punk', type:'chord-tone', tone:'fifth', octave:4, cells:[1,2.5], tip:'A blunt two-note answer under a low vocal.' },
    { id:'thirds_shadow', name:'Thirds shadow', family:'Jangle', type:'chord-tone', tone:'third', octave:4, cells:[1,3], tip:'A second guitar shadowing chord thirds under the vocal.' },
    { id:'topline_ping', name:'Topline ping', family:'Jangle', type:'chime', degree:'third', octave:5, cells:[0.75,2.75], tip:'Bright pings that make jangle arpeggios sparkle.' },
    { id:'fifth_chime', name:'Fifth chime', family:'Dream Pop', type:'chime', degree:'fifth', octave:5, cells:[2.5], tip:'One bright fifth per bar, like a delayed guitar harmonic.' },
    { id:'soft_counter', name:'Soft counter-line', family:'Dream Pop', type:'counter', octave:4, cells:[1,3], tip:'A gentle line moving against the vocal.' },
    { id:'pedal_tonic', name:'Pedal tonic', family:'Slowcore', type:'drone', degree:'root', octave:3, every:4, tip:'Low tonic pedal for static pressure.' },
    { id:'low_fifth_pedal', name:'Low fifth pedal', family:'Slowcore', type:'drone', degree:'fifth', octave:3, every:4, tip:'Low fifth under the chords for heavier slowcore pressure.' },
    { id:'low_counter', name:'Low counter-line', family:'Folk', type:'counter', octave:3, cells:[0,2], tip:'A simple descending line under the vocal or guitar.' },
    { id:'open_string_hint', name:'Open-string hint', family:'Folk', type:'chime', degree:'root', octave:4, cells:[1,3], tip:'Ringing open-string style notes between vocal phrases.' },
  ];

  const SECTIONS = [
    { id:'intro', name:'Intro', target:'establish palette', ideal:'1-2 chord loop, tonic or suspended color, no full payoff yet' },
    { id:'verse', name:'Verse', target:'tell the story', ideal:'lower register, steady or gently rising tension, leave room for the melody' },
    { id:'prechorus', name:'Pre-chorus', target:'create lift', ideal:'raise tension, end on V, bVII, iv, or a suspended chord that wants release' },
    { id:'chorus', name:'Chorus', target:'payoff', ideal:'brighter register, wider melody, clear home chord or a loop that feels inevitable' },
    { id:'bridge', name:'Bridge', target:'contrast', ideal:'borrowed color, modal switch, or a drop in drums before the return' },
    { id:'outro', name:'Outro', target:'afterglow', ideal:'repeat the strongest loop, fade on a suspended color, or resolve plainly to home' },
  ];

  // ── Per-genre arrangement profiles ──────────────────────────────────────
  // One profile per genre id in Genres.GENRES. The six focused indie styles
  // keep their rich STYLE_PROFILES entries; the broad genres get equivalent
  // profiles here so the wizard and section editor can default any genre.
  // Shape matches STYLE_PROFILES: defaults + families + scales + summary.
  const BROAD_PROFILES = [
    { id:'pop', name:'Pop', defaultTempo:105, families:['Pop','Jangle','Indie Rock','Electronic','Space'],
      scales:['major','natural_minor','mixolydian'],
      defaultRhythm:'pop_eights', defaultDrums:'pop_backbeat', defaultVocal:'quick_answer', defaultUnder:'none',
      defaultTextureTone:'clean', defaultDrumTone:'dry', defaultMelodyTone:'soft',
      summary:'Clear chords, a front-and-centre vocal, and a chorus that repeats its best idea.' },
    { id:'indie', name:'Indie', defaultTempo:112, families:['Jangle','Indie Rock','Pop','Space'],
      scales:['major','mixolydian','lydian','dorian'],
      defaultRhythm:'clean_strum', defaultDrums:'indie_drive', defaultVocal:'speech_lift', defaultUnder:'topline_ping',
      defaultTextureTone:'clean', defaultDrumTone:'dry', defaultMelodyTone:'bell',
      summary:'Ringing guitars, conversational vocals, and colour chords that stay understated.' },
    { id:'classic_rock', name:'Classic Rock', defaultTempo:125, families:['Rock','Indie Rock','Space'],
      scales:['mixolydian','major','minor_pent','blues_minor'],
      defaultRhythm:'rock_drive', defaultDrums:'rock_straight', defaultVocal:'major_six_smile', defaultUnder:'none',
      defaultTextureTone:'clean', defaultDrumTone:'dry', defaultMelodyTone:'grit',
      summary:'Riff-first writing: power chords, open strings, and a backbeat that never blinks.' },
    { id:'jazz', name:'Jazz', defaultTempo:130, families:['Jazz & Blues','Space'],
      scales:['major','melodic_minor','dorian','bebop_dom','lydian_dom','altered'],
      defaultRhythm:'swing_comp', defaultDrums:'swing_ride', defaultVocal:'sighing_fall', defaultUnder:'none',
      defaultTextureTone:'clean', defaultDrumTone:'soft', defaultMelodyTone:'soft',
      summary:'ii-V language, walking bass, and comping that answers the soloist instead of filling.' },
    { id:'bossa', name:'Bossa Nova', defaultTempo:128, families:['Latin','Jazz & Blues','Space'],
      scales:['major','dorian','melodic_minor'],
      defaultRhythm:'bossa_comp', defaultDrums:'bossa_kit', defaultVocal:'sighing_fall', defaultUnder:'none',
      defaultTextureTone:'clean', defaultDrumTone:'soft', defaultMelodyTone:'soft',
      summary:'Soft syncopation, rich sevenths, and a vocal that floats just behind the clave.' },
    { id:'blues', name:'Blues', defaultTempo:95, families:['Jazz & Blues','Rock','Space'],
      scales:['blues_minor','minor_pent','mixolydian'],
      defaultRhythm:'shuffle_strum', defaultDrums:'shuffle_blues', defaultVocal:'plain_story', defaultUnder:'none',
      defaultTextureTone:'clean', defaultDrumTone:'dry', defaultMelodyTone:'grit',
      summary:'Dominant sevenths, a hard shuffle, and call-and-response between voice and guitar.' },
    { id:'funk', name:'Funk', defaultTempo:102, families:['Groove','Electronic','Space'],
      scales:['minor_pent','dorian','mixolydian'],
      defaultRhythm:'funk_sixteenth', defaultDrums:'funk_ghost', defaultVocal:'deadpan_hook', defaultUnder:'none',
      defaultTextureTone:'clean', defaultDrumTone:'dry', defaultMelodyTone:'grit',
      summary:'One chord can be enough: the groove is the song, so every hit has to count.' },
    { id:'soul', name:'Soul / R&B', defaultTempo:88, families:['Groove','Pop','Space'],
      scales:['major','dorian','minor_pent'],
      defaultRhythm:'soul_pocket', defaultDrums:'soul_pocket_kit', defaultVocal:'speech_lift', defaultUnder:'none',
      defaultTextureTone:'clean', defaultDrumTone:'soft', defaultMelodyTone:'soft',
      summary:'Behind-the-beat warmth, gospel-tinged extensions, and a vocal with room to testify.' },
    { id:'gospel', name:'Gospel', defaultTempo:80, families:['Groove','Jazz & Blues','Space'],
      scales:['major','minor_pent','blues_minor'],
      defaultRhythm:'soul_pocket', defaultDrums:'soul_pocket_kit', defaultVocal:'chorus_lift', defaultUnder:'none',
      defaultTextureTone:'clean', defaultDrumTone:'soft', defaultMelodyTone:'soft',
      summary:'Passing chords between every change, a walking bass, and a choir-sized chorus lift.' },
    { id:'folk', name:'Folk / Acoustic', defaultTempo:95, families:['Folk','Country','Space'],
      scales:['major','mixolydian','dorian'],
      defaultRhythm:'folk_pick', defaultDrums:'brush_folk', defaultVocal:'plain_story', defaultUnder:'open_string_hint',
      defaultTextureTone:'clean', defaultDrumTone:'soft', defaultMelodyTone:'soft',
      summary:'Fingerpicked patterns, plain storytelling vocals, and arrangements that serve the words.' },
    { id:'country', name:'Country', defaultTempo:110, families:['Country','Folk','Space'],
      scales:['major','mixolydian','major_pent'],
      defaultRhythm:'country_boomchick', defaultDrums:'country_train', defaultVocal:'plain_story', defaultUnder:'none',
      defaultTextureTone:'clean', defaultDrumTone:'dry', defaultMelodyTone:'soft',
      summary:'Boom-chick drive, walking bass into every change, and a hook you can say out loud.' },
    { id:'metal', name:'Metal', defaultTempo:140, families:['Rock','Space'],
      scales:['phrygian','phrygian_dom','harmonic_minor','minor_pent'],
      defaultRhythm:'power_chug', defaultDrums:'metal_double', defaultVocal:'minor_alarm', defaultUnder:'none',
      defaultTextureTone:'fuzz', defaultDrumTone:'dry', defaultMelodyTone:'grit',
      summary:'Palm-muted chugs, double-kick pressure, and riffs built from the darkest modes.' },
    { id:'flamenco', name:'Flamenco / Spanish', defaultTempo:130, families:['Latin','Classical','Space'],
      scales:['phrygian','phrygian_dom','spanish_gypsy','harmonic_minor'],
      defaultRhythm:'flamenco_pulse', defaultDrums:'palmas_kit', defaultVocal:'modal_call', defaultUnder:'none',
      defaultTextureTone:'clean', defaultDrumTone:'dry', defaultMelodyTone:'grit',
      summary:'Phrygian fire: the Andalusian cadence, rolled chords, and clapped accent patterns.' },
    { id:'cinematic', name:'Cinematic / Film Score', defaultTempo:70, families:['Cinematic','Classical','Space'],
      scales:['lydian','natural_minor','dorian','harmonic_minor','whole_tone'],
      defaultRhythm:'cinematic_pad', defaultDrums:'cinematic_pulse', defaultVocal:'floating_arch', defaultUnder:'soft_counter',
      defaultTextureTone:'wash', defaultDrumTone:'distant', defaultMelodyTone:'airy',
      summary:'Slow harmonic light: chromatic mediants, long pads, and dynamics that build over minutes.' },
    { id:'lofi', name:'Lo-fi Hip-Hop', defaultTempo:78, families:['Electronic','Groove','Space'],
      scales:['major','dorian','minor_pent'],
      defaultRhythm:'lofi_haze', defaultDrums:'lofi_knock', defaultVocal:'one_note_murmur', defaultUnder:'none',
      defaultTextureTone:'wash', defaultDrumTone:'soft', defaultMelodyTone:'soft',
      summary:'Dusty seventh chords, a lazy knock, and warble on everything. Comfort as an aesthetic.' },
    { id:'house', name:'House / EDM', defaultTempo:124, families:['Electronic','Groove','Space'],
      scales:['natural_minor','dorian','major'],
      defaultRhythm:'house_four', defaultDrums:'four_floor_shimmer', defaultVocal:'deadpan_hook', defaultUnder:'tremolo_top',
      defaultTextureTone:'clean', defaultDrumTone:'dry', defaultMelodyTone:'airy',
      summary:'Four-on-the-floor, sidechained pads, and one hook repeated until it becomes a place.' },
    { id:'baroque', name:'Baroque / Classical', defaultTempo:100, families:['Classical','Cinematic','Space'],
      scales:['major','natural_minor','harmonic_minor'],
      defaultRhythm:'baroque_walk', defaultDrums:'none', defaultVocal:'plain_story', defaultUnder:'low_counter',
      defaultTextureTone:'clean', defaultDrumTone:'dry', defaultMelodyTone:'soft',
      summary:'Counterpoint over a walking bass: independent voices, sequences, and clean cadences.' },
    { id:'impressionist', name:'Impressionist', defaultTempo:65, families:['Classical','Cinematic','Space'],
      scales:['lydian','whole_tone','major_pent','melodic_minor'],
      defaultRhythm:'planing_arp', defaultDrums:'none', defaultVocal:'floating_arch', defaultUnder:'soft_counter',
      defaultTextureTone:'wash', defaultDrumTone:'soft', defaultMelodyTone:'airy',
      summary:'Parallel chord colours over pedal tones; harmony as light rather than as motion.' },
    { id:'reggae', name:'Reggae', defaultTempo:80, families:['Groove','Space'],
      scales:['major','minor_pent','mixolydian'],
      defaultRhythm:'reggae_skank', defaultDrums:'reggae_onedrop', defaultVocal:'plain_story', defaultUnder:'none',
      defaultTextureTone:'clean', defaultDrumTone:'dry', defaultMelodyTone:'soft',
      summary:'Off-beat skanks, one-drop drums, and a bass line that is the actual lead instrument.' },
    { id:'synthwave', name:'Synthwave / 80s', defaultTempo:112, families:['Electronic','Post-Punk','Space'],
      scales:['natural_minor','dorian','phrygian'],
      defaultRhythm:'synth_arp_line', defaultDrums:'synthwave_gate', defaultVocal:'minor_alarm', defaultUnder:'tremolo_top',
      defaultTextureTone:'clean', defaultDrumTone:'dry', defaultMelodyTone:'airy',
      summary:'Gated snares, 16th arps, and neon minor keys. Precision is the emotion.' },
    { id:'hardrock', name:'Hard Rock / Grunge', defaultTempo:120, families:['Rock','Indie Rock','Space'],
      scales:['minor_pent','mixolydian','dorian','phrygian'],
      defaultRhythm:'rock_anthem', defaultDrums:'loud_quarters', defaultVocal:'chorus_lift', defaultUnder:'none',
      defaultTextureTone:'fuzz', defaultDrumTone:'dry', defaultMelodyTone:'grit',
      summary:'Heavy 8ths, quiet-loud dynamics, and choruses that hit like a dropped amp.' },
    { id:'celtic', name:'Celtic / Trad', defaultTempo:110, families:['Folk','Space'],
      scales:['dorian','mixolydian','major','minor_pent'],
      defaultRhythm:'modal_drone_pick', defaultDrums:'porch_shuffle', defaultVocal:'modal_call', defaultUnder:'open_string_hint',
      defaultTextureTone:'clean', defaultDrumTone:'soft', defaultMelodyTone:'soft',
      summary:'Drone strings, modal melodies, and rhythms that dance even without drums.' },
  ];

  const GENRE_PROFILES = STYLE_PROFILES.concat(BROAD_PROFILES);

  function byId(list, id) {
    return list.find(item => item.id === id) || list[0] || null;
  }

  // Arrangement profile for ANY genre id; falls back to pop, then the first
  // style profile, so callers always get something usable.
  function profileFor(genreId) {
    return GENRE_PROFILES.find(p => p.id === genreId)
      || BROAD_PROFILES.find(p => p.id === 'pop')
      || STYLE_PROFILES[0];
  }

  function defaultsForStyle(styleId) {
    const style = byId(GENRE_PROFILES, styleId);
    if (!style) return {};
    return {
      focusStyle: style.id,
      tempo: style.defaultTempo,
      rhythmPattern: style.defaultRhythm,
      drumPattern: style.defaultDrums,
      vocalPattern: style.defaultVocal,
      underPattern: style.defaultUnder,
      textureTone: style.defaultTextureTone,
      drumTone: style.defaultDrumTone,
      melodyTone: style.defaultMelodyTone,
    };
  }

  function makePlaybackPattern(rhythmId, drumId) {
    const rhythm = byId(RHYTHMS, rhythmId);
    const drums = byId(DRUMS, drumId);
    return {
      drums: {
        kick: (drums && drums.kick || []).slice(),
        snare: (drums && drums.snare || []).slice(),
        hhClosed: (drums && drums.hhClosed || []).slice(),
        hhOpen: (drums && drums.hhOpen || []).slice(),
      },
      bass: rhythm ? rhythm.bass : 'root',
      chords: rhythm ? rhythm.chords : 'block',
      swing: rhythm && rhythm.swing ? rhythm.swing : 0,
      human: drums && drums.human != null ? drums.human : 8,
      rhythm,
      drum: drums,
    };
  }

  function describeCombo(styleId, rhythmId, drumId, vocalId, underId) {
    const style = byId(GENRE_PROFILES, styleId);
    const rhythm = byId(RHYTHMS, rhythmId);
    const drums = byId(DRUMS, drumId);
    const vocal = byId(VOCAL_MELODIES, vocalId);
    const under = byId(UNDER_MELODIES, underId);
    return [
      style && style.name,
      rhythm && rhythm.name,
      drums && drums.name,
      vocal && vocal.name,
      under && under.id !== 'none' ? under.name : null,
    ].filter(Boolean).join(' / ');
  }

  function sectionAnalysis(progression, key, scaleId, sectionId) {
    const A = global.Analysis;
    const section = byId(SECTIONS, sectionId) || SECTIONS[1];
    if (!progression || progression.length === 0 || !A) {
      return `${section.name}: ${section.ideal}.`;
    }

    const first = progression[0];
    const last = progression[progression.length - 1];
    const arc = A.tensionArc(progression, key);
    const start = arc[0] || 0;
    const end = arc[arc.length - 1] || 0;
    const peak = Math.max.apply(null, arc);
    const cad = A.detectCadence(progression, key, scaleId);
    const loop = A.detectLoop ? A.detectLoop(progression) : 0;
    const firstFn = A.functionalLabel(first, key, scaleId);
    const lastFn = A.functionalLabel(last, key, scaleId);

    let shape = 'holds a steady tension';
    if (end >= start + 2) shape = 'climbs from low to higher tension';
    else if (end <= start - 2) shape = 'releases tension across the phrase';
    else if (peak >= Math.max(start, end) + 3) shape = 'peaks in the middle and then settles';

    const cadenceText = cad
      ? (cad.type === 'half'
        ? `It lands on ${cad.label.toLowerCase()}, so it feels unfinished and wants the next section.`
        : cad.type === 'deceptive'
          ? `It lands with ${cad.label.toLowerCase()}, so it avoids a full stop and keeps the phrase alive.`
          : `It lands with ${cad.label.toLowerCase()}, so it feels more closed.`)
      : (lastFn === 'D' || lastFn === 'V/x' || lastFn === 'Borrowed'
        ? 'It ends unfinished, which can pull hard into the next section.'
        : 'It does not force a hard ending, so repetition will matter.');

    const loopText = loop
      ? `The last ${loop} chords read as a loop, so the groove can carry the form.`
      : 'Because it is not a strict short loop, the melody should mark the section boundary.';

    const roleAdvice = {
      intro: 'As an intro, keep drums lighter and let the under-melody state the hook before the vocal enters.',
      verse: 'As a verse, keep the vocal narrower than the guitar texture and save the widest note for the last bar.',
      prechorus: 'As a pre-chorus, emphasize the last chord and raise the vocal range so the chorus has somewhere to arrive.',
      chorus: 'As a chorus, repeat the clearest chord in the first or last slot and use the lift-style vocal pattern.',
      bridge: 'As a bridge, change either the drum density or the mode; do not change every layer at once.',
      outro: 'As an outro, repeat the most stable two-chord fragment or fade on a suspended/drone color.',
    }[section.id] || section.ideal;

    return `${section.name}: ${first.shortName} (${firstFn}) to ${last.shortName} (${lastFn}) ${shape}; tension ${start}-${peak}-${end}. ${cadenceText} ${loopText} ${roleAdvice}`;
  }

  global.Arrangements = {
    STYLE_PROFILES,
    GENRE_PROFILES,
    RHYTHMS,
    DRUMS,
    VOCAL_MELODIES,
    UNDER_MELODIES,
    SECTIONS,
    byId,
    profileFor,
    defaultsForStyle,
    makePlaybackPattern,
    describeCombo,
    sectionAnalysis,
  };
})(typeof window !== 'undefined' ? window : globalThis);
