# ChordPath — feeling-driven song studio

Tell ChordPath what you want the listener to feel, and it drafts the whole
song: key, scale, tempo, section structure (intro/verse/pre-chorus/chorus/
bridge/outro), chord progressions, arrangement patterns, and an instrument
roster — then walks you through producing it in your DAW with guitar tabs
for every part, free-plugin picks, mixing chains, and recording guides.

> **Experimental branch.** This branch adds Muse (a built-in AI), turns
> ChordPath into a desktop application, and gives it a DAW of its own.
> `main` holds the original version.

**Self-contained.** ChordPath needs no accounts, no API keys and no
services, and everything it does works offline. The audio library and fonts
ship in `vendor/`, the page's security policy forbids contacting any other
host, and the desktop shell cancels every request the page makes for
anything but the app's own files. The single exception is one you ask for:
Muse can look a song up on Wikipedia, and that request is made by the shell,
to that one site, with the song's title and artist and nothing else.

## Running it

As a desktop application (needs [Node.js](https://nodejs.org) 22.12 or newer,
once, to fetch the shell):

```
npm install
npm start
```

Or with nothing installed: open `index.html` in a browser. Either way your
songs and Muse's memory are stored on your computer. The DAW is built and
tested for the desktop application.

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
  how much of the source survives. One click turns a draft into a full song.
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

- **Timeline.** Drag a clip to move it, drag its right edge to trim it,
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
  one-bar count-in. Choose which input beside the Record button, and switch
  on "Hear it" to hear yourself through the app while you play (with
  headphones). Or bring in an audio file (WAV, MP3, OGG, FLAC) with Import
  or by dropping it on the window.
- **Takes keep time.** Change the tempo and a recording is stretched or
  squeezed to stay on its beats, with its pitch unchanged. For a loop from
  somewhere else, tell its clip what tempo it is at and tick "Keep in time".
  It sounds best within about a quarter of the original tempo either way.
- **Export.** A mixdown as 16- or 24-bit WAV, stems (one file per track),
  or the notes as MIDI.

Edits can be undone, a hundred steps back, and the project saves itself next
to the song on your computer. "Rebuild" refreshes the note tracks after you
change the song elsewhere in ChordPath; your recordings stay.

What it does not do: host VST or AU plugins. Those are native programs that
this app, built on web technology, cannot load; export the stems or the MIDI
and carry on in a DAW that can. Smaller limits: tempo changes happen at bar
lines, with no gradual speed-ups; a take is fitted to the tempo where it
starts, so one that runs across a tempo change drifts after it; and a single
take or imported file can be up to twenty minutes long.

## The workflow

1. **Songs** — your project browser. Autosaved projects, JSON import/export.
2. **New song wizard** — pick a *feeling* (26 of them, from yearning to
   menacing), an energy level, and a genre (28, from shoegaze to bossa).
   ChordPath generates a full draft song; reroll anything before creating.
3. **Overview** — the section timeline. Each section has its own feeling
   (verse can yearn while the chorus turns nostalgic); change a section's
   feeling and regenerate just its chords or arrangement. Take **snapshots**
   before big changes — autosave can never overwrite them, and restoring
   always creates a copy. Play the whole song, export multi-track MIDI.
4. **Section editor** — the writing workspace: ranked next-chord
   suggestions (scored for your section's feeling), cadence/tension
   analysis, "sounds like" genre + famous-song matching, playable full-band
   arrangements, and live guitar tab for chords, vocal melody, bass,
   under-melody, and drums.
5. **Studio** — per-section instrument roster with a frequency **density
   meter** (too sparse? too crowded? which instruments clash?), and a card
   per instrument: free plugins, a concrete mix chain (Hz, ratios, ms), and
   how to record it. Includes a full vocal-session guide with a range check
   against your own voice.
6. **DAW** — the song as editable tracks, with recording, mixing and export.
   See above.
7. **Handoff** — one printable page with every tab, arrangement note,
   plugin pick, and the production checklist. Print it or save as PDF, and
   drag the exported `.mid` into another DAW: every part lands on its own
   track with sections as markers.

## Tests

No framework needed. The theory engine, Muse and the DAW's project model run
headless in Node; everything that needs sound or a screen is tested in the
real desktop app.

```
npm test                     # the five headless suites below
node tests/run.js            # ~2300 data-integrity + engine checks
node tests/audio-test.js     # playback-scheduling checks (stubbed Tone.js)
node tests/muse-test.js      # chord parsing, lexicon, Muse memory and drafting
node tests/daw-test.js       # the DAW project, tempo map, tab, WAV, audio stretching
node tests/research-test.js  # Muse's lookup: what may be asked, how an article is read

npm run test:e2e             # launches the desktop app three times (several minutes)
node tests/e2e.js            # Muse and the desktop shell
node tests/e2e-engine.js     # the audio engine, measured from its own output
node tests/e2e-daw.js        # the DAW screen, driven with mouse and keyboard
```

No test goes online. Muse's lookup is tested against made-up articles that
the shell serves from files, in the shape Wikipedia answers in.

## Architecture

Vanilla JS, no build step. Each file is an IIFE exporting one global;
`index.html`'s script order is the dependency graph.

- `theory/` — the engine: scales, chords, voicings, progressions (ranked
  next-chord engine), analysis (cadence/tension), genres (28), arrangements
  (rhythm/drum/melody patterns + per-genre profiles), emotions (scoring),
  **feelings** (the generator: feeling × genre → whole songs), songs
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
  offline bouncing, written on the Web Audio API). `theory/parts.js` turns a
  song into the notes each track starts with.
- `ui/` — components, viz (piano/fretboard/chord diagrams), nav (hash
  router), and one view module per screen. `ui/daw/` holds the DAW's
  timeline, note editor and mixer.
- `desktop/` — the Electron shell: one window, a private `app://` address
  for the app's files, and the rule that the page may request nothing else.
  `lookup.js` is the one way out: it builds the only addresses the shell
  will ever ask (Wikipedia's) and turns the answers into plain text.
- `vendor/` — Tone.js and the Inter / JetBrains Mono fonts, with licences.
- `audio.js` — Tone.js synthesis: full-band playback per section and
  chained whole-song playback.
