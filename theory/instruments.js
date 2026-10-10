/* ChordPath — instruments.js
 * The instrument catalog and the arrangement-density engine.
 * Every instrument declares its role and how much energy it puts into each
 * frequency slot; analyzeRoster() turns a section's roster into
 * sparse / balanced / crowded verdicts with concrete advice.
 */
(function (global) {
  'use strict';

  const ROLES = [
    { id: 'rhythm',  name: 'Rhythm & pulse' },
    { id: 'bass',    name: 'Low end' },
    { id: 'harmony', name: 'Harmony & body' },
    { id: 'lead',    name: 'Leads & hooks' },
    { id: 'vocal',   name: 'Vocals' },
    { id: 'texture', name: 'Texture & air' },
  ];

  const SLOTS = [
    { id: 'low',    name: 'Low',      range: '20–120 Hz' },
    { id: 'lowmid', name: 'Low-mid',  range: '120–400 Hz' },
    { id: 'mid',    name: 'Mid',      range: '400 Hz–2 kHz' },
    { id: 'himid',  name: 'High-mid', range: '2–6 kHz' },
    { id: 'high',   name: 'High',     range: '6–12 kHz' },
    { id: 'air',    name: 'Air',      range: '12 kHz+' },
  ];

  // slots: how strongly this instrument occupies each band (0–1).
  // midiProgram: GM program for MIDI export. tabType: how it renders as tab.
  const INSTRUMENTS = [
    { id:'drums', name:'Drum kit', role:'rhythm', midiProgram:0, tabType:'grid',
      slots:{ low:0.9, lowmid:0.3, mid:0.2, himid:0.6, high:0.8, air:0.4 },
      tip:'Kick owns the low end with the bass; hats and cymbals own the top. Everything else fits around the kit.' },
    { id:'percussion', name:'Percussion (shaker, tamb, congas)', role:'rhythm', midiProgram:0, tabType:'none',
      slots:{ himid:0.4, high:0.6, air:0.3 },
      tip:'Adds motion without weight. Great for lifting a chorus without adding another loud layer.' },
    { id:'bass', name:'Bass guitar', role:'bass', midiProgram:33, tabType:'tab',
      slots:{ low:1.0, lowmid:0.7, mid:0.2 },
      tip:'The bridge between kick and chords. If the low end is muddy, it is almost always bass vs kick.' },
    { id:'synth_bass', name:'Synth bass', role:'bass', midiProgram:38, tabType:'tab',
      slots:{ low:1.0, lowmid:0.6, mid:0.3 },
      tip:'Deeper and steadier than bass guitar. Only keep one bass instrument per section.' },
    { id:'sub_drone', name:'Sub drone', role:'bass', midiProgram:89, tabType:'tab',
      slots:{ low:0.9, lowmid:0.2 },
      tip:'A held low root for cinematic weight. Mute it whenever the bass is playing actual lines.' },
    { id:'rhythm_gtr', name:'Rhythm guitar (electric)', role:'harmony', midiProgram:27, tabType:'chords',
      slots:{ lowmid:0.7, mid:1.0, himid:0.6 },
      tip:'The glue layer. High-pass it around 100 Hz so it never fights the bass.' },
    { id:'acoustic_gtr', name:'Acoustic guitar', role:'harmony', midiProgram:25, tabType:'chords',
      slots:{ lowmid:0.6, mid:0.9, himid:0.5, high:0.4 },
      tip:'Body lives at 200 Hz, sparkle at 10 kHz. Double-track and pan wide for instant width.' },
    { id:'lead_gtr', name:'Lead guitar', role:'lead', midiProgram:29, tabType:'tab',
      slots:{ mid:0.8, himid:0.9, high:0.4 },
      tip:'Shares the vocal\'s frequency lane — arrange them to answer each other, never overlap.' },
    { id:'piano', name:'Piano', role:'harmony', midiProgram:0, tabType:'chords',
      slots:{ low:0.3, lowmid:0.8, mid:0.9, himid:0.5, high:0.3 },
      tip:'Covers almost everything, so it crowds fast. Keep the left hand light when bass is present.' },
    { id:'e_piano', name:'Electric piano', role:'harmony', midiProgram:4, tabType:'chords',
      slots:{ lowmid:0.7, mid:0.8, himid:0.4 },
      tip:'Warmer and rounder than piano; a classic bed under intimate or soulful vocals.' },
    { id:'organ', name:'Organ', role:'harmony', midiProgram:16, tabType:'chords',
      slots:{ lowmid:0.6, mid:0.8, himid:0.5 },
      tip:'Long sustained glue. Sneak it in at low volume — you should only notice it when it stops.' },
    { id:'pad', name:'Synth pad', role:'texture', midiProgram:89, tabType:'chords',
      slots:{ lowmid:0.4, mid:0.6, himid:0.4, high:0.3, air:0.5 },
      tip:'Fills the gaps between everything else. High-pass at 150 Hz and sidechain lightly to the kick.' },
    { id:'strings', name:'Strings', role:'texture', midiProgram:48, tabType:'chords',
      slots:{ lowmid:0.5, mid:0.7, himid:0.6, air:0.4 },
      tip:'Emotional lift. Arrange in octaves for drama, close harmony for warmth.' },
    { id:'brass', name:'Brass', role:'lead', midiProgram:61, tabType:'tab',
      slots:{ lowmid:0.5, mid:0.8, himid:0.7 },
      tip:'Stabs for punch, sustains for majesty. Nothing else should play during a brass stab.' },
    { id:'synth_lead', name:'Synth lead', role:'lead', midiProgram:80, tabType:'tab',
      slots:{ mid:0.7, himid:0.9, high:0.5 },
      tip:'A hook machine. Mono with a touch of delay usually beats a wide stereo patch.' },
    { id:'arp', name:'Arpeggiator / sequence', role:'texture', midiProgram:81, tabType:'tab',
      slots:{ mid:0.6, himid:0.7, high:0.5 },
      tip:'Motion without commitment. Let the filter cutoff evolve across the section.' },
    { id:'bells', name:'Bells / chimes', role:'texture', midiProgram:14, tabType:'tab',
      slots:{ himid:0.5, high:0.7, air:0.6 },
      tip:'One good bell note per bar goes a long way — it is seasoning, not soup.' },
    { id:'lead_vocal', name:'Lead vocal', role:'vocal', midiProgram:52, tabType:'tab',
      slots:{ lowmid:0.3, mid:1.0, himid:0.8, air:0.5 },
      tip:'The most important instrument in the song. Everything else gets carved to make room for it.' },
    { id:'harmony_vocals', name:'Harmony / backing vocals', role:'vocal', midiProgram:53, tabType:'tab',
      slots:{ mid:0.7, himid:0.6, air:0.5 },
      tip:'Pan doubles left/right, keep them darker than the lead, and tuck them 6–10 dB under it.' },
    { id:'choir', name:'Choir / big vocal stack', role:'vocal', midiProgram:52, tabType:'chords',
      slots:{ lowmid:0.4, mid:0.8, himid:0.6, air:0.6 },
      tip:'Instant scale. Save it for the biggest moment in the song, or it stops being big.' },
    { id:'fx_texture', name:'FX / noise texture', role:'texture', midiProgram:96, tabType:'none',
      slots:{ high:0.4, air:0.7 },
      tip:'Vinyl crackle, reversed swells, room tone — the invisible layer that makes tracks feel finished.' },
    { id:'shaker_hats', name:'Extra hats / shaker loop', role:'rhythm', midiProgram:0, tabType:'none',
      slots:{ high:0.7, air:0.4 },
      tip:'A 16th-note shaker under a sparse kit adds drive without changing the drum part.' },
  ];

  function byId(id) { return INSTRUMENTS.find(i => i.id === id) || null; }

  function grouped() {
    const out = {};
    ROLES.forEach(r => { out[r.id] = []; });
    INSTRUMENTS.forEach(i => { (out[i.role] = out[i.role] || []).push(i); });
    return out;
  }

  // Target roster sizes by section role, shifted by energy.
  const TARGETS = {
    intro:     [2, 4],
    verse:     [3, 5],
    prechorus: [4, 6],
    chorus:    [5, 8],
    bridge:    [3, 6],
    outro:     [2, 5],
  };

  function analyzeRoster(rosterIds, ctx) {
    ctx = ctx || {};
    const roster = (rosterIds || []).map(byId).filter(Boolean);
    const target = (TARGETS[ctx.role] || [3, 6]).slice();
    if (ctx.energy === 'high') { target[0] += 1; target[1] += 1; }
    if (ctx.energy === 'low') { target[0] = Math.max(1, target[0] - 1); target[1] -= 1; }

    // Frequency-slot load.
    const slotLoad = {};
    SLOTS.forEach(s => { slotLoad[s.id] = 0; });
    roster.forEach(inst => {
      Object.entries(inst.slots).forEach(([slot, w]) => { slotLoad[slot] += w; });
    });
    // ~3 full-weight occupants of one band is where carving stops working
    // and muting starts being the answer.
    const hotSlots = SLOTS.filter(s => slotLoad[s.id] >= 3.2).map(s => s.id);
    const emptySlots = SLOTS.filter(s => slotLoad[s.id] < 0.3).map(s => s.id);

    // Role coverage.
    const rolesPresent = new Set(roster.map(i => i.role));
    const missingRoles = [];
    if (!rolesPresent.has('bass') && ['verse', 'prechorus', 'chorus'].includes(ctx.role)) missingRoles.push('bass');
    if (!rolesPresent.has('rhythm') && ['chorus', 'prechorus'].includes(ctx.role)) missingRoles.push('rhythm');
    if (!rolesPresent.has('vocal') && ['verse', 'chorus'].includes(ctx.role)) missingRoles.push('vocal');

    // Same-slot clashes between instruments (worst offenders first).
    const clashes = [];
    for (let a = 0; a < roster.length; a++) {
      for (let b = a + 1; b < roster.length; b++) {
        let worstSlot = null, worstSum = 0;
        SLOTS.forEach(s => {
          const sum = (roster[a].slots[s.id] || 0) + (roster[b].slots[s.id] || 0);
          if ((roster[a].slots[s.id] || 0) >= 0.5 && (roster[b].slots[s.id] || 0) >= 0.5 && sum > worstSum) {
            worstSum = sum; worstSlot = s.id;
          }
        });
        if (worstSlot && worstSum >= 1.5) {
          clashes.push({ a: roster[a].id, b: roster[b].id, slot: worstSlot, sum: worstSum });
        }
      }
    }
    clashes.sort((x, y) => y.sum - x.sum);

    // Verdict + advice.
    const advice = [];
    let verdict = 'balanced';
    if (roster.length > target[1] || hotSlots.length > 0) {
      verdict = 'crowded';
      if (roster.length > target[1]) {
        advice.push(`${roster.length} instruments is a lot for a ${ctx.role || 'section'} — aim for ${target[0]}–${target[1]}. Mute the least essential layer and see if anyone misses it.`);
      }
      hotSlots.forEach(slot => {
        const heavy = roster
          .filter(i => (i.slots[slot] || 0) >= 0.5)
          .sort((x, y) => (y.slots[slot] || 0) - (x.slots[slot] || 0))
          .slice(0, 3);
        const names = heavy.map(i => i.name).join(' + ');
        const meta = SLOTS.find(s => s.id === slot);
        advice.push(`The ${meta.name.toLowerCase()} band (${meta.range}) is carrying ${names}. Mute one per section, or EQ-carve: keep one full and high/low-pass the others.`);
      });
    }
    if (roster.length < target[0] || missingRoles.length) {
      if (verdict !== 'crowded') verdict = 'sparse';
      if (missingRoles.includes('bass')) {
        advice.push('No low end: add bass or synth bass — or make the emptiness deliberate (a classic slowcore/ballad move) and warn the mix that the floor is open.');
      }
      if (missingRoles.includes('rhythm')) {
        advice.push('Nothing is driving the pulse. Add drums, percussion, or let a strummed instrument own the rhythm explicitly.');
      }
      if (missingRoles.includes('vocal')) {
        advice.push('No vocal in a ' + ctx.role + ' — fine for an instrumental, otherwise the section needs its storyteller.');
      }
      if (roster.length < target[0] && !missingRoles.length) {
        advice.push(`Only ${roster.length} instrument${roster.length === 1 ? '' : 's'} — sparse for a ${ctx.role || 'section'}. That can be powerful; just make sure each remaining part is interesting alone.`);
      }
    }
    if (verdict === 'balanced') {
      advice.push('Instrument count and frequency spread look healthy. Balance levels so the vocal leads, then carve the clashes below.');
    }

    return { verdict, slotLoad, hotSlots, emptySlots, missingRoles, clashes, advice, target };
  }

  global.Instruments = { INSTRUMENTS, ROLES, SLOTS, byId, grouped, analyzeRoster };
})(typeof window !== 'undefined' ? window : globalThis);
