/* ChordPath — native/src/asiohost.cpp
 * See asiohost.h.
 *
 * Also holds a stand-in driver, "ChordPath test driver", that needs no sound
 * card: a thread that asks for blocks at the right pace and hands back as its
 * input whatever was last played. The tests use it to prove this code against
 * the ASIO rules on any computer. It is only on offer when the environment
 * variable CHORDPATH_TEST_AUDIO is set.
 */
#include "asiohost.h"

#include "hostthread.h"

#include <windows.h>
#include <objbase.h>
#include <mmsystem.h>

#include "iasiodrv.h"

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <stdexcept>
#include <thread>

namespace cp {

namespace {

const char* const TEST_DRIVER = "ChordPath test driver";
const unsigned RATES[] = {32000, 44100, 48000, 88200, 96000, 176400, 192000};

std::string narrow(const wchar_t* wide) {
  const int n = WideCharToMultiByte(CP_UTF8, 0, wide, -1, nullptr, 0, nullptr, nullptr);
  if (n <= 1) return std::string();
  std::string out((size_t)n - 1, '\0');
  WideCharToMultiByte(CP_UTF8, 0, wide, -1, &out[0], n, nullptr, nullptr);
  return out;
}

// Asked of Windows itself: a variable set by the running program is not seen by the C library.
bool testing() {
  char flag[8] = {};
  const DWORD length = GetEnvironmentVariableA("CHORDPATH_TEST_AUDIO", flag, sizeof(flag));
  return length > 0 && length < sizeof(flag) && std::strcmp(flag, "0") != 0;
}

// ── What Windows knows to be installed ──────────────────────────────────────
struct Installed {
  std::string name;
  CLSID id;
};

std::vector<Installed> installed() {
  std::vector<Installed> out;
  HKEY root = nullptr;
  if (RegOpenKeyExW(HKEY_LOCAL_MACHINE, L"SOFTWARE\\ASIO", 0, KEY_READ, &root) != ERROR_SUCCESS) return out;
  for (DWORD index = 0;; index++) {
    wchar_t name[256];
    DWORD length = 256;
    if (RegEnumKeyExW(root, index, name, &length, nullptr, nullptr, nullptr, nullptr) != ERROR_SUCCESS) break;
    wchar_t text[64] = {};
    DWORD bytes = sizeof(text) - sizeof(wchar_t);
    if (RegGetValueW(root, name, L"CLSID", RRF_RT_REG_SZ, nullptr, text, &bytes) != ERROR_SUCCESS) continue;
    Installed entry;
    if (CLSIDFromString(text, &entry.id) != S_OK) continue;
    entry.name = narrow(name);
    if (!entry.name.empty()) out.push_back(entry);
  }
  RegCloseKey(root);
  return out;
}

const char* problem(ASIOError error) {
  switch (error) {
    case ASE_NotPresent: return "the hardware is not there";
    case ASE_HWMalfunction: return "the hardware is not working";
    case ASE_InvalidParameter: return "it was asked for something it cannot do";
    case ASE_InvalidMode: return "it is in a mode that does not allow it";
    case ASE_SPNotAdvancing: return "the hardware is not running";
    case ASE_NoClock: return "it has no clock at that rate";
    case ASE_NoMemory: return "there is not enough memory";
    default: return "it gave no reason";
  }
}

// ── Sample formats ──────────────────────────────────────────────────────────
const char* typeName(long type) {
  switch (type) {
    case ASIOSTInt16LSB: return "16-bit";
    case ASIOSTInt24LSB: return "24-bit";
    case ASIOSTInt32LSB: return "32-bit";
    case ASIOSTFloat32LSB: return "32-bit float";
    case ASIOSTFloat64LSB: return "64-bit float";
    case ASIOSTInt32LSB16: return "16-bit in 32";
    case ASIOSTInt32LSB18: return "18-bit in 32";
    case ASIOSTInt32LSB20: return "20-bit in 32";
    case ASIOSTInt32LSB24: return "24-bit in 32";
    default: return nullptr;
  }
}

size_t bytesPerSample(long type) {
  switch (type) {
    case ASIOSTInt16LSB: return 2;
    case ASIOSTInt24LSB: return 3;
    case ASIOSTFloat64LSB: return 8;
    default: return 4;
  }
}

// How many steps make full scale in a format that keeps its samples as whole numbers in 32 bits.
double fullScale(long type) {
  switch (type) {
    case ASIOSTInt32LSB16: return 32768.0;
    case ASIOSTInt32LSB18: return 131072.0;
    case ASIOSTInt32LSB20: return 524288.0;
    case ASIOSTInt32LSB24: return 8388608.0;
    default: return 2147483648.0;
  }
}

void toFloat(long type, const void* from, float* to, unsigned count) {
  switch (type) {
    case ASIOSTInt16LSB: {
      const int16_t* src = static_cast<const int16_t*>(from);
      for (unsigned i = 0; i < count; i++) to[i] = src[i] / 32768.0f;
      break;
    }
    case ASIOSTInt24LSB: {
      const uint8_t* src = static_cast<const uint8_t*>(from);
      for (unsigned i = 0; i < count; i++, src += 3) {
        const int32_t value = (int32_t)((uint32_t)src[0] << 8 | (uint32_t)src[1] << 16 | (uint32_t)src[2] << 24) >> 8;
        to[i] = value / 8388608.0f;
      }
      break;
    }
    case ASIOSTFloat32LSB:
      std::memcpy(to, from, count * sizeof(float));
      break;
    case ASIOSTFloat64LSB: {
      const double* src = static_cast<const double*>(from);
      for (unsigned i = 0; i < count; i++) to[i] = (float)src[i];
      break;
    }
    default: {
      const int32_t* src = static_cast<const int32_t*>(from);
      const double scale = 1.0 / fullScale(type);
      for (unsigned i = 0; i < count; i++) to[i] = (float)(src[i] * scale);
    }
  }
}

void fromFloat(long type, const float* from, void* to, unsigned count) {
  auto whole = [](double value, double most) { return value >= most - 1.0 ? most - 1.0 : value <= -most ? -most : std::nearbyint(value); };
  switch (type) {
    case ASIOSTInt16LSB: {
      int16_t* dst = static_cast<int16_t*>(to);
      for (unsigned i = 0; i < count; i++) dst[i] = (int16_t)whole(from[i] * 32768.0, 32768.0);
      break;
    }
    case ASIOSTInt24LSB: {
      uint8_t* dst = static_cast<uint8_t*>(to);
      for (unsigned i = 0; i < count; i++, dst += 3) {
        const int32_t value = (int32_t)whole(from[i] * 8388608.0, 8388608.0);
        dst[0] = (uint8_t)value;
        dst[1] = (uint8_t)(value >> 8);
        dst[2] = (uint8_t)(value >> 16);
      }
      break;
    }
    case ASIOSTFloat32LSB:
      std::memcpy(to, from, count * sizeof(float));
      break;
    case ASIOSTFloat64LSB: {
      double* dst = static_cast<double*>(to);
      for (unsigned i = 0; i < count; i++) dst[i] = from[i];
      break;
    }
    default: {
      int32_t* dst = static_cast<int32_t*>(to);
      const double most = fullScale(type);
      for (unsigned i = 0; i < count; i++) dst[i] = (int32_t)whole(from[i] * most, most);
    }
  }
}

// ── The stand-in driver ─────────────────────────────────────────────────────
class TestDriver : public IASIO {
 public:
  explicit TestDriver(const std::string& name) {
    if (name.find("(16-bit)") != std::string::npos) type = ASIOSTInt16LSB;
    else if (name.find("(24-bit)") != std::string::npos) type = ASIOSTInt24LSB;
    else if (name.find("(float)") != std::string::npos) type = ASIOSTFloat32LSB;
    stalled = name.find("(stalled)") != std::string::npos;
    fixed = name.find("(fixed)") != std::string::npos;
    resets = name.find("(resets)") != std::string::npos;
    if (fixed) rate = 44100;
  }
  virtual ~TestDriver() { halt(); }

  HRESULT STDMETHODCALLTYPE QueryInterface(REFIID iid, void** object) override {
    if (!object) return E_POINTER;
    if (iid == IID_IUnknown) { *object = static_cast<IUnknown*>(this); AddRef(); return S_OK; }
    *object = nullptr;
    return E_NOINTERFACE;
  }
  ULONG STDMETHODCALLTYPE AddRef() override { return (ULONG)++references; }
  ULONG STDMETHODCALLTYPE Release() override {
    const long left = --references;
    if (!left) delete this;
    return (ULONG)left;
  }

  ASIOBool init(void*) override { return ASIOTrue; }
  void getDriverName(char* name) override { std::strcpy(name, TEST_DRIVER); }
  long getDriverVersion() override { return 1; }
  void getErrorMessage(char* text) override { std::strcpy(text, ""); }

  ASIOError start() override {
    if (!callbacks) return ASE_NotPresent;
    if (running.exchange(true)) return ASE_OK;
    if (!stalled) thread = std::thread([this] { run(); });   // a stalled driver says yes and then never asks for anything
    return ASE_OK;
  }
  ASIOError stop() override { halt(); return ASE_OK; }

  ASIOError getChannels(long* inputs, long* outputs) override { *inputs = 2; *outputs = 2; return ASE_OK; }
  ASIOError getLatencies(long* input, long* output) override {
    *input = size + 16;
    *output = size + 32;
    return ASE_OK;
  }
  ASIOError getBufferSize(long* least, long* most, long* preferred, long* granularity) override {
    *least = fixed ? 256 : 64;
    *most = fixed ? 256 : 2048;
    *preferred = 256;
    *granularity = -1;
    return ASE_OK;
  }
  ASIOError canSampleRate(ASIOSampleRate wanted) override {
    if (fixed) return wanted == 44100 ? ASE_OK : ASE_NoClock;
    return wanted == 44100 || wanted == 48000 || wanted == 88200 || wanted == 96000 ? ASE_OK : ASE_NoClock;
  }
  ASIOError getSampleRate(ASIOSampleRate* current) override { *current = rate; return ASE_OK; }
  ASIOError setSampleRate(ASIOSampleRate wanted) override {
    if (canSampleRate(wanted) != ASE_OK) return ASE_NoClock;
    rate = wanted;
    return ASE_OK;
  }
  ASIOError getClockSources(ASIOClockSource* clocks, long* count) override {
    if (*count < 1) return ASE_InvalidParameter;
    std::memset(clocks, 0, sizeof(ASIOClockSource));
    clocks[0].isCurrentSource = ASIOTrue;
    std::strcpy(clocks[0].name, "Internal");
    *count = 1;
    return ASE_OK;
  }
  ASIOError setClockSource(long) override { return ASE_OK; }
  ASIOError getSamplePosition(ASIOSamples* position, ASIOTimeStamp* stamp) override {
    const uint64_t at = played.load();
    position->hi = (unsigned long)(at >> 32);
    position->lo = (unsigned long)at;
    stamp->hi = stamp->lo = 0;
    return ASE_OK;
  }
  ASIOError getChannelInfo(ASIOChannelInfo* info) override {
    if (info->channel < 0 || info->channel > 1) return ASE_InvalidParameter;
    info->isActive = callbacks ? ASIOTrue : ASIOFalse;
    info->channelGroup = 0;
    info->type = type;
    std::snprintf(info->name, sizeof(info->name), "Test %s %ld", info->isInput ? "in" : "out", info->channel + 1);
    return ASE_OK;
  }
  ASIOError createBuffers(ASIOBufferInfo* infos, long count, long frames, ASIOCallbacks* hostCallbacks) override {
    long least, most, preferred, granularity;
    getBufferSize(&least, &most, &preferred, &granularity);
    if (frames < least || frames > most || (frames & (frames - 1)) != 0 || count < 1 || count > 4 || !hostCallbacks) return ASE_InvalidMode;
    halt();
    size = frames;
    for (long i = 0; i < count; i++) {
      if (infos[i].channelNum < 0 || infos[i].channelNum > 1) return ASE_InvalidParameter;
      std::vector<uint8_t>* pair = infos[i].isInput ? input[infos[i].channelNum] : output[infos[i].channelNum];
      for (int half = 0; half < 2; half++) {
        pair[half].assign((size_t)frames * bytesPerSample(type), 0);
        infos[i].buffers[half] = pair[half].data();
      }
    }
    callbacks = hostCallbacks;
    return ASE_OK;
  }
  ASIOError disposeBuffers() override {
    halt();
    callbacks = nullptr;
    for (auto& pair : input) for (auto& half : pair) half.clear();
    for (auto& pair : output) for (auto& half : pair) half.clear();
    return ASE_OK;
  }
  ASIOError controlPanel() override { return ASE_NotPresent; }
  ASIOError future(long, void*) override { return ASE_NotPresent; }
  ASIOError outputReady() override { return ASE_OK; }

 private:
  std::atomic<long> references{1};
  long type = ASIOSTInt32LSB;
  bool stalled = false, fixed = false, resets = false;
  double rate = 48000;
  long size = 256;
  ASIOCallbacks* callbacks = nullptr;
  std::vector<uint8_t> input[2][2], output[2][2];
  std::thread thread;
  std::atomic<bool> running{false};
  std::atomic<uint64_t> played{0};

  void halt() {
    running.store(false);
    if (thread.joinable()) thread.join();
  }

  void run() {
    timeBeginPeriod(1);
    auto due = std::chrono::steady_clock::now();
    const auto block = std::chrono::nanoseconds((long long)(1e9 * size / rate));
    long half = 0;
    for (uint64_t turn = 0; running.load(); turn++) {
      // What was played last comes back in: a cable from the output to the input.
      for (int channel = 0; channel < 2; channel++) {
        auto& heard = input[channel][half];
        const auto& sent = output[channel][1 - half];
        if (!heard.empty() && heard.size() == sent.size()) std::memcpy(heard.data(), sent.data(), heard.size());
      }
      callbacks->bufferSwitch(half, ASIOTrue);
      played.fetch_add((uint64_t)size);
      if (resets && turn == 40) callbacks->asioMessage(kAsioResetRequest, 0, nullptr, nullptr);
      half = 1 - half;
      due += block;
      const auto now = std::chrono::steady_clock::now();
      if (due < now - std::chrono::milliseconds(200)) due = now;      // fell far behind: do not race to catch up
      std::this_thread::sleep_until(due);
    }
    timeEndPeriod(1);
  }
};

bool isTestDriver(const std::string& name) { return name.compare(0, std::strlen(TEST_DRIVER), TEST_DRIVER) == 0; }

IASIO* load(const std::string& name) {
  if (isTestDriver(name)) {
    if (!testing()) throw std::runtime_error("There is no ASIO driver called \"" + name + "\"");
    return new TestDriver(name);
  }
  for (const auto& entry : installed()) {
    if (entry.name != name) continue;
    IASIO* driver = nullptr;
    // By ASIO's own convention the driver's interface goes by the same number as its class.
    const HRESULT result = CoCreateInstance(entry.id, nullptr, CLSCTX_INPROC_SERVER, entry.id, reinterpret_cast<void**>(&driver));
    if (FAILED(result) || !driver) throw std::runtime_error("The ASIO driver \"" + name + "\" could not be loaded");
    return driver;
  }
  throw std::runtime_error("There is no ASIO driver called \"" + name + "\"");
}

void begin(IASIO* driver, const std::string& name) {
  if (driver->init(hostWindow()) != ASIOTrue) {
    char text[256] = {};
    driver->getErrorMessage(text);
    driver->Release();
    const std::string why = text[0] ? std::string(text) : "it gave no reason";
    throw std::runtime_error("\"" + name + "\" would not start: " + why);
  }
}

AsioDescription ask(IASIO* driver, const std::string& name) {
  AsioDescription d;
  d.name = name;
  long inputs = 0, outputs = 0;
  driver->getChannels(&inputs, &outputs);
  d.inputs = (int)std::max(0L, inputs);
  d.outputs = (int)std::max(0L, outputs);
  for (int direction = 0; direction < 2; direction++) {
    const int count = std::min(direction ? d.inputs : d.outputs, 64);
    for (int channel = 0; channel < count; channel++) {
      ASIOChannelInfo info = {};
      info.channel = channel;
      info.isInput = direction ? ASIOTrue : ASIOFalse;
      std::string label;
      if (driver->getChannelInfo(&info) == ASE_OK) {
        info.name[sizeof(info.name) - 1] = 0;
        label = info.name;
        if (!direction && channel == 0) d.sampleType = typeName(info.type) ? typeName(info.type) : "unknown";
      }
      if (label.empty()) label = (direction ? "Input " : "Output ") + std::to_string(channel + 1);
      (direction ? d.inputNames : d.outputNames).push_back(label);
    }
  }
  ASIOSampleRate rate = 0;
  if (driver->getSampleRate(&rate) == ASE_OK) d.rate = (unsigned)std::lround(rate);
  for (unsigned candidate : RATES) {
    if (driver->canSampleRate((ASIOSampleRate)candidate) == ASE_OK) d.rates.push_back(candidate);
  }
  driver->getBufferSize(&d.minBuffer, &d.maxBuffer, &d.preferredBuffer, &d.granularity);
  return d;
}

// The block size nearest to what was asked that the driver allows.
long fitBuffer(const AsioDescription& d, unsigned wanted) {
  if (!wanted || d.minBuffer >= d.maxBuffer) return d.preferredBuffer > 0 ? d.preferredBuffer : d.minBuffer;
  long size = std::max(d.minBuffer, std::min(d.maxBuffer, (long)wanted));
  if (d.granularity == -1) {
    long best = d.minBuffer;
    for (long power = 1; power <= d.maxBuffer; power <<= 1) {
      if (power >= d.minBuffer && std::labs(power - size) < std::labs(best - size)) best = power;
    }
    size = best;
  } else if (d.granularity > 0) {
    size = d.minBuffer + (size - d.minBuffer + d.granularity / 2) / d.granularity * d.granularity;
    size = std::min(size, d.maxBuffer);
  } else {
    size = d.preferredBuffer;
  }
  return size;
}

}  // namespace

std::vector<std::string> asioDriverNames() {
  std::vector<std::string> names;
  for (const auto& entry : installed()) names.push_back(entry.name);
  if (testing()) {
    for (const char* kind : {"", " (16-bit)", " (24-bit)", " (float)", " (fixed)", " (stalled)", " (resets)"}) {
      names.push_back(std::string(TEST_DRIVER) + kind);
    }
  }
  return names;
}

// ── One open driver ─────────────────────────────────────────────────────────
struct AsioDevice::Impl {
  IASIO* driver = nullptr;
  std::string name;
  Callback callback;
  ASIOBufferInfo buffers[4] = {};
  long types[4] = {};
  int outputs = 0, inputs = 0;
  unsigned frames = 0;
  bool announce = false;                // the driver wants to be told when a block is ready
  std::atomic<bool> running{false};
  std::atomic<bool> reset{false};
  std::atomic<unsigned> overloaded{0};
  std::vector<float> inL, inR, outL, outR;

  // ASIO's callbacks carry no word of whom they are for, so there is one driver at a time.
  static std::atomic<Impl*> active;
  static ASIOCallbacks callbacks;

  void block(long half) {
    if (half < 0 || half > 1) return;
    if (!running.load() || !callback) {
      for (int i = 0; i < outputs; i++) std::memset(buffers[i].buffers[half], 0, (size_t)frames * bytesPerSample(types[i]));
      return;
    }
    if (inputs > 0) toFloat(types[outputs], buffers[outputs].buffers[half], inL.data(), frames);
    if (inputs > 1) toFloat(types[outputs + 1], buffers[outputs + 1].buffers[half], inR.data(), frames);
    callback(inputs > 0 ? inL.data() : nullptr, inputs > 1 ? inR.data() : (inputs > 0 ? inL.data() : nullptr),
             outL.data(), outR.data(), frames);
    fromFloat(types[0], outL.data(), buffers[0].buffers[half], frames);
    fromFloat(types[1], outR.data(), buffers[1].buffers[half], frames);
    if (announce) driver->outputReady();
  }

  static void bufferSwitch(long half, ASIOBool) {
    if (Impl* self = active.load()) self->block(half);
  }
  static ASIOTime* bufferSwitchTimeInfo(ASIOTime*, long half, ASIOBool) {
    if (Impl* self = active.load()) self->block(half);
    return nullptr;
  }
  static void sampleRateDidChange(ASIOSampleRate) {
    if (Impl* self = active.load()) self->reset.store(true);
  }
  static long message(long selector, long value, void*, double*) {
    Impl* self = active.load();
    switch (selector) {
      case kAsioSelectorSupported:
        return value == kAsioEngineVersion || value == kAsioResetRequest || value == kAsioResyncRequest ||
               value == kAsioLatenciesChanged || value == kAsioOverload ? 1 : 0;
      case kAsioEngineVersion:
        return 2;
      case kAsioResetRequest:
      case kAsioLatenciesChanged:
        if (self) self->reset.store(true);
        return 1;
      case kAsioResyncRequest:
      case kAsioOverload:
        if (self) self->overloaded.fetch_add(1);
        return 1;
      default:
        return 0;       // among them kAsioSupportsTimeInfo: the plain callback will do
    }
  }

  void close() {
    if (!driver) return;
    running.store(false);
    driver->stop();
    driver->disposeBuffers();
    Impl* self = this;
    active.compare_exchange_strong(self, nullptr);
    driver->Release();
    driver = nullptr;
    callback = nullptr;
  }
};

std::atomic<AsioDevice::Impl*> AsioDevice::Impl::active{nullptr};
ASIOCallbacks AsioDevice::Impl::callbacks = {
  &AsioDevice::Impl::bufferSwitch, &AsioDevice::Impl::sampleRateDidChange, &AsioDevice::Impl::message, &AsioDevice::Impl::bufferSwitchTimeInfo,
};

AsioDevice::AsioDevice() : impl(new Impl()) {}
AsioDevice::~AsioDevice() {
  if (impl->driver) onHost([this] { impl->close(); });
}

bool AsioDevice::isOpen() const { return impl->driver != nullptr; }
bool AsioDevice::takeResetRequest() { return impl->reset.exchange(false); }
unsigned AsioDevice::overloads() const { return impl->overloaded.load(); }

AsioDescription AsioDevice::describe(const std::string& name) {
  // A driver that is already open answers for itself; loading it a second time upsets some.
  Impl* current = Impl::active.load();
  if (current && current->driver && current->name == name) return ask(current->driver, name);
  IASIO* driver = load(name);
  begin(driver, name);
  AsioDescription d = ask(driver, name);
  driver->Release();
  return d;
}

AsioDescription AsioDevice::open(const std::string& name, unsigned sampleRate, unsigned bufferFrames,
                                 int firstOutput, int firstInput, Callback callback) {
  Impl& m = *impl;
  m.close();
  if (Impl::active.load()) throw std::runtime_error("Another ASIO driver is already open");
  IASIO* driver = load(name);
  begin(driver, name);
  try {
    AsioDescription d = ask(driver, name);
    if (firstOutput < 0 || firstOutput + 2 > d.outputs) throw std::runtime_error("\"" + name + "\" has no stereo output there");
    const bool wantInput = firstInput >= 0 && firstInput < d.inputs;
    const int inputCount = wantInput ? std::min(2, d.inputs - firstInput) : 0;

    if (sampleRate && sampleRate != d.rate && driver->canSampleRate((ASIOSampleRate)sampleRate) == ASE_OK) {
      const ASIOError changed = driver->setSampleRate((ASIOSampleRate)sampleRate);
      if (changed != ASE_OK) throw std::runtime_error("\"" + name + "\" would not switch to " + std::to_string(sampleRate) + " Hz: " + problem(changed));
      ASIOSampleRate now = 0;
      if (driver->getSampleRate(&now) == ASE_OK) d.rate = (unsigned)std::lround(now);
    }
    if (!d.rate) throw std::runtime_error("\"" + name + "\" does not say what rate it runs at");

    int count = 0;
    for (int i = 0; i < 2; i++, count++) {
      m.buffers[count] = {};
      m.buffers[count].isInput = ASIOFalse;
      m.buffers[count].channelNum = firstOutput + i;
    }
    for (int i = 0; i < inputCount; i++, count++) {
      m.buffers[count] = {};
      m.buffers[count].isInput = ASIOTrue;
      m.buffers[count].channelNum = firstInput + i;
    }
    for (int i = 0; i < count; i++) {
      ASIOChannelInfo info = {};
      info.channel = m.buffers[i].channelNum;
      info.isInput = m.buffers[i].isInput;
      if (driver->getChannelInfo(&info) != ASE_OK || !typeName(info.type)) {
        throw std::runtime_error("\"" + name + "\" uses a sample format ChordPath does not know");
      }
      m.types[i] = info.type;
    }

    long frames = fitBuffer(d, bufferFrames);
    m.driver = driver;
    m.name = name;
    m.outputs = 2;
    m.inputs = inputCount;
    m.callback = nullptr;
    m.running.store(false);
    m.reset.store(false);
    m.overloaded.store(0);
    Impl::active.store(&m);
    ASIOError made = driver->createBuffers(m.buffers, count, frames, &Impl::callbacks);
    if (made != ASE_OK && frames != d.preferredBuffer && d.preferredBuffer > 0) {
      // Some drivers list a range of sizes and then take only their favourite.
      frames = d.preferredBuffer;
      made = driver->createBuffers(m.buffers, count, frames, &Impl::callbacks);
    }
    if (made != ASE_OK) {
      Impl::active.store(nullptr);
      m.driver = nullptr;
      throw std::runtime_error("\"" + name + "\" would not set up its buffers: " + problem(made));
    }
    m.frames = (unsigned)frames;
    for (auto* buffer : {&m.inL, &m.inR, &m.outL, &m.outR}) buffer->assign((size_t)frames, 0.0f);
    m.callback = std::move(callback);
    driver->getLatencies(&d.inputLatency, &d.outputLatency);
    m.announce = driver->outputReady() == ASE_OK;
    d.bufferFrames = m.frames;
    d.inputs = inputCount;       // what was opened, not what there is
    return d;
  } catch (...) {
    if (m.driver == driver) {
      driver->disposeBuffers();
      Impl* self = &m;
      Impl::active.compare_exchange_strong(self, nullptr);
      m.driver = nullptr;
    }
    driver->Release();
    throw;
  }
}

void AsioDevice::start() {
  Impl& m = *impl;
  if (!m.driver) throw std::runtime_error("No ASIO driver is open");
  m.running.store(true);
  const ASIOError started = m.driver->start();
  if (started != ASE_OK) {
    m.running.store(false);
    throw std::runtime_error(std::string("The driver would not start playing: ") + problem(started));
  }
}

void AsioDevice::close() { impl->close(); }

bool AsioDevice::showControlPanel() {
  return impl->driver && impl->driver->controlPanel() == ASE_OK;
}

}  // namespace cp
