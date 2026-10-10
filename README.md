# ChordPath — feeling-driven song studio

Tell ChordPath what you want the listener to feel, and it drafts the whole
song: key, scale, tempo, section structure (intro/verse/pre-chorus/chorus/
bridge/outro), chord progressions, arrangement patterns, and an instrument
roster — then walks you through producing it in your DAW with guitar tabs
for every part, free-plugin picks, mixing chains, and recording guides.

**Zero install.** Open `index.html` in a browser. Everything runs locally;
songs autosave to your browser's localStorage.

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
6. **Handoff** — one printable page with every tab, arrangement note,
   plugin pick, and the production checklist. Print it or save as PDF, and
   drag the exported `.mid` into your DAW: every part lands on its own
   track with sections as markers.

## Tests

No framework needed — the theory engine runs headless in Node:

```
node tests/run.js        # ~2200 data-integrity + engine checks
node tests/audio-test.js # playback-scheduling checks (stubbed Tone.js)
```

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
- `ui/` — components, viz (piano/fretboard/chord diagrams), nav (hash
  router), and one view module per screen.
- `audio.js` — Tone.js synthesis: full-band playback per section and
  chained whole-song playback.
