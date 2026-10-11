/* ChordPath — daw/stretch.js
 * Makes a recording longer or shorter without changing its pitch, so that a
 * take can follow the song to a new tempo.
 *
 * The method is overlap-add with a similarity search (WSOLA): the recording
 * is cut into short overlapping slices, the slices are laid down closer
 * together or further apart, and each is nudged a few milliseconds to where
 * its waveform best continues the one before, so the joins cannot be heard.
 * It suits changes of up to a quarter or so either way; beyond that, playing
 * starts to sound grainy and a very short sound can go missing.
 */
(function (global) {
  'use strict';

  const SLICE_SECONDS = 0.046;      // length of a slice
  const SEARCH_SECONDS = 0.011;     // how far a slice may be nudged
  const STRIDE = 3;                 // every third sample is enough to compare two waveforms
  const COARSE = 4;                 // the search first looks at every fourth place, then closely round the best
  const LIMITS = { least: 0.25, most: 4, gentle: [0.75, 1.34] };

  // Sets a stretch up so it can be done a piece at a time (see `stretch`).
  // channels: Float32Array per channel. ratio: new length / old length.
  function begin(channels, sampleRate, ratio) {
    if (!(ratio >= LIMITS.least && ratio <= LIMITS.most)) throw new Error('The stretch ratio must be between 0.25 and 4');
    const length = channels[0].length;
    const half = Math.max(8, Math.round(sampleRate * SLICE_SECONDS / 2));
    const slice = half * 2;
    const reach = Math.max(1, Math.round(sampleRate * SEARCH_SECONDS));
    const job = { channels, ratio, length, half, slice, reach, index: 0, last: 0, done: false };
    if (ratio === 1 || length < slice * 2) {          // nothing to do, or too short to work on
      job.out = channels.map(c => new Float32Array(c));
      job.done = true;
      return job;
    }
    job.outLength = Math.round(length * ratio);
    job.slices = Math.ceil(job.outLength / half) + 1;
    job.out = channels.map(() => new Float32Array(job.outLength + slice));
    job.weight = new Float32Array(job.outLength + slice);
    job.window = new Float32Array(slice);
    for (let n = 0; n < slice; n++) job.window[n] = 0.5 - 0.5 * Math.cos(2 * Math.PI * n / slice);
    // The search listens to all channels at once, so they stay in step with each other.
    job.mono = new Float32Array(length);
    channels.forEach(c => { for (let i = 0; i < length; i++) job.mono[i] += c[i]; });
    return job;
  }

  // How alike the recording is at two places, over one slice.
  function likeness(mono, a, b, count, stride) {
    let both = 0, power = 0;
    for (let n = 0; n < count; n += stride) {
      const x = mono[a + n] || 0, y = mono[b + n] || 0;
      both += x * y;
      power += x * x;
    }
    return power > 1e-12 ? both / Math.sqrt(power) : 0;
  }

  // The place between `low` and `high` where the recording best carries on
  // from `follows`: a quick pass over every few samples, then a close look
  // round the best of them.
  function bestStart(mono, low, high, follows, count, fallback) {
    let best = -Infinity, from = fallback;
    for (let at = low; at <= high; at += COARSE) {
      const score = likeness(mono, at, follows, count, STRIDE * 2);
      if (score > best) { best = score; from = at; }
    }
    best = -Infinity;
    const around = from;
    for (let at = Math.max(low, around - COARSE + 1); at <= Math.min(high, around + COARSE - 1); at++) {
      const score = likeness(mono, at, follows, count, STRIDE);
      if (score > best) { best = score; from = at; }
    }
    return from;
  }

  // Lays down up to `count` more slices. Returns true once the job is finished.
  function step(job, count) {
    if (job.done) return true;
    const { mono, half, slice, reach, window, weight, length } = job;
    const until = Math.min(job.slices, job.index + count);
    for (; job.index < until; job.index++) {
      const k = job.index;
      const ideal = Math.round(k * half / job.ratio);
      let from = ideal;
      if (k > 0) {
        // `job.last + half` is where the previous slice would have carried on, had nothing been moved.
        from = bestStart(mono, Math.max(0, ideal - reach), Math.min(Math.max(0, length - 1), ideal + reach), job.last + half, half, ideal);
      }
      job.last = from;
      const at = k * half;
      for (let n = 0; n < slice; n++) {
        if (from + n >= length) break;
        weight[at + n] += window[n];
      }
      job.out.forEach((out, c) => {
        const source = job.channels[c];
        for (let n = 0; n < slice && from + n < length; n++) out[at + n] += window[n] * source[from + n];
      });
    }
    if (job.index < job.slices) return false;
    // Even out the places where fewer slices overlapped (the two ends).
    job.out = job.out.map(out => {
      const trimmed = out.subarray(0, job.outLength);
      for (let i = 0; i < trimmed.length; i++) if (weight[i] > 0.05) trimmed[i] /= weight[i];
      return new Float32Array(trimmed);
    });
    job.done = true;
    return true;
  }

  // The whole stretch in one go. Returns new channels; the originals are untouched.
  function fit(channels, sampleRate, ratio) {
    const job = begin(channels, sampleRate, ratio);
    step(job, Infinity);
    return job.out;
  }

  // The same, a piece at a time so the screen stays alive during a long take.
  // `between(fraction)` is called between pieces and may return a promise.
  async function stretch(channels, sampleRate, ratio, between) {
    const job = begin(channels, sampleRate, ratio);
    while (!step(job, 400)) {
      if (between) await between(job.index / job.slices);
      else await new Promise(resolve => setTimeout(resolve, 0));
    }
    return job.out;
  }

  global.Stretch = { fit, stretch, LIMITS };
})(typeof window !== 'undefined' ? window : globalThis);
