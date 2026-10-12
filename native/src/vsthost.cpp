/* ChordPath — native/src/vsthost.cpp
 * See vsthost.h. Built on the hosting helpers of Steinberg's VST 3 SDK.
 */
#include "vsthost.h"

#include "public.sdk/source/common/memorystream.h"
#include "public.sdk/source/vst/hosting/eventlist.h"
#include "public.sdk/source/vst/hosting/hostclasses.h"
#include "public.sdk/source/vst/hosting/module.h"
#include "public.sdk/source/vst/hosting/parameterchanges.h"
#include "public.sdk/source/vst/hosting/plugprovider.h"
#include "public.sdk/source/vst/hosting/processdata.h"
#include "public.sdk/source/vst/utility/stringconvert.h"
#include "pluginterfaces/gui/iplugview.h"
#include "pluginterfaces/gui/iplugviewcontentscalesupport.h"
#include "pluginterfaces/vst/ivstaudioprocessor.h"
#include "pluginterfaces/vst/ivstcomponent.h"
#include "pluginterfaces/vst/ivsteditcontroller.h"
#include "pluginterfaces/vst/ivstevents.h"
#include "pluginterfaces/vst/ivstprocesscontext.h"

#include <windows.h>

#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstring>
#include <map>
#include <mutex>
#include <stdexcept>

using namespace Steinberg;
using namespace Steinberg::Vst;

namespace cp {

namespace {

// What plugins see when they ask who is hosting them.
class Host : public HostApplication {
 public:
  tresult PLUGIN_API getName(String128 name) override {
    return StringConvert::convert("ChordPath", name) ? kResultTrue : kInternalError;
  }
};

void ensureHostContext() {
  static Host host;
  static bool told = false;
  if (!told) {
    PluginContextFactory::instance().setPluginContext(&host);
    told = true;
  }
}

// A plugin file stays loaded once used: instances share it, and unloading a
// plugin's code while anything of it might still run is asking for a crash.
VST3::Hosting::Module::Ptr moduleAt(const std::string& path) {
  static std::map<std::string, VST3::Hosting::Module::Ptr> loaded;
  auto found = loaded.find(path);
  if (found != loaded.end()) return found->second;
  std::string error;
  auto module = VST3::Hosting::Module::create(path, error);
  if (!module) throw std::runtime_error(error.empty() ? "The plugin file could not be loaded" : error);
  loaded[path] = module;
  return module;
}

PluginDescription describe(const std::string& path, const VST3::Hosting::ClassInfo& info) {
  PluginDescription d;
  d.path = path;
  d.uid = info.ID().toString();
  d.name = info.name();
  d.vendor = info.vendor();
  d.version = info.version();
  d.category = info.subCategoriesString();
  const auto& subs = info.subCategories();
  d.instrument = std::find(subs.begin(), subs.end(), "Instrument") != subs.end();
  return d;
}

const wchar_t* const WINDOW_CLASS = L"ChordPathPluginEditor";

std::wstring widen(const std::string& utf8) {
  if (utf8.empty()) return std::wstring();
  const int n = MultiByteToWideChar(CP_UTF8, 0, utf8.data(), (int)utf8.size(), nullptr, 0);
  std::wstring out(n, L'\0');
  MultiByteToWideChar(CP_UTF8, 0, utf8.data(), (int)utf8.size(), &out[0], n);
  return out;
}

}  // namespace

std::vector<std::string> pluginPaths() {
  return VST3::Hosting::Module::getModulePaths();
}

std::vector<PluginDescription> describePlugins(const std::string& path) {
  ensureHostContext();
  auto module = moduleAt(path);
  std::vector<PluginDescription> out;
  for (const auto& info : module->getFactory().classInfos()) {
    if (info.category() == kVstAudioEffectClass) out.push_back(describe(path, info));
  }
  return out;
}

// ── One loaded plugin ───────────────────────────────────────────────────────
struct Plugin::Impl : public IComponentHandler, public IPlugFrame {
  PluginDescription desc;
  VST3::Hosting::Module::Ptr module;
  IPtr<PlugProvider> provider;
  IPtr<IComponent> component;
  IPtr<IEditController> controller;
  IPtr<IAudioProcessor> processor;

  HostProcessData data;
  EventList events{512};
  EventList eventsOut{64};
  ParameterChanges paramsIn;
  ParameterChanges paramsOut;
  ProcessContext context{};

  double sampleRate = 44100;
  int maxBlock = 512;
  int inCh = 0, outCh = 0;
  bool prepared = false;
  bool running = false;
  bool offline = false;
  std::atomic<bool> bypass{false};

  // Handed over from other threads to the next process() call.
  struct Note { bool on; int pitch; float velocity; int offset; };
  std::mutex pendingLock;
  std::vector<Note> pendingNotes;
  std::vector<std::pair<ParamID, ParamValue>> pendingParams;
  Transport transport;
  double positionSamples = 0;

  IPtr<IPlugView> view;
  HWND window = nullptr;

  // ── What the plugin may ask of its host ──
  tresult PLUGIN_API beginEdit(ParamID) override { return kResultOk; }
  tresult PLUGIN_API performEdit(ParamID id, ParamValue value) override {
    // A control was moved in the plugin's own window: the sound has to follow.
    std::lock_guard<std::mutex> lock(pendingLock);
    pendingParams.emplace_back(id, value);
    return kResultOk;
  }
  tresult PLUGIN_API endEdit(ParamID) override { return kResultOk; }
  tresult PLUGIN_API restartComponent(int32) override { return kResultOk; }

  tresult PLUGIN_API resizeView(IPlugView* which, ViewRect* size) override {
    if (!window || !size || which != view.get()) return kInvalidArgument;
    fitWindow(size->getWidth(), size->getHeight());
    return which->onSize(size);
  }

  tresult PLUGIN_API queryInterface(const TUID iid, void** obj) override {
    if (FUnknownPrivate::iidEqual(iid, IComponentHandler::iid) || FUnknownPrivate::iidEqual(iid, FUnknown::iid)) {
      *obj = static_cast<IComponentHandler*>(this);
      return kResultOk;
    }
    if (FUnknownPrivate::iidEqual(iid, IPlugFrame::iid)) {
      *obj = static_cast<IPlugFrame*>(this);
      return kResultOk;
    }
    *obj = nullptr;
    return kNoInterface;
  }
  // Owned by the Plugin, not counted.
  uint32 PLUGIN_API addRef() override { return 1; }
  uint32 PLUGIN_API release() override { return 1; }

  // ── Audio set-up ──
  void start() {
    ProcessSetup setup{offline ? kOffline : kRealtime, kSample32, maxBlock, sampleRate};
    processor->setupProcessing(setup);
    component->setActive(true);
    processor->setProcessing(true);
    running = true;
  }
  void stop() {
    if (!running) return;
    processor->setProcessing(false);
    component->setActive(false);
    running = false;
  }

  void prepare() {
    // Ask for stereo in and out on the main buses; a plugin that will not
    // have it keeps its own layout and is adapted to in process().
    const int32 ins = component->getBusCount(kAudio, kInput);
    const int32 outs = component->getBusCount(kAudio, kOutput);
    std::vector<SpeakerArrangement> inArr(ins), outArr(outs);
    for (int32 i = 0; i < ins; i++) processor->getBusArrangement(kInput, i, inArr[i]);
    for (int32 i = 0; i < outs; i++) processor->getBusArrangement(kOutput, i, outArr[i]);
    if (ins > 0) inArr[0] = SpeakerArr::kStereo;
    if (outs > 0) outArr[0] = SpeakerArr::kStereo;
    processor->setBusArrangements(ins ? inArr.data() : nullptr, ins, outs ? outArr.data() : nullptr, outs);

    for (int32 i = 0; i < ins; i++) component->activateBus(kAudio, kInput, i, i == 0);
    for (int32 i = 0; i < outs; i++) component->activateBus(kAudio, kOutput, i, i == 0);
    const int32 eventIns = component->getBusCount(kEvent, kInput);
    for (int32 i = 0; i < eventIns; i++) component->activateBus(kEvent, kInput, i, true);

    BusInfo bus{};
    inCh = ins > 0 && component->getBusInfo(kAudio, kInput, 0, bus) == kResultOk ? bus.channelCount : 0;
    outCh = outs > 0 && component->getBusInfo(kAudio, kOutput, 0, bus) == kResultOk ? bus.channelCount : 0;

    start();
    data.prepare(*component, maxBlock, kSample32);
    data.inputEvents = &events;
    data.outputEvents = &eventsOut;
    data.inputParameterChanges = &paramsIn;
    data.outputParameterChanges = &paramsOut;
    data.processContext = &context;
    data.processMode = offline ? kOffline : kRealtime;
    prepared = true;
  }

  // ── Editor window ──
  void fitWindow(int width, int height) {
    RECT r{0, 0, width, height};
    AdjustWindowRectEx(&r, (DWORD)GetWindowLongPtrW(window, GWL_STYLE), FALSE, (DWORD)GetWindowLongPtrW(window, GWL_EXSTYLE));
    SetWindowPos(window, nullptr, 0, 0, r.right - r.left, r.bottom - r.top, SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE);
  }

  void closeEditor() {
    if (view) {
      view->setFrame(nullptr);
      view->removed();
      view = nullptr;
    }
    if (window) {
      HWND w = window;
      window = nullptr;
      SetWindowLongPtrW(w, GWLP_USERDATA, 0);
      DestroyWindow(w);
    }
  }

  static LRESULT CALLBACK windowProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam) {
    auto* self = reinterpret_cast<Impl*>(GetWindowLongPtrW(hwnd, GWLP_USERDATA));
    if (self && self->window == hwnd) {
      if (message == WM_CLOSE) {
        self->closeEditor();
        return 0;
      }
      if (message == WM_SIZE && self->view && self->view->canResize() == kResultTrue) {
        ViewRect r(0, 0, LOWORD(lParam), HIWORD(lParam));
        self->view->onSize(&r);
      }
    }
    return DefWindowProcW(hwnd, message, wParam, lParam);
  }
};

Plugin::Plugin() : impl(new Impl()) {}

Plugin::~Plugin() {
  Impl& p = *impl;
  p.closeEditor();
  if (p.controller) p.controller->setComponentHandler(nullptr);
  if (p.prepared) {
    p.stop();
    p.data.unprepare();
  }
  p.processor = nullptr;
  p.controller = nullptr;
  p.component = nullptr;
  p.provider = nullptr;       // terminates the plugin
}

std::unique_ptr<Plugin> Plugin::load(const std::string& path, const std::string& uid, double sampleRate, int maxBlock) {
  ensureHostContext();
  auto module = moduleAt(path);
  const auto& factory = module->getFactory();
  const VST3::Hosting::ClassInfo* chosen = nullptr;
  const auto infos = factory.classInfos();
  for (const auto& info : infos) {
    if (info.category() != kVstAudioEffectClass) continue;
    if (uid.empty() || info.ID().toString() == uid) { chosen = &info; break; }
  }
  if (!chosen) throw std::runtime_error("That plugin is not in the file");

  std::unique_ptr<Plugin> plugin(new Plugin());
  Impl& p = *plugin->impl;
  p.module = module;
  p.desc = describe(path, *chosen);
  p.sampleRate = sampleRate > 0 ? sampleRate : 44100;
  p.maxBlock = std::max(16, std::min(maxBlock > 0 ? maxBlock : 512, 8192));

  p.provider = owned(new PlugProvider(factory, *chosen, true));
  if (!p.provider->initialize()) throw std::runtime_error("The plugin would not start");
  p.component = p.provider->getComponentPtr();
  p.controller = p.provider->getControllerPtr();
  if (!p.component) throw std::runtime_error("The plugin would not start");
  p.processor = FUnknownPtr<IAudioProcessor>(p.component);
  if (!p.processor) throw std::runtime_error("The plugin does not process audio");
  if (p.processor->canProcessSampleSize(kSample32) != kResultTrue) throw std::runtime_error("The plugin cannot work with 32-bit audio");

  if (p.controller) {
    p.controller->setComponentHandler(&p);
    // The plugin's controls start out showing what its sound engine holds.
    MemoryStream state;
    if (p.component->getState(&state) == kResultOk) {
      state.seek(0, IBStream::kIBSeekSet, nullptr);
      p.controller->setComponentState(&state);
    }
  }
  p.context.sampleRate = p.sampleRate;
  p.context.tempo = 120;
  p.context.timeSigNumerator = 4;
  p.context.timeSigDenominator = 4;
  p.prepare();
  return plugin;
}

const PluginDescription& Plugin::description() const { return impl->desc; }
int Plugin::inputChannels() const { return impl->inCh; }
int Plugin::outputChannels() const { return impl->outCh; }
int Plugin::latencySamples() const { return (int)impl->processor->getLatencySamples(); }
double Plugin::tailSeconds() const {
  const uint32 tail = impl->processor->getTailSamples();
  return tail == kInfiniteTail ? -1 : tail / impl->sampleRate;
}
bool Plugin::bypassed() const { return impl->bypass.load(); }
void Plugin::setBypassed(bool bypassed) { impl->bypass.store(bypassed); }

void Plugin::setOffline(bool offline) {
  Impl& p = *impl;
  if (p.offline == offline) return;
  p.stop();
  p.offline = offline;
  p.data.processMode = offline ? kOffline : kRealtime;
  p.start();
}

void Plugin::noteOn(int pitch, float velocity, int sampleOffset) {
  std::lock_guard<std::mutex> lock(impl->pendingLock);
  impl->pendingNotes.push_back({true, pitch, velocity, sampleOffset});
}
void Plugin::noteOff(int pitch, int sampleOffset) {
  std::lock_guard<std::mutex> lock(impl->pendingLock);
  impl->pendingNotes.push_back({false, pitch, 0, sampleOffset});
}
void Plugin::allNotesOff() {
  std::lock_guard<std::mutex> lock(impl->pendingLock);
  for (int pitch = 0; pitch < 128; pitch++) impl->pendingNotes.push_back({false, pitch, 0, 0});
}
void Plugin::setParam(uint32_t id, double value) {
  const double v = std::max(0.0, std::min(1.0, value));
  if (impl->controller) impl->controller->setParamNormalized(id, v);
  std::lock_guard<std::mutex> lock(impl->pendingLock);
  impl->pendingParams.emplace_back(id, v);
}
void Plugin::setTransport(const Transport& transport) {
  std::lock_guard<std::mutex> lock(impl->pendingLock);
  impl->transport = transport;
}

void Plugin::process(float* left, float* right, int frames) {
  Impl& p = *impl;
  if (!p.prepared || frames <= 0) return;

  // Pick up what other threads left; if they are busy leaving it, next time will do.
  std::vector<Impl::Note> notes;
  std::vector<std::pair<ParamID, ParamValue>> params;
  Transport transport = p.transport;
  if (p.pendingLock.try_lock()) {
    notes.swap(p.pendingNotes);
    params.swap(p.pendingParams);
    transport = p.transport;
    p.pendingLock.unlock();
  }

  for (int done = 0; done < frames;) {
    const int n = std::min(p.maxBlock, frames - done);
    const bool first = done == 0;
    p.data.numSamples = n;

    p.paramsIn.clearQueue();
    p.paramsOut.clearQueue();
    p.events.clear();
    p.eventsOut.clear();
    if (first) {
      for (const auto& change : params) {
        int32 index = 0;
        if (IParamValueQueue* queue = p.paramsIn.addParameterData(change.first, index)) {
          int32 point = 0;
          queue->addPoint(0, change.second, point);
        }
      }
    }
    // Notes are given a place in the whole call; each goes out with the block it falls in.
    for (const auto& note : notes) {
      const int at = std::max(0, std::min(frames - 1, note.offset));
      if (at < done || at >= done + n) continue;
      Event e{};
      e.busIndex = 0;
      e.sampleOffset = at - done;
      e.flags = Event::kIsLive;
      if (note.on) {
        e.type = Event::kNoteOnEvent;
        e.noteOn.channel = 0;
        e.noteOn.pitch = (int16)note.pitch;
        e.noteOn.velocity = note.velocity;
        e.noteOn.noteId = -1;
      } else {
        e.type = Event::kNoteOffEvent;
        e.noteOff.channel = 0;
        e.noteOff.pitch = (int16)note.pitch;
        e.noteOff.velocity = 0;
        e.noteOff.noteId = -1;
      }
      p.events.addEvent(e);
    }

    p.context.state = ProcessContext::kTempoValid | ProcessContext::kTimeSigValid | ProcessContext::kProjectTimeMusicValid |
      (transport.playing ? ProcessContext::kPlaying : 0);
    p.context.tempo = transport.tempo;
    p.context.timeSigNumerator = transport.meterNum;
    p.context.timeSigDenominator = transport.meterDen;
    p.context.projectTimeSamples = (TSamples)p.positionSamples;
    p.context.projectTimeMusic = transport.positionBeats + (first ? 0 : done * transport.tempo / (60.0 * p.sampleRate));

    if (p.data.numInputs > 0) {
      AudioBusBuffers& in = p.data.inputs[0];
      in.silenceFlags = 0;
      for (int32 c = 0; c < in.numChannels; c++) {
        float* dst = in.channelBuffers32[c];
        if (in.numChannels == 1) for (int i = 0; i < n; i++) dst[i] = 0.5f * (left[done + i] + right[done + i]);
        else if (c < 2) std::memcpy(dst, (c == 0 ? left : right) + done, n * sizeof(float));
        else std::memset(dst, 0, n * sizeof(float));
      }
    }
    if (p.data.numOutputs > 0) {
      AudioBusBuffers& out = p.data.outputs[0];
      out.silenceFlags = 0;
      for (int32 c = 0; c < out.numChannels; c++) std::memset(out.channelBuffers32[c], 0, n * sizeof(float));
    }

    const bool ok = p.processor->process(p.data) == kResultOk;
    if (ok && !p.bypass.load() && p.data.numOutputs > 0 && p.data.outputs[0].numChannels > 0) {
      AudioBusBuffers& out = p.data.outputs[0];
      std::memcpy(left + done, out.channelBuffers32[0], n * sizeof(float));
      std::memcpy(right + done, out.channelBuffers32[out.numChannels > 1 ? 1 : 0], n * sizeof(float));
    }
    // Bypassed, or failed: the input is left as it came (an instrument, having none, gives silence).
    if (transport.playing) p.positionSamples += n;
    done += n;
  }
}

// ── Parameters and state ────────────────────────────────────────────────────
std::vector<ParamDescription> Plugin::parameters() const {
  std::vector<ParamDescription> out;
  if (!impl->controller) return out;
  const int32 count = impl->controller->getParameterCount();
  for (int32 i = 0; i < count; i++) {
    ParameterInfo info{};
    if (impl->controller->getParameterInfo(i, info) != kResultOk) continue;
    ParamDescription d;
    d.id = info.id;
    d.title = StringConvert::convert(info.title);
    d.units = StringConvert::convert(info.units);
    d.value = impl->controller->getParamNormalized(info.id);
    d.defaultValue = info.defaultNormalizedValue;
    d.steps = info.stepCount;
    d.automatable = (info.flags & ParameterInfo::kCanAutomate) != 0;
    d.hidden = (info.flags & ParameterInfo::kIsHidden) != 0 || (info.flags & ParameterInfo::kIsReadOnly) != 0;
    out.push_back(d);
  }
  return out;
}

double Plugin::getParam(uint32_t id) const {
  return impl->controller ? impl->controller->getParamNormalized(id) : 0;
}

std::string Plugin::paramText(uint32_t id, double value) const {
  if (!impl->controller) return std::string();
  String128 text{};
  if (impl->controller->getParamStringByValue(id, value, text) != kResultOk) return std::string();
  return StringConvert::convert(text);
}

// The saved form is the sound engine's state followed by the controls' own,
// each with its length in front.
std::vector<uint8_t> Plugin::getState() const {
  MemoryStream engine, controls;
  impl->component->getState(&engine);
  if (impl->controller) impl->controller->getState(&controls);
  std::vector<uint8_t> out;
  auto put = [&out](MemoryStream& s) {
    const uint32_t size = (uint32_t)s.getSize();
    const uint8_t* at = reinterpret_cast<const uint8_t*>(&size);
    out.insert(out.end(), at, at + 4);
    out.insert(out.end(), s.getData(), s.getData() + size);
  };
  out.insert(out.end(), {'C', 'P', 'V', '3'});
  put(engine);
  put(controls);
  return out;
}

bool Plugin::setState(const uint8_t* data, size_t size) {
  if (!data || size < 12 || std::memcmp(data, "CPV3", 4) != 0) return false;
  uint32_t engineSize = 0, controlSize = 0;
  std::memcpy(&engineSize, data + 4, 4);
  if ((size_t)engineSize + 12 > size) return false;
  std::memcpy(&controlSize, data + 8 + engineSize, 4);
  if ((size_t)engineSize + controlSize + 12 > size) return false;

  // The streams read from copies: a plugin is free to scribble on what it is given.
  std::vector<uint8_t> engineBytes(data + 8, data + 8 + engineSize);
  std::vector<uint8_t> controlBytes(data + 12 + engineSize, data + 12 + engineSize + controlSize);
  if (engineSize) {
    MemoryStream engine(engineBytes.data(), engineSize);
    if (impl->component->setState(&engine) != kResultOk) return false;
    if (impl->controller) {
      MemoryStream again(engineBytes.data(), engineSize);
      impl->controller->setComponentState(&again);
    }
  }
  if (controlSize && impl->controller) {
    MemoryStream controls(controlBytes.data(), controlSize);
    impl->controller->setState(&controls);
  }
  return true;
}

// ── Editor window ───────────────────────────────────────────────────────────
bool Plugin::hasEditor() const {
  if (!impl->controller) return false;
  if (impl->view) return true;
  IPtr<IPlugView> view = owned(impl->controller->createView(ViewType::kEditor));
  return view && view->isPlatformTypeSupported(kPlatformTypeHWND) == kResultTrue;
}

bool Plugin::editorOpen() const { return impl->window != nullptr; }

void Plugin::editorSize(int& width, int& height) const {
  width = height = 0;
  if (!impl->window) return;
  RECT r{};
  GetClientRect(impl->window, &r);
  width = r.right;
  height = r.bottom;
}

bool Plugin::openEditor(const std::string& title, bool visible) {
  Impl& p = *impl;
  if (p.window) {
    if (visible) { ShowWindow(p.window, SW_SHOWNORMAL); SetForegroundWindow(p.window); }
    return true;
  }
  if (!p.controller) return false;
  p.view = owned(p.controller->createView(ViewType::kEditor));
  if (!p.view || p.view->isPlatformTypeSupported(kPlatformTypeHWND) != kResultTrue) { p.view = nullptr; return false; }

  static bool registered = false;
  if (!registered) {
    WNDCLASSEXW wc{};
    wc.cbSize = sizeof(wc);
    wc.lpfnWndProc = Impl::windowProc;
    wc.hInstance = GetModuleHandleW(nullptr);
    wc.hCursor = LoadCursorW(nullptr, MAKEINTRESOURCEW(32512));   // the ordinary arrow
    wc.hbrBackground = (HBRUSH)GetStockObject(BLACK_BRUSH);
    wc.lpszClassName = WINDOW_CLASS;
    RegisterClassExW(&wc);
    registered = true;
  }
  const bool resizable = p.view->canResize() == kResultTrue;
  const DWORD style = WS_OVERLAPPED | WS_CAPTION | WS_SYSMENU | WS_MINIMIZEBOX | (resizable ? WS_THICKFRAME | WS_MAXIMIZEBOX : 0);
  ViewRect size(0, 0, 640, 400);
  p.view->getSize(&size);
  p.window = CreateWindowExW(0, WINDOW_CLASS, widen(title.empty() ? p.desc.name : title).c_str(), style,
    CW_USEDEFAULT, CW_USEDEFAULT, 640, 400, nullptr, nullptr, GetModuleHandleW(nullptr), nullptr);
  if (!p.window) { p.view = nullptr; return false; }
  SetWindowLongPtrW(p.window, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(&p));
  p.fitWindow(size.getWidth(), size.getHeight());

  p.view->setFrame(&p);
  FUnknownPtr<IPlugViewContentScaleSupport> scale(p.view);
  if (scale) scale->setContentScaleFactor(GetDpiForWindow(p.window) / 96.0f);
  if (p.view->attached(p.window, kPlatformTypeHWND) != kResultOk) {
    p.closeEditor();
    return false;
  }
  if (p.view->getSize(&size) == kResultOk && size.getWidth() > 0 && size.getHeight() > 0) p.fitWindow(size.getWidth(), size.getHeight());
  ShowWindow(p.window, visible ? SW_SHOWNORMAL : SW_HIDE);
  return true;
}

void Plugin::closeEditor() { impl->closeEditor(); }

void pumpMessages(int milliseconds) {
  const DWORD until = GetTickCount() + (DWORD)std::max(0, milliseconds);
  do {
    MSG message;
    while (PeekMessageW(&message, nullptr, 0, 0, PM_REMOVE)) {
      TranslateMessage(&message);
      DispatchMessageW(&message);
    }
    if (GetTickCount() < until) Sleep(5);
  } while (GetTickCount() < until);
}

}  // namespace cp
