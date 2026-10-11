/* ChordPath — DAW audio engine tests, run inside the real app.
 * Run with: node tests/e2e-engine.js   (or npm run test:e2e)
 *
 * Nothing here is judged by ear. Offline renders are deterministic, so the
 * tests measure them: when a note starts, how loud each channel is, whether
 * a muted track is truly silent, whether two renders match sample for sample.
 */
'use strict';

const { check, section, tempDataDir, launch, crashed, finish, cleanup } = require('./e2e-helpers');

(async () => {
  const userData = tempDataDir();
  const { app, page, log } = await launch(userData);

  try {
    // Measuring helpers, installed in the page.
    await page.evaluate(() => {
      const T = window.__t = {};
      // tracks: [{ kind, instrument, mix: {...}, clips: [{ start, length, notes: [[t, d, n, v]] }] }]
      T.project = (tempo, tracks, extra) => {
        const p = DawProject.createProject(Object.assign({ title: 'test', tempo }, extra));
        tracks.forEach(def => {
          const track = DawProject.addTrack(p, def.kind || 'instrument', { instrument: def.instrument || 'piano', volume: 0 });
          Object.assign(track, def.mix || {});
          if (def.fx) Object.assign(track.fx, def.fx);
          (def.clips || []).forEach(c => {
            const clip = DawProject.addClip(track, { start: c.start, length: c.length, audioId: c.audioId, offset: c.offset });
            (c.notes || []).forEach(n => DawProject.addNote(clip, { t: n[0], d: n[1], n: n[2], v: n[3] == null ? 0.5 : n[3] }));
          });
        });
        return p;
      };
      T.note = (instrument, mix, fx) => T.project(120, [{ instrument, mix, fx, clips: [{ start: 0, length: 4, notes: [[0, 1, 60, 0.5]] }] }]);
      T.render = (p, opts, audio) => DawEngine.render(p, audio || new Map(), Object.assign({ tail: 1 }, opts));
      T.measure = (out, from, to) => {
        const sr = out.sampleRate;
        const a = Math.max(0, Math.floor((from || 0) * sr));
        const b = Math.min(out.channels[0].length, to == null ? Infinity : Math.floor(to * sr));
        const res = { seconds: out.channels[0].length / sr, peak: [0, 0], rms: [0, 0] };
        for (let c = 0; c < 2; c++) {
          const d = out.channels[c];
          let peak = 0, sum = 0;
          for (let i = a; i < b; i++) { const v = Math.abs(d[i]); if (v > peak) peak = v; sum += d[i] * d[i]; }
          res.peak[c] = peak; res.rms[c] = Math.sqrt(sum / Math.max(1, b - a));
        }
        return res;
      };
      T.onset = (out, threshold) => {
        const d = out.channels[0], e = out.channels[1];
        for (let i = 0; i < d.length; i++) if (Math.abs(d[i]) > threshold || Math.abs(e[i]) > threshold) return i / out.sampleRate;
        return -1;
      };
      T.sum = out => {
        let h = 0;
        for (let c = 0; c < 2; c++) { const d = out.channels[c]; for (let i = 0; i < d.length; i += 7) h = (h * 31 + Math.round(d[i] * 1e6)) | 0; }
        return h;
      };
      T.wait = ms => new Promise(r => setTimeout(r, ms));
    });

    // ── Timing ─────────────────────────────────────────────────────────────
    section('Timing');
    const timing = await page.evaluate(async () => {
      const T = window.__t;
      const at4 = tempo => T.project(tempo, [{ clips: [{ start: 4, length: 4, notes: [[0, 1, 60, 0.6]] }] }]);
      const fast = await T.render(at4(120));
      const slow = await T.render(at4(60));
      return {
        fastOnset: T.onset(fast, 0.002), slowOnset: T.onset(slow, 0.002),
        fastSeconds: T.measure(fast).seconds, quietBefore: T.measure(fast, 0, 1.9).peak[0],
        delay: DawEngine.CHAIN_DELAY, rate: fast.sampleRate, channels: fast.channels.length,
      };
    });
    check('a render is 44.1 kHz stereo', timing.rate === 44100 && timing.channels === 2);
    check(`a note on beat 5 at 120 bpm starts at 2.0 s (measured ${timing.fastOnset.toFixed(4)} s)`,
      Math.abs(timing.fastOnset - 2 - timing.delay) < 0.006);
    check(`and at 60 bpm it starts at 4.0 s (measured ${timing.slowOnset.toFixed(4)} s)`,
      Math.abs(timing.slowOnset - 4 - timing.delay) < 0.006);
    check('there is silence before the first note', timing.quietBefore < 1e-5);
    check('the render runs to the end of the last clip plus its tail', Math.abs(timing.fastSeconds - 5) < 0.01);

    // ── Determinism ────────────────────────────────────────────────────────
    section('Determinism');
    const same = await page.evaluate(async () => {
      const T = window.__t;
      const p = T.project(110, [
        { instrument: 'guitar', fx: { reverb: 0.4, delay: 0.3 }, clips: [{ start: 0, length: 4, notes: [[0, 1, 60], [1, 1, 64], [2, 2, 67]] }] },
        { kind: 'drums', clips: [{ start: 0, length: 4, notes: [[0, 0.5, 36, 0.8], [1, 0.25, 38, 0.7], [0.5, 0.1, 42, 0.4], [2, 0.5, 49, 0.5]] }] },
      ]);
      const a = await T.render(p), b = await T.render(p), c = await T.render(JSON.parse(JSON.stringify(p)));
      let worst = 0;
      for (let ch = 0; ch < 2; ch++) {
        for (let i = 0; i < a.channels[ch].length; i++) {
          worst = Math.max(worst, Math.abs(a.channels[ch][i] - b.channels[ch][i]), Math.abs(a.channels[ch][i] - c.channels[ch][i]));
        }
      }
      return { worst, loud: T.measure(a).peak[0], sameLength: a.channels[0].length === b.channels[0].length };
    });
    check(`renders of the same project match to below -120 dB (worst difference ${same.worst.toExponential(1)})`,
      same.sameLength && same.loud > 0.05 && same.worst < 1e-6);

    // ── Mixer ──────────────────────────────────────────────────────────────
    section('Mixer');
    const mix = await page.evaluate(async () => {
      const T = window.__t;
      const m = async (mixSettings, fx, extra) => {
        const p = T.note('organ', mixSettings, fx);
        if (extra) Object.assign(p, extra);
        return T.measure(await T.render(p), 0.1, 0.45);
      };
      const ref = await m({});
      return {
        ref,
        muted: T.measure(await T.render(T.note('organ', { mute: true }))),
        down6: await m({ volume: -6 }),
        master12: await m({}, null, { master: -12 }),
        left: await m({ pan: -1 }), right: await m({ pan: 1 }),
      };
    });
    check('a muted track is silent', mix.muted.peak[0] < 1e-6 && mix.muted.peak[1] < 1e-6);
    check('a centred track is equally loud on both sides', Math.abs(mix.ref.rms[0] - mix.ref.rms[1]) < mix.ref.rms[0] * 0.01);
    check(`lowering a fader 6 dB halves the level (ratio ${(mix.down6.rms[0] / mix.ref.rms[0]).toFixed(3)})`,
      Math.abs(mix.down6.rms[0] / mix.ref.rms[0] - 0.501) < 0.03);
    check(`the master fader at -12 dB quarters it (ratio ${(mix.master12.rms[0] / mix.ref.rms[0]).toFixed(3)})`,
      Math.abs(mix.master12.rms[0] / mix.ref.rms[0] - 0.251) < 0.02);
    check('panned hard left, the right side is silent', mix.left.rms[1] < mix.left.rms[0] * 0.001 && mix.left.rms[0] > mix.ref.rms[0]);
    check('panned hard right, the left side is silent', mix.right.rms[0] < mix.right.rms[1] * 0.001);

    const solo = await page.evaluate(async () => {
      const T = window.__t;
      const two = soloSecond => T.project(120, [
        { instrument: 'organ', clips: [{ start: 0, length: 2, notes: [[0, 1, 60]] }] },
        { instrument: 'organ', mix: { solo: soloSecond }, clips: [{ start: 2, length: 2, notes: [[0, 1, 67]] }] },
      ]);
      const soloed = await T.render(two(true));
      const p = two(false);
      const stem = await T.render(p, { onlyTrackId: p.tracks[1].id });
      const both = await T.render(p);
      return {
        soloFirstHalf: T.measure(soloed, 0, 0.9).peak[0], soloSecondHalf: T.measure(soloed, 1.1, 1.5).rms[0],
        stemSecondHalf: T.measure(stem, 1.1, 1.5).rms[0], stemFirstHalf: T.measure(stem, 0, 0.9).peak[0],
        bothFirstHalf: T.measure(both, 0.1, 0.4).rms[0],
      };
    });
    check('soloing a track silences the others', solo.soloFirstHalf < 1e-6 && solo.soloSecondHalf > 0.01);
    check('a stem render contains only its track', solo.stemFirstHalf < 1e-6 && Math.abs(solo.stemSecondHalf - solo.soloSecondHalf) < 1e-4);
    check('without solo both tracks sound', solo.bothFirstHalf > 0.01);

    const clipEdge = await page.evaluate(async () => {
      const T = window.__t;
      const p = T.project(120, [{ instrument: 'organ', clips: [{ start: 0, length: 2, notes: [[0, 4, 60], [3, 1, 72]] }] }]);
      const out = await T.render(p);
      return { during: T.measure(out, 0.2, 0.9).rms[0], afterClip: T.measure(out, 1.3, 2.5).peak[0] };
    });
    check('notes stop at the end of their clip, and notes past it never play', clipEdge.during > 0.01 && clipEdge.afterClip < 1e-3);

    // ── Effects ────────────────────────────────────────────────────────────
    section('Effects');
    const fx = await page.evaluate(async () => {
      const T = window.__t;
      const tailOf = async fxSettings => {
        const p = T.project(120, [{ instrument: 'pluck', fx: fxSettings, clips: [{ start: 0, length: 8, notes: [[0, 0.25, 72, 0.6]] }] }]);
        const out = await T.render(p);
        return { tail: T.measure(out, 1.2, 2.2).rms[0], echo: T.measure(out, 0.375, 0.5).rms[0], dry: T.measure(out, 0, 0.2).rms[0] };
      };
      const tone = async (midi, fxSettings) => {
        const p = T.project(120, [{ instrument: 'organ', fx: fxSettings, clips: [{ start: 0, length: 4, notes: [[0, 2, midi, 0.3]] }] }]);
        return T.measure(await T.render(p), 0.2, 0.9).rms[0];
      };
      const hat = async fxSettings => {
        const p = T.project(120, [{ kind: 'drums', fx: fxSettings, clips: [{ start: 0, length: 4, notes: [[0, 0.25, 46, 0.8]] }] }]);
        return T.measure(await T.render(p), 0, 0.3).rms[0];
      };
      return {
        dry: await tailOf({}), wet: await tailOf({ reverb: 0.8 }), echoed: await tailOf({ delay: 1 }),
        bass: await tone(36, {}), bassBoost: await tone(36, { low: 12 }), bassCut: await tone(36, { low: -12 }),
        high: await hat({}), highCut: await hat({ high: -12 }), midBoost: await tone(84, { mid: 12 }), mid: await tone(84, {}),
        comp: await tone(60, { comp: true }), plain: await tone(60, {}),
      };
    });
    check('a dry pluck has died away after a second', fx.dry.tail < 1e-3);
    check(`reverb leaves a tail (${fx.wet.tail.toExponential(1)} against ${fx.dry.tail.toExponential(1)} dry)`, fx.wet.tail > fx.dry.tail * 20 && fx.wet.tail > 5e-4);
    check('delay puts an echo a dotted eighth later', fx.echoed.echo > fx.dry.echo * 3);
    check(`low shelf +12 dB lifts a bass note (x${(fx.bassBoost / fx.bass).toFixed(2)})`, fx.bassBoost / fx.bass > 2.5);
    check(`low shelf -12 dB cuts it (x${(fx.bassCut / fx.bass).toFixed(2)})`, fx.bassCut / fx.bass < 0.4);
    check(`high shelf -12 dB cuts a hi-hat (x${(fx.highCut / fx.high).toFixed(2)})`, fx.highCut / fx.high < 0.5);
    check(`mid +12 dB lifts a mid note (x${(fx.midBoost / fx.mid).toFixed(2)})`, fx.midBoost / fx.mid > 1.8);
    check('switching the compressor on changes the level', Math.abs(fx.comp - fx.plain) > fx.plain * 0.02);

    // ── Voices ─────────────────────────────────────────────────────────────
    section('Voices');
    const voices = await page.evaluate(async () => {
      const T = window.__t;
      const res = {};
      for (const inst of DawProject.INSTRUMENTS) {
        const p = T.project(120, [{ instrument: inst.id, clips: [{ start: 0, length: 2, notes: [[0, 1, inst.id === 'bass' ? 40 : 64, 0.7]] }] }]);
        const out = await T.render(p, { tail: 4 });
        res[inst.id] = { loud: T.measure(out, 0, 1).peak[0], end: T.measure(out, 4.5, 5).peak[0] };
      }
      const kit = {};
      for (const lane of DawProject.DRUM_LANES) {
        const p = T.project(120, [{ kind: 'drums', clips: [{ start: 0, length: 2, notes: [[0, 0.25, lane.note, 0.8]] }] }]);
        const out = await T.render(p, { tail: 3 });
        kit[lane.id] = { loud: T.measure(out, 0, 0.5).peak[0], end: T.measure(out, 3.5, 4).peak[0] };
      }
      return { res, kit };
    });
    for (const [id, v] of Object.entries(voices.res)) {
      check(`the ${id} voice sounds and then falls silent (peak ${v.loud.toFixed(3)})`, v.loud > 0.02 && v.loud < 1 && v.end < 2e-3);
    }
    for (const [id, v] of Object.entries(voices.kit)) {
      check(`the ${id} drum sounds and then falls silent (peak ${v.loud.toFixed(3)})`, v.loud > 0.02 && v.loud < 1 && v.end < 1e-3);
    }

    // ── Recorded audio ─────────────────────────────────────────────────────
    section('Audio clips');
    const audio = await page.evaluate(async () => {
      const T = window.__t;
      const sr = 48000;
      const sine = new Float32Array(sr);
      for (let i = 0; i < sr; i++) sine[i] = 0.5 * Math.sin(2 * Math.PI * 440 * i / sr);
      const store = new Map([['aud_sine', { sampleRate: sr, channels: [sine] }]]);
      const p = T.project(120, [{ kind: 'audio', clips: [{ start: 2, length: 1, audioId: 'aud_sine', offset: 0.25 }] }]);
      const out = await T.render(p, { tail: 1 }, store);
      // Count zero crossings in the middle of the clip to check its pitch survived resampling.
      const d = out.channels[0];
      const a = Math.floor(1.1 * out.sampleRate), b = Math.floor(1.4 * out.sampleRate);
      let crossings = 0;
      for (let i = a + 1; i < b; i++) if ((d[i - 1] < 0) !== (d[i] < 0)) crossings++;
      const missing = await T.render(T.project(120, [{ kind: 'audio', clips: [{ start: 0, length: 1, audioId: 'aud_gone' }] }]), {}, new Map());
      return {
        onset: T.onset(out, 0.01), before: T.measure(out, 0, 0.95).peak[0],
        during: T.measure(out, 1.1, 1.4).rms[0], after: T.measure(out, 1.6, 2.4).peak[0],
        hz: crossings / 2 / 0.3, missingPeak: T.measure(missing).peak[0],
      };
    });
    check(`a recording placed on beat 3 starts at 1.0 s (measured ${audio.onset.toFixed(4)} s)`, Math.abs(audio.onset - 1 - 0.012) < 0.008);
    check('it is silent before and after its clip', audio.before < 1e-5 && audio.after < 1e-3);
    check(`it plays at the right speed whatever rate it was recorded at (${audio.hz.toFixed(1)} Hz)`, Math.abs(audio.hz - 440) < 3);
    check('a clip whose recording is missing is skipped quietly', audio.missingPeak < 1e-6);

    // ── A whole song ───────────────────────────────────────────────────────
    section('Bouncing a song');
    const bounce = await page.evaluate(async () => {
      const T = window.__t;
      const song = Feelings.generateSongSpec({ feelingId: 'yearning', genreId: 'jangle_indie', energy: 'mid', seed: 11 });
      const p = DawProject.fromSong(song);
      window.__song = p;
      const t0 = performance.now();
      const out = await DawEngine.render(p, new Map());
      const ms = performance.now() - t0;
      const all = T.measure(out);
      const wav = Wav.encode(out.channels, out.sampleRate, 16);
      const back = Wav.decode(wav);
      p.loop.on = true;
      const looped = await DawEngine.render(p, new Map());
      p.loop.on = false;
      return {
        ms, seconds: all.seconds, peak: Math.max(all.peak[0], all.peak[1]), rms: all.rms[0],
        songSeconds: DawProject.endBeat(p) * 60 / p.tempo, wavBytes: wav.length, wavRate: back.sampleRate,
        wavFrames: back.channels[0].length, loopedSeconds: T.measure(looped).seconds,
      };
    });
    console.log(`  (rendered ${bounce.seconds.toFixed(1)} s of a 5-track song in ${(bounce.ms / 1000).toFixed(2)} s — ${(bounce.seconds * 1000 / bounce.ms).toFixed(0)}x real time)`);
    check('a full generated song renders with sound', bounce.rms > 0.01);
    check(`the limiter keeps the mix below full scale (peak ${bounce.peak.toFixed(3)})`, bounce.peak < 1);
    check('the render covers the whole song', Math.abs(bounce.seconds - bounce.songSeconds - 2.5) < 0.05);
    check('bouncing is at least five times faster than real time', bounce.ms < bounce.seconds * 1000 / 5);
    check('the mixdown encodes to a WAV file that reads back', bounce.wavRate === 44100 && bounce.wavFrames === Math.round(bounce.seconds * 44100));
    check('an active loop does not change what is exported', Math.abs(bounce.loopedSeconds - bounce.seconds) < 0.001);

    // ── Live playback ──────────────────────────────────────────────────────
    section('Live playback');
    const live = await page.evaluate(async () => {
      const T = window.__t;
      const eng = DawEngine.get();
      const p = window.__song;
      eng.sync(p);
      const peakFor = async ms => {
        let pk = -160;
        for (let i = 0; i < ms / 40; i++) { await T.wait(40); pk = Math.max(pk, eng.levels().master); }
        return pk;
      };
      const res = { before: eng.position(), wasPlaying: eng.isPlaying() };
      await eng.play();
      res.level = await peakFor(1500);
      res.moved = eng.position();
      res.playing = eng.isPlaying();
      eng.stop();
      res.rest = eng.position();
      await T.wait(3200);                         // long enough for the reverb to ring out
      res.restLater = eng.position();
      res.silent = await peakFor(300);

      await eng.seek(24);
      res.sought = eng.position();
      await eng.play();
      await T.wait(500);
      res.afterSeek = eng.position();

      // Tempo change while playing keeps the playhead where it is.
      const beforeTempo = eng.position();
      p.tempo = Math.round(p.tempo * 1.5);
      eng.sync(p);
      const afterTempo = eng.position();
      await T.wait(400);
      res.tempoJump = afterTempo - beforeTempo;
      res.stillMoving = eng.position() > afterTempo;
      eng.stop();
      p.tempo = Math.round(p.tempo / 1.5);

      // Loop over the first two beats.
      p.loop = { on: true, start: 0, end: 2 };
      eng.sync(p);
      await eng.seek(0);
      await eng.play();
      let maxPos = 0, wraps = 0, last = 0;
      for (let i = 0; i < 60; i++) {
        await T.wait(40);
        const pos = eng.position();
        if (pos < last - 0.5) wraps++;
        last = pos;
        maxPos = Math.max(maxPos, pos);
      }
      eng.stop();
      res.loopMax = maxPos; res.loopWraps = wraps;
      p.loop.on = false;

      // Muting while playing.
      await eng.seek(8);
      eng.sync(p);
      await eng.play();
      await T.wait(700);
      res.beforeMute = await peakFor(300);
      p.tracks.forEach(t => { t.mute = true; });
      eng.sync(p);
      await T.wait(3500);
      res.afterMute = await peakFor(300);
      eng.stop();
      p.tracks.forEach(t => { t.mute = false; });
      eng.sync(p);

      // Metronome on an empty stretch.
      const empty = DawProject.createProject({ tempo: 120 });
      eng.sync(empty);
      await eng.seek(0);
      eng.setClick(true);
      await eng.play();
      res.click = await peakFor(1200);
      eng.setClick(false);
      eng.stop();
      await T.wait(300);
      await eng.play();
      res.noClick = await peakFor(800);
      eng.stop();
      eng.sync(p);

      // Auditioning a note.
      await T.wait(300);
      eng.audition(p.tracks[0].id, 64, 0.8);
      res.audition = await peakFor(400);
      return res;
    });
    check('the playhead starts at rest', live.before === 0 && live.wasPlaying === false);
    check(`playing moves the playhead (${live.moved.toFixed(2)} beats)`, live.playing && live.moved > 1 && live.moved < 6);
    check(`and makes sound (${live.level.toFixed(1)} dB)`, live.level > -40);
    check('stopping holds the playhead, and the mix rings out to silence', live.rest > 1 && live.restLater === live.rest && live.silent < -50);
    check('seeking moves the playhead, and playback continues from there', live.sought === 24 && live.afterSeek > 24.3 && live.afterSeek < 27);
    check('a tempo change while playing does not jump the playhead', Math.abs(live.tempoJump) < 0.3 && live.stillMoving);
    check(`a loop keeps the playhead inside it (max ${live.loopMax.toFixed(2)}, ${live.loopWraps} wraps)`, live.loopMax < 2.05 && live.loopWraps >= 2);
    check('muting every track while playing silences the mix', live.beforeMute > -40 && live.afterMute < -50);
    check('the metronome clicks only when it is on', live.click > -30 && live.noClick < -60);
    check('auditioning a note makes sound', live.audition > -40);

    // ── Recording ──────────────────────────────────────────────────────────
    section('Recording');
    const rec = await page.evaluate(async () => {
      const T = window.__t;
      const eng = DawEngine.get();
      const p = DawProject.createProject({ tempo: 120 });
      const track = DawProject.addTrack(p, 'audio', { name: 'Take', volume: 0 });
      eng.sync(p);
      await eng.seek(4);
      const t0 = performance.now();
      await eng.startRecording();
      const recordingFlag = eng.isRecording();
      await T.wait(2000 + 2600);                 // one bar count-in at 120 bpm, then ~2.6 s of take
      const take = eng.stopRecording();
      if (!take) return { take: null };
      let peak = 0;
      for (let i = 0; i < take.channels[0].length; i++) peak = Math.max(peak, Math.abs(take.channels[0][i]));
      eng.setAudio('aud_take1', take.sampleRate, take.channels);
      DawProject.addClip(track, { start: take.startBeat, length: take.beats, audioId: 'aud_take1', offset: take.latency });
      const out = await T.render(p, { tail: 0.5 }, eng.audio);
      await DawStore.putAudio('aud_take1', p.id, take.sampleRate, take.channels);
      await DawStore.saveProject(p);
      const back = await DawStore.loadProject(p.id);
      const stored = await DawStore.getAudio('aud_take1');
      await DawStore.deleteProject(p.id);
      return {
        recordingFlag, after: eng.isRecording(), playing: eng.isPlaying(), restAt: eng.position(),
        seconds: take.channels[0].length / take.sampleRate, beats: take.beats, startBeat: take.startBeat,
        latency: take.latency, peak, renderedPeak: T.measure(out).peak[0], renderedBefore: T.measure(out, 0, 1.9).peak[0],
        peaks: Array.from(eng.audioPeaks('aud_take1', 8)).some(v => v > 0.01), storedSeconds: eng.audioSeconds('aud_take1'),
        savedTracks: back.tracks.length, savedClip: back.tracks[0].clips[0].audioId,
        storedFrames: stored.channels[0].length, storedRate: stored.sampleRate,
        gone: (await DawStore.loadProject(p.id)) === null && (await DawStore.getAudio('aud_take1')) === null,
        elapsed: (performance.now() - t0) / 1000,
      };
    });
    check('a take was captured', !!rec.seconds);
    if (rec.seconds) {
      check('the engine reports recording while it runs, and stops cleanly', rec.recordingFlag && !rec.after && !rec.playing);
      check(`the take lasts as long as was recorded after the count-in (${rec.seconds.toFixed(2)} s)`, rec.seconds > 2.2 && rec.seconds < 3.2);
      check('its length in beats matches the tempo', Math.abs(rec.beats - rec.seconds * 2) < 0.01);
      check('it starts where the playhead was, and the playhead returns there', rec.startBeat === 4 && rec.restAt === 4);
      check('the microphone signal was captured', rec.peak > 0.01);
      check(`latency compensation is small and positive (${Math.round(rec.latency * 1000)} ms)`, rec.latency > 0.01 && rec.latency < 0.5);
      check('the take plays back from its clip, not before it', rec.renderedPeak > 0.01 && rec.renderedBefore < 1e-5);
      check('waveform peaks are available for drawing', rec.peaks && Math.abs(rec.storedSeconds - rec.seconds) < 0.001);
      check('project and recording are saved and load back', rec.savedTracks === 1 && rec.savedClip === 'aud_take1' && rec.storedFrames > 0 && rec.storedRate > 0);
      check('deleting a project deletes its recordings', rec.gone);
    }

    section('Health');
    if (log.errors.length) console.error(log.errors.join('\n'));
    check('no errors were logged', log.errors.length === 0);
    const external = log.requests.filter(u => !/^(app:\/\/chordpath\/|blob:|data:)/.test(u));
    check('the engine made no request beyond the app itself', external.length === 0);
  } catch (err) {
    crashed(err);
  } finally {
    try { await app.close(); } catch (e) { /* already closed */ }
    cleanup(userData);
  }
  finish();
})();
