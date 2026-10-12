/* ChordPath — native/src/asiohost.h
 * Talks to ASIO sound-card drivers directly.
 *
 * An ASIO driver is a small program from the card's maker that hands audio
 * over with very little delay. One is loaded only when it is chosen: merely
 * listing what is installed reads their names from Windows and touches no
 * driver. Everything here except the audio itself happens on the host thread
 * (see hostthread.h), which gives the driver the window and message loop it
 * expects from an application.
 */
#pragma once

#include <functional>
#include <memory>
#include <string>
#include <vector>

namespace cp {

// The ASIO drivers installed on this computer, by name.
std::vector<std::string> asioDriverNames();

struct AsioDescription {
  std::string name;
  int inputs = 0, outputs = 0;
  std::vector<std::string> inputNames, outputNames;
  unsigned rate = 0;                    // what it is running at
  std::vector<unsigned> rates;          // what it will accept
  long minBuffer = 0, maxBuffer = 0, preferredBuffer = 0, granularity = 0;
  // Filled in once opened:
  unsigned bufferFrames = 0;
  long inputLatency = 0, outputLatency = 0;
  std::string sampleType;
};

class AsioDevice {
 public:
  // Called on the driver's own thread for every block. inL/inR are null
  // when no input was asked for; outL/outR are to be filled.
  using Callback = std::function<void(const float* inL, const float* inR, float* outL, float* outR, unsigned frames)>;

  AsioDevice();
  ~AsioDevice();
  AsioDevice(const AsioDevice&) = delete;
  AsioDevice& operator=(const AsioDevice&) = delete;

  // Host thread. Loads the driver for a moment to ask what it can do.
  static AsioDescription describe(const std::string& name);

  // Host thread. sampleRate 0 keeps the driver's own; one it will not do also
  // keeps its own (the answer says which). bufferFrames 0 takes its
  // preferred size. firstInput -1 opens no input. Throws std::runtime_error
  // with the reason when the driver will not open.
  AsioDescription open(const std::string& name, unsigned sampleRate, unsigned bufferFrames,
                       int firstOutput, int firstInput, Callback callback);
  void start();
  void close();
  bool isOpen() const;
  // The driver's own settings window.
  bool showControlPanel();

  // Any thread.
  bool takeResetRequest();      // the driver wants closing and opening again: its settings changed
  unsigned overloads() const;   // times the driver said it could not keep up

 private:
  struct Impl;
  std::unique_ptr<Impl> impl;
};

}  // namespace cp
