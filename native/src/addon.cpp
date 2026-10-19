/* ChordPath — native/src/addon.cpp
 * The JavaScript face of the native audio host. Everything is checked on the
 * way in: a wrong argument throws a JavaScript error rather than reaching
 * the plugin or driver code behind it.
 *
 * Plugins and drivers live on the host thread (hostthread.h). Calls that can
 * take a while there — loading a plugin, opening its window, reading or
 * restoring its settings — return promises, so that the thread JavaScript
 * runs on stays free to keep audio moving. The rest wait for their answer.
 */
#include <napi.h>

#include "audio.h"
#include "hostthread.h"
#include "mixer.h"
#include "vsthost.h"

#include <functional>
#include <memory>
#include <stdexcept>

namespace {

// ── Arguments ───────────────────────────────────────────────────────────────
std::string textArg(const Napi::CallbackInfo& info, size_t index, const char* what) {
  if (info.Length() <= index || !info[index].IsString()) throw Napi::TypeError::New(info.Env(), std::string(what) + " must be text");
  return info[index].As<Napi::String>().Utf8Value();
}

double numberArg(const Napi::CallbackInfo& info, size_t index, const char* what) {
  if (info.Length() <= index || !info[index].IsNumber()) throw Napi::TypeError::New(info.Env(), std::string(what) + " must be a number");
  return info[index].As<Napi::Number>().DoubleValue();
}

Napi::Object objectArg(const Napi::CallbackInfo& info, size_t index, const char* what) {
  if (info.Length() <= index || !info[index].IsObject() || info[index].IsArray()) throw Napi::TypeError::New(info.Env(), std::string(what) + " must be an object");
  return info[index].As<Napi::Object>();
}

Napi::Float32Array floatsArg(const Napi::CallbackInfo& info, size_t index, const char* what) {
  if (info.Length() <= index || !info[index].IsTypedArray() || info[index].As<Napi::TypedArray>().TypedArrayType() != napi_float32_array) {
    throw Napi::TypeError::New(info.Env(), std::string(what) + " must be a Float32Array");
  }
  return info[index].As<Napi::Float32Array>();
}

double numberIn(const Napi::Object& o, const char* key, double fallback) {
  const Napi::Value v = o.Get(key);
  if (!v.IsNumber()) return fallback;
  const double n = v.As<Napi::Number>().DoubleValue();
  return n == n ? n : fallback;                 // not a number is no answer
}
bool flagIn(const Napi::Object& o, const char* key, bool fallback) {
  const Napi::Value v = o.Get(key);
  return v.IsBoolean() ? v.As<Napi::Boolean>().Value() : fallback;
}
std::string textIn(const Napi::Object& o, const char* key) {
  const Napi::Value v = o.Get(key);
  return v.IsString() ? v.As<Napi::String>().Utf8Value() : std::string();
}

// Runs `work` on the host thread, waits, and turns whatever it throws into a JavaScript error.
template <class F>
auto hostNow(Napi::Env env, F&& work) -> decltype(work()) {
  try {
    return cp::onHost(std::forward<F>(work));
  } catch (const Napi::Error&) {
    throw;
  } catch (const std::exception& e) {
    throw Napi::Error::New(env, e.what());
  }
}

// Runs `work` on the host thread without waiting; the promise is settled,
// back on this thread, with what `finish` makes of its result.
template <class T>
Napi::Promise hostLater(Napi::Env env, std::function<T()> work, std::function<Napi::Value(Napi::Env, T&)> finish) {
  auto deferred = std::make_shared<Napi::Promise::Deferred>(Napi::Promise::Deferred::New(env));
  auto back = std::make_shared<Napi::ThreadSafeFunction>(
    Napi::ThreadSafeFunction::New(env, Napi::Function::New(env, [](const Napi::CallbackInfo&) {}), "ChordPath host", 0, 1));
  cp::postToHost([deferred, back, work, finish] {
    auto result = std::make_shared<T>();
    auto failure = std::make_shared<std::string>();
    bool ok = true;
    try {
      *result = work();
    } catch (const std::exception& e) {
      ok = false;
      *failure = e.what();
    } catch (...) {
      ok = false;
      *failure = "Something went wrong";
    }
    back->BlockingCall([deferred, result, failure, ok, finish](Napi::Env env, Napi::Function) {
      Napi::HandleScope scope(env);
      if (!ok) {
        deferred->Reject(Napi::Error::New(env, *failure).Value());
        return;
      }
      try {
        deferred->Resolve(finish(env, *result));
      } catch (const Napi::Error& e) {
        deferred->Reject(e.Value());
      }
    });
    back->Release();
  });
  return deferred->Promise();
}

Napi::Object describe(Napi::Env env, const cp::PluginDescription& d) {
  Napi::Object o = Napi::Object::New(env);
  o.Set("path", d.path);
  o.Set("uid", d.uid);
  o.Set("name", d.name);
  o.Set("vendor", d.vendor);
  o.Set("version", d.version);
  o.Set("category", d.category);
  o.Set("instrument", d.instrument);
  return o;
}

cp::Transport transportFrom(const Napi::Object& o) {
  cp::Transport t;
  t.tempo = numberIn(o, "tempo", 120);
  t.playing = flagIn(o, "playing", false);
  t.positionBeats = numberIn(o, "position", 0);
  t.meterNum = (int)numberIn(o, "meterNum", 4);
  t.meterDen = (int)numberIn(o, "meterDen", 4);
  if (!(t.tempo >= 20 && t.tempo <= 999)) t.tempo = 120;
  if (t.meterNum < 1 || t.meterNum > 64) t.meterNum = 4;
  if (t.meterDen < 1 || t.meterDen > 64) t.meterDen = 4;
  return t;
}

// ── Plugin ──────────────────────────────────────────────────────────────────
using PluginPtr = std::shared_ptr<cp::Plugin>;

struct PluginFacts {
  int inputs = 0, outputs = 0, latency = 0;
  double tail = 0;
  bool editor = false;
};

struct Loaded {
  PluginPtr plugin;
  PluginFacts facts;
};

PluginFacts factsOf(cp::Plugin& p) {
  return PluginFacts{p.inputChannels(), p.outputChannels(), p.latencySamples(), p.tailSeconds(), p.hasEditor()};
}

Napi::Object describe(Napi::Env env, const cp::PluginDescription& d);

Napi::Object factsObject(Napi::Env env, cp::Plugin& p, const PluginFacts& f) {
  Napi::Object o = describe(env, p.description());
  o.Set("inputs", f.inputs);
  o.Set("outputs", f.outputs);
  o.Set("latency", f.latency);
  o.Set("tail", f.tail);
  o.Set("hasEditor", f.editor);
  o.Set("bypassed", p.bypassed());
  return o;
}

class PluginWrap : public Napi::ObjectWrap<PluginWrap> {
 public:
  static Napi::FunctionReference constructor;

  // The plugin behind a JavaScript value, or null if it is not one of ours (or has been closed).
  static PluginPtr from(const Napi::Value& value) {
    if (!value.IsObject() || !value.As<Napi::Object>().InstanceOf(constructor.Value())) return nullptr;
    return Unwrap(value.As<Napi::Object>())->plugin;
  }

  static void define(Napi::Env env) {
    Napi::Function made = DefineClass(env, "Plugin", {
      InstanceMethod("info", &PluginWrap::info),
      InstanceMethod("parameters", &PluginWrap::parameters),
      InstanceMethod("getParam", &PluginWrap::getParam),
      InstanceMethod("setParam", &PluginWrap::setParam),
      InstanceMethod("paramText", &PluginWrap::paramText),
      InstanceMethod("process", &PluginWrap::process),
      InstanceMethod("noteOn", &PluginWrap::noteOn),
      InstanceMethod("noteOff", &PluginWrap::noteOff),
      InstanceMethod("allNotesOff", &PluginWrap::allNotesOff),
      InstanceMethod("setTransport", &PluginWrap::setTransport),
      InstanceMethod("setBypassed", &PluginWrap::setBypassed),
      InstanceMethod("setOffline", &PluginWrap::setOffline),
      InstanceMethod("getState", &PluginWrap::getState),
      InstanceMethod("setState", &PluginWrap::setState),
      InstanceMethod("openEditor", &PluginWrap::openEditor),
      InstanceMethod("closeEditor", &PluginWrap::closeEditor),
      InstanceMethod("editor", &PluginWrap::editor),
      InstanceMethod("setEditorOnTop", &PluginWrap::setEditorOnTop),
      InstanceMethod("refresh", &PluginWrap::refresh),
      InstanceMethod("changes", &PluginWrap::changes),
      InstanceMethod("dispose", &PluginWrap::dispose),
    });
    constructor = Napi::Persistent(made);
    constructor.SuppressDestruct();
  }

  // Only loadPlugin() makes these: it hands the loaded plugin over in an External.
  explicit PluginWrap(const Napi::CallbackInfo& info) : Napi::ObjectWrap<PluginWrap>(info) {
    if (info.Length() < 1 || !info[0].IsExternal()) throw Napi::TypeError::New(info.Env(), "Plugins are made with loadPlugin()");
    plugin = *info[0].As<Napi::External<PluginPtr>>().Data();
  }

  // loadPlugin({ path, uid, sampleRate, blockSize }) → Promise<Plugin>
  static Napi::Value load(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    const Napi::Object o = objectArg(info, 0, "what to load");
    const std::string path = textIn(o, "path"), uid = textIn(o, "uid");
    const double rate = numberIn(o, "sampleRate", 44100);
    const int block = (int)numberIn(o, "blockSize", 512);
    if (path.empty()) throw Napi::TypeError::New(env, "path must be text");
    if (!(rate >= 8000 && rate <= 384000)) throw Napi::RangeError::New(env, "sampleRate is out of range");
    return hostLater<Loaded>(env,
      [path, uid, rate, block] {
        Loaded made;
        // Whoever lets go of it last, it is the host thread that takes it apart.
        made.plugin = PluginPtr(cp::Plugin::load(path, uid, rate, block).release(), [](cp::Plugin* p) { cp::postToHost([p] { delete p; }); });
        made.facts = factsOf(*made.plugin);
        return made;
      },
      [](Napi::Env env, Loaded& made) -> Napi::Value {
        Napi::Object wrapped = constructor.New({Napi::External<PluginPtr>::New(env, &made.plugin)});
        // What it said about itself as it was loaded: reading this later costs the host thread nothing.
        wrapped.Set("about", factsObject(env, *made.plugin, made.facts));
        return wrapped;
      });
  }

 private:
  // Shared with any chain the plugin has been put in, which keeps it alive while it is playing.
  PluginPtr plugin;

  PluginPtr live(const Napi::CallbackInfo& info) {
    if (!plugin) throw Napi::Error::New(info.Env(), "The plugin has been closed");
    return plugin;
  }

  Napi::Value info(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    const PluginPtr p = live(info);
    const PluginFacts f = hostNow(env, [&p] { return factsOf(*p); });
    return factsObject(env, *p, f);
  }

  // refresh() → Promise of the same facts, asked for without waiting on the host thread.
  Napi::Value refresh(const Napi::CallbackInfo& info) {
    const PluginPtr p = live(info);
    return hostLater<PluginFacts>(info.Env(),
      [p] { return factsOf(*p); },
      [p](Napi::Env env, PluginFacts& f) -> Napi::Value { return factsObject(env, *p, f); });
  }

  Napi::Value parameters(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    const PluginPtr p = live(info);
    const auto list = hostNow(env, [&p] { return p->parameters(); });
    Napi::Array out = Napi::Array::New(env, list.size());
    for (size_t i = 0; i < list.size(); i++) {
      Napi::Object o = Napi::Object::New(env);
      o.Set("id", list[i].id);
      o.Set("title", list[i].title);
      o.Set("units", list[i].units);
      o.Set("value", list[i].value);
      o.Set("defaultValue", list[i].defaultValue);
      o.Set("steps", list[i].steps);
      o.Set("automatable", list[i].automatable);
      o.Set("hidden", list[i].hidden);
      out.Set((uint32_t)i, o);
    }
    return out;
  }

  Napi::Value getParam(const Napi::CallbackInfo& info) {
    const PluginPtr p = live(info);
    const uint32_t id = (uint32_t)numberArg(info, 0, "id");
    return Napi::Number::New(info.Env(), hostNow(info.Env(), [&p, id] { return p->getParam(id); }));
  }
  void setParam(const Napi::CallbackInfo& info) {
    const PluginPtr p = live(info);
    const uint32_t id = (uint32_t)numberArg(info, 0, "id");
    const double value = numberArg(info, 1, "value");
    hostNow(info.Env(), [&p, id, value] { p->setParam(id, value); });
  }
  Napi::Value paramText(const Napi::CallbackInfo& info) {
    const PluginPtr p = live(info);
    const uint32_t id = (uint32_t)numberArg(info, 0, "id");
    const bool given = info.Length() > 1 && info[1].IsNumber();
    const double value = given ? info[1].As<Napi::Number>().DoubleValue() : 0;
    return Napi::String::New(info.Env(), hostNow(info.Env(), [&p, id, given, value] { return p->paramText(id, given ? value : p->getParam(id)); }));
  }

  // process(left, right): two Float32Arrays of the same length, changed in place.
  void process(const Napi::CallbackInfo& info) {
    const PluginPtr p = live(info);
    Napi::Float32Array left = floatsArg(info, 0, "left"), right = floatsArg(info, 1, "right");
    if (left.ElementLength() != right.ElementLength()) throw Napi::RangeError::New(info.Env(), "left and right must be the same length");
    if (left.ElementLength() > 16 * 1024 * 1024) throw Napi::RangeError::New(info.Env(), "too much audio for one call");
    p->process(left.Data(), right.Data(), (int)left.ElementLength());
  }

  void noteOn(const Napi::CallbackInfo& info) {
    const int pitch = (int)numberArg(info, 0, "pitch");
    const double velocity = info.Length() > 1 && info[1].IsNumber() ? info[1].As<Napi::Number>().DoubleValue() : 0.8;
    const int offset = info.Length() > 2 && info[2].IsNumber() ? info[2].As<Napi::Number>().Int32Value() : 0;
    if (pitch < 0 || pitch > 127) throw Napi::RangeError::New(info.Env(), "pitch must be 0 to 127");
    live(info)->noteOn(pitch, (float)(velocity < 0 ? 0 : velocity > 1 ? 1 : velocity), offset);
  }
  void noteOff(const Napi::CallbackInfo& info) {
    const int pitch = (int)numberArg(info, 0, "pitch");
    const int offset = info.Length() > 1 && info[1].IsNumber() ? info[1].As<Napi::Number>().Int32Value() : 0;
    if (pitch < 0 || pitch > 127) throw Napi::RangeError::New(info.Env(), "pitch must be 0 to 127");
    live(info)->noteOff(pitch, offset);
  }
  void allNotesOff(const Napi::CallbackInfo& info) { live(info)->allNotesOff(); }

  // setTransport({ tempo, playing, position, meterNum, meterDen })
  void setTransport(const Napi::CallbackInfo& info) { live(info)->setTransport(transportFrom(objectArg(info, 0, "the transport"))); }
  void setBypassed(const Napi::CallbackInfo& info) { live(info)->setBypassed(info.Length() > 0 && info[0].ToBoolean().Value()); }
  void setOffline(const Napi::CallbackInfo& info) {
    const PluginPtr p = live(info);
    const bool offline = info.Length() > 0 && info[0].ToBoolean().Value();
    hostNow(info.Env(), [&p, offline] { p->setOffline(offline); });
  }

  // getState() → Promise<Buffer>
  Napi::Value getState(const Napi::CallbackInfo& info) {
    const PluginPtr p = live(info);
    return hostLater<std::vector<uint8_t>>(info.Env(),
      [p] { return p->getState(); },
      [](Napi::Env env, std::vector<uint8_t>& bytes) -> Napi::Value { return Napi::Buffer<uint8_t>::Copy(env, bytes.data(), bytes.size()); });
  }
  // setState(bytes) → Promise<boolean>
  Napi::Value setState(const Napi::CallbackInfo& info) {
    const PluginPtr p = live(info);
    if (info.Length() < 1 || !info[0].IsTypedArray() || info[0].As<Napi::TypedArray>().TypedArrayType() != napi_uint8_array) {
      throw Napi::TypeError::New(info.Env(), "setState needs the bytes getState gave");
    }
    Napi::Uint8Array given = info[0].As<Napi::Uint8Array>();
    if (given.ByteLength() > 64 * 1024 * 1024) throw Napi::RangeError::New(info.Env(), "that state is too large");
    auto bytes = std::make_shared<std::vector<uint8_t>>(given.Data(), given.Data() + given.ByteLength());
    return hostLater<bool>(info.Env(),
      [p, bytes] { return p->setState(bytes->data(), bytes->size()); },
      [](Napi::Env env, bool& ok) -> Napi::Value { return Napi::Boolean::New(env, ok); });
  }

  // openEditor({ title, visible }) → Promise<boolean>
  Napi::Value openEditor(const Napi::CallbackInfo& info) {
    const PluginPtr p = live(info);
    std::string title;
    bool visible = true;
    if (info.Length() > 0 && info[0].IsObject()) {
      const Napi::Object o = info[0].As<Napi::Object>();
      title = textIn(o, "title");
      visible = flagIn(o, "visible", true);
    }
    return hostLater<bool>(info.Env(),
      [p, title, visible] { return p->openEditor(title, visible); },
      [](Napi::Env env, bool& ok) -> Napi::Value { return Napi::Boolean::New(env, ok); });
  }
  // closeEditor() → Promise
  Napi::Value closeEditor(const Napi::CallbackInfo& info) {
    const PluginPtr p = live(info);
    return hostLater<bool>(info.Env(),
      [p] { p->closeEditor(); return true; },
      [](Napi::Env env, bool&) -> Napi::Value { return env.Undefined(); });
  }
  Napi::Value editor(const Napi::CallbackInfo& info) {
    const PluginPtr p = live(info);
    struct Size { bool open; int width, height; };
    const Size s = hostNow(info.Env(), [&p] { Size s{p->editorOpen(), 0, 0}; p->editorSize(s.width, s.height); return s; });
    Napi::Object o = Napi::Object::New(info.Env());
    o.Set("open", s.open);
    o.Set("width", s.width);
    o.Set("height", s.height);
    return o;
  }

  // changes() → { edited, latency, editorOpen }: what the plugin has done of its
  // own accord since last asked, and whether its window is up. Never waits.
  Napi::Value changes(const Napi::CallbackInfo& info) {
    const PluginPtr p = live(info);
    Napi::Object o = Napi::Object::New(info.Env());
    o.Set("edited", p->takeEdited());
    o.Set("latency", p->takeLatencyChanged());
    o.Set("editorOpen", p->editorOpen());
    return o;
  }

  // setEditorOnTop(onTop): keeps the window above others, or not. Does not wait.
  void setEditorOnTop(const Napi::CallbackInfo& info) {
    const PluginPtr p = live(info);
    const bool onTop = info.Length() > 0 && info[0].ToBoolean().Value();
    cp::postToHost([p, onTop] { p->setEditorOnTop(onTop); });
  }

  void dispose(const Napi::CallbackInfo&) { plugin.reset(); }
};

Napi::FunctionReference PluginWrap::constructor;

// ── What the desk is told, whether it is playing through a card or mixing down ──
void deskStrip(cp::Mixer& desk, const Napi::CallbackInfo& info) {
  const int strip = (int)numberArg(info, 0, "strip");
  const Napi::Object o = objectArg(info, 1, "the strip's settings");
  if (strip < 0 || strip >= desk.strips()) throw Napi::RangeError::New(info.Env(), "there is no such strip");
  cp::StripSettings s;
  s.active = flagIn(o, "active", true);
  s.gain = (float)numberIn(o, "gain", 1);
  s.pan = (float)numberIn(o, "pan", 0);
  s.reverb = (float)numberIn(o, "reverb", 0);
  s.echo = (float)numberIn(o, "echo", 0);
  desk.setStrip(strip, s);
}

void deskMaster(cp::Mixer& desk, const Napi::CallbackInfo& info) {
  const Napi::Object o = objectArg(info, 0, "the master's settings");
  cp::MasterSettings s;
  s.gain = (float)std::max(0.0, std::min(8.0, numberIn(o, "gain", 1)));
  s.reverbReturn = (float)std::max(0.0, std::min(16.0, numberIn(o, "reverbReturn", 3)));
  s.echoSeconds = std::max(0.001, std::min(1.9, numberIn(o, "echoSeconds", 0.375)));
  s.echoFeedback = (float)std::max(0.0, std::min(0.95, numberIn(o, "echoFeedback", 0.34)));
  s.echoDampHz = std::max(20.0, std::min(20000.0, numberIn(o, "echoDampHz", 3400)));
  s.echoDampQ = std::max(-20.0, std::min(20.0, numberIn(o, "echoDampQ", 0.5)));
  s.limiterDelay = (unsigned)std::max(0.0, std::min(desk.sampleRate() * 0.05, numberIn(o, "limiterDelay", 0)));
  s.limiterGain = (float)std::max(0.0, std::min(4.0, numberIn(o, "limiterGain", 1)));
  s.limiterThresholdDb = (float)std::max(-60.0, std::min(0.0, numberIn(o, "limiterThresholdDb", -1.5)));
  s.limiterRatio = (float)std::max(1.0, std::min(100.0, numberIn(o, "limiterRatio", 20)));
  s.limiterAttack = (float)std::max(0.0001, std::min(1.0, numberIn(o, "limiterAttack", 0.002)));
  s.limiterRelease = (float)std::max(0.001, std::min(5.0, numberIn(o, "limiterRelease", 0.12)));
  desk.setMaster(s);
}

// setReverb(left, right): the room's impulse response; two empty arrays for none.
void deskReverb(cp::Mixer& desk, const Napi::CallbackInfo& info) {
  Napi::Float32Array left = floatsArg(info, 0, "left"), right = floatsArg(info, 1, "right");
  if (left.ElementLength() != right.ElementLength()) throw Napi::RangeError::New(info.Env(), "left and right must be the same length");
  if (left.ElementLength() > 1920000) throw Napi::RangeError::New(info.Env(), "that room is too long");
  desk.setReverb(left.Data(), right.Data(), left.ElementLength());
}

// setChain(strip, [{ id, plugin }]): strip -1 is the master.
void deskChain(cp::Mixer& desk, const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  const int strip = (int)numberArg(info, 0, "strip");
  if (info.Length() < 2 || !info[1].IsArray()) throw Napi::TypeError::New(env, "the chain must be a list");
  const Napi::Array list = info[1].As<Napi::Array>();
  if (strip < -1 || strip >= desk.strips()) throw Napi::RangeError::New(env, "there is no such strip");
  if (list.Length() > 16) throw Napi::RangeError::New(env, "a chain holds at most 16 plugins");
  cp::Chain chain;
  for (uint32_t i = 0; i < list.Length(); i++) {
    const Napi::Value entry = list.Get(i);
    if (!entry.IsObject()) throw Napi::TypeError::New(env, "the chain must be a list of { id, plugin }");
    const Napi::Object o = entry.As<Napi::Object>();
    cp::ChainSlot slot;
    slot.id = (uint32_t)numberIn(o, "id", 0);
    slot.plugin = PluginWrap::from(o.Get("plugin"));
    if (!slot.plugin || !slot.id) throw Napi::TypeError::New(env, "the chain must be a list of { id, plugin } with open plugins");
    chain.push_back(slot);
  }
  cp::Mixer* target = &desk;
  hostNow(env, [target, strip, &chain] { target->setChain(strip, chain); });
}

// schedule([{ plugin, frame, on, pitch, velocity }]) → how many were taken.
// `counted` is true where frames are counted from the start of a mixdown;
// played live, they are places in the stream and 0 means at once.
Napi::Value deskSchedule(cp::Mixer& desk, const Napi::CallbackInfo& info, bool counted) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsArray()) throw Napi::TypeError::New(env, "schedule needs a list of notes");
  const Napi::Array list = info[0].As<Napi::Array>();
  uint32_t taken = 0;
  for (uint32_t i = 0; i < list.Length(); i++) {
    const Napi::Value entry = list.Get(i);
    if (!entry.IsObject()) continue;
    const Napi::Object o = entry.As<Napi::Object>();
    cp::NoteEvent e;
    e.plugin = (uint32_t)numberIn(o, "plugin", 0);
    const double frame = numberIn(o, "frame", 0);
    e.frame = (frame > 0 ? (uint64_t)frame : 0) + (counted ? 1 : 0);
    e.on = flagIn(o, "on", false);
    e.pitch = (int)numberIn(o, "pitch", 60);
    e.velocity = (float)numberIn(o, "velocity", 0.8);
    if (!e.plugin || e.pitch < 0 || e.pitch > 127) continue;
    if (desk.schedule(e)) taken++;
  }
  return Napi::Number::New(env, taken);
}

Napi::Array peaksArray(Napi::Env env, const std::vector<float>& peaks) {
  Napi::Array out = Napi::Array::New(env, peaks.size());
  for (size_t i = 0; i < peaks.size(); i++) out.Set((uint32_t)i, peaks[i]);
  return out;
}

// The strips a lump of stream is for, as a list of numbers.
std::vector<int> slotsArg(const Napi::CallbackInfo& info, size_t index, int most) {
  if (info.Length() <= index || !info[index].IsArray()) throw Napi::TypeError::New(info.Env(), "slots must be a list of strip numbers");
  const Napi::Array list = info[index].As<Napi::Array>();
  if (list.Length() > (uint32_t)most + 1) throw Napi::RangeError::New(info.Env(), "more slots than there are strips");
  std::vector<int> slots;
  for (uint32_t i = 0; i < list.Length(); i++) {
    const Napi::Value v = list.Get(i);
    const int slot = v.IsNumber() ? v.As<Napi::Number>().Int32Value() : -1;
    if (slot < 0 || slot > most) throw Napi::RangeError::New(info.Env(), "there is no such strip");
    slots.push_back(slot);
  }
  return slots;
}

Napi::Object asioObject(Napi::Env env, const cp::AsioDescription& d) {
  Napi::Object o = Napi::Object::New(env);
  o.Set("name", d.name);
  o.Set("inputs", d.inputs);
  o.Set("outputs", d.outputs);
  auto names = [&env](const std::vector<std::string>& list) {
    Napi::Array out = Napi::Array::New(env, list.size());
    for (size_t i = 0; i < list.size(); i++) out.Set((uint32_t)i, list[i]);
    return out;
  };
  o.Set("inputNames", names(d.inputNames));
  o.Set("outputNames", names(d.outputNames));
  o.Set("rate", d.rate);
  Napi::Array rates = Napi::Array::New(env, d.rates.size());
  for (size_t i = 0; i < d.rates.size(); i++) rates.Set((uint32_t)i, d.rates[i]);
  o.Set("rates", rates);
  o.Set("minBuffer", (double)d.minBuffer);
  o.Set("maxBuffer", (double)d.maxBuffer);
  o.Set("preferredBuffer", (double)d.preferredBuffer);
  o.Set("granularity", (double)d.granularity);
  o.Set("bufferFrames", d.bufferFrames);
  o.Set("inputLatency", (double)d.inputLatency);
  o.Set("outputLatency", (double)d.outputLatency);
  o.Set("sampleType", d.sampleType);
  return o;
}

// ── The sound card ──────────────────────────────────────────────────────────
class AudioWrap : public Napi::ObjectWrap<AudioWrap> {
 public:
  static Napi::Function define(Napi::Env env) {
    return DefineClass(env, "AudioIO", {
      InstanceMethod("open", &AudioWrap::open),
      InstanceMethod("close", &AudioWrap::close),
      InstanceMethod("showControlPanel", &AudioWrap::showControlPanel),
      InstanceMethod("push", &AudioWrap::push),
      InstanceMethod("flush", &AudioWrap::flush),
      InstanceMethod("setPaused", &AudioWrap::setPaused),
      InstanceMethod("setStrip", &AudioWrap::setStrip),
      InstanceMethod("setMaster", &AudioWrap::setMaster),
      InstanceMethod("setReverb", &AudioWrap::setReverb),
      InstanceMethod("setChain", &AudioWrap::setChain),
      InstanceMethod("setMonitor", &AudioWrap::setMonitor),
      InstanceMethod("setTransport", &AudioWrap::setTransport),
      InstanceMethod("schedule", &AudioWrap::schedule),
      InstanceMethod("clearEvents", &AudioWrap::clearEvents),
      InstanceMethod("setRecording", &AudioWrap::setRecording),
      InstanceMethod("readInput", &AudioWrap::readInput),
      InstanceMethod("capture", &AudioWrap::capture),
      InstanceMethod("status", &AudioWrap::status),
    });
  }

  explicit AudioWrap(const Napi::CallbackInfo& info) : Napi::ObjectWrap<AudioWrap>(info) {}

 private:
  cp::AudioIO io;

  cp::Mixer& desk(const Napi::CallbackInfo& info) {
    cp::Mixer* mixer = io.mixer();
    if (!mixer) throw Napi::Error::New(info.Env(), "The sound card is not open");
    return *mixer;
  }

  // open({ api, device, useInput, input, firstOutput, firstInput, sampleRate, bufferFrames, strips, prebufferFrames, muted })
  Napi::Value open(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    const Napi::Object o = objectArg(info, 0, "what to open");
    cp::OpenRequest request;
    request.api = textIn(o, "api");
    if (request.api != "asio" && request.api != "wasapi") throw Napi::TypeError::New(env, "api must be 'asio' or 'wasapi'");
    request.device = textIn(o, "device");
    request.useInput = flagIn(o, "useInput", false);
    request.input = textIn(o, "input");
    request.firstOutput = (int)std::max(0.0, std::min(1024.0, numberIn(o, "firstOutput", 0)));
    request.firstInput = (int)std::max(0.0, std::min(1024.0, numberIn(o, "firstInput", 0)));
    request.sampleRate = (unsigned)numberIn(o, "sampleRate", 0);
    request.bufferFrames = (unsigned)std::max(0.0, std::min(8192.0, numberIn(o, "bufferFrames", 0)));
    request.strips = (int)numberIn(o, "strips", 8);
    request.prebufferFrames = (unsigned)std::max(0.0, std::min(192000.0, numberIn(o, "prebufferFrames", 0)));
    request.muted = flagIn(o, "muted", false);
    if (request.sampleRate && (request.sampleRate < 8000 || request.sampleRate > 384000)) throw Napi::RangeError::New(env, "sampleRate is out of range");
    if (request.api == "asio" && request.device.empty()) throw Napi::TypeError::New(env, "an ASIO driver must be named");
    cp::AudioIO* card = &io;
    const cp::OpenResult r = hostNow(env, [card, &request] { return card->open(request); });
    Napi::Object out = Napi::Object::New(env);
    out.Set("api", r.api);
    out.Set("device", r.device);
    out.Set("sampleRate", r.sampleRate);
    out.Set("bufferFrames", r.bufferFrames);
    out.Set("prebufferFrames", r.prebufferFrames);
    out.Set("outputLatency", (double)r.outputLatency);
    out.Set("inputLatency", (double)r.inputLatency);
    out.Set("inputs", r.inputs);
    out.Set("strips", r.strips);
    if (r.api == "asio") out.Set("asio", asioObject(env, r.asio));
    return out;
  }

  void close(const Napi::CallbackInfo& info) {
    cp::AudioIO* card = &io;
    hostNow(info.Env(), [card] { card->close(); });
  }

  Napi::Value showControlPanel(const Napi::CallbackInfo& info) {
    // The driver's window may take its time; nothing waits for it.
    cp::AudioIO* card = &io;
    cp::postToHost([card] { card->showControlPanel(); });
    return Napi::Boolean::New(info.Env(), io.isOpen());
  }

  // push(samples, frames, slots): left and right for every listed strip, frame after frame. → whether there was room
  Napi::Value push(const Napi::CallbackInfo& info) {
    Napi::Float32Array samples = floatsArg(info, 0, "samples");
    const double frames = numberArg(info, 1, "frames");
    cp::Mixer* mixer = io.mixer();
    if (!mixer) return Napi::Boolean::New(info.Env(), false);
    const std::vector<int> slots = slotsArg(info, 2, mixer->strips());
    if (!(frames >= 1 && frames <= 1048576) || samples.ElementLength() != (size_t)frames * slots.size() * 2) {
      throw Napi::RangeError::New(info.Env(), "samples must hold every frame of every listed strip");
    }
    return Napi::Boolean::New(info.Env(), io.push(samples.Data(), (unsigned)frames, slots.data(), (unsigned)slots.size()));
  }

  void flush(const Napi::CallbackInfo&) { io.flush(); }
  void setPaused(const Napi::CallbackInfo& info) { io.setPaused(info.Length() > 0 && info[0].ToBoolean().Value()); }

  void setStrip(const Napi::CallbackInfo& info) { deskStrip(desk(info), info); }
  void setMaster(const Napi::CallbackInfo& info) { deskMaster(desk(info), info); }
  void setReverb(const Napi::CallbackInfo& info) { deskReverb(desk(info), info); }
  void setChain(const Napi::CallbackInfo& info) { deskChain(desk(info), info); }
  Napi::Value schedule(const Napi::CallbackInfo& info) { return deskSchedule(desk(info), info, false); }
  void clearEvents(const Napi::CallbackInfo& info) { desk(info).clearEvents(); }
  void setTransport(const Napi::CallbackInfo& info) { desk(info).setTransport(transportFrom(objectArg(info, 0, "the transport"))); }

  // setMonitor(strip, gain): the card's input through that strip; -1 for none.
  void setMonitor(const Napi::CallbackInfo& info) {
    const int strip = (int)numberArg(info, 0, "strip");
    const double gain = info.Length() > 1 && info[1].IsNumber() ? info[1].As<Napi::Number>().DoubleValue() : 1.0;
    desk(info).setMonitor(strip, (float)gain);
  }

  void setRecording(const Napi::CallbackInfo& info) { io.setRecording(info.Length() > 0 && info[0].ToBoolean().Value()); }

  // readInput(left, right) → { frames, streamAt, cardAt }
  Napi::Value readInput(const Napi::CallbackInfo& info) {
    Napi::Float32Array left = floatsArg(info, 0, "left"), right = floatsArg(info, 1, "right");
    if (left.ElementLength() != right.ElementLength()) throw Napi::RangeError::New(info.Env(), "left and right must be the same length");
    const cp::AudioIO::Take take = io.readInput(left.Data(), right.Data(), (unsigned)left.ElementLength());
    Napi::Object out = Napi::Object::New(info.Env());
    out.Set("frames", take.frames);
    out.Set("streamAt", (double)take.streamAt);
    out.Set("cardAt", (double)take.cardAt);
    return out;
  }

  // capture(left, right) → frames copied: the newest of the finished mix.
  Napi::Value capture(const Napi::CallbackInfo& info) {
    Napi::Float32Array left = floatsArg(info, 0, "left"), right = floatsArg(info, 1, "right");
    if (left.ElementLength() != right.ElementLength()) throw Napi::RangeError::New(info.Env(), "left and right must be the same length");
    return Napi::Number::New(info.Env(), io.capture(left.Data(), right.Data(), (unsigned)left.ElementLength()));
  }

  Napi::Value status(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    const cp::IoStatus s = io.status();
    Napi::Object out = Napi::Object::New(env);
    out.Set("open", s.open);
    out.Set("flowing", s.flowing);
    out.Set("received", (double)s.received);
    out.Set("played", (double)s.played);
    out.Set("lost", (double)s.lost);
    out.Set("buffered", s.buffered);
    out.Set("underruns", s.underruns);
    out.Set("slips", s.slips);
    out.Set("blocks", (double)s.blocks);
    out.Set("cardFrames", (double)s.cardFrames);
    out.Set("load", s.load);
    out.Set("idleSeconds", s.idleSeconds);
    out.Set("latencyFrames", s.latencyFrames);
    out.Set("overloads", s.overloads);
    out.Set("resetWanted", s.resetWanted);
    out.Set("peaks", peaksArray(env, s.peaks));
    return out;
  }
};

// ── Mixing down to a file ───────────────────────────────────────────────────
// The same desk with no card behind it: it is given the tracks' audio a
// stretch at a time and returns the finished mix for that stretch.
class MixdownWrap : public Napi::ObjectWrap<MixdownWrap> {
 public:
  static Napi::Function define(Napi::Env env) {
    return DefineClass(env, "Mixdown", {
      InstanceMethod("setStrip", &MixdownWrap::setStrip),
      InstanceMethod("setMaster", &MixdownWrap::setMaster),
      InstanceMethod("setReverb", &MixdownWrap::setReverb),
      InstanceMethod("setChain", &MixdownWrap::setChain),
      InstanceMethod("setTransport", &MixdownWrap::setTransport),
      InstanceMethod("schedule", &MixdownWrap::schedule),
      InstanceMethod("process", &MixdownWrap::process),
      InstanceMethod("latency", &MixdownWrap::latency),
      InstanceMethod("peaks", &MixdownWrap::peaks),
    });
  }

  // new Mixdown({ sampleRate, strips })
  explicit MixdownWrap(const Napi::CallbackInfo& info) : Napi::ObjectWrap<MixdownWrap>(info) {
    Napi::Env env = info.Env();
    const Napi::Object o = objectArg(info, 0, "the mixdown's settings");
    const double rate = numberIn(o, "sampleRate", 44100);
    const int strips = (int)numberIn(o, "strips", 8);
    if (!(rate >= 8000 && rate <= 384000)) throw Napi::RangeError::New(env, "sampleRate is out of range");
    if (strips < 1 || strips > 64) throw Napi::RangeError::New(env, "there must be between 1 and 64 strips");
    desk.reset(new cp::Mixer(strips, rate, BLOCK));
    desk->snap();
    work.assign((size_t)BLOCK * desk->width(), 0.0f);
  }

 private:
  static const unsigned BLOCK = 512;
  std::unique_ptr<cp::Mixer> desk;
  std::vector<float> work;
  uint64_t position = 1;          // the desk counts from 1 here: to it, 0 means "at once"

  void setStrip(const Napi::CallbackInfo& info) { deskStrip(*desk, info); }
  void setMaster(const Napi::CallbackInfo& info) { deskMaster(*desk, info); }
  void setReverb(const Napi::CallbackInfo& info) { deskReverb(*desk, info); }
  void setChain(const Napi::CallbackInfo& info) { deskChain(*desk, info); }
  Napi::Value schedule(const Napi::CallbackInfo& info) { return deskSchedule(*desk, info, true); }
  void setTransport(const Napi::CallbackInfo& info) { desk->setTransport(transportFrom(objectArg(info, 0, "the transport"))); }
  Napi::Value latency(const Napi::CallbackInfo& info) { return Napi::Number::New(info.Env(), desk->latencyFrames()); }
  Napi::Value peaks(const Napi::CallbackInfo& info) { return peaksArray(info.Env(), desk->takePeaks()); }

  // process(samples, frames, slots) → { left, right }. samples may be null for a stretch of silence.
  Napi::Value process(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    const double asked = numberArg(info, 1, "frames");
    if (!(asked >= 1 && asked <= 16 * 1024 * 1024)) throw Napi::RangeError::New(env, "frames is out of range");
    const unsigned frames = (unsigned)asked;
    const bool silent = info.Length() < 1 || info[0].IsNull() || info[0].IsUndefined();
    std::vector<int> slots;
    const float* samples = nullptr;
    if (!silent) {
      Napi::Float32Array given = floatsArg(info, 0, "samples");
      slots = slotsArg(info, 2, desk->strips());
      if (given.ElementLength() != (size_t)frames * slots.size() * 2) throw Napi::RangeError::New(env, "samples must hold every frame of every listed strip");
      samples = given.Data();
    }
    Napi::Float32Array left = Napi::Float32Array::New(env, frames), right = Napi::Float32Array::New(env, frames);
    const unsigned width = desk->width();
    const size_t each = slots.size() * 2;
    for (unsigned done = 0; done < frames;) {
      const unsigned n = std::min(BLOCK, frames - done);
      if (samples) {
        std::fill(work.begin(), work.begin() + (size_t)n * width, 0.0f);
        for (size_t s = 0; s < slots.size(); s++) {
          const size_t to = (size_t)slots[s] * 2;
          for (unsigned i = 0; i < n; i++) {
            work[(size_t)i * width + to] = samples[(size_t)(done + i) * each + s * 2];
            work[(size_t)i * width + to + 1] = samples[(size_t)(done + i) * each + s * 2 + 1];
          }
        }
      }
      desk->process(samples ? work.data() : nullptr, nullptr, nullptr, left.Data() + done, right.Data() + done, n, position, n);
      position += n;
      done += n;
    }
    Napi::Object out = Napi::Object::New(env);
    out.Set("left", left);
    out.Set("right", right);
    return out;
  }
};

// ── What there is to play through, and to load ──────────────────────────────
// audioDevices() → { asio: [name], windows: [{ name, outputs, inputs, defaultOutput, defaultInput, preferredRate, rates }] }
Napi::Value audioDevices(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  const std::vector<std::string> drivers = cp::asioDriverNames();
  const std::vector<cp::SoundDevice> devices = hostNow(env, [] { return cp::windowsDevices(); });
  Napi::Object out = Napi::Object::New(env);
  Napi::Array asio = Napi::Array::New(env, drivers.size());
  for (size_t i = 0; i < drivers.size(); i++) asio.Set((uint32_t)i, drivers[i]);
  out.Set("asio", asio);
  Napi::Array windows = Napi::Array::New(env, devices.size());
  for (size_t i = 0; i < devices.size(); i++) {
    Napi::Object o = Napi::Object::New(env);
    o.Set("name", devices[i].name);
    o.Set("outputs", devices[i].outputs);
    o.Set("inputs", devices[i].inputs);
    o.Set("defaultOutput", devices[i].defaultOutput);
    o.Set("defaultInput", devices[i].defaultInput);
    o.Set("preferredRate", devices[i].preferredRate);
    Napi::Array rates = Napi::Array::New(env, devices[i].rates.size());
    for (size_t r = 0; r < devices[i].rates.size(); r++) rates.Set((uint32_t)r, devices[i].rates[r]);
    o.Set("rates", rates);
    windows.Set((uint32_t)i, o);
  }
  out.Set("windows", windows);
  return out;
}

// describeAsio(name) → what the driver offers. Loads it for a moment.
Napi::Value describeAsio(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  const std::string name = textArg(info, 0, "name");
  return asioObject(env, hostNow(env, [&name] { return cp::AsioDevice::describe(name); }));
}

Napi::Value pluginPaths(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  const auto paths = cp::pluginPaths();
  Napi::Array out = Napi::Array::New(env, paths.size());
  for (size_t i = 0; i < paths.size(); i++) out.Set((uint32_t)i, paths[i]);
  return out;
}

Napi::Value describePlugins(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  const std::string path = textArg(info, 0, "path");
  const auto list = hostNow(env, [&path] { return cp::describePlugins(path); });
  Napi::Array out = Napi::Array::New(env, list.size());
  for (size_t i = 0; i < list.size(); i++) out.Set((uint32_t)i, describe(env, list[i]));
  return out;
}

Napi::Object init(Napi::Env env, Napi::Object exports) {
  PluginWrap::define(env);
  exports.Set("loadPlugin", Napi::Function::New(env, PluginWrap::load));
  exports.Set("AudioIO", AudioWrap::define(env));
  exports.Set("Mixdown", MixdownWrap::define(env));
  exports.Set("audioDevices", Napi::Function::New(env, audioDevices));
  exports.Set("describeAsio", Napi::Function::New(env, describeAsio));
  exports.Set("pluginPaths", Napi::Function::New(env, pluginPaths));
  exports.Set("describePlugins", Napi::Function::New(env, describePlugins));
  return exports;
}

}  // namespace

NODE_API_MODULE(chordpath_native, init)
