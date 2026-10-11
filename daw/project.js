/* ChordPath — daw/project.js
 * The DAW's project model: tracks hold clips, clips hold notes (or point at
 * a recording). Everything here is plain data plus the editing operations on
 * it, so it runs without a sound card and can be tested on its own.
 *
 * Time is in beats. A note is { id, t, d, n, v }: start and length in beats
 * from the start of its clip, MIDI pitch, velocity 0..1.
 */
(function (global) {
  'use strict';

  const FORMAT = 'chordpath-daw';
  const LIMITS = { tracks: 64, clips: 512, notes: 8192, markers: 256, name: 60, title: 120, beats: 100000, audioSeconds: 1200 };
  // Megabytes that hold about twenty-five minutes of each kind of audio file.
  const AUDIO_MB = { compressed: 25, flac: 130, plain: 260 };
  const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
  const NOTE_RE = /^[A-G][#b]?$/;
  const COLOR_RE = /^#[0-9a-f]{6}$/i;
  const KINDS = ['instrument', 'drums', 'audio'];
  const MIN_LENGTH = 0.25;

  const INSTRUMENTS = [
    { id: 'piano', name: 'Piano', program: 0 },
    { id: 'epiano', name: 'Electric piano', program: 4 },
    { id: 'guitar', name: 'Guitar', program: 27 },
    { id: 'pluck', name: 'Plucked strings', program: 46 },
    { id: 'strings', name: 'Strings', program: 48 },
    { id: 'pad', name: 'Pad', program: 89 },
    { id: 'organ', name: 'Organ', program: 16 },
    { id: 'bass', name: 'Bass', program: 33 },
    { id: 'lead', name: 'Lead', program: 80 },
    { id: 'bell', name: 'Bell', program: 10 },
  ];
  // Top row first, the way a drum grid is read.
  const DRUM_LANES = [
    { id: 'crash', note: 49, name: 'Crash' },
    { id: 'hhOpen', note: 46, name: 'Open hat' },
    { id: 'hhClosed', note: 42, name: 'Closed hat' },
    { id: 'tom', note: 45, name: 'Tom' },
    { id: 'clap', note: 39, name: 'Clap' },
    { id: 'snare', note: 38, name: 'Snare' },
    { id: 'kick', note: 36, name: 'Kick' },
  ];
  const TRACK_COLORS = ['#b85a2a', '#4f7d3f', '#a86d1e', '#7a4a87', '#3f6f8a', '#a83a2c', '#6b6b6b', '#8a5a26', '#5d7a2f', '#6e4a8a'];
  // Song roster instrument → the DAW voice that plays the chord track.
  const ROSTER_VOICE = { rhythm_gtr: 'guitar', acoustic_gtr: 'guitar', piano: 'piano', e_piano: 'epiano', organ: 'organ', pad: 'pad', strings: 'strings' };

  let counter = 0;
  function uid(prefix) {
    return prefix + Date.now().toString(36) + (counter++).toString(36);
  }

  function num(v, lo, hi, fallback) {
    return typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : fallback;
  }
  function text(v, max, fallback) {
    return typeof v === 'string' && v.length ? v.slice(0, max) : fallback;
  }
  function keepId(v, prefix, seen) {
    const id = typeof v === 'string' && ID_RE.test(v) && !seen.has(v) ? v : uid(prefix);
    seen.add(id);
    return id;
  }

  // ── Constructors (also define the saved field order) ─────────────────────
  function createNote(n) {
    return {
      id: n.id || uid('n'),
      t: Math.max(0, num(n.t, -LIMITS.beats, LIMITS.beats, 0)),
      d: Math.max(1 / 64, num(n.d, 0, LIMITS.beats, 0.25)),
      n: Math.round(num(n.n, 0, 127, 60)),
      v: num(n.v, 0.01, 1, 0.8),
    };
  }

  function createClip(opts) {
    opts = opts || {};
    const clip = {
      id: opts.id || uid('c'),
      name: text(opts.name, LIMITS.name, ''),
      start: num(opts.start, 0, LIMITS.beats, 0),
      length: num(opts.length, MIN_LENGTH, LIMITS.beats, 4),
    };
    if (opts.audioId) {
      clip.audioId = opts.audioId;
      clip.offset = num(opts.offset, 0, 36000, 0);     // seconds into the recording
      clip.gain = num(opts.gain, 0, 4, 1);
    } else {
      clip.notes = (opts.notes || []).map(createNote);
    }
    return clip;
  }

  function createTrack(kind, opts) {
    opts = opts || {};
    const fx = opts.fx || {};
    const known = INSTRUMENTS.some(i => i.id === opts.instrument);
    return {
      id: opts.id || uid('t'),
      name: text(opts.name, LIMITS.name, kind === 'drums' ? 'Drums' : kind === 'audio' ? 'Audio' : 'Instrument'),
      kind,
      instrument: kind === 'instrument' ? (known ? opts.instrument : 'piano') : (kind === 'drums' ? 'kit' : ''),
      color: typeof opts.color === 'string' && COLOR_RE.test(opts.color) ? opts.color.toLowerCase() : TRACK_COLORS[0],
      volume: num(opts.volume, -60, 6, -8),            // dB
      pan: num(opts.pan, -1, 1, 0),
      mute: opts.mute === true,
      solo: opts.solo === true,
      armed: opts.armed === true,
      fx: {
        low: num(fx.low, -18, 18, 0), mid: num(fx.mid, -18, 18, 0), high: num(fx.high, -18, 18, 0),
        comp: fx.comp === true,
        reverb: num(fx.reverb, 0, 1, 0), delay: num(fx.delay, 0, 1, 0),
      },
      clips: [],
    };
  }

  function createProject(opts) {
    opts = opts || {};
    return {
      id: opts.id || uid('daw'),
      title: text(opts.title, LIMITS.title, 'Untitled'),
      songId: typeof opts.songId === 'string' && ID_RE.test(opts.songId) ? opts.songId : null,
      tempo: Math.round(num(opts.tempo, 40, 240, 100)),
      key: typeof opts.key === 'string' && NOTE_RE.test(opts.key) ? opts.key : 'C',
      scale: text(opts.scale, 40, 'major'),
      master: num(opts.master, -60, 6, 0),               // master fader, dB
      loop: { on: false, start: 0, end: 16 },
      markers: [],
      tracks: [],
    };
  }

  // ── From a ChordPath song ────────────────────────────────────────────────
  function chordVoice(song) {
    for (const sec of song.sections) {
      for (const id of (sec.roster || [])) {
        if (ROSTER_VOICE[id]) return ROSTER_VOICE[id];
      }
    }
    return 'piano';
  }

  function fromSong(song) {
    const laid = global.Parts.fromSong(song);
    const project = createProject({ title: song.title, songId: song.id, tempo: song.tempo, key: song.key, scale: song.scale });
    const plan = [
      { part: 'chords', name: 'Chords', kind: 'instrument', instrument: chordVoice(song), volume: -9, reverb: 0.22 },
      { part: 'bass', name: 'Bass', kind: 'instrument', instrument: 'bass', volume: -7, reverb: 0 },
      { part: 'drums', name: 'Drums', kind: 'drums', volume: -5, reverb: 0.06 },
      { part: 'vocal', name: 'Vocal melody', kind: 'instrument', instrument: 'lead', volume: -10, reverb: 0.3 },
      { part: 'under', name: 'Under melody', kind: 'instrument', instrument: 'bell', volume: -16, reverb: 0.4 },
    ];
    plan.forEach(def => {
      const clips = [];
      laid.sections.forEach(sec => {
        const notes = sec.parts[def.part];
        if (!notes.length) return;
        clips.push(createClip({ name: sec.name, start: sec.start, length: sec.beats, notes }));
      });
      if (!clips.length && def.part === 'under') return;
      const track = createTrack(def.kind, {
        name: def.name, instrument: def.instrument, volume: def.volume,
        color: TRACK_COLORS[project.tracks.length % TRACK_COLORS.length],
        fx: { reverb: def.reverb },
      });
      track.clips = clips;
      project.tracks.push(track);
    });
    project.markers = laid.sections.map(sec => ({ beat: sec.start, name: sec.name }));
    if (laid.sections.length) project.loop.end = laid.sections[0].beats;
    return project;
  }

  // ── Looking things up ────────────────────────────────────────────────────
  function findTrack(project, trackId) {
    return project.tracks.find(t => t.id === trackId) || null;
  }
  function findClip(project, clipId) {
    for (const track of project.tracks) {
      const clip = track.clips.find(c => c.id === clipId);
      if (clip) return { track, clip };
    }
    return null;
  }
  function endBeat(project) {
    let end = 0;
    project.tracks.forEach(t => t.clips.forEach(c => { end = Math.max(end, c.start + c.length); }));
    return end;
  }
  function snap(beat, grid) {
    return grid > 0 ? Math.round(beat / grid) * grid : beat;
  }

  // ── What may be imported ─────────────────────────────────────────────────
  const TOO_LONG = 'That file is too long to import. Trim it to under 20 minutes first.';

  // Whether an audio file is short enough to bring in, judged from its name
  // and size alone so that nothing enormous is ever read into memory.
  // Returns '' when it is, or the reason it is not.
  function audioFileProblem(name, bytes) {
    if (!(bytes > 0)) return 'That file is empty.';
    const ext = (/\.([A-Za-z0-9]{1,5})$/.exec(String(name || '')) || ['', ''])[1].toLowerCase();
    const kind = ['wav', 'wave', 'aif', 'aiff'].includes(ext) ? 'plain' : ext === 'flac' ? 'flac' : 'compressed';
    return bytes > AUDIO_MB[kind] * 1024 * 1024 ? TOO_LONG : '';
  }
  // The same question once the audio has been read and its real length is known.
  function audioLengthProblem(seconds) {
    return seconds > LIMITS.audioSeconds ? TOO_LONG : '';
  }

  // ── Tracks ───────────────────────────────────────────────────────────────
  function addTrack(project, kind, opts) {
    if (!KINDS.includes(kind) || project.tracks.length >= LIMITS.tracks) return null;
    const track = createTrack(kind, Object.assign(
      { color: TRACK_COLORS[project.tracks.length % TRACK_COLORS.length] }, opts));
    project.tracks.push(track);
    return track;
  }
  function removeTrack(project, trackId) {
    const i = project.tracks.findIndex(t => t.id === trackId);
    if (i < 0) return false;
    project.tracks.splice(i, 1);
    return true;
  }

  // ── Clips ────────────────────────────────────────────────────────────────
  function addClip(track, opts) {
    if (track.clips.length >= LIMITS.clips) return null;
    opts = Object.assign({}, opts);
    if (track.kind === 'audio') {
      if (typeof opts.audioId !== 'string' || !ID_RE.test(opts.audioId)) return null;
    } else {
      delete opts.audioId;
    }
    const clip = createClip(opts);
    track.clips.push(clip);
    return clip;
  }

  function removeClip(project, clipId) {
    const found = findClip(project, clipId);
    if (!found) return false;
    found.track.clips.splice(found.track.clips.indexOf(found.clip), 1);
    return true;
  }

  // Moves a clip in time and, optionally, onto another track of the same kind.
  function moveClip(project, clipId, start, toTrackId) {
    const found = findClip(project, clipId);
    if (!found) return false;
    found.clip.start = Math.max(0, Math.min(LIMITS.beats, start));
    if (toTrackId && toTrackId !== found.track.id) {
      const target = findTrack(project, toTrackId);
      if (target && target.kind === found.track.kind && target.clips.length < LIMITS.clips) {
        found.track.clips.splice(found.track.clips.indexOf(found.clip), 1);
        target.clips.push(found.clip);
      }
    }
    return true;
  }

  function resizeClip(project, clipId, length) {
    const found = findClip(project, clipId);
    if (!found) return false;
    found.clip.length = Math.max(MIN_LENGTH, Math.min(LIMITS.beats, length));
    return true;
  }

  function splitClip(project, clipId, beat) {
    const found = findClip(project, clipId);
    if (!found) return null;
    const { track, clip } = found;
    const cut = beat - clip.start;
    if (cut <= 0 || cut >= clip.length || track.clips.length >= LIMITS.clips) return null;
    const right = { id: uid('c'), name: clip.name, start: beat, length: clip.length - cut };
    if (clip.audioId) {
      right.audioId = clip.audioId;
      right.offset = clip.offset + cut * 60 / project.tempo;
      right.gain = clip.gain;
    } else {
      right.notes = clip.notes.filter(n => n.t >= cut).map(n =>
        createNote({ t: n.t - cut, d: Math.min(n.d, right.length - (n.t - cut)), n: n.n, v: n.v }));
      clip.notes = clip.notes.filter(n => n.t < cut);
      clip.notes.forEach(n => { n.d = Math.min(n.d, cut - n.t); });
    }
    clip.length = cut;
    track.clips.splice(track.clips.indexOf(clip) + 1, 0, right);
    return [clip, right];
  }

  function duplicateClip(project, clipId) {
    const found = findClip(project, clipId);
    if (!found || found.track.clips.length >= LIMITS.clips) return null;
    const src = found.clip;
    const copy = createClip({
      name: src.name, start: src.start + src.length, length: src.length,
      audioId: src.audioId, offset: src.offset, gain: src.gain,
      notes: src.notes ? src.notes.map(n => ({ t: n.t, d: n.d, n: n.n, v: n.v })) : undefined,
    });
    found.track.clips.splice(found.track.clips.indexOf(src) + 1, 0, copy);
    return copy;
  }

  // ── Notes ────────────────────────────────────────────────────────────────
  function sortNotes(clip) { clip.notes.sort((a, b) => a.t - b.t || a.n - b.n); }

  function addNote(clip, note) {
    if (!clip.notes || clip.notes.length >= LIMITS.notes) return null;
    const made = createNote({ t: note.t, d: note.d, n: note.n, v: note.v });
    clip.notes.push(made);
    sortNotes(clip);
    return made;
  }
  function removeNote(clip, noteId) {
    const i = clip.notes ? clip.notes.findIndex(n => n.id === noteId) : -1;
    if (i < 0) return false;
    clip.notes.splice(i, 1);
    return true;
  }
  function updateNote(clip, noteId, patch) {
    const note = clip.notes ? clip.notes.find(n => n.id === noteId) : null;
    if (!note) return null;
    Object.assign(note, createNote(Object.assign({}, note, patch)), { id: note.id });
    sortNotes(clip);
    return note;
  }
  function quantize(clip, grid) {
    if (!clip.notes || !(grid > 0)) return;
    clip.notes.forEach(n => { n.t = Math.max(0, Math.min(snap(n.t, grid), Math.max(0, clip.length - grid))); });
    sortNotes(clip);
  }
  function transpose(clip, semitones) {
    if (!clip.notes) return;
    clip.notes.forEach(n => { n.n = Math.max(0, Math.min(127, n.n + Math.round(semitones))); });
    sortNotes(clip);
  }

  // ── Loading untrusted data ───────────────────────────────────────────────
  // Project files, autosaves and undo states all pass through here, so every
  // field comes out with the right type and inside its range.
  function validNote(n) {
    return n && typeof n === 'object' &&
      [n.t, n.d, n.n, n.v].every(x => typeof x === 'number' && Number.isFinite(x)) &&
      n.t >= 0 && n.t <= LIMITS.beats && n.d > 0 && n.n >= 0 && n.n <= 127 && n.v > 0 && n.v <= 1;
  }

  function sanitize(raw) {
    raw = raw && typeof raw === 'object' ? raw : {};
    const seen = new Set();
    const project = createProject({
      id: keepId(raw.id, 'daw', seen), title: raw.title, songId: raw.songId,
      tempo: raw.tempo, key: raw.key, scale: raw.scale, master: raw.master,
    });
    if (global.Scales && !global.Scales.SCALES[project.scale]) project.scale = 'major';

    const loop = raw.loop && typeof raw.loop === 'object' ? raw.loop : {};
    project.loop.on = loop.on === true;
    project.loop.start = num(loop.start, 0, LIMITS.beats, 0);
    project.loop.end = num(loop.end, project.loop.start + MIN_LENGTH, LIMITS.beats, project.loop.start + 16);

    project.markers = (Array.isArray(raw.markers) ? raw.markers : [])
      .filter(m => m && typeof m === 'object' && typeof m.name === 'string' &&
        typeof m.beat === 'number' && Number.isFinite(m.beat) && m.beat >= 0)
      .slice(0, LIMITS.markers)
      .map(m => ({ beat: Math.min(m.beat, LIMITS.beats), name: m.name.slice(0, LIMITS.name) }));

    (Array.isArray(raw.tracks) ? raw.tracks : []).forEach(rt => {
      if (!rt || typeof rt !== 'object' || !KINDS.includes(rt.kind) || project.tracks.length >= LIMITS.tracks) return;
      const track = createTrack(rt.kind, {
        id: keepId(rt.id, 't', seen), name: rt.name, instrument: rt.instrument,
        color: typeof rt.color === 'string' && COLOR_RE.test(rt.color)
          ? rt.color : TRACK_COLORS[project.tracks.length % TRACK_COLORS.length],
        volume: rt.volume, pan: rt.pan, mute: rt.mute, solo: rt.solo, armed: rt.armed,
        fx: rt.fx && typeof rt.fx === 'object' ? rt.fx : {},
      });
      (Array.isArray(rt.clips) ? rt.clips : []).forEach(rc => {
        if (!rc || typeof rc !== 'object' || track.clips.length >= LIMITS.clips) return;
        const base = { id: keepId(rc.id, 'c', seen), name: rc.name, start: rc.start, length: rc.length };
        if (track.kind === 'audio') {
          if (typeof rc.audioId !== 'string' || !ID_RE.test(rc.audioId)) return;
          track.clips.push(createClip(Object.assign(base, { audioId: rc.audioId, offset: rc.offset, gain: rc.gain })));
        } else {
          const clip = createClip(base);
          clip.notes = (Array.isArray(rc.notes) ? rc.notes : []).filter(validNote).slice(0, LIMITS.notes)
            .map(n => ({ id: keepId(n.id, 'n', seen), t: n.t, d: n.d, n: Math.round(n.n), v: n.v }));
          track.clips.push(clip);
        }
      });
      project.tracks.push(track);
    });
    return project;
  }

  function serialize(project) {
    return JSON.stringify({ format: FORMAT, version: 1, project });
  }
  function deserialize(textIn) {
    let parsed;
    try { parsed = JSON.parse(textIn); }
    catch (e) { return { project: null, errors: ['not valid JSON'] }; }
    if (!parsed || parsed.format !== FORMAT || !parsed.project || typeof parsed.project !== 'object') {
      return { project: null, errors: ['not a ChordPath DAW project'] };
    }
    return { project: sanitize(parsed.project), errors: [] };
  }

  // ── Undo history ─────────────────────────────────────────────────────────
  // Whole-project snapshots: simple, and small because audio lives elsewhere.
  function History(limit) {
    this.limit = Math.max(2, limit || 100);
    this.states = [];
    this.index = -1;
  }
  History.prototype.push = function (project) {
    const snapshot = JSON.stringify(project);
    if (this.index >= 0 && this.states[this.index] === snapshot) return;
    this.states = this.states.slice(0, this.index + 1);
    this.states.push(snapshot);
    if (this.states.length > this.limit) this.states = this.states.slice(-this.limit);
    this.index = this.states.length - 1;
  };
  History.prototype.canUndo = function () { return this.index > 0; };
  History.prototype.canRedo = function () { return this.index < this.states.length - 1; };
  History.prototype.undo = function () {
    if (!this.canUndo()) return null;
    return JSON.parse(this.states[--this.index]);
  };
  History.prototype.redo = function () {
    if (!this.canRedo()) return null;
    return JSON.parse(this.states[++this.index]);
  };

  // ── MIDI export ──────────────────────────────────────────────────────────
  const PPQ = 480;
  function varlen(out, v) {
    const bytes = [v & 0x7f];
    while ((v >>= 7)) bytes.unshift((v & 0x7f) | 0x80);
    bytes.forEach(b => out.push(b));
  }
  function meta(out, delta, type, bytes) {
    varlen(out, delta);
    out.push(0xff, type);
    varlen(out, bytes.length);
    bytes.forEach(b => out.push(b & 0xff));
  }
  function ascii(s) { return String(s).split('').map(ch => { const c = ch.charCodeAt(0); return c < 128 ? c : 63; }); }
  function chunk(out, body) {
    out.push(0x4d, 0x54, 0x72, 0x6b, (body.length >>> 24) & 255, (body.length >>> 16) & 255, (body.length >>> 8) & 255, body.length & 255);
    for (let i = 0; i < body.length; i++) out.push(body[i]);
  }

  // A standard MIDI file of the project as it is now: one track per part.
  function toMidi(project) {
    const playable = project.tracks.filter(t => t.kind !== 'audio' && t.clips.some(c => c.notes && c.notes.length));
    const out = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, 0, 1 + playable.length, (PPQ >> 8) & 255, PPQ & 255];

    const cond = [];
    meta(cond, 0, 0x03, ascii(project.title));
    meta(cond, 0, 0x58, [4, 2, 24, 8]);
    const mpq = Math.round(60000000 / project.tempo);
    meta(cond, 0, 0x51, [(mpq >> 16) & 255, (mpq >> 8) & 255, mpq & 255]);
    let last = 0;
    project.markers.slice().sort((a, b) => a.beat - b.beat).forEach(m => {
      const tick = Math.round(m.beat * PPQ);
      meta(cond, tick - last, 0x06, ascii(m.name));
      last = tick;
    });
    meta(cond, 0, 0x2f, []);
    chunk(out, cond);

    let nextChannel = 0;
    playable.forEach(track => {
      let channel = 9;
      if (track.kind !== 'drums') {
        if (nextChannel === 9) nextChannel++;
        channel = nextChannel++ % 16;
      }
      const body = [];
      meta(body, 0, 0x03, ascii(track.name));
      if (track.kind !== 'drums') {
        const inst = INSTRUMENTS.find(i => i.id === track.instrument) || INSTRUMENTS[0];
        varlen(body, 0); body.push(0xc0 | channel, inst.program);
      }
      const events = [];
      track.clips.forEach(clip => (clip.notes || []).forEach(n => {
        if (n.t >= clip.length) return;
        const on = Math.round((clip.start + n.t) * PPQ);
        const off = Math.max(on + 1, Math.round((clip.start + Math.min(n.t + n.d, clip.length)) * PPQ) - 2);
        events.push({ tick: on, on: true, n: n.n, v: Math.max(1, Math.min(127, Math.round(n.v * 127))) });
        events.push({ tick: off, on: false, n: n.n, v: 0 });
      }));
      events.sort((a, b) => a.tick - b.tick || (a.on ? 1 : -1));
      let at = 0;
      events.forEach(e => {
        varlen(body, e.tick - at);
        at = e.tick;
        body.push((e.on ? 0x90 : 0x80) | channel, e.n & 0x7f, e.v & 0x7f);
      });
      meta(body, 0, 0x2f, []);
      chunk(out, body);
    });
    return new Uint8Array(out);
  }

  global.DawProject = {
    INSTRUMENTS, DRUM_LANES, TRACK_COLORS, LIMITS,
    createProject, createTrack, createClip, fromSong,
    findTrack, findClip, endBeat, snap,
    audioFileProblem, audioLengthProblem,
    addTrack, removeTrack,
    addClip, removeClip, moveClip, resizeClip, splitClip, duplicateClip,
    addNote, removeNote, updateNote, quantize, transpose,
    sanitize, serialize, deserialize, History, toMidi,
  };
})(typeof window !== 'undefined' ? window : globalThis);
