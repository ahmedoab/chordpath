/* ChordPath — recording.js
 * How to actually capture each instrument, DAW-neutral: signal chain, gain
 * staging, takes and comping, plus a full vocal-session guide. Assumes a
 * bedroom/home-studio setup with one audio interface.
 */
(function (global) {
  'use strict';

  const GAIN_RULE = 'Set input gain so the loudest moment peaks around −12 dBFS. Digital clipping is unfixable; quiet recordings are just a fader move.';

  const GUIDES = [
    { instrumentId:'lead_vocal',
      methods:[
        { id:'condenser', name:'Condenser mic (best if you have one)', steps:[
          'Room: record in the deadest space you have — a closet of clothes beats an empty bedroom. Hang a duvet behind YOU (the mic points at you, you point at the duvet).',
          'Mic 15–20 cm away, pop filter halfway between; sing slightly across the mic, not straight into it, to soften plosives.',
          GAIN_RULE,
          'Monitor on closed headphones with a touch of reverb in the cue mix (record DRY — the reverb is only for confidence).',
        ]},
        { id:'dynamic', name:'Dynamic mic (SM58-style)', steps:[
          'Get close: 5–10 cm. Dynamics reject the room, which is a superpower in untreated spaces.',
          'Expect to add more high shelf later; dynamics are darker than condensers.',
          GAIN_RULE,
        ]},
      ],
      takes:'Record the full song 3 times, then 2–3 extra passes of the hardest lines. Comp the best phrases into one take (your DAW\'s take lanes / comping feature). Then record all doubles and harmonies while the voice is warm.',
      tip:'Sing the chorus once at half volume too — a whisper-double under the main take is instant intimacy.' },

    { instrumentId:'harmony_vocals',
      methods:[
        { id:'stack', name:'Stacking pass', steps:[
          'Same mic and position as the lead so the voices blend.',
          'Record each harmony line twice minimum (pan the pair later).',
          'Sing softer and straighter than the lead — vibrato multiplies badly in stacks.',
        ]},
      ],
      takes:'Two takes per line, tight timing beats perfect pitch (tuning fixes pitch; nothing fixes smeared consonants — clip the S off doubles if needed).',
      tip:'Record the same line an octave up quietly; blended low, it reads as shine rather than a part.' },

    { instrumentId:'acoustic_gtr',
      methods:[
        { id:'mic', name:'Single mic', steps:[
          'Point the mic at the 12th fret from 20–30 cm, angled slightly toward the soundhole. NEVER straight at the soundhole (boom city).',
          'Move your chair, not the EQ: 10 cm of mic position changes more than any plugin.',
          GAIN_RULE,
        ]},
        { id:'di', name:'Pickup/DI (backup plan)', steps:[
          'Plug straight into the interface instrument input.',
          'Expect a quacky midrange — cut 2–4 dB around 1–2 kHz later, add an acoustic-IR or reverb to restore air.',
        ]},
      ],
      takes:'Two full takes panned L/R makes a bedroom recording sound like a record. Watch chair squeaks and breathing between phrases.',
      tip:'New-ish strings matter more than the mic. Old strings sound like old strings through anything.' },

    { instrumentId:'rhythm_gtr',
      methods:[
        { id:'di_sim', name:'DI + amp sim (the modern default)', steps:[
          'Guitar → interface instrument (Hi-Z) input. No pedals in the way at first.',
          GAIN_RULE,
          'Pick an amp sim preset in the style, then reduce its gain one notch — recorded distortion always sounds bigger than it feels.',
          'Record the DRY DI on a duplicate track too, so you can re-amp with a different sim later.',
        ]},
      ],
      takes:'Double every part: two performances panned hard L/R, NOT one take copied. Tight palm-muting between chords keeps doubles clean.',
      tip:'Tune before EVERY take. Cheap insurance, priceless result.' },

    { instrumentId:'lead_gtr',
      methods:[
        { id:'di_sim', name:'DI + amp sim', steps:[
          'Same chain as rhythm; add the delay/reverb only in the DAW (record dry, monitor wet).',
          'Slightly more gain than rhythm is fine; sustain helps leads.',
        ]},
      ],
      takes:'Punch in phrase by phrase without shame — every record you love did it.',
      tip:'Record a safety take of the melody an octave up; a low-mixed octave double is a free chorus lift.' },

    { instrumentId:'bass',
      methods:[
        { id:'di', name:'Straight DI (the studio standard)', steps:[
          'Bass → interface instrument input. Fresh-ish strings, tone knob open.',
          GAIN_RULE + ' Bass transients spike higher than they sound.',
          'Play with consistent force — compression fixes level, not intent.',
        ]},
      ],
      takes:'One clean take beats three sloppy comps; bass errors are exposed. Slow the song down 10% in the DAW for hard lines and speed back up if pitch-stretch quality allows.',
      tip:'Mute unplayed strings with your fretting hand; DI hears every rattle.' },

    { instrumentId:'drums',
      methods:[
        { id:'midi', name:'Programmed MIDI (recommended at home)', steps:[
          'Export the ChordPath drum MIDI (or program your own) into a sampler like MT Power Drum Kit.',
          'Humanize: ±10–20 ms of timing and velocity variation on hats; keep kick and snare tighter.',
          'Add ONE fill per 8 bars max; amateur programming = too many fills.',
        ]},
        { id:'oneMic', name:'Real kit, one mic (if you must)', steps:[
          'One condenser at chest height, 1–2 m in front of the kit, pointed at the snare.',
          'Move the mic, not the faders: closer = more kick, higher = more cymbals.',
          GAIN_RULE,
        ]},
      ],
      takes:'For MIDI: loop 8 bars, play variations on a pad/keyboard, keep the best. For real drums: full-song passes only — drum edits are hard.',
      tip:'Record a shaker or tambourine pass along with programmed drums; one live element humanizes the whole kit.' },

    { instrumentId:'percussion',
      methods:[
        { id:'mic', name:'Any mic, close-ish', steps:[
          'Shakers/tambourine 20–30 cm from the mic, slightly off-axis.',
          'Play to the recorded groove wearing headphones; the FEEL is the part.',
        ]},
      ],
      takes:'Loop-record 8 bars until one pass grooves; copy it.',
      tip:'If timing wanders, quantize only the downbeats and leave the rest human.' },

    { instrumentId:'piano',
      methods:[
        { id:'midi', name:'MIDI keyboard + sampled piano', steps:[
          'Any MIDI keyboard into LABS Soft Piano or a similar sampled instrument.',
          'Record pedal (CC64) with the performance; piano without pedal data sounds robotic.',
          'Fix wrong notes in the editor, but keep the original timing feel.',
        ]},
      ],
      takes:'Hands separately if the part is hard — nobody will ever know.',
      tip:'Reduce velocity variation slightly (compress velocities 20%) if your keyboard is unweighted.' },

    { instrumentId:'e_piano',
      methods:[
        { id:'midi', name:'MIDI + Dexed / sampled EP', steps:[
          'Same workflow as piano; the classic DX "E.PIANO 1" or a Rhodes sample.',
          'Play sparser than piano: EPs love space and long notes.',
        ]},
      ],
      takes:'Loop 8 bars, keep the pass with the best feel.',
      tip:'Add the tremolo/chorus while TRACKING — it changes how you play.' },

    { instrumentId:'organ', methods:[
      { id:'midi', name:'MIDI + organ patch', steps:[
        'Hold chords with smooth voice-leading (change one note at a time when possible).',
        'Ride the volume with your MIDI mod wheel — organ swells are the part.',
      ]}],
      takes:'One take with good swells beats edits.',
      tip:'Record the swell automation live; drawing it later never feels the same.' },

    { instrumentId:'pad', methods:[
      { id:'midi', name:'MIDI + synth', steps:[
        'Whole notes, wide voicings, let the patch move.',
        'Record filter-cutoff automation as you play (mod wheel or knob).',
      ]}],
      takes:'One pass; pads forgive everything.',
      tip:'Two different pad patches at half volume each beat one loud pad.' },

    { instrumentId:'strings', methods:[
      { id:'midi', name:'MIDI + LABS/BBCSO', steps:[
        'Play lines one voice at a time (all violins, then celli) rather than block chords.',
        'Use the mod wheel for dynamics (CC1) — sampled strings live and die by it.',
      ]}],
      takes:'Layer voice by voice; 4 simple lines beat 1 complex take.',
      tip:'End phrases with a slight mod-wheel fade; abrupt string releases scream "MIDI".' },

    { instrumentId:'brass', methods:[
      { id:'midi', name:'MIDI + BBCSO/soundfont', steps:[
        'Short notes for stabs, mod-wheel swells for pads.',
        'Slightly late timing (10–20 ms) sounds like a real section.',
      ]}],
      takes:'Program stabs on the grid, then nudge the whole track 10 ms late.',
      tip:'Voice stabs in 3rds/6ths, not octaves, for that classic section sound.' },

    { instrumentId:'synth_lead', methods:[
      { id:'midi', name:'MIDI + Vital/Surge', steps:[
        'Record the line, then overdub pitch-bend and vibrato gestures on a second pass if needed.',
        'Print (bounce) the sound once you commit — endless patch-tweaking kills songs.',
      ]}],
      takes:'Loop-record; keep the take with the best micro-timing.',
      tip:'Program a subtle volume swell into long notes; static synth notes feel dead.' },

    { instrumentId:'synth_bass', methods:[
      { id:'midi', name:'MIDI + synth', steps:[
        'Velocity consistent, notes slightly short (staccato breathes with the kick).',
        'One octave, few pitches: the groove is in the rhythm.',
      ]}],
      takes:'Draw it in the piano roll if playing is fiddly — synth bass forgives programming.',
      tip:'Copy the kick pattern as your note-start grid, then delete where the kick needs room.' },

    { instrumentId:'arp', methods:[
      { id:'midi', name:'Hold chords + arpeggiator', steps:[
        'Hold the ChordPath chords, let the synth arpeggiator do the 16ths.',
        'Record the filter opening across the section.',
      ]}],
      takes:'One pass per section.',
      tip:'Sync the arp rate to tempo (1/16) before recording, not after.' },

    { instrumentId:'bells', methods:[
      { id:'midi', name:'MIDI + bell patch', steps:['One or two notes per bar, high register, let them ring full length.']}],
      takes:'One pass.',
      tip:'Slightly early bells sparkle; late bells drag.' },

    { instrumentId:'choir', methods:[
      { id:'midi', name:'MIDI + LABS Choir', steps:['Block chords, slow changes, mod wheel for swells.']},
      { id:'self', name:'Stack yourself', steps:[
        'Record yourself singing "ooh" on each chord tone, 3 takes per note, pan them around.',
        'Twelve quiet takes of an average voice = one gorgeous choir.',
      ]}],
      takes:'The self-stack takes an hour and is worth every minute.',
      tip:'Tune the stack lightly; perfectly-tuned choirs sound synthetic.' },

    { instrumentId:'fx_texture', methods:[
      { id:'found', name:'Found sound', steps:[
        'Record 30 s of room tone, rain, street noise, or vinyl crackle on your phone.',
        'Low-pass it, drench it in reverb, tuck it at −30 dB under the mix.',
      ]}],
      takes:'One pass of anything.',
      tip:'Reverse a cymbal or vocal phrase for instant transitions into choruses.' },

    { instrumentId:'shaker_hats', methods:[
      { id:'mic', name:'Real shaker > programmed', steps:['A real shaker (or a jar of rice) into any mic beats programmed 16ths for feel.']}],
      takes:'Loop 8 bars until one pass locks.',
      tip:'Aim the "chick" of the shaker at the offbeats, not the downbeats.' },

    { instrumentId:'sub_drone', methods:[
      { id:'midi', name:'MIDI + sine patch', steps:['One held low note (the key\'s root). A plain sine wave is the whole instrument.']}],
      takes:'One note, one take.',
      tip:'Fade it in over 2 bars; a sub that appears from nowhere reads as a mistake.' },
  ];

  // The full vocal-session walkthrough for the Studio vocals block.
  const VOCAL_GUIDE = {
    warmup: [
      'Ten minutes: gentle humming up and down, lip trills, then sing the song once at half volume.',
      'Warm water, no dairy right before, and stop before it hurts — a strained take never comps well.',
    ],
    setup: [
      'Deadest room available; closet of clothes > empty room. Duvet behind the singer.',
      'Pop filter, mic at mouth height 15–20 cm, singer STANDS (better breath support).',
      'Headphone mix: music slightly quiet, voice clear, a little reverb for confidence (record dry).',
      'Peaks around −12 dBFS on the loudest chorus line before you start.',
    ],
    takes: [
      'Three full passes first — do not stop for small mistakes; flow beats perfection.',
      'Then loop the hardest lines for 2–3 focused retakes each.',
      'Record chorus doubles (same melody twice more) and any harmonies while warm.',
      'Last: one quiet, close, half-volume pass of the most emotional section — production gold.',
    ],
    comping: [
      'Comp phrase by phrase in take lanes; pick for FEELING first, pitch second.',
      'Tune gently after comping (30–50% correction) — tuning before comping wastes work.',
      'Edit breaths down (−6 dB), never out; breathless vocals sound dead.',
    ],
    mixPrep: [
      'Follow the lead-vocal mix chain in the instrument card (HPF → EQ → comp → de-ess → space).',
      'Automate the fader through the song FIRST, then let the compressor do the last 3 dB.',
    ],
  };

  function guideFor(instrumentId) {
    return GUIDES.find(g => g.instrumentId === instrumentId) || null;
  }

  global.Recording = { GUIDES, VOCAL_GUIDE, GAIN_RULE, guideFor };
})(typeof window !== 'undefined' ? window : globalThis);
