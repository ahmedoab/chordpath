/* ChordPath — daw/wav.js
 * Reads and writes uncompressed WAV audio. Recordings are stored this way
 * and mixdowns are exported this way, so nothing is ever lost to compression.
 */
(function (global) {
  'use strict';

  // channels: Float32Array per channel, samples in -1..1.
  function encode(channels, sampleRate, bitDepth) {
    bitDepth = bitDepth || 16;
    if (!Array.isArray(channels) || !channels.length) throw new Error('WAV needs at least one channel');
    if (bitDepth !== 16 && bitDepth !== 24) throw new Error('Unsupported bit depth: ' + bitDepth);
    const frames = Math.min.apply(null, channels.map(c => c.length));
    const bytesPer = bitDepth / 8;
    const blockAlign = channels.length * bytesPer;
    const dataSize = frames * blockAlign;
    const out = new Uint8Array(44 + dataSize);
    const view = new DataView(out.buffer);
    const tag = (at, text) => { for (let i = 0; i < 4; i++) out[at + i] = text.charCodeAt(i); };

    tag(0, 'RIFF'); view.setUint32(4, 36 + dataSize, true); tag(8, 'WAVE');
    tag(12, 'fmt '); view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);                       // PCM
    view.setUint16(22, channels.length, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitDepth, true);
    tag(36, 'data'); view.setUint32(40, dataSize, true);

    const max = bitDepth === 16 ? 32767 : 8388607;
    let at = 44;
    for (let i = 0; i < frames; i++) {
      for (let c = 0; c < channels.length; c++) {
        const s = Math.max(-1, Math.min(1, channels[c][i] || 0));
        const v = Math.round(s < 0 ? s * (max + 1) : s * max);
        if (bitDepth === 16) { view.setInt16(at, v, true); at += 2; }
        else { out[at] = v & 255; out[at + 1] = (v >> 8) & 255; out[at + 2] = (v >> 16) & 255; at += 3; }
      }
    }
    return out;
  }

  // Accepts PCM 16/24-bit and 32-bit float files.
  function decode(input) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const tag = at => String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
    if (bytes.length < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('Not a WAV file');

    let fmt = null, data = null;
    let at = 12;
    while (at + 8 <= bytes.length) {
      const id = tag(at);
      const size = view.getUint32(at + 4, true);
      if (id === 'fmt ') {
        if (at + 24 > bytes.length) break;
        fmt = {
          format: view.getUint16(at + 8, true), channels: view.getUint16(at + 10, true),
          sampleRate: view.getUint32(at + 12, true), bitDepth: view.getUint16(at + 22, true),
        };
      } else if (id === 'data') {
        data = { at: at + 8, size: Math.min(size, bytes.length - at - 8) };
        break;
      }
      at += 8 + size + (size % 2);
    }
    if (!fmt || !data) throw new Error('WAV file is truncated or has no audio');
    const float = fmt.format === 3 && fmt.bitDepth === 32;
    const pcm = (fmt.format === 1 || fmt.format === 0xfffe) && (fmt.bitDepth === 16 || fmt.bitDepth === 24);
    if (!fmt.channels || fmt.channels > 8 || (!float && !pcm)) throw new Error('Unsupported WAV encoding');

    const bytesPer = fmt.bitDepth / 8;
    const frames = Math.floor(data.size / (bytesPer * fmt.channels));
    const channels = [];
    for (let c = 0; c < fmt.channels; c++) channels.push(new Float32Array(frames));
    let p = data.at;
    for (let i = 0; i < frames; i++) {
      for (let c = 0; c < fmt.channels; c++) {
        let s;
        if (float) s = view.getFloat32(p, true);
        else if (fmt.bitDepth === 16) s = view.getInt16(p, true) / 32768;
        else s = (((bytes[p + 2] << 24) >> 8) | (bytes[p + 1] << 8) | bytes[p]) / 8388608;
        channels[c][i] = s;
        p += bytesPer;
      }
    }
    return { sampleRate: fmt.sampleRate, bitDepth: fmt.bitDepth, channels };
  }

  // Loudest sample in each of `buckets` equal slices — what a waveform draws.
  function peaks(samples, buckets) {
    const out = new Float32Array(buckets);
    if (!samples.length) return out;
    const per = samples.length / buckets;
    for (let b = 0; b < buckets; b++) {
      const end = Math.min(samples.length, Math.max(Math.floor((b + 1) * per), Math.floor(b * per) + 1));
      let max = 0;
      for (let i = Math.floor(b * per); i < end; i++) {
        const a = samples[i] < 0 ? -samples[i] : samples[i];
        if (a > max) max = a;
      }
      out[b] = max;
    }
    return out;
  }

  global.Wav = { encode, decode, peaks };
})(typeof window !== 'undefined' ? window : globalThis);
