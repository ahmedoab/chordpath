/* ChordPath — native/src/dsp.h
 * The mixer's building blocks: a convolution reverb, an echo, a limiter and
 * the delay lines that keep tracks in step. Each is made to match what the
 * web page's own engine does with the same settings, so a song sounds the
 * same whichever of the two is mixing it.
 *
 * Nothing here allocates memory once it has been set up, so all of it is
 * safe to run on the sound card's thread.
 */
#pragma once

#include <complex>
#include <cstddef>
#include <cstdint>
#include <vector>

namespace cp {

// ── FFT ─────────────────────────────────────────────────────────────────────
// A plan for transforms of one power-of-two size, in place. The inverse is
// left unscaled.
class Fft {
 public:
  explicit Fft(unsigned size);
  void run(std::complex<float>* data, bool inverse) const;
  unsigned size() const { return n; }

 private:
  unsigned n;
  std::vector<unsigned> swaps;                      // pairs of places to exchange before the passes
  std::vector<std::complex<float>> twiddles;        // e^(-2πik/n) for k < n/2
};

// ── Convolution ─────────────────────────────────────────────────────────────
// Passes sound through an impulse response (a recorded or generated room)
// with no added delay. The response is cut into blocks handled with FFTs,
// except its first block, which is applied directly.
class Convolver {
 public:
  // `response` may be any length; an empty one gives silence.
  Convolver(const float* response, size_t length);
  // out = in ⊛ response, for any number of frames. `in` and `out` may not overlap.
  void process(const float* in, float* out, unsigned frames);
  size_t length() const { return taps; }

 private:
  static const unsigned BLOCK = 512;
  static const unsigned FFT = 1024;
  static const unsigned BINS = FFT / 2 + 1;

  size_t taps = 0;
  unsigned parts = 0;                               // FFT blocks after the first
  bool headSilent = true;
  std::vector<float> head;                          // the first BLOCK taps, newest-first ready
  std::vector<std::complex<float>> spectra;         // parts × BINS: each later block of the response
  std::vector<std::complex<float>> inputs;          // parts × BINS: the last `parts` input spectra, going round
  unsigned newest = 0;                              // where in `inputs` the latest spectrum is
  std::vector<float> history;                       // the last BLOCK input samples, written twice so they are always in one run
  unsigned historyAt = 0;
  std::vector<float> previous, current;             // the input block before this one, and this one as it fills
  unsigned filled = 0;
  std::vector<float> tail;                          // what the FFT blocks add to the block now being played
  unsigned quiet = 0;                               // input blocks in a row that were silent
  std::vector<std::complex<float>> work, sum;
  Fft plan{FFT};

  void finishBlock();
};

// ── Echo ────────────────────────────────────────────────────────────────────
// One channel of a feedback delay with a low-pass filter in the loop: what
// the page builds from a DelayNode, a BiquadFilterNode and a GainNode.
class Echo {
 public:
  Echo(double sampleRate, double maxSeconds);
  void set(double seconds, float feedback, double dampHz, double dampQdB);
  void process(const float* in, float* out, unsigned frames);
  void clear();

 private:
  double rate;
  std::vector<float> line;
  size_t writeAt = 0;
  double delayFrames = 1;
  float feedback = 0;
  double b0 = 1, b1 = 0, b2 = 0, a1 = 0, a2 = 0;
  double x1 = 0, x2 = 0, y1 = 0, y2 = 0;
};

// ── Limiter ─────────────────────────────────────────────────────────────────
// Looks a few milliseconds ahead and turns the level down just before a peak
// would go over. Below its threshold it is a fixed gain and a fixed delay.
class Limiter {
 public:
  Limiter(double sampleRate, unsigned maxDelayFrames);
  void set(unsigned delayFrames, float gain, float thresholdDb, float ratio, float attackSeconds, float releaseSeconds);
  void process(float* left, float* right, unsigned frames);
  unsigned delay() const { return delayFrames; }

 private:
  double rate;
  std::vector<float> lineL, lineR;
  size_t at = 0;
  unsigned delayFrames = 0;
  float makeup = 1, threshold = 1, slope = 0, attack = 1, release = 1;
  float reduction = 1;
};

// ── A plain delay ───────────────────────────────────────────────────────────
// Holds sound back by a whole number of frames, to line a track up with
// others whose plugins take longer.
class DelayLine {
 public:
  void resize(unsigned maxFrames);
  void setDelay(unsigned frames);
  unsigned delay() const { return frames; }
  void process(float* samples, unsigned count);

 private:
  std::vector<float> line;
  size_t at = 0;
  unsigned frames = 0;
};

}  // namespace cp
