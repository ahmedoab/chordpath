/* ChordPath — learn.js
 * What the Help window shows: how the pages fit together, genre writing
 * tips, what each part does, and the keyboard shortcuts; plus the starter
 * sounds the section editor's Ideas pane offers.
 */
(function (global) {
  'use strict';

  const SHORTCUTS = [
    { key:'Space',       desc:'Play or stop (Play plays what is chosen beside it)' },
    { key:'D',           desc:'Play the drums on their own'  },
    { key:'B',           desc:'Play the band: chords in their rhythm, drums and bass' },
    { key:'X',           desc:'Play everything, melodies too' },
    { key:'M',           desc:'Play the chords and the vocal melody' },
    { key:'L',           desc:'Loop on or off'               },
    { key:'7',           desc:'Suggest 7th chords, or not'   },
    { key:'⌫ / Backspace', desc:'Take out the last chord'    },
    { key:'⌘Z / Ctrl+Z',  desc:'Undo the last change to the chords' },
    { key:'C',           desc:'Clear the chords (Undo brings them back)' },
    { key:'1 – 9',       desc:'Add suggestion 1 to 9 from the Next chord list' },
    { key:'I',           desc:'Switch between Next chord and Ideas' },
    { key:'P',           desc:'Show the notes on the piano or the guitar neck' },
    { key:'E / F',       desc:'Add the chord that best fits the section\'s feeling' },
    { key:'[ / ]',       desc:'Previous / next section'      },
    { key:'T',           desc:'Light or dark theme'          },
    { key:'?',           desc:'Show this shortcut list'      },
    { key:'Esc',         desc:'Close any open dialog, stop the sound' },
  ];

  // How the app fits together: the pages along the top, in order.
  const HOW_IT_WORKS = [
    { where:'Songs', what:'Every song you have started. New song asks for the key first, then the time and tempo, and opens the song in Write. Nothing is written for you.' },
    { where:'Overview', what:'The whole song: its sections in order (add, duplicate, move and delete them), the key, time and tempo, playing the song from the top, and snapshots to keep a version safe.' },
    { where:'Write', what:'One section at a time. Next chord suggests what could follow, best fit first. Ideas offers progressions, rhythms, drum grooves, other times and melody shapes, each to hear before you use it. Parts sets what each instrument plays. The tab is on the right, and Play at the bottom plays the chords, the band or everything.' },
    { where:'Studio guide', what:'Which instruments to use in each section, with free plugin picks and how to record and mix each one.' },
    { where:'DAW', what:'Record, arrange and mix the song: tracks, takes to choose the best of, a note editor, tab, a mixer with automation, and your own sound card and plugins.' },
    { where:'Song sheet', what:'Every tab and note for the song on one page, to print or save as a PDF.' },
    { where:'Muse', what:'ChordPath\'s own AI. Teach it songs you love and how they feel, then ask it for a progression in that spirit.' },
  ];

  const DAW_SHORTCUTS = [
    { key:'Space',            desc:'Play / stop'                              },
    { key:'Home',             desc:'Back to the start'                        },
    { key:'R',                desc:'Record onto an audio track'               },
    { key:'L',                desc:'Toggle loop. Recording while it loops keeps every pass as a take.' },
    { key:'P',                desc:'Toggle punch in/out: recording keeps only the range marked in red' },
    { key:'Shift + drag ruler', desc:'Mark the punch range'                   },
    { key:'Drag a take row',  desc:'Use that take over the stretch dragged across. Click: swap the stretch under the pointer. Double-click: use it all through.' },
    { key:'Clip corners',     desc:'Drag the small squares on an audio clip\'s top corners to fade it in or out; drag either edge to trim it' },
    { key:'Automation rows',  desc:'Auto on a track (or Master automation) shows its lanes. Click in a lane to put a point down, drag one to move it, right-click or double-click it to take it away' },
    { key:'S',                desc:'Split the selected clip at the playhead'  },
    { key:'Ctrl+D',           desc:'Duplicate the selected clip'              },
    { key:'Delete',           desc:'Delete the selected note, or else the selected clip' },
    { key:'Ctrl+Z / Ctrl+Y',  desc:'Undo / redo'                              },
    { key:'+ / -',            desc:'Zoom the timeline in / out'               },
    { key:'Ctrl + wheel',     desc:'Zoom the timeline around the pointer'     },
    { key:'Double-click',     desc:'Empty track: new clip. Clip: open its notes. Fader: reset. Bar ruler: change tempo or time signature there.' },
    { key:'Right-click',      desc:'Delete a note in the note editor'         },
    { key:'Shift + drag',     desc:'Note editor: draw a box round several notes to select them' },
    { key:'Shift + click',    desc:'Note editor: add a note to the selection, or take it out' },
    { key:'Ctrl+A',           desc:'Select every note in the open clip'       },
    { key:'Ctrl+C / X / V',   desc:'Copy, cut and paste notes (paste lands at the playhead)' },
    { key:'Arrow keys',       desc:'Nudge selected notes: a step left or right, a semitone up or down (Shift: an octave)' },
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
      body: `Under Parts, choose one rhythm, one drum pattern, one vocal melody and one under-melody, choose Everything beside Play, and press Play. Change only one at a time so you can hear what changed.`,
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
    return `<h2>Genre writing tips</h2>${sections}
            <p class="meta" style="margin-top:1rem">A checklist to keep beside you while you try parts out.</p>`;
  }

  function renderLayerGuide() {
    const sections = LAYER_GUIDE.map(p => `<h3>${p.heading}</h3><p>${p.body}</p>`).join('');
    return `<h2>What each part does</h2>${sections}
            <p class="meta" style="margin-top:1rem">The quickest test: change one part, play Everything, and compare.</p>`;
  }

  // The Help window: how the pages fit together, and the other guides.
  function renderHelp() {
    const rows = HOW_IT_WORKS.map(s => `<dt>${s.where}</dt><dd>${s.what}</dd>`).join('');
    return `<h2>How ChordPath works</h2>
            <p>Start a song from Songs. Its pages then appear along the top, beside its name. Your work saves itself as you go.</p>
            <dl class="help-steps">${rows}</dl>
            <h3>More help</h3>
            <div class="help-more">
              <button type="button" class="ghost" data-help="shortcuts">Keyboard shortcuts</button>
              <button type="button" class="ghost" data-help="layers">What each part does</button>
              <button type="button" class="ghost" data-help="genres">Genre writing tips</button>
              <button type="button" class="ghost" data-help="quiz">Chord ear quiz</button>
            </div>
            <p class="meta" style="margin-top:.8rem">Not sure what something does? Rest the pointer on it: most buttons say. A word with a dotted line under it gives its music-theory name.</p>`;
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
         <small style="display:block; color: var(--muted)">${p.specs.length} chords · ${/minor|dorian|phrygian/.test(p.scale) ? 'minor' : 'major'} colour · ${p.focusStyle ? p.focusStyle.replace('_',' ') : 'custom'}</small>
       </button>`
    ).join('');
    return `<h2>Starter sounds</h2>
            <p class="meta" style="margin-bottom: .8rem">Scenes to start from: chords, a rhythm, drums and melody shapes. Each one plays in your song's key and time, and Undo takes its chords out again.</p>
            <div style="display: flex; flex-wrap: wrap; gap: .25rem;">${items}</div>`;
  }

  global.Learn = { SHORTCUTS, DAW_SHORTCUTS, PRIMER, LAYER_GUIDE, PRESETS, HOW_IT_WORKS, renderShortcuts, renderPrimer, renderLayerGuide, renderPresets, renderHelp };
})(typeof window !== 'undefined' ? window : globalThis);
