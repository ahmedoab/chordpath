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
  const LIMITS = { tracks: 64, clips: 512, notes: 8192, markers: 256, changes: 128, name: 60, title: 120, beats: 100000, audioSeconds: 1200, plugins: 8, takes: 32, comp: 512 };
  const XFADE = 0.01;                                    // seconds: the crossfade where takes or clips meet
  const EPS = 1e-6;
  const DENOMINATORS = [2, 4, 8, 16];                    // the note a time signature counts in
  // Megabytes that hold about twenty-five minutes of each kind of audio file.
  const AUDIO_MB = { compressed: 25, flac: 130, plain: 260 };
  const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
  const PLUGIN_FILE_RE = /^[A-Za-z]:[\\/][^<>"|?*\u0000-\u001f]{1,1000}\.vst3$/i;   // a full path to a VST 3 plugin, either slash
  const PLUGIN_UID_RE = /^[0-9A-Fa-f]{32}$/;
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
      // The clip's own recording is its first take. offset: seconds into the
      // recording at the clip's start; below 0 the recording starts later.
      clip.audioId = opts.audioId;
      clip.offset = num(opts.offset, -3600, 36000, 0);
      clip.gain = num(opts.gain, 0, 4, 1);
      clip.tempo = playedTempo(opts.tempo);            // the tempo the audio was played at; 0 = not known
      clip.stretch = opts.stretch === true;            // whether it is stretched to follow the song's tempo
      clip.fadeIn = num(opts.fadeIn, 0, LIMITS.beats, 0);     // beats
      clip.fadeOut = num(opts.fadeOut, 0, LIMITS.beats, 0);
      fitFades(clip);
      // Other takes of the same stretch of the song, and which take plays where.
      const alts = (Array.isArray(opts.alts) ? opts.alts : []).map(createTake).filter(Boolean).slice(0, LIMITS.takes - 1);
      if (alts.length) {
        clip.alts = alts;
        clip.comp = cleanComp(opts.comp, alts.length + 1);
      }
    } else {
      clip.notes = (opts.notes || []).map(createNote);
    }
    return clip;
  }

  function playedTempo(v) {
    const played = Math.round(num(v, 0, 400, 0));
    return played >= 20 ? played : 0;
  }

  // Another take of a clip: { audioId, offset, tempo }, read like the clip's own. Null if it names no recording.
  function createTake(t) {
    if (!t || typeof t !== 'object' || typeof t.audioId !== 'string' || !ID_RE.test(t.audioId)) return null;
    return { audioId: t.audioId, offset: num(t.offset, -3600, 36000, 0), tempo: playedTempo(t.tempo) };
  }

  // Which take plays where: [{ at, take }], `at` in beats from the clip's
  // start. Always begins at 0, in order, no two neighbours the same.
  function cleanComp(raw, count) {
    const list = (Array.isArray(raw) ? raw : [])
      .filter(r => r && typeof r === 'object' && typeof r.at === 'number' && Number.isFinite(r.at) && r.at >= 0 &&
        r.at <= LIMITS.beats && Number.isInteger(r.take) && r.take >= 0 && r.take < count)
      .map(r => ({ at: r.at, take: r.take }))
      .sort((a, b) => a.at - b.at)
      .slice(0, LIMITS.comp);
    return mergeComp(list.length ? list : [{ at: 0, take: count - 1 }]);
  }
  function mergeComp(list) {
    const out = [];
    list.forEach(r => {
      const last = out[out.length - 1];
      if (last && Math.abs(last.at - r.at) < EPS) { last.take = r.take; return; }      // the later word on one spot wins
      if (last && last.take === r.take) return;
      out.push({ at: r.at, take: r.take });
    });
    if (out.length) out[0].at = 0;
    // Merging the first two may have left neighbours the same again.
    return out.filter((r, i) => i === 0 || r.take !== out[i - 1].take);
  }

  // Fades never overlap: together they are at most the clip's length.
  function fitFades(clip) {
    if (!clip.audioId) return;
    clip.fadeIn = Math.max(0, Math.min(clip.fadeIn || 0, clip.length));
    clip.fadeOut = Math.max(0, Math.min(clip.fadeOut || 0, clip.length - clip.fadeIn));
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
      showTakes: kind === 'audio' && opts.showTakes === true,   // its clips' takes are shown in rows beneath it
      fx: {
        low: num(fx.low, -18, 18, 0), mid: num(fx.mid, -18, 18, 0), high: num(fx.high, -18, 18, 0),
        comp: fx.comp === true,
        reverb: num(fx.reverb, 0, 1, 0), delay: num(fx.delay, 0, 1, 0),
      },
      plugins: [],                                       // VST plugins the track passes through, in order
      clips: [],
    };
  }

  // A plugin on a track (or the master): which file and which plugin in it,
  // and what to call it. Its settings are not kept here but beside the
  // project, like recordings (see daw/store.js), so undo history stays small.
  // Returns null for anything that does not name a plugin.
  function createPlugin(opts) {
    opts = opts && typeof opts === 'object' ? opts : {};
    if (typeof opts.path !== 'string' || !PLUGIN_FILE_RE.test(opts.path)) return null;
    if (typeof opts.uid !== 'string' || !PLUGIN_UID_RE.test(opts.uid)) return null;
    return {
      id: opts.id || uid('p'),
      path: opts.path,
      uid: opts.uid.toUpperCase(),
      name: text(opts.name, LIMITS.title, 'Plugin'),
      vendor: text(opts.vendor, LIMITS.title, ''),
      instrument: opts.instrument === true,              // it makes sound from notes rather than changing sound
      bypass: opts.bypass === true,
    };
  }

  function createMeter(m) {
    m = m && typeof m === 'object' ? m : {};
    const beats = typeof m.num === 'number' && Number.isFinite(m.num) ? Math.round(m.num) : 4;
    return { num: beats >= 1 && beats <= 16 ? beats : 4, den: DENOMINATORS.includes(m.den) ? m.den : 4 };
  }

  function createProject(opts) {
    opts = opts || {};
    return {
      id: opts.id || uid('daw'),
      title: text(opts.title, LIMITS.title, 'Untitled'),
      songId: typeof opts.songId === 'string' && ID_RE.test(opts.songId) ? opts.songId : null,
      tempo: Math.round(num(opts.tempo, 40, 240, 100)),  // from the first bar
      meter: createMeter(opts.meter),                    // time signature from the first bar
      changes: [],                                       // later: [{ beat, tempo, num, den }], each at a bar start
      key: typeof opts.key === 'string' && NOTE_RE.test(opts.key) ? opts.key : 'C',
      scale: text(opts.scale, 40, 'major'),
      master: num(opts.master, -60, 6, 0),               // master fader, dB
      masterPlugins: [],                                 // plugins the whole mix passes through
      loop: { on: false, start: 0, end: 16 },
      punch: { on: false, start: 0, end: 0 },            // recording keeps only this stretch while on
      markers: [],
      tracks: [],
    };
  }

  // ── Tempo and time signature along the song ──────────────────────────────
  // A song is a row of stretches, each with one tempo and one time signature.
  // The first starts at beat 0 (project.tempo, project.meter); every entry in
  // project.changes starts another, and always at the start of a bar. Beats
  // are quarter notes throughout, whatever the time signature.
  //
  // Returns [{ beat, tempo, num, den, bar }], bar being the number of the
  // stretch's first bar.
  function stretches(project) {
    const meter = project.meter || { num: 4, den: 4 };
    const out = [{ beat: 0, tempo: project.tempo, num: meter.num, den: meter.den, bar: 1 }];
    (project.changes || []).forEach(c => {
      const prev = out[out.length - 1];
      const bars = Math.max(1, Math.ceil((c.beat - prev.beat) / (prev.num * 4 / prev.den) - 1e-9));
      out.push({ beat: c.beat, tempo: c.tempo, num: c.num, den: c.den, bar: prev.bar + bars });
    });
    return out;
  }
  function stretchAt(project, beat) {
    const list = stretches(project);
    let found = list[0];
    for (let i = 1; i < list.length && list[i].beat <= beat + 1e-9; i++) found = list[i];
    return found;
  }
  function tempoAt(project, beat) { return stretchAt(project, beat).tempo; }

  function beatToSeconds(project, beat) {
    const list = stretches(project);
    let seconds = 0;
    for (let i = 0; i < list.length; i++) {
      const end = i + 1 < list.length ? list[i + 1].beat : Infinity;
      if (beat <= end) return seconds + (beat - list[i].beat) * 60 / list[i].tempo;
      seconds += (end - list[i].beat) * 60 / list[i].tempo;
    }
    return seconds;
  }
  function secondsToBeat(project, seconds) {
    const list = stretches(project);
    let passed = 0;
    for (let i = 0; i < list.length; i++) {
      const end = i + 1 < list.length ? list[i + 1].beat : Infinity;
      const lasts = (end - list[i].beat) * 60 / list[i].tempo;
      if (seconds <= passed + lasts) return list[i].beat + (seconds - passed) * list[i].tempo / 60;
      passed += lasts;
    }
    return 0;
  }

  // Where a beat falls: { bar, beat, start, length, num, den }. `beat` counts
  // the beats of the bar from 1 (eighths in 6/8); start and length are the
  // bar's, in quarter notes.
  function positionAt(project, at) {
    const s = stretchAt(project, Math.max(0, at));
    const length = s.num * 4 / s.den;
    const bars = Math.floor((Math.max(0, at) - s.beat) / length + 1e-9);
    const start = s.beat + bars * length;
    return { bar: s.bar + bars, beat: (Math.max(0, at) - start) * s.den / 4 + 1, start, length, num: s.num, den: s.den };
  }

  // Every bar line from `from` up to (not including) `to`: [{ beat, bar, num, den, length }].
  function barsBetween(project, from, to) {
    const list = stretches(project);
    const out = [];
    list.forEach((s, i) => {
      const end = Math.min(to, i + 1 < list.length ? list[i + 1].beat : Infinity);
      const length = s.num * 4 / s.den;
      const first = Math.max(0, Math.ceil((from - s.beat) / length - 1e-9));
      for (let k = first; s.beat + k * length < end - 1e-9; k++) {
        out.push({ beat: s.beat + k * length, bar: s.bar + k, num: s.num, den: s.den, length });
      }
    });
    return out;
  }
  function nearestBar(project, beat) {
    const here = positionAt(project, beat);
    const list = stretches(project);
    const following = list.find(s => s.beat > here.start + 1e-9);
    const next = Math.min(here.start + here.length, following ? following.beat : Infinity);
    return beat - here.start < next - beat ? here.start : next;
  }

  // The bars a clip lies across, cut to the clip: [{ bar, start, length, num,
  // den, skip }]. start is counted from the start of the clip, and skip is
  // how much of the bar comes before it, for a clip that begins inside a bar.
  function clipBars(project, clip) {
    const end = clip.start + clip.length;
    const lines = barsBetween(project, positionAt(project, clip.start).start, end);
    return lines.map((b, i) => {
      const from = Math.max(b.beat, clip.start);
      const to = Math.min(b.beat + b.length, i + 1 < lines.length ? lines[i + 1].beat : Infinity, end);
      return { bar: b.bar, start: from - clip.start, length: to - from, num: b.num, den: b.den, skip: from - b.beat };
    }).filter(b => b.length > 1e-9);
  }

  // Metronome clicks from `from` up to `to`: one on every beat of the bar,
  // the first of each bar accented. [{ beat, accent }]
  function clicksBetween(project, from, to) {
    const out = [];
    barsBetween(project, positionAt(project, from).start, to).forEach(bar => {
      const step = 4 / bar.den;
      for (let k = 0; k < bar.num; k++) {
        const beat = bar.beat + k * step;
        if (beat >= from - 1e-9 && beat < to - 1e-9 && beat < bar.beat + bar.length) out.push({ beat, accent: k === 0 });
      }
    });
    return out;
  }

  // Makes the tempo and time signature change at the start of the bar that
  // `beat` falls in, or edits the change already there. patch: { tempo, num,
  // den }; anything left out stays as it is at that point. In the first bar
  // it sets what the song starts from. Returns the beat the change sits on.
  function setChange(project, beat, patch) {
    patch = patch || {};
    const at = positionAt(project, beat).start;
    const now = stretchAt(project, at);
    const next = {
      beat: at,
      tempo: Math.round(num(patch.tempo, 40, 240, now.tempo)),
      num: Math.round(num(patch.num, 1, 16, now.num)),
      den: DENOMINATORS.includes(patch.den) ? patch.den : now.den,
    };
    if (at < 1e-9) {
      project.tempo = next.tempo;
      project.meter = { num: next.num, den: next.den };
      return 0;
    }
    project.changes = (project.changes || []).filter(c => Math.abs(c.beat - at) > 1e-9);
    if (project.changes.length < LIMITS.changes) project.changes.push(next);
    project.changes.sort((a, b) => a.beat - b.beat);
    return at;
  }
  // The punch range while it is in use: [from, to], or null.
  function punchRange(project) {
    const p = project.punch;
    return p && p.on && p.end - p.start >= MIN_LENGTH - EPS ? [p.start, p.end] : null;
  }
  function removeChange(project, beat) {
    const before = (project.changes || []).length;
    project.changes = (project.changes || []).filter(c => Math.abs(c.beat - beat) > 1e-9);
    return project.changes.length < before;
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
    // A section with a tempo or a time signature of its own is a change where it starts.
    let tempo = project.tempo;
    let meter = createMeter(song.meter);
    project.meter = meter;
    laid.sections.forEach(sec => {
      const wanted = Math.round(num(sec.tempo, 40, 240, tempo));
      const time = createMeter(sec.meter);
      if (wanted === tempo && time.num === meter.num && time.den === meter.den) return;
      tempo = wanted;
      meter = time;
      if (sec.start > 0) project.changes.push({ beat: sec.start, tempo, num: time.num, den: time.den });
      else { project.tempo = tempo; project.meter = time; }
    });
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

  // ── Recordings that follow the tempo ─────────────────────────────────────
  // A clip that follows the tempo keeps its length in beats; its audio is
  // stretched to fit. The rate is how much longer (above 1) or shorter the
  // audio has to become: the tempo it was played at over the tempo where the
  // clip now starts.
  function clipRate(project, clip) { return takeRate(project, clip, clip); }
  // The same for any take of the clip: each keeps the tempo it was played at.
  function takeRate(project, clip, take) {
    if (!clip.audioId || !clip.stretch || !(take.tempo > 0)) return 1;
    return Math.round(take.tempo / tempoAt(project, clip.start) * 10000) / 10000;
  }
  // Seconds of the recording that the clip covers.
  function clipSpan(project, clip) {
    if (clip.stretch && clip.tempo > 0) return clip.length * 60 / clip.tempo;
    return beatToSeconds(project, clip.start + clip.length) - beatToSeconds(project, clip.start);
  }
  // Switches following on or off. The clip goes on covering the same stretch
  // of the recording, so its length in beats is worked out afresh.
  function setStretch(project, clip, on) {
    if (!clip.audioId || clip.stretch === !!on) return;
    const span = clipSpan(project, clip);
    if (on) {
      if (!(clip.tempo > 0)) clip.tempo = tempoAt(project, clip.start);     // taken to have been played at the song's tempo
      clip.stretch = true;
      clip.length = Math.max(MIN_LENGTH, span * clip.tempo / 60);
    } else {
      clip.stretch = false;
      clip.length = Math.max(MIN_LENGTH, secondsToBeat(project, beatToSeconds(project, clip.start) + span) - clip.start);
    }
  }
  // Notes the tempo the audio was really played at: every take's.
  function setClipTempo(project, clip, bpm) {
    if (!clip.audioId) return;
    const span = clipSpan(project, clip);
    const tempo = Math.round(num(bpm, 20, 400, clip.tempo || tempoAt(project, clip.start)));
    takesOf(clip).forEach(t => { t.tempo = tempo; });
    if (clip.stretch) clip.length = Math.max(MIN_LENGTH, span * clip.tempo / 60);
    fitFades(clip);
  }

  // ── Takes ────────────────────────────────────────────────────────────────
  // An audio clip can hold several takes of the same stretch of the song —
  // the passes of a loop recorded over and over, or a part played again over
  // an earlier one. Its own recording is the first; the others are in
  // clip.alts. clip.comp says which take plays where, so the best of each can
  // be put together without anything being cut away.
  function takesOf(clip) {
    return clip && clip.audioId ? [clip].concat(clip.alts || []) : [];
  }
  // Seconds of a take's recording that pass between two beats of its clip.
  function takeSpan(project, clip, take, from, to) {
    if (clip.stretch && take.tempo > 0) return (to - from) * 60 / take.tempo;
    return beatToSeconds(project, to) - beatToSeconds(project, from);
  }
  // Where in its recording a take is at a beat of the song (seconds; below 0 it has not started).
  function takeAt(project, clip, take, beat) {
    return take.offset + takeSpan(project, clip, take, clip.start, beat);
  }

  // [{ from, to, take }] in beats from the clip's start, end to end across it.
  function compRegions(clip) {
    const count = takesOf(clip).length;
    const comp = count > 1 && Array.isArray(clip.comp) && clip.comp.length ? clip.comp : [{ at: 0, take: 0 }];
    const out = [];
    comp.forEach((r, i) => {
      const from = i === 0 ? 0 : Math.max(0, r.at);
      const to = Math.min(clip.length, i + 1 < comp.length ? comp[i + 1].at : clip.length);
      if (to - from > EPS) out.push({ from, to, take: Math.min(Math.max(0, r.take), count - 1) });
    });
    if (!out.length) out.push({ from: 0, to: clip.length, take: Math.min(Math.max(0, comp[0].take), Math.max(0, count - 1)) });
    return out;
  }
  // The take playing at a beat of the clip (from its start).
  function takeIndexAt(clip, at) {
    const regions = compRegions(clip);
    const found = regions.find(r => at >= r.from - EPS && at < r.to - EPS);
    return found ? found.take : regions[regions.length - 1].take;
  }

  // Makes take number `take` play from `from` to `to` (beats from the clip's start).
  function setComp(clip, from, to, take) {
    const count = takesOf(clip).length;
    if (count < 2 || !Number.isInteger(take) || take < 0 || take >= count) return false;
    const a = Math.max(0, Math.min(from, to)), b = Math.min(clip.length, Math.max(from, to));
    if (b - a < EPS) return false;
    const next = [];
    compRegions(clip).forEach(r => {
      if (r.to <= a + EPS || r.from >= b - EPS) { next.push(r); return; }
      if (r.from < a - EPS) next.push({ from: r.from, to: a, take: r.take });
      if (r.to > b + EPS) next.push({ from: b, to: r.to, take: r.take });
    });
    next.push({ from: a, to: b, take });
    next.sort((x, y) => x.from - y.from);
    clip.comp = mergeComp(next.map(r => ({ at: r.from, take: r.take }))).slice(0, LIMITS.comp);
    return true;
  }
  // The one take plays all the way through.
  function useTake(clip, take) {
    return setComp(clip, 0, clip.length, take);
  }

  // Deletes a take. Where it was playing, the take before it plays instead.
  function removeTake(clip, index) {
    const takes = takesOf(clip);
    if (takes.length < 2 || !Number.isInteger(index) || index < 0 || index >= takes.length) return false;
    const regions = compRegions(clip);
    if (index === 0) {
      const next = clip.alts.shift();
      clip.audioId = next.audioId;
      clip.offset = next.offset;
      clip.tempo = next.tempo;
    } else {
      clip.alts.splice(index - 1, 1);
    }
    const moved = t => (t === index ? Math.max(0, index - 1) : t > index ? t - 1 : t);
    if (clip.alts.length) {
      clip.comp = mergeComp(regions.map(r => ({ at: r.from, take: moved(r.take) })));
    } else {
      delete clip.alts;
      delete clip.comp;
    }
    return true;
  }
  // Deletes the takes that play nowhere. Returns how many went.
  function removeUnusedTakes(clip) {
    const used = new Set(compRegions(clip).map(r => r.take));
    let gone = 0;
    for (let i = takesOf(clip).length - 1; i >= 0 && takesOf(clip).length > 1; i--) {
      if (!used.has(i) && removeTake(clip, i)) gone++;
    }
    return gone;
  }

  // ── Fades ────────────────────────────────────────────────────────────────
  // which: 'in' or 'out'; beats from the clip's edge.
  function setFade(clip, which, beats) {
    if (!clip || !clip.audioId) return false;
    const room = clip.length - (which === 'in' ? clip.fadeOut : clip.fadeIn);
    const value = Math.max(0, Math.min(room, Number.isFinite(beats) ? beats : 0));
    if (which === 'in') clip.fadeIn = value; else clip.fadeOut = value;
    return true;
  }

  // ── What a recording becomes ─────────────────────────────────────────────
  // rec: { audioId, startBeat, latency, seconds, loop: { start, end } | null,
  // punch: { start, end } | null }. The recording's sample at `latency`
  // seconds was heard with beat startBeat; `seconds` is how long it is. A
  // loop that was going round while it was made turns it into one take for
  // every pass; a punch range keeps only what was played inside it.
  //
  // Returns { audioId, start, length, offsets, active, keep, tempo, stretch }:
  // every take lies over start..start+length, takes[i] beginning `offsets[i]`
  // seconds into the recording; `active` is the take to use, and keep the
  // stretch [from, to] of the song to use it over. Null if nothing is left.
  function takesFromRecording(project, rec) {
    if (!rec || typeof rec.audioId !== 'string') return null;
    const latency = Math.max(0, rec.latency || 0);
    const usable = (rec.seconds || 0) - latency;
    if (!(usable > 0.05)) return null;
    const from = Math.max(0, rec.startBeat || 0);
    const startSec = beatToSeconds(project, from);
    const loop = rec.loop && rec.loop.end - rec.loop.start >= MIN_LENGTH - EPS &&
      from >= rec.loop.start - EPS && from < rec.loop.end - EPS ? rec.loop : null;
    const first = loop ? beatToSeconds(project, loop.end) - startSec : Infinity;   // seconds before the loop first turns back
    let start = from, length, offsets, active = 0;
    if (!loop || usable <= first + 0.05) {
      length = secondsToBeat(project, startSec + usable) - start;
      offsets = [latency];
    } else {
      const lap = beatToSeconds(project, loop.end) - beatToSeconds(project, loop.start);
      const lead = startSec - beatToSeconds(project, loop.start);                 // how far into the loop recording began
      const passes = [{ offset: latency - lead, heard: first, whole: lead < 0.001 }];
      for (let at = first; at < usable - 0.001 && passes.length < 4 * LIMITS.takes; at += lap) {
        const heard = Math.min(lap, usable - at);
        passes.push({ offset: latency + at, heard, whole: heard >= lap - 0.001 });
      }
      // A pass cut short near its start is not worth keeping; a whole one always is.
      let kept = passes.filter(p => p.whole || p.heard >= lap / 4);
      if (!kept.length) kept = [passes.reduce((a, b) => (b.heard > a.heard ? b : a))];
      kept = kept.slice(-LIMITS.takes);
      start = loop.start;
      length = loop.end - loop.start;
      offsets = kept.map(p => p.offset);
      const whole = kept.map((p, i) => (p.whole ? i : -1)).filter(i => i >= 0);
      active = whole.length ? whole[whole.length - 1] : kept.indexOf(kept.reduce((a, b) => (b.heard >= a.heard ? b : a)));
    }
    if (!(length >= 1 / 64)) return null;
    const end = start + length;
    let keep = [start, end];
    if (rec.punch && rec.punch.end > rec.punch.start) keep = [Math.max(start, rec.punch.start), Math.min(end, rec.punch.end)];
    if (keep[1] - keep[0] < 1 / 64) return null;
    // A take follows later tempo changes only if the tempo held while it was played.
    const steady = !(project.changes || []).some(c => c.beat > start + EPS && c.beat < end - EPS);
    return { audioId: rec.audioId, start, length, offsets, active, keep, tempo: tempoAt(project, start), stretch: steady };
  }

  // Puts what takesFromRecording made on an audio track. Played over a clip
  // already there, the new takes join it — the clip grows to cover them if
  // need be — and play over the stretch that was kept; the old takes stay,
  // to go back to. Otherwise they make a clip of their own.
  // Returns { clip, joined, take } or null.
  function placeTakes(project, track, made, name) {
    if (!track || track.kind !== 'audio' || !made || !made.offsets || !made.offsets.length) return null;
    const a = made.keep[0], b = made.keep[1];
    const span = (to, stretch) => (stretch ? (to - made.start) * 60 / made.tempo
      : beatToSeconds(project, to) - beatToSeconds(project, made.start));
    const takesAt = (beat, stretch) => made.offsets.map(o => ({ audioId: made.audioId, offset: o + span(beat, stretch), tempo: made.tempo }));
    const host = track.clips.slice().reverse().find(c => c.audioId && c.start < b - EPS && c.start + c.length > a + EPS);
    if (host && takesOf(host).length + made.offsets.length <= LIMITS.takes) {
      if (a < host.start - EPS) trimStart(project, host.id, a);
      if (b > host.start + host.length + EPS) host.length = b - host.start;
      const first = takesOf(host).length;
      host.alts = (host.alts || []).concat(takesAt(host.start, host.stretch));
      if (!host.comp) host.comp = [{ at: 0, take: 0 }];
      setComp(host, a - host.start, b - host.start, first + made.active);
      track.clips.splice(track.clips.indexOf(host), 1);
      track.clips.push(host);                          // on top, where it is heard
      return { clip: host, joined: true, take: first + made.active };
    }
    if (track.clips.length >= LIMITS.clips) return null;
    const takes = takesAt(a, made.stretch);
    const clip = createClip({
      name: name || 'Take', start: a, length: b - a, audioId: made.audioId, offset: takes[0].offset,
      tempo: made.tempo, stretch: made.stretch, alts: takes.slice(1), comp: [{ at: 0, take: made.active }],
    });
    track.clips.push(clip);
    return { clip, joined: false, take: made.active };
  }

  // ── What an audio track plays ────────────────────────────────────────────
  // Where clips overlap, the one on top (later in the list) is heard. Each
  // stretch that is heard becomes a piece: one take, from one beat to
  // another, with its fades. Where one piece gives way to another they
  // crossfade: the one going on a little under the one coming in.
  //
  // [{ clip, take, audioId, rate, at, beat, end, fadeIn, fadeOut, shapeIn,
  // shapeOut, gain }] in order of beat. at: seconds into the take's
  // recording at `beat`; fades in beats; shapes 'equal' (two different
  // sounds) or 'linear' (the same sound going on, as at a split).
  function audioPieces(project, track) {
    if (!track || track.kind !== 'audio') return [];
    const clips = track.clips.filter(c => c.audioId && c.length > EPS);
    const xf = beat => XFADE * tempoAt(project, beat) / 60;
    const out = [];
    const endOf = c => c.start + c.length;
    // Does clip `next` carry on exactly where `prev` leaves off, same recording and same place in it?
    const continues = (prev, prevBeat, next, nextBeat) => {
      const pt = takesOf(prev)[takeIndexAt(prev, prevBeat - prev.start - EPS)];
      const nt = takesOf(next)[takeIndexAt(next, nextBeat - next.start)];
      return pt.audioId === nt.audioId && Math.abs(prev.gain - next.gain) < 1e-3 &&
        Math.abs(takeAt(project, prev, pt, prevBeat) - takeAt(project, next, nt, nextBeat)) < 0.001;
    };
    clips.forEach((clip, i) => {
      const end = endOf(clip);
      const above = clips.slice(i + 1);
      const topmost = test => { for (let j = above.length - 1; j >= 0; j--) if (test(above[j])) return above[j]; return null; };
      let open = [[clip.start, end]];
      above.forEach(c => {
        const a = c.start, b = endOf(c);
        open = open.flatMap(([s, e]) => (b <= s + EPS || a >= e - EPS ? [[s, e]]
          : [[s, Math.min(e, a)], [Math.max(s, b), e]].filter(([x, y]) => y - x > EPS)));
      });
      // Is there a clip beneath this one, going on past `beat`?
      const below = clips.slice(0, i);
      const over = beat => below.some(c => c.start < beat - EPS && endOf(c) > beat + EPS);
      open.forEach(([s, e]) => {
        let from = s, to = e, fadeIn = 0, fadeOut = 0, shapeIn = 'equal', shapeOut = 'equal';
        if (s > clip.start + EPS) {
          // Uncovered where a clip on top ends: come in under that one's fade-out.
          const top = topmost(c => Math.abs(endOf(c) - s) < EPS);
          const x = Math.max(top ? top.fadeOut : 0, xf(s));
          from = Math.max(clip.start, s - x);
          fadeIn = s - from;
        } else if (clip.fadeIn > EPS) {
          fadeIn = clip.fadeIn;
        } else {
          // Coming in over a clip beneath, or straight after one that runs on under this one's start: a short fade.
          const before = topmost(c => Math.abs(endOf(c) - s) < EPS) || below.slice().reverse().find(c => Math.abs(endOf(c) - s) < EPS);
          if (over(s) || (before && !(before.fadeOut > EPS))) fadeIn = Math.min(xf(s), e - s);
          if (before && !over(s) && continues(before, s, clip, s)) shapeIn = 'linear';
        }
        if (e < end - EPS) {
          // A clip on top begins here: carry on under its fade-in.
          const top = topmost(c => Math.abs(c.start - e) < EPS);
          const x = Math.max(top ? top.fadeIn : 0, xf(e));
          to = Math.min(end, e + x);
          fadeOut = to - e;
        } else if (clip.fadeOut > EPS) {
          fadeOut = clip.fadeOut;
        } else {
          const after = topmost(c => Math.abs(c.start - e) < EPS) || below.find(c => Math.abs(c.start - e) < EPS);
          if (after) {
            // Straight into another clip: run on a moment past the end, under its fade-in.
            to = e + Math.max(after.fadeIn > EPS ? after.fadeIn : 0, xf(e));
            fadeOut = to - e;
            if (continues(clip, e, after, e)) shapeOut = 'linear';
          } else if (over(e)) {
            fadeOut = Math.min(xf(e), e - s);                      // the clip beneath comes in under this ending
          }
        }
        // The stretch is split where the comp changes take, with a crossfade at each change.
        const regions = compRegions(clip).map(r => ({ from: clip.start + r.from, to: clip.start + r.to, take: r.take }));
        regions[0].from = Math.min(regions[0].from, from);
        regions[regions.length - 1].to = Math.max(regions[regions.length - 1].to, to);
        regions.forEach((r, k) => {
          let a = Math.max(r.from, from), b = Math.min(r.to, to);
          if (b - a <= EPS) return;
          const piece = { fadeIn: 0, fadeOut: 0, shapeIn: 'equal', shapeOut: 'equal' };
          if (a <= from + EPS) { piece.fadeIn = fadeIn; piece.shapeIn = shapeIn; }
          else piece.fadeIn = Math.min(xf(a), b - a);              // the comp changes take here
          if (b >= to - EPS) { piece.fadeOut = fadeOut; piece.shapeOut = shapeOut; }
          else if (k + 1 < regions.length) {
            const past = Math.min(to, b + xf(b));                // go on under the next take's fade-in
            piece.fadeOut = past - b;
            b = past;
          }
          const take = takesOf(clip)[r.take];
          out.push(Object.assign(piece, {
            clip, take, takeIndex: r.take, audioId: take.audioId, rate: takeRate(project, clip, take),
            at: takeAt(project, clip, take, a), beat: a, end: b, gain: clip.gain,
          }));
        });
      });
    });
    return out.sort((x, y) => x.beat - y.beat);
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

  // ── Plugins ──────────────────────────────────────────────────────────────
  // A track's plugins are a chain the sound passes through in order. On a
  // note track the first may be an instrument, which then plays the notes in
  // place of the built-in one; there is never more than one, and it is always
  // first. Audio tracks and the master take effects only.
  function takesInstrument(track) { return !!track && track.kind !== 'audio'; }
  function instrumentPlugin(track) {
    const first = track && track.plugins && track.plugins[0];
    return first && first.instrument && takesInstrument(track) ? first : null;
  }
  function pluginIds(project) {
    const ids = [];
    project.tracks.forEach(t => t.plugins.forEach(p => ids.push(p.id)));
    project.masterPlugins.forEach(p => ids.push(p.id));
    return ids;
  }
  // { plugin, track, list }: track is null for the master. Null when there is no such plugin.
  function findPlugin(project, pluginId) {
    for (const track of project.tracks) {
      const plugin = track.plugins.find(p => p.id === pluginId);
      if (plugin) return { plugin, track, list: track.plugins };
    }
    const plugin = project.masterPlugins.find(p => p.id === pluginId);
    return plugin ? { plugin, track: null, list: project.masterPlugins } : null;
  }
  // Adds a plugin to a track, or to the master when trackId is null.
  function addPlugin(project, trackId, opts) {
    const track = trackId == null ? null : findTrack(project, trackId);
    if (trackId != null && !track) return null;
    const list = track ? track.plugins : project.masterPlugins;
    const plugin = createPlugin(Object.assign({}, opts, { id: null, bypass: false }));
    if (!plugin) return null;
    if (plugin.instrument) {
      if (!takesInstrument(track)) return null;
      if (list[0] && list[0].instrument) list.shift();   // one instrument plays a track
      list.unshift(plugin);
      return plugin;
    }
    if (list.length >= LIMITS.plugins) return null;
    list.push(plugin);
    return plugin;
  }
  function removePlugin(project, pluginId) {
    const found = findPlugin(project, pluginId);
    if (!found) return false;
    found.list.splice(found.list.indexOf(found.plugin), 1);
    return true;
  }
  // Moves a plugin earlier (by < 0) or later in its chain.
  function movePlugin(project, pluginId, by) {
    const found = findPlugin(project, pluginId);
    if (!found || found.plugin.instrument) return false;
    const from = found.list.indexOf(found.plugin);
    const to = from + (by < 0 ? -1 : 1);
    if (to < 0 || to >= found.list.length || found.list[to].instrument) return false;
    found.list.splice(from, 1);
    found.list.splice(to, 0, found.plugin);
    return true;
  }
  // A saved chain made safe: only whole plugins, each with a name of its own,
  // an instrument (where one is allowed) first and alone.
  function cleanPlugins(raw, seen, instrumentAllowed) {
    const whole = (Array.isArray(raw) ? raw : [])
      .map(p => (p && typeof p === 'object' ? createPlugin(Object.assign({}, p, { id: keepId(p.id, 'p', seen) })) : null))
      .filter(p => p && (instrumentAllowed || !p.instrument));
    const instrument = whole.find(p => p.instrument);
    const effects = whole.filter(p => !p.instrument).slice(0, LIMITS.plugins);
    return instrument ? [instrument].concat(effects) : effects;
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
  // Puts an audio clip on top of any it overlaps, so that it is the one heard.
  function raiseClip(project, clipId) {
    const found = findClip(project, clipId);
    if (!found) return false;
    const list = found.track.clips;
    if (list[list.length - 1] === found.clip) return false;
    list.splice(list.indexOf(found.clip), 1);
    list.push(found.clip);
    return true;
  }

  function resizeClip(project, clipId, length) {
    const found = findClip(project, clipId);
    if (!found) return false;
    found.clip.length = Math.max(MIN_LENGTH, Math.min(LIMITS.beats, length));
    fitFades(found.clip);
    return true;
  }

  // Moves a clip's start (its left edge) and keeps its end where it is. A
  // recording slides under it, so what was heard at each beat still is; a
  // clip of notes keeps its notes where they were in the song, losing any
  // that now start before it.
  function trimStart(project, clipId, beat) {
    const found = findClip(project, clipId);
    if (!found) return false;
    const clip = found.clip;
    const end = clip.start + clip.length;
    const to = Math.max(0, Math.min(beat, end - MIN_LENGTH));
    const delta = to - clip.start;
    if (Math.abs(delta) < EPS) return false;
    if (clip.audioId) {
      const regions = compRegions(clip);
      takesOf(clip).forEach(t => { t.offset += takeSpan(project, clip, t, clip.start, to); });
      if (clip.comp) {
        clip.comp = mergeComp(regions.filter(r => r.to - delta > EPS).map(r => ({ at: Math.max(0, r.from - delta), take: r.take })));
      }
    } else {
      clip.notes = clip.notes.filter(n => n.t - delta >= -EPS);
      clip.notes.forEach(n => { n.t = Math.max(0, n.t - delta); });
    }
    clip.start = to;
    clip.length = end - to;
    fitFades(clip);
    return true;
  }

  function splitClip(project, clipId, beat) {
    const found = findClip(project, clipId);
    if (!found) return null;
    const { track, clip } = found;
    const cut = beat - clip.start;
    if (cut <= 0 || cut >= clip.length || track.clips.length >= LIMITS.clips) return null;
    let right = { id: uid('c'), name: clip.name, start: beat, length: clip.length - cut };
    if (clip.audioId) {
      // The second part starts as far into each recording as the first part runs.
      const passed = take => takeSpan(project, clip, take, clip.start, beat);
      const regions = compRegions(clip);
      right = createClip(Object.assign(right, {
        audioId: clip.audioId, offset: clip.offset + passed(clip), gain: clip.gain, tempo: clip.tempo, stretch: clip.stretch,
        fadeIn: 0, fadeOut: clip.fadeOut,
        alts: (clip.alts || []).map(t => ({ audioId: t.audioId, offset: t.offset + passed(t), tempo: t.tempo })),
        comp: regions.filter(r => r.to > cut + EPS).map(r => ({ at: Math.max(0, r.from - cut), take: r.take })),
      }));
      if (clip.comp) clip.comp = mergeComp(regions.filter(r => r.from < cut - EPS).map(r => ({ at: r.from, take: r.take })));
      clip.fadeOut = 0;
      clip.length = cut;
      fitFades(clip);
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
      audioId: src.audioId, offset: src.offset, gain: src.gain, tempo: src.tempo, stretch: src.stretch,
      fadeIn: src.fadeIn, fadeOut: src.fadeOut, alts: src.alts, comp: src.comp,
      notes: src.notes ? src.notes.map(n => ({ t: n.t, d: n.d, n: n.n, v: n.v })) : undefined,
    });
    // On an audio track the copy goes on top, where it is heard.
    if (found.track.kind === 'audio') found.track.clips.push(copy);
    else found.track.clips.splice(found.track.clips.indexOf(src) + 1, 0, copy);
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
  // The notes an edit applies to: the ones named, or the whole clip when none are.
  function chosen(clip, ids) {
    if (!clip.notes) return [];
    return ids && ids.length ? clip.notes.filter(n => ids.includes(n.id)) : clip.notes;
  }
  function quantize(clip, grid, ids) {
    if (!clip.notes || !(grid > 0)) return;
    chosen(clip, ids).forEach(n => { n.t = Math.max(0, Math.min(snap(n.t, grid), Math.max(0, clip.length - grid))); });
    sortNotes(clip);
  }
  function transpose(clip, semitones, ids) {
    if (!clip.notes) return;
    chosen(clip, ids).forEach(n => { n.n = Math.max(0, Math.min(127, n.n + Math.round(semitones))); });
    sortNotes(clip);
  }
  function setVelocity(clip, ids, velocity) {
    if (!clip.notes || !ids || !ids.length) return;
    chosen(clip, ids).forEach(n => { n.v = num(velocity, 0.01, 1, n.v); });
  }

  // ── Several notes at once ────────────────────────────────────────────────
  // Ids of the notes on the given pitches that sound within a span of time
  // (given either way round). `width` makes every note count as that long,
  // which is how the drum grid draws its hits.
  function notesWithin(clip, t0, t1, pitches, width) {
    if (!clip.notes) return [];
    const from = Math.min(t0, t1), to = Math.max(t0, t1);
    const rows = new Set(pitches);
    return clip.notes.filter(n => rows.has(n.n) && n.t < to && n.t + (width > 0 ? width : n.d) > from).map(n => n.id);
  }

  // Moves a group as one. `base` is where its notes were when the move began,
  // [{ id, t, n }], so a drag can be applied again and again without drifting.
  // The whole group stops at the edges of the clip and of the pitch range
  // (limits: { low, high, step }). Returns the { dt, dn } actually applied.
  function shiftNotes(clip, base, dt, dn, limits) {
    if (!clip.notes || !base.length) return { dt: 0, dn: 0 };
    limits = limits || {};
    const low = limits.low == null ? 0 : limits.low, high = limits.high == null ? 127 : limits.high;
    const lastStart = Math.max(0, clip.length - (limits.step > 0 ? limits.step : 0.25));
    const times = base.map(b => b.t), pitches = base.map(b => b.n);
    const time = Math.max(-Math.min.apply(null, times), Math.min(dt, lastStart - Math.max.apply(null, times)));
    const pitch = Math.max(low - Math.min.apply(null, pitches), Math.min(Math.round(dn), high - Math.max.apply(null, pitches)));
    base.forEach(b => {
      const note = clip.notes.find(n => n.id === b.id);
      if (note) { note.t = Math.max(0, b.t + time); note.n = Math.max(0, Math.min(127, b.n + pitch)); }
    });
    sortNotes(clip);
    return { dt: time, dn: pitch };
  }

  // Lengthens or shortens a group by the same amount, from [{ id, t, d }].
  function stretchNotes(clip, base, dd, shortest) {
    if (!clip.notes) return;
    const least = shortest > 0 ? shortest : 1 / 64;
    base.forEach(b => {
      const note = clip.notes.find(n => n.id === b.id);
      if (note) note.d = Math.max(least, Math.min(b.d + dd, Math.max(least, clip.length - b.t)));
    });
  }

  function removeNotes(clip, ids) {
    if (!clip.notes) return 0;
    const before = clip.notes.length;
    clip.notes = clip.notes.filter(n => !ids.includes(n.id));
    return before - clip.notes.length;
  }

  // What Copy holds: the notes, timed from the first of them. Null for none.
  function copyNotes(clip, ids) {
    const picked = clip.notes && ids && ids.length ? clip.notes.filter(n => ids.includes(n.id)) : [];
    if (!picked.length) return null;
    const first = Math.min.apply(null, picked.map(n => n.t));
    const last = Math.max.apply(null, picked.map(n => n.t + n.d));
    return { span: last - first, notes: picked.map(n => ({ t: n.t - first, d: n.d, n: n.n, v: n.v })) };
  }

  // Puts copied notes down starting at `at`. Notes that would begin after the
  // clip are left out and ones that overhang are trimmed. Returns the new ids.
  function pasteNotes(clip, copied, at) {
    if (!clip.notes || !copied || !Array.isArray(copied.notes)) return [];
    const made = [];
    copied.notes.forEach(c => {
      const t = at + c.t;
      if (!(t >= 0) || t >= clip.length || clip.notes.length >= LIMITS.notes) return;
      const note = createNote({ t, d: Math.min(c.d, clip.length - t), n: c.n, v: c.v });
      clip.notes.push(note);
      made.push(note.id);
    });
    sortNotes(clip);
    return made;
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
      tempo: raw.tempo, meter: raw.meter, key: raw.key, scale: raw.scale, master: raw.master,
    });
    if (global.Scales && !global.Scales.SCALES[project.scale]) project.scale = 'major';

    // Later tempo and time-signature changes: in order, one to a beat (the
    // last one given wins), never at or before the first bar.
    const changes = new Map();
    (Array.isArray(raw.changes) ? raw.changes : []).forEach(c => {
      if (!c || typeof c !== 'object' || typeof c.beat !== 'number' || !Number.isFinite(c.beat) || c.beat <= 0 ||
          c.beat > LIMITS.beats || typeof c.tempo !== 'number' || !Number.isFinite(c.tempo)) return;
      const meter = createMeter(c);
      changes.set(c.beat, { beat: c.beat, tempo: Math.round(num(c.tempo, 40, 240, project.tempo)), num: meter.num, den: meter.den });
    });
    project.changes = Array.from(changes.values()).sort((a, b) => a.beat - b.beat).slice(0, LIMITS.changes);

    const loop = raw.loop && typeof raw.loop === 'object' ? raw.loop : {};
    project.loop.on = loop.on === true;
    project.loop.start = num(loop.start, 0, LIMITS.beats, 0);
    project.loop.end = num(loop.end, project.loop.start + MIN_LENGTH, LIMITS.beats, project.loop.start + 16);
    const punch = raw.punch && typeof raw.punch === 'object' ? raw.punch : {};
    project.punch.start = num(punch.start, 0, LIMITS.beats, 0);
    project.punch.end = num(punch.end, project.punch.start, LIMITS.beats, project.punch.start);
    project.punch.on = punch.on === true && project.punch.end - project.punch.start >= MIN_LENGTH - EPS;

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
        volume: rt.volume, pan: rt.pan, mute: rt.mute, solo: rt.solo, armed: rt.armed, showTakes: rt.showTakes,
        fx: rt.fx && typeof rt.fx === 'object' ? rt.fx : {},
      });
      track.plugins = cleanPlugins(rt.plugins, seen, takesInstrument(track));
      (Array.isArray(rt.clips) ? rt.clips : []).forEach(rc => {
        if (!rc || typeof rc !== 'object' || track.clips.length >= LIMITS.clips) return;
        const base = { id: keepId(rc.id, 'c', seen), name: rc.name, start: rc.start, length: rc.length };
        if (track.kind === 'audio') {
          if (typeof rc.audioId !== 'string' || !ID_RE.test(rc.audioId)) return;
          track.clips.push(createClip(Object.assign(base, {
            audioId: rc.audioId, offset: rc.offset, gain: rc.gain, tempo: rc.tempo, stretch: rc.stretch,
            fadeIn: rc.fadeIn, fadeOut: rc.fadeOut, alts: rc.alts, comp: rc.comp,
          })));
        } else {
          const clip = createClip(base);
          clip.notes = (Array.isArray(rc.notes) ? rc.notes : []).filter(validNote).slice(0, LIMITS.notes)
            .map(n => ({ id: keepId(n.id, 'n', seen), t: n.t, d: n.d, n: Math.round(n.n), v: n.v }));
          track.clips.push(clip);
        }
      });
      project.tracks.push(track);
    });
    project.masterPlugins = cleanPlugins(raw.masterPlugins, seen, false);
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

    // The conductor track: title, then tempo, time signature and section
    // names, each where it takes effect.
    const cond = [];
    meta(cond, 0, 0x03, ascii(project.title));
    const events = [];
    stretches(project).forEach((s, i, all) => {
      const tick = Math.round(s.beat * PPQ);
      const mpq = Math.round(60000000 / s.tempo);
      events.push({ tick, order: 0, type: 0x51, bytes: [(mpq >> 16) & 255, (mpq >> 8) & 255, mpq & 255] });
      if (i === 0 || s.num !== all[i - 1].num || s.den !== all[i - 1].den) {
        events.push({ tick, order: 1, type: 0x58, bytes: [s.num, Math.round(Math.log2(s.den)), Math.round(96 / s.den), 8] });
      }
    });
    project.markers.forEach(m => events.push({ tick: Math.round(m.beat * PPQ), order: 2, type: 0x06, bytes: ascii(m.name) }));
    events.sort((a, b) => a.tick - b.tick || a.order - b.order);
    let last = 0;
    events.forEach(e => {
      meta(cond, e.tick - last, e.type, e.bytes);
      last = e.tick;
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
    DENOMINATORS, stretches, stretchAt, tempoAt, beatToSeconds, secondsToBeat, positionAt, barsBetween, nearestBar, clipBars, clicksBetween,
    setChange, removeChange,
    clipRate, clipSpan, setStretch, setClipTempo,
    takesOf, takeAt, takeRate, compRegions, takeIndexAt, setComp, useTake, removeTake, removeUnusedTakes, setFade,
    takesFromRecording, placeTakes, audioPieces, punchRange, XFADE,
    audioFileProblem, audioLengthProblem,
    addTrack, removeTrack,
    addPlugin, removePlugin, movePlugin, findPlugin, pluginIds, instrumentPlugin,
    addClip, removeClip, moveClip, raiseClip, resizeClip, trimStart, splitClip, duplicateClip,
    addNote, removeNote, updateNote, quantize, transpose, setVelocity,
    notesWithin, shiftNotes, stretchNotes, removeNotes, copyNotes, pasteNotes,
    sanitize, serialize, deserialize, History, toMidi,
  };
})(typeof window !== 'undefined' ? window : globalThis);
