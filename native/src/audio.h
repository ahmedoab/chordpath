/* ChordPath — native/src/audio.h
 * The sound card, and the stream of audio that feeds its mixer.
 *
 * The web page makes each track's sound and sends it here in lumps, from
 * another process. The sound card, on its own thread, asks for a block at a
 * time and must never be kept waiting, so a short stretch of the stream is
 * always held in hand (the prebuffer). The page's clock and the card's are
 * two different clocks, however slightly: when the stretch in hand creeps
 * longer or shorter, a single frame is squeezed in or out, smoothly, to
 * bring it back. When the clocks agree the audio passes through untouched.
 *
 * Cards are reached two ways: ASIO, straight to the maker's driver, for low
 * delay; and WASAPI (through RtAudio) for anything Windows can play through.
 */
#pragma once

#include "asiohost.h"
#include "mixer.h"

#include <cstdint>
#include <memory>
#include <string>
#include <vector>

namespace cp {

struct SoundDevice {
  std::string name;
  int outputs = 0;
  int inputs = 0;
  bool defaultOutput = false;
  bool defaultInput = false;
  unsigned preferredRate = 0;
  std::vector<unsigned> rates;
};

// What Windows itself can play through and record from.
std::vector<SoundDevice> windowsDevices();

struct OpenRequest {
  std::string api;            // "asio" or "wasapi"
  std::string device;         // ASIO: the driver. WASAPI: the output, "" for the default one
  bool useInput = false;
  std::string input;          // WASAPI: the input to open, "" for the default one
  int firstOutput = 0;        // ASIO: which pair of the card's channels
  int firstInput = 0;
  unsigned sampleRate = 0;    // 0 = whatever the card is set to
  unsigned bufferFrames = 0;  // 0 = whatever the card prefers
  int strips = 8;             // track strips in the mixer
  unsigned prebufferFrames = 0;   // 0 = a sensible stretch for the rate
  bool muted = false;         // do everything, but send the card silence (tests)
};

struct OpenResult {
  std::string api, device;
  unsigned sampleRate = 0;
  unsigned bufferFrames = 0;
  unsigned prebufferFrames = 0;
  long outputLatency = 0;     // frames, as the driver reports them (0 when it does not say)
  long inputLatency = 0;
  int inputs = 0;             // input channels that were opened
  int strips = 0;
  AsioDescription asio;       // ASIO only: what else the driver offers
};

struct IoStatus {
  bool open = false;
  bool flowing = false;       // the stream is being played, not waited for
  uint64_t received = 0;      // stream frames taken in
  uint64_t played = 0;        // stream frames that have been mixed
  uint64_t lost = 0;          // stream frames turned away because there was no room
  unsigned buffered = 0;      // frames in hand
  unsigned underruns = 0;     // times the stream ran dry
  unsigned slips = 0;         // frames squeezed in or out to keep the clocks together
  uint64_t blocks = 0;        // blocks the card has asked for
  uint64_t cardFrames = 0;    // frames the card has played since it was opened
  double load = 0;            // share of each block's time spent working, 0..1
  double idleSeconds = 0;     // since the card last asked for a block
  unsigned latencyFrames = 0; // how much later the mix comes out than its feeds went in
  unsigned overloads = 0;     // times an ASIO driver said it could not keep up
  bool resetWanted = false;   // an ASIO driver's settings changed: close it and open it again
  std::vector<float> peaks;   // left and right for each strip, then the master
};

class AudioIO {
 public:
  AudioIO();
  ~AudioIO();
  AudioIO(const AudioIO&) = delete;
  AudioIO& operator=(const AudioIO&) = delete;

  // Host thread. Throws std::runtime_error with the reason when the card will not open.
  OpenResult open(const OpenRequest& request);
  void close();
  bool showControlPanel();

  bool isOpen() const;
  // The desk the card plays from; null while closed.
  Mixer* mixer();

  // Takes in the next `frames` frames of the stream. Each frame holds left and
  // right for every strip listed in `slots` (the number of strips itself names
  // the direct feed); strips not listed are silent. All of it is taken, or
  // none: returns false when there was no room.
  bool push(const float* samples, unsigned frames, const int* slots, unsigned slotCount);
  // Throws away what is in hand and waits for the prebuffer to fill again.
  void flush();

  // While paused the card is given silence and the mixer and its plugins are
  // left alone (so that they can be used for a mixdown). Returns once the
  // audio thread has taken notice.
  void setPaused(bool paused);

  // Keeps the card's input for collecting with readInput().
  void setRecording(bool on);
  struct Take {
    unsigned frames = 0;
    uint64_t streamAt = 0;      // the stream frame being mixed as the first of these arrived
    uint64_t cardAt = 0;        // the card frame at that moment
  };
  Take readInput(float* left, float* right, unsigned frames);

  // The newest frames of the finished mix (what went, or would have gone, to
  // the card). Returns how many were copied, newest last.
  unsigned capture(float* left, float* right, unsigned frames);

  IoStatus status();

 private:
  struct Impl;
  std::unique_ptr<Impl> impl;
};

}  // namespace cp
