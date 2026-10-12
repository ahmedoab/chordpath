/* ChordPath — native/src/dsp.cpp
 * See dsp.h.
 */
#include "dsp.h"

#include <algorithm>
#include <cmath>
#include <cstring>

namespace cp {

namespace {
const double PI = 3.14159265358979323846;
}

// ── FFT ─────────────────────────────────────────────────────────────────────
Fft::Fft(unsigned size) : n(size) {
  unsigned bits = 0;
  while ((1u << bits) < n) bits++;
  for (unsigned i = 0; i < n; i++) {
    unsigned j = 0;
    for (unsigned b = 0; b < bits; b++) if (i & (1u << b)) j |= 1u << (bits - 1 - b);
    if (j > i) { swaps.push_back(i); swaps.push_back(j); }
  }
  twiddles.resize(n / 2);
  for (unsigned k = 0; k < n / 2; k++) {
    const double angle = -2.0 * PI * k / n;
    twiddles[k] = std::complex<float>((float)std::cos(angle), (float)std::sin(angle));
  }
}

void Fft::run(std::complex<float>* data, bool inverse) const {
  for (size_t i = 0; i < swaps.size(); i += 2) std::swap(data[swaps[i]], data[swaps[i + 1]]);
  for (unsigned half = 1; half < n; half <<= 1) {
    const unsigned step = n / (half * 2);
    for (unsigned start = 0; start < n; start += half * 2) {
      for (unsigned k = 0; k < half; k++) {
        const std::complex<float> w = inverse ? std::conj(twiddles[k * step]) : twiddles[k * step];
        const std::complex<float> a = data[start + k];
        const std::complex<float> b = data[start + k + half];
        const std::complex<float> t(b.real() * w.real() - b.imag() * w.imag(), b.real() * w.imag() + b.imag() * w.real());
        data[start + k] = a + t;
        data[start + k + half] = a - t;
      }
    }
  }
}

// ── Convolution ─────────────────────────────────────────────────────────────
Convolver::Convolver(const float* response, size_t length) : taps(response ? length : 0) {
  head.assign(BLOCK, 0.0f);
  history.assign(BLOCK * 2, 0.0f);
  previous.assign(BLOCK, 0.0f);
  current.assign(BLOCK, 0.0f);
  tail.assign(BLOCK, 0.0f);
  work.assign(FFT, std::complex<float>(0, 0));
  sum.assign(BINS, std::complex<float>(0, 0));
  if (!taps) return;

  // The first block, turned round so that it runs the same way as the history it meets.
  for (size_t k = 0; k < std::min<size_t>(BLOCK, taps); k++) {
    head[BLOCK - 1 - k] = response[k];
    if (response[k] != 0.0f) headSilent = false;
  }
  parts = taps > BLOCK ? (unsigned)((taps - BLOCK + BLOCK - 1) / BLOCK) : 0;
  spectra.assign((size_t)parts * BINS, std::complex<float>(0, 0));
  inputs.assign((size_t)parts * BINS, std::complex<float>(0, 0));
  for (unsigned p = 0; p < parts; p++) {
    const size_t from = (size_t)BLOCK * (p + 1);
    for (unsigned i = 0; i < FFT; i++) {
      const size_t at = from + i;
      work[i] = std::complex<float>(i < BLOCK && at < taps ? response[at] : 0.0f, 0.0f);
    }
    plan.run(work.data(), false);
    std::copy(work.begin(), work.begin() + BINS, spectra.begin() + (size_t)p * BINS);
  }
  quiet = parts + 2;                                // nothing has been through it yet
}

void Convolver::finishBlock() {
  bool silent = true;
  for (unsigned i = 0; i < BLOCK; i++) if (current[i] != 0.0f) { silent = false; break; }
  quiet = silent ? std::min(quiet + 1, parts + 2) : 0;

  if (!parts || quiet > parts + 1) {
    // Every spectrum still in hand is of silence, so the sum is silence too.
    std::fill(tail.begin(), tail.end(), 0.0f);
  } else {
    for (unsigned i = 0; i < BLOCK; i++) {
      work[i] = std::complex<float>(previous[i], 0.0f);
      work[BLOCK + i] = std::complex<float>(current[i], 0.0f);
    }
    plan.run(work.data(), false);
    newest = (newest + 1) % parts;
    std::copy(work.begin(), work.begin() + BINS, inputs.begin() + (size_t)newest * BINS);

    std::fill(sum.begin(), sum.end(), std::complex<float>(0, 0));
    for (unsigned p = 0; p < parts; p++) {
      const std::complex<float>* x = &inputs[(size_t)((newest + parts - p) % parts) * BINS];
      const std::complex<float>* h = &spectra[(size_t)p * BINS];
      for (unsigned k = 0; k < BINS; k++) {
        sum[k] += std::complex<float>(x[k].real() * h[k].real() - x[k].imag() * h[k].imag(),
                                      x[k].real() * h[k].imag() + x[k].imag() * h[k].real());
      }
    }
    // The other half of the spectrum is the mirror image, because the result is real.
    for (unsigned k = 0; k < BINS; k++) work[k] = sum[k];
    for (unsigned k = 1; k < FFT / 2; k++) work[FFT - k] = std::conj(sum[k]);
    plan.run(work.data(), true);
    const float scale = 1.0f / FFT;
    for (unsigned i = 0; i < BLOCK; i++) tail[i] = work[BLOCK + i].real() * scale;
  }
  previous.swap(current);
  filled = 0;
}

void Convolver::process(const float* in, float* out, unsigned frames) {
  if (!taps) {
    std::memset(out, 0, frames * sizeof(float));
    return;
  }
  while (frames) {
    const unsigned n = std::min(frames, BLOCK - filled);
    for (unsigned i = 0; i < n; i++) {
      const float x = in[i];
      current[filled + i] = x;
      float acc = tail[filled + i];
      if (!headSilent) {
        history[historyAt] = x;
        history[historyAt + BLOCK] = x;
        // The last BLOCK samples, oldest first, are history[historyAt + 1 .. historyAt + BLOCK].
        const float* h = head.data();
        const float* past = &history[historyAt + 1];
        float direct = 0;
        for (unsigned k = 0; k < BLOCK; k++) direct += h[k] * past[k];
        acc += direct;
        historyAt = (historyAt + 1) % BLOCK;
      }
      out[i] = acc;
    }
    filled += n;
    in += n;
    out += n;
    frames -= n;
    if (filled == BLOCK) finishBlock();
  }
}

// ── Echo ────────────────────────────────────────────────────────────────────
Echo::Echo(double sampleRate, double maxSeconds) : rate(sampleRate) {
  line.assign((size_t)std::ceil(maxSeconds * sampleRate) + 4, 0.0f);
}

void Echo::clear() {
  std::fill(line.begin(), line.end(), 0.0f);
  x1 = x2 = y1 = y2 = 0;
}

void Echo::set(double seconds, float feedbackGain, double dampHz, double dampQdB) {
  delayFrames = std::max(1.0, std::min(seconds * rate, (double)line.size() - 3));
  feedback = feedbackGain;
  // The low-pass of the Web Audio API, whose Q is in decibels.
  const double w0 = 2.0 * PI * std::max(1.0, std::min(dampHz, rate * 0.4999)) / rate;
  const double alpha = std::sin(w0) / (2.0 * std::pow(10.0, dampQdB / 20.0));
  const double cosw = std::cos(w0);
  const double a0 = 1.0 + alpha;
  b0 = (1.0 - cosw) / 2.0 / a0;
  b1 = (1.0 - cosw) / a0;
  b2 = (1.0 - cosw) / 2.0 / a0;
  a1 = -2.0 * cosw / a0;
  a2 = (1.0 - alpha) / a0;
}

void Echo::process(const float* in, float* out, unsigned frames) {
  const size_t size = line.size();
  for (unsigned i = 0; i < frames; i++) {
    double position = (double)writeAt + (double)size - delayFrames;
    if (position >= (double)size) position -= (double)size;
    const size_t first = (size_t)position;
    const size_t second = first + 1 < size ? first + 1 : 0;
    const float between = (float)(position - (double)first);
    const float delayed = line[first] + between * (line[second] - line[first]);

    const double y = b0 * delayed + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = delayed;
    y2 = y1; y1 = y;

    line[writeAt] = in[i] + feedback * (float)y;
    writeAt = writeAt + 1 < size ? writeAt + 1 : 0;
    out[i] = (float)y;
  }
  // Numbers too small to hear are costly to keep computing with.
  if (std::fabs(y1) < 1e-30) y1 = 0;
  if (std::fabs(y2) < 1e-30) y2 = 0;
}

// ── Limiter ─────────────────────────────────────────────────────────────────
Limiter::Limiter(double sampleRate, unsigned maxDelayFrames) : rate(sampleRate) {
  lineL.assign(maxDelayFrames + 1, 0.0f);
  lineR.assign(maxDelayFrames + 1, 0.0f);
  set(0, 1.0f, 0.0f, 1.0f, 0.002f, 0.12f);
}

void Limiter::set(unsigned frames, float gain, float thresholdDb, float ratio, float attackSeconds, float releaseSeconds) {
  const unsigned wanted = std::min(frames, (unsigned)lineL.size() - 1);
  if (wanted != delayFrames) {
    delayFrames = wanted;
    std::fill(lineL.begin(), lineL.end(), 0.0f);
    std::fill(lineR.begin(), lineR.end(), 0.0f);
    at = 0;
  }
  makeup = gain;
  threshold = std::pow(10.0f, thresholdDb / 20.0f);
  slope = ratio > 1.0f ? 1.0f - 1.0f / ratio : 0.0f;
  attack = 1.0f - (float)std::exp(-1.0 / (std::max(0.0001f, attackSeconds) * rate));
  release = 1.0f - (float)std::exp(-1.0 / (std::max(0.001f, releaseSeconds) * rate));
}

void Limiter::process(float* left, float* right, unsigned frames) {
  for (unsigned i = 0; i < frames; i++) {
    const float inL = left[i], inR = right[i];
    const float peak = std::max(std::fabs(inL), std::fabs(inR));
    const float target = peak > threshold && slope > 0.0f ? std::pow(threshold / peak, slope) : 1.0f;
    reduction += (target - reduction) * (target < reduction ? attack : release);
    float outL = inL, outR = inR;
    if (delayFrames) {
      outL = lineL[at];
      outR = lineR[at];
      lineL[at] = inL;
      lineR[at] = inR;
      at = at + 1 < delayFrames ? at + 1 : 0;
    }
    left[i] = outL * reduction * makeup;
    right[i] = outR * reduction * makeup;
  }
  if (reduction > 0.999999f) reduction = 1.0f;
}

// ── A plain delay ───────────────────────────────────────────────────────────
void DelayLine::resize(unsigned maxFrames) {
  line.assign((size_t)maxFrames + 1, 0.0f);
  at = 0;
  frames = std::min(frames, maxFrames);
}

void DelayLine::setDelay(unsigned wanted) {
  const unsigned most = line.empty() ? 0 : (unsigned)line.size() - 1;
  wanted = std::min(wanted, most);
  if (wanted == frames) return;
  frames = wanted;
  std::fill(line.begin(), line.end(), 0.0f);
  at = 0;
}

void DelayLine::process(float* samples, unsigned count) {
  if (!frames) return;
  for (unsigned i = 0; i < count; i++) {
    const float out = line[at];
    line[at] = samples[i];
    samples[i] = out;
    at = at + 1 < frames ? at + 1 : 0;
  }
}

}  // namespace cp
