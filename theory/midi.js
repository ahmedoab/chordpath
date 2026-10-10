/* ChordPath — midi.js
 * Build a Standard MIDI File (Type-0) from a chord progression and trigger
 * a browser download. No external library — we hand-roll the SMF bytes.
 *
 * MIDI structure (Type-0):
 *   - Header chunk "MThd" (6 bytes payload): format(0) tracks(1) division(ticks/quarter)
 *   - Track chunk  "MTrk" (length + event stream)
 * Each event is preceded by a variable-length delta-time tick count.
 */
(function (global) {
  'use strict';

  const TICKS_PER_QUARTER = 480;
  const V = global.Voicings;

  function midiOfNote(noteName) {
    if (global.Voicings && global.Voicings.midiOf) return global.Voicings.midiOf(noteName);
    const m = noteName.match(/^([A-G][#b]?)(-?\d+)$/);
    if (!m) return 60;
    const S = global.Scales;
    return S.noteIndex(m[1]) + (parseInt(m[2], 10) + 1) * 12;
  }

  // ── byte buffer ──────────────────────────────────────────────────────────
  function Buf() { this.bytes = []; }
  Buf.prototype.u8  = function (v) { this.bytes.push(v & 0xff); };
  Buf.prototype.u16 = function (v) { this.bytes.push((v >> 8) & 0xff, v & 0xff); };
  Buf.prototype.u32 = function (v) { this.bytes.push((v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff); };
  Buf.prototype.str = function (s) { for (let i = 0; i < s.length; i++) this.bytes.push(s.charCodeAt(i) & 0xff); };
  Buf.prototype.varlen = function (v) {
    const out = [v & 0x7f];
    while (v >>= 7) out.unshift((v & 0x7f) | 0x80);
    for (const b of out) this.bytes.push(b);
  };
  Buf.prototype.bytesArr = function () { return this.bytes.slice(); };

  // ── Build a chord progression as MIDI events ─────────────────────────────
  function buildSMF(opts) {
    const tempo    = opts.tempo || 92;
    const chords   = opts.chords || [];
    const voicing  = opts.voicing || 'smart';
    const withBass = opts.withBass !== false;
    const withMelody = !!opts.melody && opts.melody.length;
    const beatsPerChord = opts.beatsPerChord || 4;

    if (chords.length === 0) return null;

    // Pre-compute voicings with prev chain
    const voicedNotes = [];
    let prev = null;
    for (const ch of chords) {
      const v = V.voice(ch, voicing, { previous: prev });
      voicedNotes.push(v);
      prev = v;
    }
    const bassNotes = chords.map(ch => {
      const pc = ch.rootPc;
      const midi = pc + 3 * 12; // octave 2
      return midi;
    });

    // ── Track 0: tempo + chord notes + bass + melody ───────────────────────
    const trk = new Buf();

    // Tempo meta event (microseconds per quarter note)
    const microPerQuarter = Math.round(60000000 / tempo);
    trk.varlen(0);
    trk.u8(0xff); trk.u8(0x51); trk.u8(0x03);
    trk.u8((microPerQuarter >> 16) & 0xff);
    trk.u8((microPerQuarter >> 8) & 0xff);
    trk.u8(microPerQuarter & 0xff);

    // Time signature 4/4 (denom=2 means 2^2=4, 24 ticks per click, 8 32nds per quarter)
    trk.varlen(0);
    trk.u8(0xff); trk.u8(0x58); trk.u8(0x04);
    trk.u8(4); trk.u8(2); trk.u8(24); trk.u8(8);

    // Program change: channel 0 = Acoustic Grand Piano (0), channel 1 = Acoustic Bass (32),
    // channel 2 = Square Lead Synth (80) for melody.
    trk.varlen(0); trk.u8(0xc0); trk.u8(0);
    trk.varlen(0); trk.u8(0xc1); trk.u8(32);
    trk.varlen(0); trk.u8(0xc2); trk.u8(80);

    // Build a sorted event list (deltaTimeAbs, kind: 'on'|'off', channel, note, vel)
    const events = [];
    const ticksPerChord = beatsPerChord * TICKS_PER_QUARTER;
    chords.forEach((ch, idx) => {
      const start = idx * ticksPerChord;
      const end = start + ticksPerChord - 8; // slight gap for note-off
      // Chord notes (channel 0)
      voicedNotes[idx].forEach((noteName, ni) => {
        const midi = midiOfNote(noteName);
        events.push({ t: start, kind: 'on',  ch: 0, n: midi, v: 80 });
        events.push({ t: end,   kind: 'off', ch: 0, n: midi, v: 0  });
      });
      // Bass note (channel 1)
      if (withBass) {
        events.push({ t: start, kind: 'on',  ch: 1, n: bassNotes[idx], v: 90 });
        events.push({ t: end,   kind: 'off', ch: 1, n: bassNotes[idx], v: 0  });
      }
    });

    if (withMelody) {
      // Melody event: { midi, name, beatStart, beats }
      opts.melody.forEach(ev => {
        const start = Math.round(ev.beatStart * TICKS_PER_QUARTER);
        const len   = Math.max(20, Math.round(ev.beats * TICKS_PER_QUARTER) - 4);
        events.push({ t: start, kind: 'on',  ch: 2, n: ev.midi, v: 95 });
        events.push({ t: start + len, kind: 'off', ch: 2, n: ev.midi, v: 0 });
      });
    }

    events.sort((a, b) => a.t - b.t || (a.kind === 'off' ? -1 : 1));

    let last = 0;
    for (const e of events) {
      const delta = e.t - last;
      last = e.t;
      trk.varlen(delta);
      const status = (e.kind === 'on' ? 0x90 : 0x80) | (e.ch & 0x0f);
      trk.u8(status); trk.u8(e.n & 0x7f); trk.u8(e.v & 0x7f);
    }

    // End-of-track meta event
    trk.varlen(0);
    trk.u8(0xff); trk.u8(0x2f); trk.u8(0x00);

    const trkBytes = trk.bytesArr();

    // ── Header chunk ───────────────────────────────────────────────────────
    const out = new Buf();
    out.str('MThd');
    out.u32(6);
    out.u16(0);                 // format 0
    out.u16(1);                 // 1 track
    out.u16(TICKS_PER_QUARTER); // division

    out.str('MTrk');
    out.u32(trkBytes.length);
    trkBytes.forEach(b => out.u8(b));

    return new Uint8Array(out.bytesArr());
  }

  // ── Whole-song Type-1 export ─────────────────────────────────────────────
  // One conductor track (tempo map, markers, key/time signature) plus one
  // track per part: chords, bass, vocal melody, under melody, and drums on
  // channel 10 — drag the file into any DAW and each part lands on its own
  // track with sections visible as markers.

  function metaEvent(trk, delta, type, bytes) {
    trk.varlen(delta);
    trk.u8(0xff); trk.u8(type); trk.varlen(bytes.length);
    bytes.forEach(b => trk.u8(b & 0xff));
  }
  function metaText(trk, delta, type, text) {
    metaEvent(trk, delta, type, String(text).split('').map(c => c.charCodeAt(0)));
  }
  function strBytes(s) { return String(s).split('').map(c => c.charCodeAt(0)); }

  const KEY_SIGS = { C:0, G:1, D:2, A:3, E:4, B:5, 'F#':6, 'C#':7, F:-1, Bb:-2, Eb:-3, Ab:-4, Db:-5, Gb:-6 };
  const MINOR_SIGS = { A:0, E:1, B:2, 'F#':3, 'C#':4, 'G#':5, 'D#':6, D:-1, G:-2, C:-3, F:-4, Bb:-5, Eb:-6 };

  function trackChunk(out, trk) {
    const bytes = trk.bytesArr();
    out.str('MTrk');
    out.u32(bytes.length);
    bytes.forEach(b => out.u8(b));
  }

  function writeNoteEvents(trk, events, channel) {
    events.sort((a, b) => a.t - b.t || (a.kind === 'off' ? -1 : 1));
    let last = 0;
    for (const e of events) {
      trk.varlen(Math.max(0, e.t - last));
      last = e.t;
      trk.u8((e.kind === 'on' ? 0x90 : 0x80) | (channel & 0x0f));
      trk.u8(e.n & 0x7f); trk.u8(e.v & 0x7f);
    }
    metaEvent(trk, 0, 0x2f, []);
  }

  const DRUM_NOTES = { kick: 36, snare: 38, hhClosed: 42, hhOpen: 46 };
  const DRUM_VELS = { kick: 100, snare: 95, hhClosed: 70, hhOpen: 80 };

  function buildSongSMF(song) {
    const Song = global.Song;
    const I = global.Instruments;
    const items = Song.buildPlayback(song);
    if (!items.length) return null;

    // Absolute start tick of each queue entry (repeats expand the timeline).
    const timeline = [];
    let tick = 0;
    items.forEach(item => {
      const secTicks = item.chords.length * item.beatsPerChord * TICKS_PER_QUARTER;
      const reps = Math.max(1, item.repeat || 1);
      for (let r = 0; r < reps; r++) {
        timeline.push({ item, startTick: tick, firstRep: r === 0 });
        tick += secTicks;
      }
    });

    // ── Conductor track ────────────────────────────────────────────────────
    const cond = new Buf();
    metaText(cond, 0, 0x03, song.title || 'ChordPath song');
    metaEvent(cond, 0, 0x58, [4, 2, 24, 8]);   // 4/4
    const sig = song.scale === 'major' ? KEY_SIGS[song.key]
      : song.scale === 'natural_minor' ? MINOR_SIGS[song.key] : undefined;
    if (sig !== undefined) {
      metaEvent(cond, 0, 0x59, [(sig + 256) & 0xff, song.scale === 'natural_minor' ? 1 : 0]);
    }
    let condLast = 0;
    let lastTempo = null;
    timeline.forEach(entry => {
      const delta = entry.startTick - condLast;
      let used = false;
      if (entry.item.tempo !== lastTempo) {
        const mpq = Math.round(60000000 / entry.item.tempo);
        metaEvent(cond, delta, 0x51, [(mpq >> 16) & 0xff, (mpq >> 8) & 0xff, mpq & 0xff]);
        lastTempo = entry.item.tempo;
        used = true;
      }
      if (entry.firstRep) {
        const feeling = global.Feelings && global.Song
          ? (global.Feelings.getFeeling(
              (song.sections.find(s => s.id === entry.item.sectionId) || {}).feelingId || song.feelingId
            ) || {}).name || ''
          : '';
        metaText(cond, used ? 0 : delta, 0x06, entry.item.name + (feeling ? ' [' + feeling + ']' : ''));
        used = true;
      }
      if (used) condLast = entry.startTick;
    });
    metaEvent(cond, 0, 0x2f, []);

    // ── Part tracks ────────────────────────────────────────────────────────
    // Chord program: the first harmony instrument in any section roster.
    let chordProgram = 0;
    if (I) {
      outer:
      for (const sec of song.sections) {
        for (const id of (sec.roster || [])) {
          const inst = I.byId(id);
          if (inst && inst.role === 'harmony') { chordProgram = inst.midiProgram; break outer; }
        }
      }
    }

    const chordEvents = [], bassEvents = [], vocalEvents = [], underEvents = [], drumEvents = [];
    let prevVoicing = null;
    timeline.forEach(({ item, startTick }) => {
      const ticksPerChord = item.beatsPerChord * TICKS_PER_QUARTER;
      // Chords (smart voice leading chained across the whole song).
      item.chords.forEach((ch, idx) => {
        const start = startTick + idx * ticksPerChord;
        const end = start + ticksPerChord - 8;
        const v = V.voice(ch, 'smart', { previous: prevVoicing });
        prevVoicing = v;
        v.forEach(noteName => {
          const midi = midiOfNote(noteName);
          chordEvents.push({ t: start, kind: 'on', n: midi, v: 80 });
          chordEvents.push({ t: end, kind: 'off', n: midi, v: 0 });
        });
      });
      // Bass line mirrors the section's rhythm style (shared with the tabs).
      const bassStyle = item.pattern && item.pattern.bass ? item.pattern.bass : 'root';
      global.Tabs.bassEvents(item.chords, bassStyle, item.beatsPerChord).forEach(ev => {
        const start = startTick + Math.round(ev.beatStart * TICKS_PER_QUARTER);
        const len = Math.max(20, Math.round(ev.beats * TICKS_PER_QUARTER) - 8);
        bassEvents.push({ t: start, kind: 'on', n: ev.midi, v: 90 });
        bassEvents.push({ t: start + len, kind: 'off', n: ev.midi, v: 0 });
      });
      // Vocal + under melodies.
      (item.melody || []).forEach(ev => {
        const start = startTick + Math.round(ev.beatStart * TICKS_PER_QUARTER);
        const len = Math.max(20, Math.round(ev.beats * TICKS_PER_QUARTER) - 4);
        vocalEvents.push({ t: start, kind: 'on', n: ev.midi, v: 95 });
        vocalEvents.push({ t: start + len, kind: 'off', n: ev.midi, v: 0 });
      });
      (item.under || []).forEach(ev => {
        const start = startTick + Math.round(ev.beatStart * TICKS_PER_QUARTER);
        const len = Math.max(20, Math.round(ev.beats * TICKS_PER_QUARTER) - 4);
        underEvents.push({ t: start, kind: 'on', n: ev.midi, v: 70 });
        underEvents.push({ t: start + len, kind: 'off', n: ev.midi, v: 0 });
      });
      // Drums: tile the 16-step grid across every bar of the section.
      const drums = item.pattern && item.pattern.drums;
      if (drums) {
        const bars = Math.ceil(item.chords.length * item.beatsPerChord / 4);
        const stepTicks = TICKS_PER_QUARTER / 4;
        for (let bar = 0; bar < bars; bar++) {
          const barTick = startTick + bar * 16 * stepTicks;
          Object.entries(DRUM_NOTES).forEach(([lane, note]) => {
            (drums[lane] || []).forEach(step => {
              const t = Math.round(barTick + step * stepTicks);
              drumEvents.push({ t, kind: 'on', n: note, v: DRUM_VELS[lane] });
              drumEvents.push({ t: t + Math.round(stepTicks / 2), kind: 'off', n: note, v: 0 });
            });
          });
        }
      }
    });

    const parts = [
      { name: 'Chords', channel: 0, program: chordProgram, events: chordEvents },
      { name: 'Bass', channel: 1, program: 33, events: bassEvents },
      { name: 'Vocal melody', channel: 2, program: 80, events: vocalEvents },
      { name: 'Under melody', channel: 3, program: 88, events: underEvents },
      { name: 'Drums', channel: 9, program: null, events: drumEvents },
    ].filter(p => p.events.length > 0);

    const out = new Buf();
    out.str('MThd');
    out.u32(6);
    out.u16(1);                        // format 1
    out.u16(1 + parts.length);
    out.u16(TICKS_PER_QUARTER);
    trackChunk(out, cond);
    parts.forEach(p => {
      const trk = new Buf();
      metaText(trk, 0, 0x03, p.name);
      if (p.program != null) {
        trk.varlen(0); trk.u8(0xc0 | (p.channel & 0x0f)); trk.u8(p.program & 0x7f);
      }
      writeNoteEvents(trk, p.events, p.channel);
      trackChunk(out, trk);
    });
    return new Uint8Array(out.bytesArr());
  }

  function slug(text) {
    return String(text || 'song').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'song';
  }

  function downloadSong(song) {
    const bytes = buildSongSMF(song);
    if (!bytes) return false;
    const blob = new Blob([bytes], { type: 'audio/midi' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = slug(song.title) + '.mid';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    return true;
  }

  // ── Trigger browser download ─────────────────────────────────────────────
  function download(opts) {
    const bytes = buildSMF(opts);
    if (!bytes) return false;
    const blob = new Blob([bytes], { type: 'audio/midi' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (opts.filename || 'chordpath') + '.mid';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    return true;
  }

  global.Midi = { buildSMF, download, buildSongSMF, downloadSong };
})(typeof window !== 'undefined' ? window : globalThis);
