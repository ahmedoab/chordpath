/* ChordPath — learn.js
 * Hand-written music-theory primer that the Learn drawer renders, plus the
 * keyboard-shortcut reference.
 */
(function (global) {
  'use strict';

  const SHORTCUTS = [
    { key:'Space',       desc:'Play / Stop'                  },
    { key:'B',           desc:'Play with band'               },
    { key:'M',           desc:'Play with melody'             },
    { key:'L',           desc:'Toggle loop'                  },
    { key:'7',           desc:'Toggle 7th chords'            },
    { key:'⌫ / Backspace', desc:'Undo last chord'            },
    { key:'⌘Z / Ctrl+Z',  desc:'Undo last chord'             },
    { key:'C',           desc:'Clear progression'            },
    { key:'1 – 9',       desc:'Add option chord #1–9'        },
    { key:'P',           desc:'Toggle Piano / Guitar view'   },
    { key:'E',           desc:'Pick best chord for emotion'  },
    { key:'F',           desc:'Pick best chord for feeling'  },
    { key:'T',           desc:'Toggle light / dark theme'    },
    { key:'?',           desc:'Show this shortcut list'      },
    { key:'/',           desc:'Focus key picker'             },
    { key:'Esc',         desc:'Close any open dialog'        },
  ];

  const PRIMER = [
    {
      heading: 'The map of harmony',
      body: `Tonal music in the West has been built for ~400 years on a simple bedrock: a <em>tonic</em> (home), a <em>dominant</em> (away — tense), and chords that build a path between them. The Roman numerals (I, ii, IV, V…) name these stations in any key. Once you can hear the function — "this is a IV" — you can play the same emotion in any of the 12 keys.`,
    },
    {
      heading: 'Diatonic chords',
      body: `Every major scale gives you seven chords built by stacking thirds on each note: <strong>I, ii, iii, IV, V, vi, vii°</strong>. Three are <em>tonic-functioning</em> (I, iii, vi — they feel restful), two are <em>predominant</em> (ii, IV — they head somewhere), two are <em>dominant</em> (V, vii° — they pull home). The colour comes from what order you string them in.`,
    },
    {
      heading: 'Cadences — the punctuation marks',
      body: `Cadences are how musical sentences end. <strong>V → I</strong> is a period. <strong>IV → I</strong> is a soft "amen". <strong>V → vi</strong> is a comma that surprises (the deceptive cadence). Half cadences end on V — a question that demands an answer. Picardy thirds end a minor piece on major — light breaking through.`,
    },
    {
      heading: 'Voice leading',
      body: `When you move between chords, voices should move the smallest possible distance. Common tones stay put. Other notes step by a half- or whole-step where possible. The reason that the I–V–vi–IV progression feels so smooth is that every chord shares at least one note with its neighbour, and the bass moves by a 4th or 2nd, never a leap.`,
    },
    {
      heading: 'Borrowed chords',
      body: `In major, you can borrow from the parallel minor — most commonly <strong>iv, ♭VI, ♭VII, ♭III</strong>. They give a sudden cinematic colour (think the chorus of "Creep" where the IV becomes iv). Pop song writers use these constantly. In minor, you can borrow back from the major — most famously the major V (with raised 7th, from harmonic minor) and the Picardy third I.`,
    },
    {
      heading: 'Secondary dominants',
      body: `Any chord can be temporarily treated as a tonic. A "V7 of ii" is the dom-7 a fifth above the ii — it tonicizes (briefly makes a tonic of) the ii. Jazz uses these to thread chains: V7/iii → iii7 → V7/ii → ii7 → V7 → I. The whole thing is built out of mini-V→I cells.`,
    },
    {
      heading: 'Tritone substitution',
      body: `Any dominant 7 chord shares its tritone (the 3rd + 7th interval) with the dom-7 a tritone away. So <strong>G7</strong> (G-B-D-F) shares the B-F tritone with <strong>D♭7</strong> (D♭-F-A♭-C♭). Swap them and the bass walks chromatically (D♭ → C) instead of jumping a fourth. This is the move that turns a corny ii–V–I into a sophisticated ii–♭II7–I.`,
    },
    {
      heading: 'Modes',
      body: `Modes are scales that share the same notes but start in a different place. <strong>Dorian</strong> is minor with a major 6th (cool, jazzy — "Eleanor Rigby"). <strong>Mixolydian</strong> is major with a flat 7th (bluesy — "Sweet Home Alabama"). <strong>Lydian</strong> is major with a sharp 4th (dreamy, floating — every space-movie cue). <strong>Phrygian</strong> is minor with a flat 2nd (Spanish, dark — flamenco). Try the same I–IV–V progression in different modes and listen to the change.`,
    },
    {
      heading: 'Tension and release',
      body: `Music is patterns of tension and rest. Dissonance creates tension; consonance releases it. The trick isn't to avoid tension — it's to set up an arc. A perfectly diatonic progression has a tension graph that wobbles around 2–4 out of 10. A more dramatic one might pull 6 → 7 → 8 over four chords, then drop to 1 on a resolution. The Tension Arc visual at the top of ChordPath shows you that shape in real time.`,
    },
    {
      heading: 'Inversions and slash chords',
      body: `"C/E" means a C major chord with E in the bass. Inversions smooth out the bass line, often letting it move by step instead of by leap. The classic descending bass C → C/B → Am → Am/G → F → F/E gives you the "Pachelbel walk". Bach used this technique constantly; pop ballads still use it today.`,
    },
    {
      heading: 'Where to go next',
      body: `Try setting an unusual emotion ("Mysterious" or "Sensual") and building a 6–8 chord phrase with the suggestions. Switch on 7ths and watch the same diatonic chords become jazz. Try Lydian or Dorian as your scale on the same progression you already know in major. Above all, play it — the keyboard and guitar visualizers show you the actual notes so you can copy them onto a real instrument.`,
    },
  ];

  // ── HTML render helpers ───────────────────────────────────────────────────
  function renderShortcuts() {
    const items = SHORTCUTS.map(s => `<dt><kbd>${s.key}</kbd></dt><dd>${s.desc}</dd>`).join('');
    return `<h2>Keyboard shortcuts</h2><dl>${items}</dl>
            <p class="meta" style="margin-top:.8rem">Shortcuts are disabled while typing in a text field.</p>`;
  }

  function renderPrimer() {
    const sections = PRIMER.map(p => `<h3>${p.heading}</h3><p>${p.body}</p>`).join('');
    return `<h2>Theory primer</h2>${sections}
            <p class="meta" style="margin-top:1rem">Read it once, refer back forever. Every concept here has a knob in the app.</p>`;
  }

  // ── Preset progressions library ─────────────────────────────────────────
  // Each preset gives: name, key, scale, chord-specs (root:quality).
  // Click → instantly loaded into the editor.
  const PRESETS = [
    { name:'I-V-vi-IV (the Axis)',  key:'C', scale:'major', specs:['C:maj','G:maj','A:m','F:maj'] },
    { name:'50s Doo-wop',           key:'C', scale:'major', specs:['C:maj','A:m','F:maj','G:maj'] },
    { name:'ii-V-I (jazz)',         key:'C', scale:'major', specs:['D:m7','G:7','C:maj7'] },
    { name:'12-Bar Blues (in C)',   key:'C', scale:'major', specs:['C:7','C:7','C:7','C:7','F:7','F:7','C:7','C:7','G:7','F:7','C:7','G:7'] },
    { name:'Andalusian Cadence',    key:'A', scale:'natural_minor', specs:['A:m','G:maj','F:maj','E:maj'] },
    { name:'Mixolydian Rock',       key:'D', scale:'mixolydian', specs:['D:maj','C:maj','G:maj','D:maj'] },
    { name:'Pachelbel Canon',       key:'D', scale:'major', specs:['D:maj','A:maj','B:m','F#:m','G:maj','D:maj','G:maj','A:maj'] },
    { name:'Dorian Vamp',           key:'D', scale:'dorian', specs:['D:m7','G:7'] },
    { name:'Synthwave Loop',        key:'A', scale:'natural_minor', specs:['A:m','F:maj','C:maj','G:maj'] },
    { name:'Beatles "Something"',   key:'C', scale:'major', specs:['C:maj','C:maj7','C:7','F:maj'] },
    { name:'Bossa Wave',            key:'F', scale:'major', specs:['F:maj7','D:m7','G:m7','C:7'] },
    { name:'Gospel I-V/iii-vi',     key:'C', scale:'major', specs:['C:maj','B:7','E:m','A:7','D:m','G:7','C:maj'] },
    { name:'Phrygian Lurch',        key:'E', scale:'phrygian', specs:['E:m','F:maj','E:m'] },
    { name:'Lydian Float',          key:'F', scale:'lydian', specs:['F:maj7','G:maj','F:maj7','G:maj'] },
    { name:'Backdoor Resolution',   key:'C', scale:'major', specs:['F:m7','Bb:7','C:maj7'] },
    { name:'House of the Rising',   key:'A', scale:'natural_minor', specs:['A:m','C:maj','D:maj','F:maj','A:m','C:maj','E:maj','E:maj'] },
    { name:'Africa (verse)',        key:'B', scale:'natural_minor', specs:['F#:m','D:maj','A:maj','E:maj'] },
    { name:'Smells Like Teen Spirit',key:'F', scale:'natural_minor', specs:['F:m','Bb:maj','Ab:maj','Db:maj'] },
    { name:'Hotel California',      key:'B', scale:'natural_minor', specs:['B:m','F#:maj','A:maj','E:maj','G:maj','D:maj','E:m','F#:maj'] },
    { name:'Sus chord pads',        key:'C', scale:'major', specs:['C:sus2','G:sus4','A:m9','F:maj7'] },
  ];

  function renderPresets() {
    const items = PRESETS.map((p, i) =>
      `<button class="ghost pill" type="button" data-preset="${i}" style="margin: .15rem; text-align: left;">
         <strong>${p.name}</strong>
         <small style="display:block; color: var(--muted)">${p.key} ${p.scale.replace('_',' ')} · ${p.specs.length} chords</small>
       </button>`
    ).join('');
    return `<h2>Famous progressions</h2>
            <p class="meta" style="margin-bottom: .8rem">One-click load. Substitutes your current work.</p>
            <div style="display: flex; flex-wrap: wrap; gap: .25rem;">${items}</div>`;
  }

  global.Learn = { SHORTCUTS, PRIMER, PRESETS, renderShortcuts, renderPrimer, renderPresets };
})(typeof window !== 'undefined' ? window : globalThis);
