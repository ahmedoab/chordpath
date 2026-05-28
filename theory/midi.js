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

  global.Midi = { buildSMF, download };
})(typeof window !== 'undefined' ? window : globalThis);
