/* ChordPath — native/src/mixer.h
 * The mixing desk behind the plugins.
 *
 * The web page makes each track's sound (its notes, recordings, tone
 * controls and compressor) and hands it over as a stereo "feed". From there
 * on the desk is this one: the track's plugins, its fader and pan, its sends
 * to the shared reverb and echo, the master's own plugins, the master fader
 * and the limiter. Doing all of that here is what lets a plugin sit where it
 * belongs — before the fader and before the sends.
 *
 * The reverb, echo, pan law and fader glides follow the page's own engine,
 * so a song without plugins comes out the same from either.
 *
 * One Mixer serves a sound card (see audio.h); another, made for the
 * occasion, mixes a song down to a file.
 */
#pragma once

#include "vsthost.h"

#include <cstddef>
#include <cstdint>
#include <memory>
#include <vector>

namespace cp {

struct ChainSlot {
  uint32_t id = 0;                      // the name notes are addressed to
  std::shared_ptr<Plugin> plugin;
};
using Chain = std::vector<ChainSlot>;

struct StripSettings {
  bool active = false;      // a track is using this strip
  float gain = 1;           // the fader as a plain multiplier; 0 when muted
  float pan = 0;            // -1 left … 1 right
  float reverb = 0;         // send levels, taken after the fader and pan
  float echo = 0;
};

struct MasterSettings {
  float gain = 1;
  float reverbReturn = 3;
  double echoSeconds = 0.375;
  float echoFeedback = 0.34f;
  double echoDampHz = 3400;
  double echoDampQ = 0.5;             // in decibels, as the Web Audio low-pass has it
  unsigned limiterDelay = 0;          // frames the limiter looks ahead
  float limiterGain = 1;              // what it adds below its threshold
  float limiterThresholdDb = -1.5f;
  float limiterRatio = 20;
  float limiterAttack = 0.002f;
  float limiterRelease = 0.12f;
};

struct NoteEvent {
  uint64_t frame = 0;       // place in the stream of feeds; 0 = as soon as possible
  uint32_t plugin = 0;      // the ChainSlot id of the instrument it is for
  bool on = false;
  int pitch = 60;
  float velocity = 0.8f;
};

class Mixer {
 public:
  // `strips` track strips, each fed in stereo, plus one "direct" feed that
  // joins after the master fader (the metronome).
  Mixer(int strips, double sampleRate, unsigned maxBlock);
  ~Mixer();
  Mixer(const Mixer&) = delete;
  Mixer& operator=(const Mixer&) = delete;

  int strips() const;
  double sampleRate() const;
  // Floats in one frame of feeds: left and right for every strip, then the direct feed.
  unsigned width() const;

  // ── The controlling thread ──
  void setStrip(int strip, const StripSettings& settings);
  void setMaster(const MasterSettings& settings);
  // The room: an impulse response for each side, already scaled.
  void setReverb(const float* left, const float* right, size_t length);
  // strip -1 is the master. Takes effect at the next block.
  void setChain(int strip, const Chain& chain);
  // Passes the card's input through one strip (its plugins, fader and sends); -1 for none.
  void setMonitor(int strip, float gain);
  void setTransport(const Transport& transport);
  // False when too many notes are already waiting.
  bool schedule(const NoteEvent& event);
  void clearEvents();
  // Jumps every gliding control to where it is headed (before a mixdown).
  void snap();
  // How many frames later the mix comes out than its feeds went in.
  unsigned latencyFrames() const;
  // Highest level since the last call: left and right for each strip, then the master.
  std::vector<float> takePeaks();

  // ── The audio thread ──
  // feeds: `frames` frames of width() floats each, or null for silence.
  // inL/inR: the card's input, or null. The first `streamFrames` frames are
  // stream frames `streamFrame` onward; any after them are padding.
  // At most `maxBlock` frames at a time.
  void process(const float* feeds, const float* inL, const float* inR, float* outL, float* outR,
               unsigned frames, uint64_t streamFrame, unsigned streamFrames);

 private:
  struct Impl;
  std::unique_ptr<Impl> impl;
};

}  // namespace cp
