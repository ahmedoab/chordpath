/* ChordPath — native/src/vsthost.h
 * Loads VST 3 plugins and runs audio through them.
 *
 * A Plugin is one loaded instance: an effect that audio passes through, or
 * an instrument that turns notes into audio. Everything here is plain C++;
 * the JavaScript side lives in addon.cpp.
 *
 * Threads: process() is the only call meant for the audio thread. Notes and
 * parameter changes may come from any thread and are handed to the next
 * process() call. Everything else belongs to the thread that loaded the
 * plugin (in the app, the main one, which also owns its editor window).
 */
#pragma once

#include <cstdint>
#include <memory>
#include <string>
#include <vector>

namespace cp {

struct PluginDescription {
  std::string path;       // the .vst3 file or bundle
  std::string uid;        // which plugin inside it (a file can hold several)
  std::string name;
  std::string vendor;
  std::string version;
  std::string category;   // the plugin's own sub-categories, e.g. "Fx|Reverb"
  bool instrument = false;
};

struct ParamDescription {
  uint32_t id = 0;
  std::string title;
  std::string units;
  double value = 0;         // 0..1
  double defaultValue = 0;  // 0..1
  int steps = 0;            // 0 = continuous, 1 = on/off, n = n + 1 positions
  bool automatable = true;
  bool hidden = false;
};

struct Transport {
  double tempo = 120;
  bool playing = false;
  double positionBeats = 0;
  int meterNum = 4;
  int meterDen = 4;
};

// Where VST 3 plugins are installed on this computer.
std::vector<std::string> pluginPaths();

// The plugins inside one .vst3. Loads the file, so a broken plugin can throw
// (or take the process down): scanning is done in a process of its own.
std::vector<PluginDescription> describePlugins(const std::string& path);

class Plugin {
 public:
  // Throws std::runtime_error with a readable reason when the plugin cannot be loaded.
  static std::unique_ptr<Plugin> load(const std::string& path, const std::string& uid, double sampleRate, int maxBlock);
  ~Plugin();
  Plugin(const Plugin&) = delete;
  Plugin& operator=(const Plugin&) = delete;

  const PluginDescription& description() const;
  int inputChannels() const;      // of its main audio input; 0 for most instruments
  int outputChannels() const;
  int latencySamples() const;
  double tailSeconds() const;     // how long it rings after the input stops; < 0 = for ever
  bool hasEditor() const;

  // Audio thread. Stereo, in place: left and right hold the input and are
  // overwritten with the output. Any number of frames.
  void process(float* left, float* right, int frames);

  // Any thread; takes effect in the next process() call.
  void noteOn(int pitch, float velocity, int sampleOffset);
  void noteOff(int pitch, int sampleOffset);
  void allNotesOff();
  void setParam(uint32_t id, double value);
  void setTransport(const Transport& transport);
  void setBypassed(bool bypassed);
  bool bypassed() const;

  // Main thread.
  std::vector<ParamDescription> parameters() const;
  double getParam(uint32_t id) const;
  std::string paramText(uint32_t id, double value) const;
  std::vector<uint8_t> getState() const;
  bool setState(const uint8_t* data, size_t size);
  // Offline rendering wants every block computed in full; live playing does not.
  void setOffline(bool offline);

  bool openEditor(const std::string& title, bool visible);
  void closeEditor();
  bool editorOpen() const;
  void editorSize(int& width, int& height) const;

 private:
  Plugin();
  struct Impl;
  std::unique_ptr<Impl> impl;
};

// Gives windows on the calling thread a chance to work for a moment. The app
// has a message loop of its own; this is for tests that run without one.
void pumpMessages(int milliseconds);

}  // namespace cp
