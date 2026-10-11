/* ChordPath — learn.js
 * Hand-written music-theory primer that the Learn drawer renders, plus the
 * keyboard-shortcut reference.
 */
(function (global) {
  'use strict';

  const SHORTCUTS = [
    { key:'Space',       desc:'Play / Stop'                  },
    { key:'D',           desc:'Play drums only'              },
    { key:'B',           desc:'Play with band'               },
    { key:'X',           desc:'Play selected full combo'      },
    { key:'M',           desc:'Play with melody'             },
    { key:'L',           desc:'Toggle loop'                  },
    { key:'7',           desc:'Toggle 7th chords'            },
    { key:'⌫ / Backspace', desc:'Undo last chord'            },
    { key:'⌘Z / Ctrl+Z',  desc:'Undo last chord'             },
    { key:'C',           desc:'Clear progression'            },
    { key:'1 – 9',       desc:'Add option chord #1–9'        },
    { key:'P',           desc:'Toggle Piano / Guitar view'   },
    { key:'E / F',       desc:'Add best chord for the section feeling' },
    { key:'[ / ]',       desc:'Previous / next section'      },
    { key:'T',           desc:'Toggle light / dark theme'    },
    { key:'?',           desc:'Show this shortcut list'      },
    { key:'Esc',         desc:'Close any open dialog / stop audio' },
  ];

  const DAW_SHORTCUTS = [
    { key:'Space',            desc:'Play / stop'                              },
    { key:'Home',             desc:'Back to the start'                        },
    { key:'R',                desc:'Record onto an audio track'               },
    { key:'L',                desc:'Toggle loop'                              },
    { key:'S',                desc:'Split the selected clip at the playhead'  },
    { key:'Ctrl+D',           desc:'Duplicate the selected clip'              },
    { key:'Delete',           desc:'Delete the selected note, or else the selected clip' },
    { key:'Ctrl+Z / Ctrl+Y',  desc:'Undo / redo'                              },
    { key:'+ / -',            desc:'Zoom the timeline in / out'               },
    { key:'Ctrl + wheel',     desc:'Zoom the timeline around the pointer'     },
    { key:'Double-click',     desc:'Empty track: new clip. Clip: open its notes. Fader: reset.' },
    { key:'Right-click',      desc:'Delete a note in the note editor'         },
    { key:'T',                desc:'Toggle light / dark theme'                },
    { key:'?',                desc:'Show this shortcut list'                  },
    { key:'Esc',              desc:'Close any open dialog'                    },
  ];

  const PRIMER = [
    {
      heading: 'Start from the section',
      body: `Pick whether the progression is an intro, verse, pre-chorus, chorus, bridge, or outro before judging it. The same four chords can be weak as a chorus but perfect as a verse if the vocal stays narrow and the drums leave space.`,
    },
    {
      heading: 'Shoegaze',
      body: `Use add9, sus2, maj7, m7, and long rhythm attacks. The vocal should usually move by small steps. The under-melody can be a high drone or one bright chime; it should blur with the guitar instead of competing with the singer.`,
    },
    {
      heading: 'Cure-style post-punk',
      body: `Let the bass and drums do more of the hook work. Minor loops, flat VII, flat VI, iv, and a major V in minor all work well. A verse can end unfinished; a chorus should either answer it clearly or lift the vocal range.`,
    },
    {
      heading: 'Smiths-style jangle',
      body: `Use bright arpeggios, melodic bass, borrowed iv, add9 chords, and quick major/minor turns. The vocal can sit close to speech rhythm, then rise at the end of the phrase for emphasis.`,
    },
    {
      heading: 'Folk edge',
      body: `Use open-string sus chords, alternating-bass picking, drones, and simple pentatonic melody. If drums are present, keep them supportive. If the song already feels honest without drums, leave them off.`,
    },
    {
      heading: 'Make sections interact',
      body: `For a verse to chorus move, change one or two layers: denser drums, wider vocal melody, brighter rhythm, or a clearer home chord. For a bridge, remove something or use a borrowed chord color. For an outro, repeat the strongest fragment and let the under-melody fade or drone.`,
    },
  ];

  const LAYER_GUIDE = [
    {
      heading: 'Rhythm',
      body: `This is the main guitar or pad motion. Shoegaze wash makes simple chords huge. Jangle arpeggio makes every chord change easier to hear. Slowcore swell makes silence part of the song.`,
    },
    {
      heading: 'Drums',
      body: `Drums decide the section energy. Motorik backbeat pushes post-punk. Hazy backbeat supports washed guitars. No drums is valid for intros, bridges, and folk sections.`,
    },
    {
      heading: 'Vocal melody',
      body: `This is the singing line. Stepwise haze melts into the track, low question sounds darker and more spoken, chorus lift makes the hook feel wider, and falling plainchant gives slowcore or folk weight.`,
    },
    {
      heading: 'Under melody',
      body: `This is the second melodic layer: drone, chime, shadow thirds, or counter-line. Use one under-melody at a time. If the vocal is busy, choose None or a drone.`,
    },
    {
      heading: 'How to audition',
      body: `Choose one rhythm, one drum pattern, one vocal melody, and one under-melody, then press Combo. Change only one selector at a time so you can actually hear what changed.`,
    },
  ];

  // ── HTML render helpers ───────────────────────────────────────────────────
  // which: 'daw' for the DAW's own list; otherwise the Section editor's.
  function renderShortcuts(which) {
    const daw = which === 'daw';
    const items = (daw ? DAW_SHORTCUTS : SHORTCUTS).map(s => `<dt><kbd>${s.key}</kbd></dt><dd>${s.desc}</dd>`).join('');
    return `<h2>${daw ? 'DAW shortcuts' : 'Keyboard shortcuts'}</h2><dl>${items}</dl>
            <p class="meta" style="margin-top:.8rem">Shortcuts are disabled while typing in a text field.</p>`;
  }

  function renderPrimer() {
    const sections = PRIMER.map(p => `<h3>${p.heading}</h3><p>${p.body}</p>`).join('');
    return `<h2>Writing guide</h2>${sections}
            <p class="meta" style="margin-top:1rem">Use this as a practical checklist while auditioning combos.</p>`;
  }

  function renderLayerGuide() {
    const sections = LAYER_GUIDE.map(p => `<h3>${p.heading}</h3><p>${p.body}</p>`).join('');
    return `<h2>Layer guide</h2>${sections}
            <p class="meta" style="margin-top:1rem">The fastest test is to change one selector, press Combo, and compare.</p>`;
  }

  // ── Preset progressions library ─────────────────────────────────────────
  // Each preset gives: name, key, scale, chord-specs (root:quality).
  // Click → instantly loaded into the editor.
  const PRESETS = [
    {
      name:'Shoegaze verse haze', key:'E', scale:'major',
      specs:['E:add9','B:sus4','C#:m7','A:maj7'],
      focusStyle:'shoegaze', sectionRole:'verse', rhythmPattern:'shoegaze_wash', drumPattern:'hazy_backbeat', vocalPattern:'stepwise_haze', underPattern:'high_drone',
    },
    {
      name:'Shoegaze chorus lift', key:'D', scale:'major',
      specs:['D:maj7','A:add9','B:m7','G:maj7'],
      focusStyle:'shoegaze', sectionRole:'chorus', rhythmPattern:'glide_strum', drumPattern:'hazy_backbeat', vocalPattern:'chorus_lift', underPattern:'fifth_chime',
    },
    {
      name:'Cure-ish dark verse', key:'A', scale:'natural_minor',
      specs:['A:m','G:maj','F:maj','E:maj'],
      focusStyle:'goth_postpunk', sectionRole:'verse', rhythmPattern:'postpunk_chime', drumPattern:'motorik_backbeat', vocalPattern:'low_question', underPattern:'octave_bell',
    },
    {
      name:'Post-punk pre-chorus climb', key:'D', scale:'dorian',
      specs:['D:m7','G:maj','F:maj','A:sus4'],
      focusStyle:'goth_postpunk', sectionRole:'prechorus', rhythmPattern:'postpunk_chime', drumPattern:'motorik_backbeat', vocalPattern:'chorus_lift', underPattern:'octave_bell',
    },
    {
      name:'Smiths-ish jangle verse', key:'C', scale:'major',
      specs:['C:maj7','E:m','F:add9','G:sus4'],
      focusStyle:'jangle_indie', sectionRole:'verse', rhythmPattern:'jangle_arp', drumPattern:'dry_jangle', vocalPattern:'speech_lift', underPattern:'thirds_shadow',
    },
    {
      name:'Jangle borrowed-iv turn', key:'C', scale:'major',
      specs:['F:maj','F:m','C:maj7','G:add9'],
      focusStyle:'jangle_indie', sectionRole:'bridge', rhythmPattern:'jangle_arp', drumPattern:'dry_jangle', vocalPattern:'speech_lift', underPattern:'thirds_shadow',
    },
    {
      name:'Dream-pop floating loop', key:'F', scale:'lydian',
      specs:['F:maj9','G:add9','C:maj7','F:maj9'],
      focusStyle:'dream_pop', sectionRole:'chorus', rhythmPattern:'dream_pulse', drumPattern:'soft_sixteenths', vocalPattern:'floating_arch', underPattern:'fifth_chime',
    },
    {
      name:'Slowcore open wound', key:'A', scale:'natural_minor',
      specs:['A:madd9','F:maj7','C:maj','G:sus4'],
      focusStyle:'slowcore', sectionRole:'verse', rhythmPattern:'slowcore_swell', drumPattern:'minimal_room', vocalPattern:'falling_plain', underPattern:'pedal_tonic',
    },
    {
      name:'Alt-folk open strings', key:'D', scale:'mixolydian',
      specs:['D:sus2','C:maj','G:add9','D:maj'],
      focusStyle:'alt_folk', sectionRole:'verse', rhythmPattern:'folk_pick', drumPattern:'brush_folk', vocalPattern:'folk_lilt', underPattern:'low_counter',
    },
    {
      name:'Minor folk drone', key:'E', scale:'dorian',
      specs:['E:m','G:maj','A:maj','E:m7'],
      focusStyle:'alt_folk', sectionRole:'intro', rhythmPattern:'folk_pick', drumPattern:'none', vocalPattern:'folk_lilt', underPattern:'pedal_tonic',
    },
  ];

  function renderPresets() {
    const items = PRESETS.map((p, i) =>
      `<button class="ghost pill" type="button" data-preset="${i}" style="margin: .15rem; text-align: left;">
         <strong>${p.name}</strong>
         <small style="display:block; color: var(--muted)">${p.key} ${p.scale.replace('_',' ')} · ${p.specs.length} chords · ${p.focusStyle ? p.focusStyle.replace('_',' ') : 'custom'}</small>
       </button>`
    ).join('');
    return `<h2>Starter sounds</h2>
            <p class="meta" style="margin-bottom: .8rem">One-click scenes with chords, section role, rhythm, drums, vocal shape, and under-melody.</p>
            <div style="display: flex; flex-wrap: wrap; gap: .25rem;">${items}</div>`;
  }

  global.Learn = { SHORTCUTS, DAW_SHORTCUTS, PRIMER, LAYER_GUIDE, PRESETS, renderShortcuts, renderPrimer, renderLayerGuide, renderPresets };
})(typeof window !== 'undefined' ? window : globalThis);
