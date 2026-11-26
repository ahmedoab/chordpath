# ChordPath — a songwriting aid and DAW

ChordPath is a songwriting aid, not a song generator. You choose the key and
the time; it offers what to try next — chords, progressions, strum rhythms,
drum grooves, melody shapes, other time signatures — lets you hear each one
before it goes in, and writes nothing you did not choose. When the song is
written, it walks you through producing it, in its own DAW or in yours, with
guitar tabs for every part, free-plugin picks, mixing chains, and recording
guides.

**Self-contained.** ChordPath needs no accounts, no API keys and no
services, and everything it does works offline. The audio library and fonts
ship in `vendor/`, the page's security policy forbids contacting any other
host, and the desktop shell cancels every request the page makes for
anything but the app's own files. The single exception is one you ask for:
Muse can look a song up on Wikipedia, and that request is made by the shell,
to that one site, with the song's title and artist and nothing else.

## Running it

**As a Windows program.** Build the installer once (needs
[Node.js](https://nodejs.org) 22.12 or newer, and for the audio engine
Visual Studio 2022 with its C++ tools):

```
npm install
npm run build:native   # the audio engine: sound cards, ASIO and plugins
npm run dist
```

Without `build:native` the program still builds and runs; it plays through
Windows' own sound and the DAW's Audio settings say the engine is missing.

That leaves two files in `dist/`:

- `ChordPath-Setup-<version>.exe` installs ChordPath for you, with Start
  menu and desktop shortcuts and an uninstaller.
- `ChordPath-<version>-portable.exe` runs without installing anything.

Neither is code-signed, so the first time you run one Windows SmartScreen
will warn about an unrecognised app: choose "More info", then "Run anyway".
`npm run test:packaged` checks the built program.

**From source.** `npm install`, then `npm start`.

**In a browser.** Open `index.html`. The song tools work there; the DAW and
Muse's lookup are built and tested for the desktop program.

However you run it, your songs and Muse's memory are stored on your
computer, and the installed program and `npm start` share them.

## Muse — ChordPath's own AI

Muse is a small learning model that lives inside the app. It is not a
chatbot and it does not call anyone else's AI. When it looks a song up it
reads an encyclopedia article with rules of its own, not with a language
model.

- **Teach it a song.** Name one. If Muse knows it (it starts with about 140
  well-known songs) it shows the chords for you to check. If it does not, it
  asks you: type them (`Am F C G`), use numerals (`i-bVI-bIII-bVII`), or
  paste a whole chord sheet and it picks the chords out of the lyrics.
- **Or have it look the song up.** In the desktop app, "Look it up on
  Wikipedia" makes Muse read the song's article and tell you what it found:
  who it is by, when, in what style, the key and tempo, any chords the
  article spells out, and its words for how the song feels, with a link to
  the article. Chords it finds go into the box for you to check; nothing is
  learned until you confirm it, and chords you have already typed are never
  overwritten. Many articles do not give chords at all, and Muse says so.
- **Tell it how the song feels**, in your own words. Muse maps that onto
  ChordPath's 26 feelings, shows you what it heard so you can correct it,
  and learns your vocabulary: a word it does not know takes on the feelings
  of the songs you use it for.
- **Ask for a draft.** Describe a feeling, or pick a song you taught it, and
  Muse writes a new progression from the songs closest to your request. It
  tells you which songs shaped the draft and which chord moves it borrowed.
  Drafts are never copies of a song it knows; "Loose / Near / Close" sets
  how much of the source survives, and "Another" always gives different
  chords. "Start a song with this" puts a draft's chords in the verse of a
  new song, in the draft's key; the rest of the song is yours to write.
- **Its memory is yours.** Everything is in the panel on the right: edit,
  forget, export to a file, import on another machine.

How it works: every loop is stored relative to its key. A request is compared
with every song by feeling and by shared words; those similarities weight a
chord-to-chord transition model, and a search writes a new loop from it.
Songs you taught count three times as much as the built-in ones.

## The DAW

Open a song in the DAW and its parts arrive as tracks: chords, bass, drums,
vocal melody and under melody, one clip per section, with the sections as
markers along the top. From there the project is yours to change.

- **Timeline.** Drag a clip to move it, drag either edge to trim it,
  double-click an empty stretch to start a new one. Click a section name to
  loop that section, or drag in the bar ruler to loop any range. `S` splits
  at the playhead, `Ctrl+D` duplicates, `?` lists every shortcut.
- **Tempo and time.** Both can change at any bar. Click the time signature
  beside the tempo, or double-click the bar ruler, and add a change where the
  playhead is. The metronome, the count-in, bar numbers, the tab and exported
  MIDI all follow; a section of the song that has its own tempo arrives as a
  change already in place.
- **Notes.** A piano roll for pitched tracks and a step grid for drums:
  click to add, drag to move or lengthen, right-click to delete, plus
  velocity, quantize and transpose. Hold Shift and drag a box to select
  several notes, then move, resize, copy and paste them together.
- **Tab.** Any clip as six-line guitar tab, whatever instrument plays it.
  Chords are written as shapes one hand can hold, in the octave where they
  are easiest; drums as a step grid.
- **Mixer.** Volume, pan, mute and solo, three-band EQ, a compressor and
  reverb and delay sends on every track, a master fader, and level meters.
- **Sound.** Ten built-in instruments and a drum kit, synthesised by the app
  itself. There are no samples to download.
- **Recording.** Record a microphone or interface onto audio tracks after a
  one-bar count-in. Choose the Input beside the Record button, and switch
  on Monitor to hear yourself through the app while you play (with
  headphones). Or bring in an audio file (WAV, MP3, OGG, FLAC) with Import
  or by dropping it on the window.
- **Takes and comping.** Record with the loop on and every pass is kept as
  a take of one clip; play over a clip again and the new take joins it.
  "Takes" on the track shows each take in a row of its own: drag along a
  row to use that take there, so the best of each can be put together.
  Nothing is cut away, and where the takes change they crossfade.
- **Punch in and out.** Turn on Punch (`P`) and Shift-drag in the bar ruler
  to mark a range: recording starts a bar ahead so you can play yourself in,
  keeps only what was played inside the range, and stops a bar after it.
- **Fades.** Drag the small squares on an audio clip's top corners to fade
  it in or out. Where one clip lies over another, the one on top is heard,
  and the two crossfade at its edges; a split clip plays on across the cut
  as if it were whole.
- **Takes keep time.** Change the tempo and a recording is stretched or
  squeezed to stay on its beats, with its pitch unchanged. For a loop from
  somewhere else, tell its clip what tempo it is at and tick "Keep in time".
  It sounds best within about a quarter of the original tempo either way.
- **Export.** A mixdown as 16- or 24-bit WAV, stems (one file per track),
  or the notes as MIDI.

Edits can be undone, a hundred steps back, and the project saves itself next
to the song on your computer. "Update from song" refreshes the note tracks
after you change the song in Write; your recordings stay.

### Sound cards and plugins

The DAW can hand its sound to ChordPath's own audio engine, a native program
(`native/`) that runs in a process of its own, so a plugin that crashes takes
only the engine down and the song carries on through Windows' sound.

- **Audio…** in the toolbar chooses where the sound goes: this computer's
  sound, or a sound card through the engine, by ASIO or by Windows (WASAPI),
  with its sample rate and buffer size. The dialog says what is playing and
  how long a buffer lasts; an ASIO driver's own settings window opens from
  there. The choice is remembered, and the card is opened again next time.
- **FX** on each mixer strip, and on the master, opens its plugin chain: VST 3
  effects (and, on a note track, one instrument that plays its notes),
  each with its own window, Bypass, and a place in the order. Plugins that
  take time are lined up with the rest; their settings are saved with the
  project and come back when it opens. Mixdowns go through the same plugins.
- Recording through a card records its inputs, and Monitor passes them
  through the track's plugins with only the card's delay.

Plugins are heard only through a card; through this computer's sound the
chain waits, and the dialog says so. AU plugins (macOS) and VST 2 are not
supported.

Limits: tempo changes happen at bar lines, with no gradual speed-ups; a take
is fitted to the tempo where it starts, so one that runs across a tempo
change drifts after it; and a single take or imported file can be up to
twenty minutes long.

## The workflow

The pages along the top follow a song from the first chord to the last mix.
Songs and Muse are always there; once a song is open, its own pages appear
beside its name: Overview, Write, Studio guide, DAW and Song sheet. Help
(F1 in the desktop app) explains each one.

1. **Songs** — your songs. Each saves itself as you work; "Save file" and
   "Open a song file…" move one between computers.
2. **Start a song** — choose the key first, named the way musicians name
   it (D♭ major, C♯ minor), then the time signature (hear it before you
   choose), the tempo, and how many empty sections to begin with. A
   *feeling* (26 of them, from yearning to menacing) is optional; it only
   guides what is suggested.
3. **Overview** — the section timeline. Each card shows its time
   signature, its bars counted in that time, and the rhythm and drums it
   really plays. Set the song's time signature here; add empty sections,
   duplicate and reorder them (click a card to write it); give a section a
   feeling of its own (it guides the suggestions and changes nothing you
   wrote). The key can be changed here too. Take **snapshots** before big
   changes — autosave can never overwrite them, and restoring always
   creates a copy. Play the whole song, save it as multi-track MIDI.
4. **Write** — the writing workspace, one section at a time. Its four
   views: **Next chord** (ranked suggestions, scored for the section's
   feeling), **Ideas** (progressions, strum rhythms, drum grooves, melody
   shapes and other times to try, each heard before it is used, plus
   starter sounds), **Parts** (what each instrument plays) and **About**
   (what the chords do, a tension line, songs that use them). Undo takes
   chord edits back out. Each section can have its own time, and a chord
   can last half a bar or several bars. On the right: how to play the
   chord, and live guitar tab for chords, vocal melody, bass, under-melody
   and drums, written in the section's time. Play at the bottom plays what
   is chosen beside it: the chords, the chords and melody, the band,
   everything, or the drums; Sound… holds the instruments, tones and levels.
5. **Studio guide** — per-section instrument roster with a frequency **density
   meter** (too sparse? too crowded? which instruments clash?), and a card
   per instrument: free plugins, a concrete mix chain (Hz, ratios, ms), and
   how to record it. Includes a full vocal-session guide with a range check
   against your own voice.
6. **DAW** — the song as editable tracks, with recording, mixing and export.
   See above.
7. **Song sheet** — one printable page with every tab (each section in its
   own time, exactly as Write shows it), arrangement note,
   plugin pick, and the production checklist. Print it or save as PDF, and
   drag the exported `.mid` into another DAW: every part lands on its own
   track with sections as markers.

## Tests

No framework needed. The theory engine, Muse and the DAW's project model run
headless in Node; everything that needs sound or a screen is tested in the
real desktop app.

```
npm test                     # the eight headless suites below
node tests/run.js            # ~2300 data-integrity + engine checks
node tests/meter-test.js     # time signatures, their rhythms and grooves
node tests/ideas-test.js     # the ideas the section editor offers
node tests/audio-test.js     # playback-scheduling checks (stubbed Tone.js)
node tests/muse-test.js      # chord parsing, lexicon, Muse memory and drafting
node tests/daw-test.js       # the DAW project, tempo map, tab, WAV, audio stretching
node tests/research-test.js  # Muse's lookup: what may be asked, how an article is read
node tests/native-test.js    # the native audio host (skips if it is not built)

npm run test:e2e             # launches the desktop app five times (several minutes)
node tests/e2e.js            # Muse and the desktop shell
node tests/e2e-writing.js    # starting a song, the section editor, overview, handoff
node tests/e2e-engine.js     # the audio engine, measured from its own output
node tests/e2e-daw.js        # the DAW screen, driven with mouse and keyboard
node tests/e2e-host.js       # sound cards and plugins on screen, through the audio engine

npm run test:packaged        # the built program, after npm run dist
```

The sound-card tests need no hardware: the engine carries a stand-in ASIO
driver that only tests can see, and under test nothing is heard and plugin
windows open hidden. Plugin tests use TDR Nova where it is installed.

No test goes online. Muse's lookup is tested against made-up articles that
the shell serves from files, in the shape Wikipedia answers in.

## Architecture

Vanilla JS, no build step. Each file is an IIFE exporting one global;
`index.html`'s script order is the dependency graph.

- `theory/` — the engine: scales, chords, voicings, progressions (ranked
  next-chord engine), analysis (cadence/tension), genres (28), arrangements
  (rhythm/drum/melody patterns + per-genre profiles), emotions (scoring),
  **feelings** (what each feeling sounds like; ranks suggestions),
  **meters** (time signatures and the rhythms and grooves written for
  each), **ideas** (what the section editor offers to try), songs
  (famous-progression matcher), melody, **tabs** (guitar tablature
  renderer), **instruments/plugins/mixing/recording** (the studio knowledge
  base), **song** (project model), storage (projects/snapshots/migration),
  midi (Type-1 multi-track writer), learn.
- `theory/` also holds Muse: **chordparse** (chord text, chord sheets, roman
  numerals, key detection), **lexicon** (description → feelings),
  **musedata** (the built-in song library), **muse** (memory, learning,
  drafting), **research** (choosing and reading an article about a song).
- `daw/` — the DAW underneath the screen: **wav** (reading and writing WAV),
  **project** (tracks, clips and notes, the editing operations, undo, MIDI
  export), **store** (projects and recordings in the app's local database),
  **stretch** (making a recording longer or shorter without changing its
  pitch), **engine** (instruments, mixer, effects, transport, recording and
  offline bouncing, written on the Web Audio API), **native** (the page's
  side of the audio engine: sending the tracks to it, keeping its plugins in
  step with the project). `theory/parts.js` turns a song into the notes each
  track starts with.
- `native/` — the audio engine, in C++: VST 3 hosting (Steinberg's VST 3
  SDK), a mixing desk that matches the page's own, sound cards through
  WASAPI (RtAudio) or ASIO. `fetch-deps.js` downloads the SDKs it builds
  against; `desktop/audiohost.js` runs it in a process of its own and
  `desktop/pluginscan.js` reads plugin files in a throwaway one.
- `ui/` — components, viz (piano/fretboard/chord diagrams), nav (hash
  router), and one view module per screen. `ui/daw/` holds the DAW's
  timeline, note editor and mixer.
- `tools/make-icon.js` redraws the program's icon from `desktop/icon.svg`.
- `desktop/` — the Electron shell: one window, a private `app://` address
  for the app's files, and the rule that the page may request nothing else.
  `lookup.js` is the one way out: it builds the only addresses the shell
  will ever ask (Wikipedia's) and turns the answers into plain text.
- `vendor/` — Tone.js and the Inter / JetBrains Mono fonts, with licences.
- `audio.js` — Tone.js synthesis: full-band playback per section and
  chained whole-song playback.
