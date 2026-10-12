/* ChordPath — native/src/mixer.cpp
 * See mixer.h.
 */
#include "mixer.h"

#include "dsp.h"

#include <xmmintrin.h>
#include <pmmintrin.h>

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cmath>
#include <cstring>
#include <mutex>

namespace cp {

namespace {

const double PI = 3.14159265358979323846;
const double GLIDE_SECONDS = 0.015;     // how fast a fader follows its setting, as in the page's engine
const unsigned EVENT_ROOM = 8192;       // notes that can be waiting their turn

// Who gets what, fixed for as long as one block takes to mix.
struct Routing {
  std::vector<Chain> strips;
  Chain master;
  std::vector<unsigned> wait;           // frames each strip is held back so that all arrive together
  unsigned most = 0;                    // the slowest strip's plugins
  unsigned masterLatency = 0;
};

struct Reverb {
  Convolver left, right;
  Reverb(const float* l, const float* r, size_t n) : left(l, n), right(r, n) {}
};

struct Stamped {
  NoteEvent event;
  uint32_t generation = 0;
  uint32_t order = 0;
};

// The soonest note on top; where two fall on the same frame, a note ending
// goes before a note starting, and otherwise first come, first served.
bool later(const Stamped& a, const Stamped& b) {
  if (a.event.frame != b.event.frame) return a.event.frame > b.event.frame;
  if (a.event.on != b.event.on) return a.event.on;
  return a.order > b.order;
}

unsigned chainLatency(const Chain& chain) {
  unsigned total = 0;
  for (const auto& slot : chain) total += (unsigned)std::max(0, slot.plugin->latencySamples());
  return total;
}

// outL = m[0]·L + m[1]·R, outR = m[2]·L + m[3]·R: the fader and the Web
// Audio API's pan for a stereo signal, in one.
void faderMatrix(float gain, float pan, float m[4]) {
  if (pan <= 0) {
    const double x = (pan + 1.0) * PI / 2.0;
    m[0] = gain;
    m[1] = gain * (float)std::cos(x);
    m[2] = 0;
    m[3] = gain * (float)std::sin(x);
  } else {
    const double x = pan * PI / 2.0;
    m[0] = gain * (float)std::cos(x);
    m[1] = 0;
    m[2] = gain * (float)std::sin(x);
    m[3] = gain;
  }
}

template <class T>
using Retired = std::vector<std::pair<std::chrono::steady_clock::time_point, std::shared_ptr<T>>>;

// The audio thread may still be using what was just replaced; it is kept a
// little longer and let go of here, never there.
template <class T>
void retire(Retired<T>& list, std::shared_ptr<T> old) {
  const auto now = std::chrono::steady_clock::now();
  list.erase(std::remove_if(list.begin(), list.end(), [now](const auto& entry) {
    return now - entry.first > std::chrono::seconds(2);
  }), list.end());
  if (old) list.emplace_back(now, std::move(old));
}

}  // namespace

struct Mixer::Impl {
  int count = 0;
  double rate = 48000;
  unsigned maxBlock = 512;
  unsigned maxWait = 48000;

  struct Strip {
    std::atomic<bool> active{false};
    std::atomic<float> gain{1}, pan{0}, reverb{0}, echo{0};
    float nowGain = 1, nowPan = 0, nowReverb = 0, nowEcho = 0;
    DelayLine waitL, waitR;
    std::atomic<float> peakL{0}, peakR{0};
  };
  std::unique_ptr<Strip[]> strips;
  DelayLine directL, directR;

  std::mutex controlLock;                           // one controller at a time
  std::shared_ptr<const Routing> routing;
  Retired<const Routing> oldRoutings;
  std::shared_ptr<Reverb> reverb;
  Retired<Reverb> oldReverbs;
  Transport transport;

  std::mutex masterLock;
  MasterSettings pendingMaster;
  std::atomic<bool> masterChanged{true};
  MasterSettings master;
  float nowMaster = 1;
  std::atomic<unsigned> limiterDelay{0};
  Echo echoL, echoR;
  Limiter limiter;

  std::atomic<int> monitorStrip{-1};
  std::atomic<float> monitorGain{1};
  std::atomic<bool> snapRequested{true};
  std::atomic<float> masterPeakL{0}, masterPeakR{0};

  // Notes on their way to instruments: handed over through `queue`, then kept in time order in `waiting`.
  std::vector<Stamped> queue;
  std::atomic<uint32_t> queueWrite{0}, queueRead{0};
  std::atomic<uint32_t> generation{0};
  uint32_t order = 0;
  std::vector<Stamped> waiting;

  std::vector<float> bufL, bufR, sumL, sumR, revL, revR, echL, echR, tmpL, tmpR;

  Impl(int strips_, double sampleRate, unsigned block)
      : count(strips_), rate(sampleRate), maxBlock(block), maxWait((unsigned)sampleRate),
        echoL(sampleRate, 2.0), echoR(sampleRate, 2.0), limiter(sampleRate, (unsigned)(sampleRate * 0.05)) {}

  void takeNotes(const Routing& routing, uint64_t streamFrame, unsigned streamFrames) {
    const uint32_t current = generation.load();
    uint32_t read = queueRead.load();
    const uint32_t write = queueWrite.load();
    while (read != write) {
      const Stamped& s = queue[read % EVENT_ROOM];
      if (s.generation == current && waiting.size() < EVENT_ROOM) {
        waiting.push_back(s);
        std::push_heap(waiting.begin(), waiting.end(), later);
      }
      read++;
    }
    queueRead.store(read);

    const uint64_t end = streamFrame + streamFrames;
    while (!waiting.empty()) {
      const Stamped& top = waiting.front();
      const bool stale = top.generation != current;
      const bool due = top.event.frame == 0 || (streamFrames && top.event.frame < end);
      if (!stale && !due) break;
      const Stamped s = top;
      std::pop_heap(waiting.begin(), waiting.end(), later);
      waiting.pop_back();
      if (stale) continue;
      const int offset = s.event.frame > streamFrame ? (int)(s.event.frame - streamFrame) : 0;
      Plugin* target = nullptr;
      for (const auto& chain : routing.strips) {
        for (const auto& slot : chain) if (slot.id == s.event.plugin) target = slot.plugin.get();
      }
      for (const auto& slot : routing.master) if (slot.id == s.event.plugin) target = slot.plugin.get();
      if (target) target->noteFromAudioThread(s.event.on, s.event.pitch, s.event.velocity, offset);
    }
  }
};

Mixer::Mixer(int strips, double sampleRate, unsigned maxBlock) : impl(new Impl(std::max(1, strips), sampleRate, std::max(16u, maxBlock))) {
  Impl& m = *impl;
  m.strips.reset(new Impl::Strip[m.count]);
  for (int s = 0; s < m.count; s++) {
    m.strips[s].waitL.resize(m.maxWait);
    m.strips[s].waitR.resize(m.maxWait);
  }
  m.directL.resize(m.maxWait * 2);
  m.directR.resize(m.maxWait * 2);
  auto routing = std::make_shared<Routing>();
  routing->strips.resize(m.count);
  routing->wait.assign(m.count, 0);
  m.routing = routing;
  m.queue.resize(EVENT_ROOM);
  m.waiting.reserve(EVENT_ROOM);
  for (auto* buffer : {&m.bufL, &m.bufR, &m.sumL, &m.sumR, &m.revL, &m.revR, &m.echL, &m.echR, &m.tmpL, &m.tmpR}) {
    buffer->assign(m.maxBlock, 0.0f);
  }
}

Mixer::~Mixer() {}

int Mixer::strips() const { return impl->count; }
double Mixer::sampleRate() const { return impl->rate; }
unsigned Mixer::width() const { return (unsigned)(impl->count + 1) * 2; }

void Mixer::setStrip(int strip, const StripSettings& settings) {
  if (strip < 0 || strip >= impl->count) return;
  Impl::Strip& s = impl->strips[strip];
  s.gain.store(std::max(0.0f, std::min(8.0f, settings.gain)));
  s.pan.store(std::max(-1.0f, std::min(1.0f, settings.pan)));
  s.reverb.store(std::max(0.0f, std::min(4.0f, settings.reverb)));
  s.echo.store(std::max(0.0f, std::min(4.0f, settings.echo)));
  s.active.store(settings.active);
}

void Mixer::setMaster(const MasterSettings& settings) {
  std::lock_guard<std::mutex> lock(impl->masterLock);
  impl->pendingMaster = settings;
  impl->pendingMaster.limiterDelay = std::min(settings.limiterDelay, (unsigned)(impl->rate * 0.05));
  impl->limiterDelay.store(impl->pendingMaster.limiterDelay);
  impl->masterChanged.store(true);
}

void Mixer::setReverb(const float* left, const float* right, size_t length) {
  std::shared_ptr<Reverb> made = left && right && length ? std::make_shared<Reverb>(left, right, length) : nullptr;
  std::lock_guard<std::mutex> lock(impl->controlLock);
  retire(impl->oldReverbs, std::atomic_load(&impl->reverb));
  std::atomic_store(&impl->reverb, made);
}

void Mixer::setChain(int strip, const Chain& chain) {
  Impl& m = *impl;
  if (strip >= m.count) return;
  std::lock_guard<std::mutex> lock(m.controlLock);
  const std::shared_ptr<const Routing> old = std::atomic_load(&m.routing);
  auto next = std::make_shared<Routing>(*old);
  (strip < 0 ? next->master : next->strips[strip]) = chain;
  std::vector<unsigned> each(m.count);
  next->most = 0;
  for (int s = 0; s < m.count; s++) {
    each[s] = std::min(chainLatency(next->strips[s]), m.maxWait);
    next->most = std::max(next->most, each[s]);
  }
  for (int s = 0; s < m.count; s++) next->wait[s] = next->most - each[s];
  next->masterLatency = std::min(chainLatency(next->master), m.maxWait);
  for (const auto& slot : chain) slot.plugin->setTransport(m.transport);
  retire(m.oldRoutings, old);
  std::atomic_store(&m.routing, std::shared_ptr<const Routing>(next));
}

void Mixer::setMonitor(int strip, float gain) {
  impl->monitorGain.store(std::max(0.0f, std::min(4.0f, gain)));
  impl->monitorStrip.store(strip >= 0 && strip < impl->count ? strip : -1);
}

void Mixer::setTransport(const Transport& transport) {
  std::lock_guard<std::mutex> lock(impl->controlLock);
  impl->transport = transport;
  const std::shared_ptr<const Routing> routing = std::atomic_load(&impl->routing);
  for (const auto& chain : routing->strips) for (const auto& slot : chain) slot.plugin->setTransport(transport);
  for (const auto& slot : routing->master) slot.plugin->setTransport(transport);
}

bool Mixer::schedule(const NoteEvent& event) {
  Impl& m = *impl;
  std::lock_guard<std::mutex> lock(m.controlLock);
  const uint32_t write = m.queueWrite.load();
  if (write - m.queueRead.load() >= EVENT_ROOM) return false;
  Stamped& s = m.queue[write % EVENT_ROOM];
  s.event = event;
  s.event.pitch = std::max(0, std::min(127, event.pitch));
  s.event.velocity = std::max(0.0f, std::min(1.0f, event.velocity));
  s.generation = m.generation.load();
  s.order = m.order++;
  m.queueWrite.store(write + 1);
  return true;
}

void Mixer::clearEvents() { impl->generation.fetch_add(1); }
void Mixer::snap() { impl->snapRequested.store(true); }

unsigned Mixer::latencyFrames() const {
  const std::shared_ptr<const Routing> routing = std::atomic_load(&impl->routing);
  return routing->most + routing->masterLatency + impl->limiterDelay.load();
}

std::vector<float> Mixer::takePeaks() {
  std::vector<float> peaks;
  peaks.reserve((size_t)(impl->count + 1) * 2);
  for (int s = 0; s < impl->count; s++) {
    peaks.push_back(impl->strips[s].peakL.exchange(0));
    peaks.push_back(impl->strips[s].peakR.exchange(0));
  }
  peaks.push_back(impl->masterPeakL.exchange(0));
  peaks.push_back(impl->masterPeakR.exchange(0));
  return peaks;
}

void Mixer::process(const float* feeds, const float* inL, const float* inR, float* outL, float* outR,
                    unsigned frames, uint64_t streamFrame, unsigned streamFrames) {
  Impl& m = *impl;
  frames = std::min(frames, m.maxBlock);
  if (!frames) return;

  // Sounds dying away would otherwise slow to a crawl as their numbers shrink towards nothing.
  const unsigned savedFlush = _MM_GET_FLUSH_ZERO_MODE();
  const unsigned savedDenormals = _MM_GET_DENORMALS_ZERO_MODE();
  _MM_SET_FLUSH_ZERO_MODE(_MM_FLUSH_ZERO_ON);
  _MM_SET_DENORMALS_ZERO_MODE(_MM_DENORMALS_ZERO_ON);

  const std::shared_ptr<const Routing> routing = std::atomic_load(&m.routing);
  const std::shared_ptr<Reverb> reverb = std::atomic_load(&m.reverb);
  const bool snap = m.snapRequested.exchange(false);

  if (m.masterChanged.load() && m.masterLock.try_lock()) {
    m.master = m.pendingMaster;
    m.masterChanged.store(false);
    m.masterLock.unlock();
    m.echoL.set(m.master.echoSeconds, m.master.echoFeedback, m.master.echoDampHz, m.master.echoDampQ);
    m.echoR.set(m.master.echoSeconds, m.master.echoFeedback, m.master.echoDampHz, m.master.echoDampQ);
    m.limiter.set(m.master.limiterDelay, m.master.limiterGain, m.master.limiterThresholdDb, m.master.limiterRatio,
                  m.master.limiterAttack, m.master.limiterRelease);
  }

  m.takeNotes(*routing, streamFrame, std::min(streamFrames, frames));

  const float glide = snap ? 1.0f : 1.0f - (float)std::exp(-(double)frames / (GLIDE_SECONDS * m.rate));
  const float step = 1.0f / (float)frames;
  const unsigned width = this->width();
  const size_t bytes = frames * sizeof(float);
  for (auto* buffer : {&m.sumL, &m.sumR, &m.revL, &m.revR, &m.echL, &m.echR}) std::memset(buffer->data(), 0, bytes);
  const int monitor = inL ? m.monitorStrip.load() : -1;

  for (int s = 0; s < m.count; s++) {
    Impl::Strip& strip = m.strips[s];
    const Chain& chain = routing->strips[s];
    if (!strip.active.load() && chain.empty() && monitor != s) continue;

    float* L = m.bufL.data();
    float* R = m.bufR.data();
    if (feeds) {
      const float* src = feeds + (size_t)s * 2;
      for (unsigned i = 0; i < frames; i++) {
        L[i] = src[(size_t)i * width];
        R[i] = src[(size_t)i * width + 1];
      }
    } else {
      std::memset(L, 0, bytes);
      std::memset(R, 0, bytes);
    }
    if (monitor == s) {
      const float gain = m.monitorGain.load();
      const float* right = inR ? inR : inL;
      for (unsigned i = 0; i < frames; i++) {
        L[i] += inL[i] * gain;
        R[i] += right[i] * gain;
      }
    }
    for (const auto& slot : chain) slot.plugin->process(L, R, (int)frames);

    const unsigned wait = routing->wait[s];
    if (strip.waitL.delay() != wait) {
      strip.waitL.setDelay(wait);
      strip.waitR.setDelay(wait);
    }
    strip.waitL.process(L, frames);
    strip.waitR.process(R, frames);

    // The fader and pan, gliding to where they have been set, then the sends.
    const float gainTo = strip.nowGain + (strip.gain.load() - strip.nowGain) * glide;
    const float panTo = strip.nowPan + (strip.pan.load() - strip.nowPan) * glide;
    const float reverbTo = strip.nowReverb + (strip.reverb.load() - strip.nowReverb) * glide;
    const float echoTo = strip.nowEcho + (strip.echo.load() - strip.nowEcho) * glide;
    float from[4], to[4];
    faderMatrix(snap ? gainTo : strip.nowGain, snap ? panTo : strip.nowPan, from);
    faderMatrix(gainTo, panTo, to);
    const float reverbFrom = snap ? reverbTo : strip.nowReverb, echoFrom = snap ? echoTo : strip.nowEcho;
    float peakL = 0, peakR = 0;
    for (unsigned i = 0; i < frames; i++) {
      const float t = (float)i * step;
      const float l = (from[0] + (to[0] - from[0]) * t) * L[i] + (from[1] + (to[1] - from[1]) * t) * R[i];
      const float r = (from[2] + (to[2] - from[2]) * t) * L[i] + (from[3] + (to[3] - from[3]) * t) * R[i];
      const float toReverb = reverbFrom + (reverbTo - reverbFrom) * t;
      const float toEcho = echoFrom + (echoTo - echoFrom) * t;
      m.sumL[i] += l;
      m.sumR[i] += r;
      m.revL[i] += l * toReverb;
      m.revR[i] += r * toReverb;
      m.echL[i] += l * toEcho;
      m.echR[i] += r * toEcho;
      peakL = std::max(peakL, std::fabs(l));
      peakR = std::max(peakR, std::fabs(r));
    }
    strip.nowGain = gainTo;
    strip.nowPan = panTo;
    strip.nowReverb = reverbTo;
    strip.nowEcho = echoTo;
    if (peakL > strip.peakL.load()) strip.peakL.store(peakL);
    if (peakR > strip.peakR.load()) strip.peakR.store(peakR);
  }

  if (reverb) {
    reverb->left.process(m.revL.data(), m.tmpL.data(), frames);
    reverb->right.process(m.revR.data(), m.tmpR.data(), frames);
    const float back = m.master.reverbReturn;
    for (unsigned i = 0; i < frames; i++) {
      m.sumL[i] += m.tmpL[i] * back;
      m.sumR[i] += m.tmpR[i] * back;
    }
  }
  m.echoL.process(m.echL.data(), m.tmpL.data(), frames);
  m.echoR.process(m.echR.data(), m.tmpR.data(), frames);
  for (unsigned i = 0; i < frames; i++) {
    m.sumL[i] += m.tmpL[i];
    m.sumR[i] += m.tmpR[i];
  }

  for (const auto& slot : routing->master) slot.plugin->process(m.sumL.data(), m.sumR.data(), (int)frames);

  const float masterTo = m.nowMaster + (m.master.gain - m.nowMaster) * glide;
  const float masterFrom = snap ? masterTo : m.nowMaster;
  for (unsigned i = 0; i < frames; i++) {
    const float g = masterFrom + (masterTo - masterFrom) * (float)i * step;
    m.sumL[i] *= g;
    m.sumR[i] *= g;
  }
  m.nowMaster = masterTo;

  // The metronome joins here, held back as long as the music was.
  float* L = m.bufL.data();
  float* R = m.bufR.data();
  if (feeds) {
    const float* src = feeds + (size_t)m.count * 2;
    for (unsigned i = 0; i < frames; i++) {
      L[i] = src[(size_t)i * width];
      R[i] = src[(size_t)i * width + 1];
    }
  } else {
    std::memset(L, 0, bytes);
    std::memset(R, 0, bytes);
  }
  const unsigned directWait = routing->most + routing->masterLatency;
  if (m.directL.delay() != directWait) {
    m.directL.setDelay(directWait);
    m.directR.setDelay(directWait);
  }
  m.directL.process(L, frames);
  m.directR.process(R, frames);
  for (unsigned i = 0; i < frames; i++) {
    m.sumL[i] += L[i];
    m.sumR[i] += R[i];
  }

  m.limiter.process(m.sumL.data(), m.sumR.data(), frames);

  float peakL = 0, peakR = 0;
  for (unsigned i = 0; i < frames; i++) {
    outL[i] = m.sumL[i];
    outR[i] = m.sumR[i];
    peakL = std::max(peakL, std::fabs(outL[i]));
    peakR = std::max(peakR, std::fabs(outR[i]));
  }
  if (peakL > m.masterPeakL.load()) m.masterPeakL.store(peakL);
  if (peakR > m.masterPeakR.load()) m.masterPeakR.store(peakR);

  _MM_SET_FLUSH_ZERO_MODE(savedFlush);
  _MM_SET_DENORMALS_ZERO_MODE(savedDenormals);
}

}  // namespace cp
