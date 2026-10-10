/* ChordPath — plugins.js
 * Free plugin recommendations, DAW-neutral (they load in Reaper, FL, Live,
 * Cakewalk — anything that hosts VST3/AU). kind 'instrument' = makes sound,
 * 'effect' = shapes sound. forInstruments maps to Instruments ids.
 */
(function (global) {
  'use strict';

  const PLUGINS = [
    // ── Sound sources ────────────────────────────────────────────────────
    { id:'vital', name:'Vital', kind:'instrument', role:'synth', freeTier:'freemium',
      forInstruments:['synth_lead','pad','arp','synth_bass','sub_drone','fx_texture','bells'],
      why:'Modern wavetable synth that rivals paid flagships; huge free preset community.',
      tip:'Start from a factory preset close to your idea, then only touch filter cutoff and envelopes at first.' },
    { id:'surge_xt', name:'Surge XT', kind:'instrument', role:'synth', freeTier:'free',
      forInstruments:['synth_lead','pad','arp','synth_bass','bells','fx_texture'],
      why:'Fully free, open-source, absurdly deep synth with thousands of built-in patches.',
      tip:'Browse the patch categories (Pads, Leads, Basses) instead of designing from scratch.' },
    { id:'dexed', name:'Dexed', kind:'instrument', role:'synth', freeTier:'free',
      forInstruments:['e_piano','bells','synth_lead'],
      why:'A free DX7 — the definitive 80s electric-piano and bell machine.',
      tip:'Search cartridge banks for "E.PIANO 1" — that is the sound on half the ballads ever made.' },
    { id:'labs', name:'Spitfire LABS', kind:'instrument', role:'sampler', freeTier:'free',
      forInstruments:['piano','strings','choir','pad','fx_texture','organ','bells'],
      why:'Beautiful free sampled instruments (soft piano, strings, choir, textures) with one knob.',
      tip:'"Soft Piano" and "Strings" are instant emotional weight for ballads and cinematic sections.' },
    { id:'bbcso_discover', name:'BBC Symphony Orchestra Discover', kind:'instrument', role:'sampler', freeTier:'free',
      forInstruments:['strings','brass'],
      why:'A real orchestra in one free plugin — every section, sensible articulations.',
      tip:'Write strings in octaves (violins + celli) for the big-screen effect.' },
    { id:'ample_guitar_m', name:'Ample Guitar M Lite II', kind:'instrument', role:'sampler', freeTier:'free',
      forInstruments:['acoustic_gtr'],
      why:'Convincing sampled acoustic guitar with a strummer, for when you cannot record one.',
      tip:'Use the strummer panel and feed it your ChordPath chords; humanize timing slightly.' },
    { id:'ample_bass_p', name:'Ample Bass P Lite II', kind:'instrument', role:'sampler', freeTier:'free',
      forInstruments:['bass'],
      why:'Free sampled P-bass that sits perfectly in a rock/indie mix.',
      tip:'Keep velocities moderate and consistent; real bassists do not hammer every note.' },
    { id:'mt_power_drumkit', name:'MT Power Drum Kit 2', kind:'instrument', role:'sampler', freeTier:'free',
      forInstruments:['drums'],
      why:'Free acoustic drum kit that is pre-mixed to sit well in rock and pop.',
      tip:'Drag the exported ChordPath MIDI drum track straight onto it — GM mapping matches.' },
    { id:'sitala', name:'Sitala', kind:'instrument', role:'sampler', freeTier:'free',
      forInstruments:['drums','percussion','shaker_hats'],
      why:'Dead-simple free drum sampler — drag in any samples, 16 pads, done.',
      tip:'Perfect for lo-fi and electronic kits; pitch pads down a few semitones for weight.' },

    // ── EQ / dynamics ────────────────────────────────────────────────────
    { id:'tdr_nova', name:'TDR Nova', kind:'effect', role:'eq', freeTier:'free',
      forInstruments:['lead_vocal','harmony_vocals','rhythm_gtr','acoustic_gtr','piano','bass','drums','pad','strings','e_piano','organ','lead_gtr','synth_lead','choir'],
      why:'Free dynamic EQ — surgical cuts that only act when the problem appears.',
      tip:'Use the band solo to find harshness, cut 2–4 dB, and set the band to dynamic so it only ducks on peaks.' },
    { id:'tdr_kotelnikov', name:'TDR Kotelnikov', kind:'effect', role:'comp', freeTier:'free',
      forInstruments:['lead_vocal','bass','drums','piano','acoustic_gtr','mix_bus'],
      why:'Transparent mastering-grade compressor, free.',
      tip:'2–4 dB of gain reduction is plenty; if you can hear it pumping, back off.' },
    { id:'mjuc_jr', name:'Klanghelm MJUC jr.', kind:'effect', role:'comp', freeTier:'free',
      forInstruments:['lead_vocal','harmony_vocals','bass','e_piano','brass'],
      why:'Free vari-mu style compressor with tone — makes vocals sound expensive.',
      tip:'One knob: turn compress until the vocal feels held, then one notch back.' },
    { id:'ott', name:'Xfer OTT', kind:'effect', role:'comp', freeTier:'free',
      forInstruments:['synth_lead','pad','arp','synth_bass','fx_texture'],
      why:'The famous free multiband upward compressor behind modern electronic brightness.',
      tip:'Depth 20–35% is usually enough; 100% is a special effect, not a mix move.' },

    // ── Space / colour ───────────────────────────────────────────────────
    { id:'valhalla_supermassive', name:'Valhalla Supermassive', kind:'effect', role:'reverb', freeTier:'free',
      forInstruments:['lead_vocal','harmony_vocals','pad','lead_gtr','strings','bells','fx_texture','snare','choir','e_piano'],
      why:'Free lush reverb/delay hybrid — the shoegaze and dream-pop cheat code.',
      tip:'Use on a send, not an insert. Gemini and Great Annihilator modes for huge washes.' },
    { id:'valhalla_freq_echo', name:'Valhalla FreqEcho', kind:'effect', role:'delay', freeTier:'free',
      forInstruments:['lead_gtr','synth_lead','fx_texture','lead_vocal'],
      why:'Free frequency-shifter delay for psychedelic tails and dub throws.',
      tip:'Tiny shift amounts (0.1–2 Hz) make repeats spiral upward beautifully.' },
    { id:'saturation_knob', name:'Softube Saturation Knob', kind:'effect', role:'saturation', freeTier:'free',
      forInstruments:['bass','drums','rhythm_gtr','lead_vocal','synth_bass','e_piano'],
      why:'One free knob of analog-style grit that helps thin parts cut through.',
      tip:'"Keep Low" mode on bass adds bite without losing the bottom.' },
    { id:'span', name:'Voxengo SPAN', kind:'effect', role:'meter', freeTier:'free',
      forInstruments:['mix_bus'],
      why:'The standard free spectrum analyzer — see the frequency slots ChordPath talks about.',
      tip:'Compare your mix to a reference track at matched volume; look at the low-mid buildup first.' },
    { id:'graillon', name:'Auburn Sounds Graillon 2 (free)', kind:'effect', role:'pitch', freeTier:'freemium',
      forInstruments:['lead_vocal'],
      why:'Free live pitch correction — subtle tuning or hard autotune, your call.',
      tip:'Correction amount around 30–50% keeps performances human.' },
    { id:'melda_free', name:'MeldaProduction MFreeFXBundle', kind:'effect', role:'utility', freeTier:'free',
      forInstruments:['lead_vocal','harmony_vocals','mix_bus','drums'],
      why:'Huge free bundle: gate, de-esser-style dynamics, phaser, utility tools.',
      tip:'MCompressor with a custom shape is a sleeper de-esser on the 5–8 kHz band.' },
    { id:'kilohearts_ess', name:'Kilohearts Essentials', kind:'effect', role:'utility', freeTier:'free',
      forInstruments:['pad','synth_lead','arp','fx_texture'],
      why:'Dozens of tiny free effects (chorus, ensemble, filter, trance gate).',
      tip:'Ensemble on a plain pad instantly turns it into a wide 80s dream.' },
  ];

  function byId(id) { return PLUGINS.find(p => p.id === id) || null; }

  function forInstrument(instrumentId) {
    const sound = PLUGINS.filter(p => p.kind === 'instrument' && p.forInstruments.includes(instrumentId));
    const effects = PLUGINS.filter(p => p.kind === 'effect' && p.forInstruments.includes(instrumentId));
    return { sound, effects };
  }

  global.Plugins = { PLUGINS, byId, forInstrument };
})(typeof window !== 'undefined' ? window : globalThis);
