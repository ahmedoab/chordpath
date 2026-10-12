/* ChordPath — native/src/addon.cpp
 * The JavaScript face of the native audio host. Everything is checked on the
 * way in: a wrong argument throws a JavaScript error rather than reaching
 * the plugin code behind it.
 */
#include <napi.h>

#include "vsthost.h"

#include <memory>
#include <stdexcept>

namespace {

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

std::string textArg(const Napi::CallbackInfo& info, size_t index, const char* what) {
  if (info.Length() <= index || !info[index].IsString()) throw Napi::TypeError::New(info.Env(), std::string(what) + " must be text");
  return info[index].As<Napi::String>().Utf8Value();
}

double numberArg(const Napi::CallbackInfo& info, size_t index, const char* what) {
  if (info.Length() <= index || !info[index].IsNumber()) throw Napi::TypeError::New(info.Env(), std::string(what) + " must be a number");
  return info[index].As<Napi::Number>().DoubleValue();
}

// ── Plugin ──────────────────────────────────────────────────────────────────
class PluginWrap : public Napi::ObjectWrap<PluginWrap> {
 public:
  static Napi::Function define(Napi::Env env) {
    return DefineClass(env, "Plugin", {
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
      InstanceMethod("dispose", &PluginWrap::dispose),
    });
  }

  // new Plugin({ path, uid, sampleRate, blockSize })
  explicit PluginWrap(const Napi::CallbackInfo& info) : Napi::ObjectWrap<PluginWrap>(info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsObject()) throw Napi::TypeError::New(env, "Plugin needs { path, uid, sampleRate, blockSize }");
    Napi::Object o = info[0].As<Napi::Object>();
    if (!o.Get("path").IsString()) throw Napi::TypeError::New(env, "path must be text");
    const std::string path = o.Get("path").As<Napi::String>().Utf8Value();
    const std::string uid = o.Get("uid").IsString() ? o.Get("uid").As<Napi::String>().Utf8Value() : std::string();
    const double rate = o.Get("sampleRate").IsNumber() ? o.Get("sampleRate").As<Napi::Number>().DoubleValue() : 44100;
    const int block = o.Get("blockSize").IsNumber() ? o.Get("blockSize").As<Napi::Number>().Int32Value() : 512;
    if (!(rate >= 8000 && rate <= 384000)) throw Napi::RangeError::New(env, "sampleRate is out of range");
    try {
      plugin = cp::Plugin::load(path, uid, rate, block);
    } catch (const std::exception& e) {
      throw Napi::Error::New(env, e.what());
    }
  }

 private:
  std::unique_ptr<cp::Plugin> plugin;

  cp::Plugin& live(const Napi::CallbackInfo& info) {
    if (!plugin) throw Napi::Error::New(info.Env(), "The plugin has been closed");
    return *plugin;
  }

  Napi::Value info(const Napi::CallbackInfo& info) {
    cp::Plugin& p = live(info);
    Napi::Object o = describe(info.Env(), p.description());
    o.Set("inputs", p.inputChannels());
    o.Set("outputs", p.outputChannels());
    o.Set("latency", p.latencySamples());
    o.Set("tail", p.tailSeconds());
    o.Set("hasEditor", p.hasEditor());
    o.Set("bypassed", p.bypassed());
    return o;
  }

  Napi::Value parameters(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    const auto list = live(info).parameters();
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
    return Napi::Number::New(info.Env(), live(info).getParam((uint32_t)numberArg(info, 0, "id")));
  }
  void setParam(const Napi::CallbackInfo& info) {
    live(info).setParam((uint32_t)numberArg(info, 0, "id"), numberArg(info, 1, "value"));
  }
  Napi::Value paramText(const Napi::CallbackInfo& info) {
    cp::Plugin& p = live(info);
    const uint32_t id = (uint32_t)numberArg(info, 0, "id");
    const double value = info.Length() > 1 && info[1].IsNumber() ? info[1].As<Napi::Number>().DoubleValue() : p.getParam(id);
    return Napi::String::New(info.Env(), p.paramText(id, value));
  }

  // process(left, right): two Float32Arrays of the same length, changed in place.
  void process(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    cp::Plugin& p = live(info);
    if (info.Length() < 2 || !info[0].IsTypedArray() || !info[1].IsTypedArray()) throw Napi::TypeError::New(env, "process needs two Float32Arrays");
    Napi::TypedArray a = info[0].As<Napi::TypedArray>(), b = info[1].As<Napi::TypedArray>();
    if (a.TypedArrayType() != napi_float32_array || b.TypedArrayType() != napi_float32_array) throw Napi::TypeError::New(env, "process needs two Float32Arrays");
    Napi::Float32Array left = a.As<Napi::Float32Array>(), right = b.As<Napi::Float32Array>();
    if (left.ElementLength() != right.ElementLength()) throw Napi::RangeError::New(env, "left and right must be the same length");
    if (left.ElementLength() > 16 * 1024 * 1024) throw Napi::RangeError::New(env, "too much audio for one call");
    p.process(left.Data(), right.Data(), (int)left.ElementLength());
  }

  void noteOn(const Napi::CallbackInfo& info) {
    const int pitch = (int)numberArg(info, 0, "pitch");
    const double velocity = info.Length() > 1 && info[1].IsNumber() ? info[1].As<Napi::Number>().DoubleValue() : 0.8;
    const int offset = info.Length() > 2 && info[2].IsNumber() ? info[2].As<Napi::Number>().Int32Value() : 0;
    if (pitch < 0 || pitch > 127) throw Napi::RangeError::New(info.Env(), "pitch must be 0 to 127");
    live(info).noteOn(pitch, (float)(velocity < 0 ? 0 : velocity > 1 ? 1 : velocity), offset);
  }
  void noteOff(const Napi::CallbackInfo& info) {
    const int pitch = (int)numberArg(info, 0, "pitch");
    const int offset = info.Length() > 1 && info[1].IsNumber() ? info[1].As<Napi::Number>().Int32Value() : 0;
    if (pitch < 0 || pitch > 127) throw Napi::RangeError::New(info.Env(), "pitch must be 0 to 127");
    live(info).noteOff(pitch, offset);
  }
  void allNotesOff(const Napi::CallbackInfo& info) { live(info).allNotesOff(); }

  // setTransport({ tempo, playing, position, meter: [num, den] })
  void setTransport(const Napi::CallbackInfo& info) {
    cp::Plugin& p = live(info);
    if (info.Length() < 1 || !info[0].IsObject()) throw Napi::TypeError::New(info.Env(), "setTransport needs an object");
    Napi::Object o = info[0].As<Napi::Object>();
    cp::Transport t;
    if (o.Get("tempo").IsNumber()) t.tempo = o.Get("tempo").As<Napi::Number>().DoubleValue();
    if (o.Get("playing").IsBoolean()) t.playing = o.Get("playing").As<Napi::Boolean>().Value();
    if (o.Get("position").IsNumber()) t.positionBeats = o.Get("position").As<Napi::Number>().DoubleValue();
    if (o.Get("meterNum").IsNumber()) t.meterNum = o.Get("meterNum").As<Napi::Number>().Int32Value();
    if (o.Get("meterDen").IsNumber()) t.meterDen = o.Get("meterDen").As<Napi::Number>().Int32Value();
    if (!(t.tempo >= 20 && t.tempo <= 999)) t.tempo = 120;
    p.setTransport(t);
  }

  void setBypassed(const Napi::CallbackInfo& info) { live(info).setBypassed(info.Length() > 0 && info[0].ToBoolean().Value()); }
  void setOffline(const Napi::CallbackInfo& info) { live(info).setOffline(info.Length() > 0 && info[0].ToBoolean().Value()); }

  Napi::Value getState(const Napi::CallbackInfo& info) {
    const auto bytes = live(info).getState();
    return Napi::Buffer<uint8_t>::Copy(info.Env(), bytes.data(), bytes.size());
  }
  Napi::Value setState(const Napi::CallbackInfo& info) {
    cp::Plugin& p = live(info);
    if (info.Length() < 1 || !info[0].IsTypedArray()) throw Napi::TypeError::New(info.Env(), "setState needs the bytes getState gave");
    Napi::TypedArray array = info[0].As<Napi::TypedArray>();
    if (array.TypedArrayType() != napi_uint8_array) throw Napi::TypeError::New(info.Env(), "setState needs the bytes getState gave");
    Napi::Uint8Array bytes = array.As<Napi::Uint8Array>();
    if (bytes.ByteLength() > 64 * 1024 * 1024) throw Napi::RangeError::New(info.Env(), "that state is too large");
    return Napi::Boolean::New(info.Env(), p.setState(bytes.Data(), bytes.ByteLength()));
  }

  // openEditor({ title, visible })
  Napi::Value openEditor(const Napi::CallbackInfo& info) {
    cp::Plugin& p = live(info);
    std::string title;
    bool visible = true;
    if (info.Length() > 0 && info[0].IsObject()) {
      Napi::Object o = info[0].As<Napi::Object>();
      if (o.Get("title").IsString()) title = o.Get("title").As<Napi::String>().Utf8Value();
      if (o.Get("visible").IsBoolean()) visible = o.Get("visible").As<Napi::Boolean>().Value();
    }
    return Napi::Boolean::New(info.Env(), p.openEditor(title, visible));
  }
  void closeEditor(const Napi::CallbackInfo& info) { live(info).closeEditor(); }
  Napi::Value editor(const Napi::CallbackInfo& info) {
    cp::Plugin& p = live(info);
    int width = 0, height = 0;
    p.editorSize(width, height);
    Napi::Object o = Napi::Object::New(info.Env());
    o.Set("open", p.editorOpen());
    o.Set("width", width);
    o.Set("height", height);
    return o;
  }

  void dispose(const Napi::CallbackInfo&) { plugin.reset(); }
};

// ── Finding plugins ─────────────────────────────────────────────────────────
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
  try {
    const auto list = cp::describePlugins(path);
    Napi::Array out = Napi::Array::New(env, list.size());
    for (size_t i = 0; i < list.size(); i++) out.Set((uint32_t)i, describe(env, list[i]));
    return out;
  } catch (const std::exception& e) {
    throw Napi::Error::New(env, e.what());
  }
}

void pumpMessages(const Napi::CallbackInfo& info) {
  cp::pumpMessages((int)numberArg(info, 0, "milliseconds"));
}

Napi::Object init(Napi::Env env, Napi::Object exports) {
  exports.Set("Plugin", PluginWrap::define(env));
  exports.Set("pluginPaths", Napi::Function::New(env, pluginPaths));
  exports.Set("describePlugins", Napi::Function::New(env, describePlugins));
  exports.Set("pumpMessages", Napi::Function::New(env, pumpMessages));
  return exports;
}

}  // namespace

NODE_API_MODULE(chordpath_native, init)
