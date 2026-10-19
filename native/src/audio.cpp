/* ChordPath — native/src/audio.cpp
 * See audio.h.
 */
#include "audio.h"

#include "hostthread.h"

#include "RtAudio.h"

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cmath>
#include <cstring>
#include <stdexcept>
#include <thread>

namespace cp {

namespace {

const unsigned MAX_BLOCK = 8192;        // the largest block a card is allowed to ask for
const unsigned TAP_FRAMES = 1 << 17;    // about three seconds of the finished mix, kept for tests and meters
const unsigned KEPT = 4;                // frames of the stream kept from one block to the next
const unsigned LEAD = 2;                // how far behind the newest of them the mix reads, so a frame can be eased in or out
const unsigned GAP_ROOM = 64;

// One writer, one reader, no locks.
class Ring {
 public:
  void resize(size_t floats) {
    data.assign(std::max<size_t>(floats, 1), 0.0f);
    writeAt.store(0);
    readAt.store(0);
  }
  size_t readable() const { return (size_t)(writeAt.load() - readAt.load()); }
  size_t writable() const { return data.size() - readable(); }
  // Where the next `count` floats go: at most two runs, because the ring wraps.
  void place(size_t count, float*& first, size_t& firstCount, float*& second) {
    const size_t at = (size_t)(writeAt.load() % data.size());
    firstCount = std::min(count, data.size() - at);
    first = &data[at];
    second = &data[0];
  }
  void wrote(size_t count) { writeAt.fetch_add(count); }
  size_t write(const float* from, size_t count) {
    count = std::min(count, writable());
    float *first, *second;
    size_t firstCount;
    place(count, first, firstCount, second);
    std::memcpy(first, from, firstCount * sizeof(float));
    std::memcpy(second, from + firstCount, (count - firstCount) * sizeof(float));
    wrote(count);
    return count;
  }
  size_t read(float* to, size_t count) {
    count = std::min(count, readable());
    const size_t at = (size_t)(readAt.load() % data.size());
    const size_t first = std::min(count, data.size() - at);
    std::memcpy(to, &data[at], first * sizeof(float));
    std::memcpy(to + first, &data[0], (count - first) * sizeof(float));
    readAt.fetch_add(count);
    return count;
  }
  // Reader's side: pass over `count` floats without looking at them.
  void skip(size_t count) { readAt.fetch_add(std::min(count, readable())); }

 private:
  std::vector<float> data;
  std::atomic<uint64_t> writeAt{0}, readAt{0};
};

double seconds() {
  return std::chrono::duration<double>(std::chrono::steady_clock::now().time_since_epoch()).count();
}

// A smooth curve through four neighbouring samples, read `t` of the way from the second to the third.
inline float between(float a, float b, float c, float d, float t) {
  return b + 0.5f * t * (c - a + t * (2.0f * a - 5.0f * b + 4.0f * c - d + t * (3.0f * (b - c) + d - a)));
}

}  // namespace

std::vector<SoundDevice> windowsDevices() {
  RtAudio rt(RtAudio::WINDOWS_WASAPI);
  rt.showWarnings(false);
  std::vector<SoundDevice> out;
  for (unsigned id : rt.getDeviceIds()) {
    const RtAudio::DeviceInfo info = rt.getDeviceInfo(id);
    if (info.outputChannels == 0 && info.inputChannels == 0) continue;
    SoundDevice d;
    d.name = info.name;
    d.outputs = (int)info.outputChannels;
    d.inputs = (int)info.inputChannels;
    d.defaultOutput = info.isDefaultOutput;
    d.defaultInput = info.isDefaultInput;
    d.preferredRate = info.preferredSampleRate;
    d.rates = info.sampleRates;
    out.push_back(d);
  }
  return out;
}

struct AudioIO::Impl {
  AsioDevice asio;
  std::unique_ptr<RtAudio> rt;
  std::unique_ptr<Mixer> desk;
  bool opened = false;
  bool usingAsio = false;
  int inputChannels = 0;
  int strips = 0;
  unsigned width = 2;
  unsigned prebuffer = 0;
  unsigned surplus = 0;                         // more than the prebuffer plus this in hand is let go
  double sampleRate = 48000;
  double openedAt = 0;

  // The stream, as the app delivers it, and where frames were lost on the way in.
  Ring ring;
  struct Gap { uint64_t at; uint64_t frames; };
  Gap gaps[GAP_ROOM];
  std::atomic<uint32_t> gapWrite{0}, gapRead{0};
  uint64_t pushedFrames = 0, waitingGap = 0;    // the writer's own
  std::vector<float> scatter;

  // The audio thread's own.
  std::vector<float> work, eased;
  uint64_t readFrames = 0, streamAt = 0;
  bool keptLive = false;
  double level = 0, wanted = 0, flowed = 0;
  bool settled = false;
  int easing = 0;

  std::atomic<bool> flowing{false}, dropRequested{false}, muted{false}, paused{false}, pausedSeen{false};
  std::atomic<bool> recording{false}, recordFrom{false};
  std::atomic<uint64_t> received{0}, played{0}, lost{0}, blocks{0}, cardFrames{0};
  std::atomic<unsigned> underruns{0}, slips{0};
  std::atomic<double> load{0}, lastBlock{0};

  std::vector<float> tapL, tapR;                // the finished mix, going round and round
  std::atomic<uint64_t> tapAt{0};

  Ring inputL, inputR;
  std::atomic<uint64_t> takeStream{0}, takeCard{0};
  uint64_t taken = 0;

  static int fromRtAudio(void* out, void* in, unsigned frames, double, RtAudioStreamStatus, void* self) {
    Impl* m = static_cast<Impl*>(self);
    float* o = static_cast<float*>(out);
    const float* i = static_cast<const float*>(in);
    frames = std::min(frames, MAX_BLOCK);
    m->block(i, i && m->inputChannels > 1 ? i + frames : i, o, o + frames, frames);
    return 0;
  }

  void settle(unsigned have) {
    level = have;
    settled = false;
    flowed = 0;
    easing = 0;
  }

  // Whether to take one frame more or fewer than the card asked for, to keep
  // the stretch in hand where it settled.
  int ease(unsigned have, unsigned frames) {
    // `level` is the stretch in hand with the lumpiness of its arrival smoothed
    // out (over half a second); `wanted` is where it stood once things had settled.
    const double took = frames / sampleRate;
    flowed += took;
    level += (have - level) * std::min(1.0, took / 0.5);
    if (!settled) {
      if (flowed >= 2.0) { wanted = level; settled = true; }
      return 0;
    }
    const double band = std::max(48.0, sampleRate * 0.001);
    const double off = level - wanted;
    if (!easing) {
      if (off > band) easing = 1;
      else if (off < -band) easing = -1;
    } else if ((easing > 0 && off < band / 2) || (easing < 0 && off > -band / 2)) {
      easing = 0;
    }
    if (easing) level -= easing;                // what is about to happen to the stretch in hand
    return easing;
  }

  void applyGaps(uint64_t upTo) {
    uint32_t read = gapRead.load();
    const uint32_t write = gapWrite.load();
    while (read != write && gaps[read % GAP_ROOM].at <= upTo) {
      streamAt += gaps[read % GAP_ROOM].frames;
      read++;
    }
    gapRead.store(read);
  }

  void pass(unsigned count) {
    ring.skip((size_t)count * width);
    applyGaps(readFrames + count);
    readFrames += count;
    streamAt += count;
  }

  // Remembers the finished mix for capture().
  void keepMix(const float* left, const float* right, unsigned frames) {
    const uint64_t at = tapAt.load();
    for (unsigned i = 0; i < frames; i++) {
      tapL[(size_t)((at + i) % TAP_FRAMES)] = left[i];
      tapR[(size_t)((at + i) % TAP_FRAMES)] = right[i];
    }
    tapAt.store(at + frames);
  }

  // One block for the card.
  void block(const float* inL, const float* inR, float* outL, float* outR, unsigned frames) {
    const auto began = std::chrono::steady_clock::now();
    lastBlock.store(seconds());
    frames = std::min(frames, MAX_BLOCK);
    if (paused.load() || !desk) {
      pausedSeen.store(true);
      std::memset(outL, 0, frames * sizeof(float));
      std::memset(outR, 0, frames * sizeof(float));
      keepMix(outL, outR, frames);
      blocks.fetch_add(1);
      cardFrames.fetch_add(frames);
      return;
    }
    pausedSeen.store(false);

    unsigned have = (unsigned)(ring.readable() / width);
    if (dropRequested.exchange(false)) {
      pass(have);
      have = 0;
      flowing.store(false);
    }
    if (!flowing.load() && have >= prebuffer) {
      flowing.store(true);
      settle(have);
    }
    if (flowing.load() && have > prebuffer + surplus) {
      // The card fell behind for a while. Playing all of it would leave the sound that much late for good.
      pass(have - prebuffer);
      have = prebuffer;
      settle(have);
    }

    int slip = flowing.load() ? ease(have, frames) : 0;
    const unsigned want = (unsigned)((int)frames + slip);
    unsigned got = 0;
    float* stream = work.data();                // KEPT frames from last time, then this block's
    if (flowing.load()) {
      got = std::min(have, want);
      applyGaps(readFrames + got);
      ring.read(stream + (size_t)KEPT * width, (size_t)got * width);
      readFrames += got;
      if (got < want) {
        underruns.fetch_add(1);
        flowing.store(false);                   // it ran dry: build the reserve up again
        slip = 0;
      }
    }
    std::memset(stream + (size_t)(KEPT + got) * width, 0, (size_t)(frames + KEPT - got) * width * sizeof(float));

    const float* feeds = nullptr;
    if (slip) {
      // One frame more or fewer than usual, spread evenly across the block.
      const double stride = (double)got / (double)frames;
      float* to = eased.data();
      for (unsigned i = 0; i < frames; i++) {
        const double place = LEAD + i * stride;
        const unsigned at = (unsigned)place;
        const float t = (float)(place - at);
        const float* a = stream + (size_t)(at - 1) * width;
        for (unsigned c = 0; c < width; c++) to[c] = between(a[c], a[width + c], a[2 * width + c], a[3 * width + c], t);
        to += width;
      }
      feeds = eased.data();
      slips.fetch_add(1);
    } else if (got || keptLive) {
      feeds = stream + (size_t)LEAD * width;
    }
    const uint64_t first = streamAt >= LEAD ? streamAt - LEAD : 0;
    const unsigned carrying = got == want ? frames : std::min(frames, got + LEAD);
    if (recordFrom.exchange(false)) {
      takeStream.store(first);
      takeCard.store(cardFrames.load());
      recording.store(true);
    }
    desk->process(feeds, inL, inR, outL, outR, frames, first, feeds ? carrying : 0);
    streamAt += got;

    if (got == want && got) {
      std::memmove(stream, stream + (size_t)got * width, (size_t)KEPT * width * sizeof(float));
      keptLive = true;
    } else {
      std::memset(stream, 0, (size_t)KEPT * width * sizeof(float));
      keptLive = false;
    }

    if (recording.load() && inL) {
      inputL.write(inL, frames);
      inputR.write(inR ? inR : inL, frames);
    }

    keepMix(outL, outR, frames);

    if (muted.load()) {
      std::memset(outL, 0, frames * sizeof(float));
      std::memset(outR, 0, frames * sizeof(float));
    } else {
      // The last line of defence: nothing louder than full scale reaches the card.
      for (unsigned i = 0; i < frames; i++) {
        outL[i] = std::max(-1.0f, std::min(1.0f, outL[i]));
        outR[i] = std::max(-1.0f, std::min(1.0f, outR[i]));
      }
    }

    played.fetch_add(got);
    blocks.fetch_add(1);
    cardFrames.fetch_add(frames);
    const double took = std::chrono::duration<double>(std::chrono::steady_clock::now() - began).count();
    load.store(load.load() * 0.9 + (took / (frames / sampleRate)) * 0.1);
  }

  void prepare(const OpenRequest& request, unsigned rate, unsigned bufferFrames) {
    sampleRate = rate;
    strips = request.strips;
    desk.reset(new Mixer(strips, rate, MAX_BLOCK));
    width = desk->width();
    const unsigned least = bufferFrames + 256;
    const unsigned usual = std::max((unsigned)(rate * 0.04), bufferFrames + (unsigned)(rate * 0.025));
    prebuffer = std::max(least, request.prebufferFrames ? request.prebufferFrames : usual);
    prebuffer = std::min(prebuffer, rate);
    surplus = (unsigned)(rate * 0.25) + bufferFrames;
    ring.resize((size_t)(prebuffer + surplus + rate) * width);
    work.assign((size_t)(KEPT + MAX_BLOCK + 4) * width, 0.0f);
    eased.assign((size_t)MAX_BLOCK * width, 0.0f);
    scatter.assign((size_t)4096 * width, 0.0f);
    tapL.assign(TAP_FRAMES, 0.0f);
    tapR.assign(TAP_FRAMES, 0.0f);
    inputL.resize((size_t)rate * 20);
    inputR.resize((size_t)rate * 20);
    gapWrite = 0; gapRead = 0; pushedFrames = 0; waitingGap = 0;
    readFrames = 0; streamAt = 0; keptLive = false; taken = 0;
    received = 0; played = 0; lost = 0; blocks = 0; cardFrames = 0; underruns = 0; slips = 0; tapAt = 0;
    flowing = false; dropRequested = false; paused = false; pausedSeen = false; recording = false; recordFrom = false;
    muted = request.muted;
    load = 0;
    openedAt = seconds();
    lastBlock = openedAt;
    settle(0);
  }
};

AudioIO::AudioIO() : impl(new Impl()) {}
AudioIO::~AudioIO() {
  if (impl->opened) onHost([this] { close(); });
}

bool AudioIO::isOpen() const { return impl->opened; }
Mixer* AudioIO::mixer() { return impl->opened ? impl->desk.get() : nullptr; }

OpenResult AudioIO::open(const OpenRequest& request) {
  close();
  Impl& m = *impl;
  if (request.strips < 1 || request.strips > 64) throw std::runtime_error("There must be between 1 and 64 track strips");
  OpenResult result;
  result.api = request.api;
  result.strips = request.strips;

  if (request.api == "asio") {
    result.asio = m.asio.open(request.device, request.sampleRate, std::min(request.bufferFrames, MAX_BLOCK), request.firstOutput,
      request.useInput ? request.firstInput : -1,
      [&m](const float* inL, const float* inR, float* outL, float* outR, unsigned frames) { m.block(inL, inR, outL, outR, frames); });
    if (result.asio.bufferFrames > MAX_BLOCK) {
      m.asio.close();
      throw std::runtime_error("The driver insists on blocks too large to work with");
    }
    result.device = request.device;
    result.sampleRate = result.asio.rate;
    result.bufferFrames = result.asio.bufferFrames;
    result.outputLatency = result.asio.outputLatency;
    result.inputLatency = result.asio.inputLatency;
    result.inputs = result.asio.inputs;
    m.inputChannels = result.inputs;
    m.usingAsio = true;
    m.prepare(request, result.sampleRate, result.bufferFrames);
    try {
      m.asio.start();
    } catch (...) {
      m.asio.close();
      m.desk.reset();
      throw;
    }
  } else if (request.api == "wasapi") {
    m.rt.reset(new RtAudio(RtAudio::WINDOWS_WASAPI));
    m.rt->showWarnings(false);
    RtAudio::StreamParameters out, in;
    RtAudio::DeviceInfo outInfo, inInfo;
    bool foundOut = false, foundIn = false;
    for (unsigned id : m.rt->getDeviceIds()) {
      const RtAudio::DeviceInfo info = m.rt->getDeviceInfo(id);
      if (!foundOut && info.outputChannels >= 2 && (request.device.empty() ? info.isDefaultOutput : info.name == request.device)) {
        out.deviceId = id; outInfo = info; foundOut = true;
      }
      if (!foundIn && request.useInput && info.inputChannels >= 1 && (request.input.empty() ? info.isDefaultInput : info.name == request.input)) {
        in.deviceId = id; inInfo = info; foundIn = true;
      }
    }
    if (!foundOut) {
      m.rt.reset();
      throw std::runtime_error(request.device.empty() ? "Windows has no sound output to play through" : "Windows no longer lists \"" + request.device + "\"");
    }
    out.nChannels = 2;
    out.firstChannel = 0;
    m.inputChannels = 0;
    if (foundIn) {
      in.nChannels = std::min(2u, inInfo.inputChannels);
      in.firstChannel = 0;
      m.inputChannels = (int)in.nChannels;
    }
    const unsigned rate = request.sampleRate ? request.sampleRate : (outInfo.preferredSampleRate ? outInfo.preferredSampleRate : 48000);
    RtAudio::StreamOptions options;
    options.flags = RTAUDIO_NONINTERLEAVED | RTAUDIO_SCHEDULE_REALTIME;
    options.streamName = "ChordPath";
    unsigned frames = std::max(64u, std::min(request.bufferFrames ? request.bufferFrames : rate / 100, MAX_BLOCK));
    if (m.rt->openStream(&out, m.inputChannels ? &in : nullptr, RTAUDIO_FLOAT32, rate, &frames, &Impl::fromRtAudio, &m, &options) != RTAUDIO_NO_ERROR) {
      const std::string why = m.rt->getErrorText();
      m.rt.reset();
      throw std::runtime_error(why.empty() ? "The sound card would not open" : why);
    }
    if (frames > MAX_BLOCK) {
      m.rt->closeStream();
      m.rt.reset();
      throw std::runtime_error("The sound card insists on blocks too large to work with");
    }
    result.device = outInfo.name;
    result.sampleRate = m.rt->getStreamSampleRate();
    result.bufferFrames = frames;
    result.outputLatency = m.rt->getStreamLatency();
    result.inputs = m.inputChannels;
    m.usingAsio = false;
    m.prepare(request, result.sampleRate, result.bufferFrames);
    if (m.rt->startStream() != RTAUDIO_NO_ERROR) {
      const std::string why = m.rt->getErrorText();
      m.rt->closeStream();
      m.rt.reset();
      m.desk.reset();
      throw std::runtime_error(why.empty() ? "The sound card would not start" : why);
    }
  } else {
    throw std::runtime_error("There is no such sound-card system as \"" + request.api + "\"");
  }
  result.prebufferFrames = m.prebuffer;
  m.opened = true;
  return result;
}

void AudioIO::close() {
  Impl& m = *impl;
  m.opened = false;
  m.asio.close();
  if (m.rt) {
    // Closing stops the stream too. Stopping it first only adds a wait for
    // the card to play out, which a card that has stopped responding never does.
    if (m.rt->isStreamOpen()) m.rt->closeStream();
    m.rt.reset();
  }
  // The audio thread is gone, so the desk and its plugins can go.
  m.desk.reset();
  m.flowing = false;
}

bool AudioIO::showControlPanel() { return impl->usingAsio && impl->asio.showControlPanel(); }

bool AudioIO::push(const float* samples, unsigned frames, const int* slots, unsigned slotCount) {
  Impl& m = *impl;
  if (!m.opened || !frames || (!samples && slotCount)) return false;
  const unsigned width = m.width;
  if (m.ring.writable() / width < frames) {
    m.waitingGap += frames;
    m.lost.fetch_add(frames);
    return false;
  }
  // Frames that were turned away earlier are a hole in the stream just before these.
  if (m.waitingGap && m.gapWrite.load() - m.gapRead.load() < GAP_ROOM) {
    m.gaps[m.gapWrite.load() % GAP_ROOM] = {m.pushedFrames, m.waitingGap};
    m.gapWrite.fetch_add(1);
    m.waitingGap = 0;
  }
  const unsigned lump = (unsigned)(m.scatter.size() / width);
  for (unsigned done = 0; done < frames;) {
    const unsigned n = std::min(lump, frames - done);
    float* to = m.scatter.data();
    std::memset(to, 0, (size_t)n * width * sizeof(float));
    const float* from = samples + (size_t)done * slotCount * 2;
    for (unsigned s = 0; s < slotCount; s++) {
      const int slot = slots[s];
      if (slot < 0 || slot > m.strips) continue;
      for (unsigned i = 0; i < n; i++) {
        to[(size_t)i * width + (size_t)slot * 2] = from[(size_t)i * slotCount * 2 + (size_t)s * 2];
        to[(size_t)i * width + (size_t)slot * 2 + 1] = from[(size_t)i * slotCount * 2 + (size_t)s * 2 + 1];
      }
    }
    m.ring.write(to, (size_t)n * width);
    done += n;
  }
  m.pushedFrames += frames;
  m.received.fetch_add(frames);
  return true;
}

void AudioIO::flush() { impl->dropRequested.store(true); }

void AudioIO::setPaused(bool paused) {
  Impl& m = *impl;
  m.pausedSeen.store(false);
  m.paused.store(paused);
  if (!paused || !m.opened) return;
  // A card that has stopped asking for blocks is not using the plugins either.
  for (int i = 0; i < 60 && !m.pausedSeen.load(); i++) std::this_thread::sleep_for(std::chrono::milliseconds(5));
}

void AudioIO::setRecording(bool on) {
  Impl& m = *impl;
  if (!on) {
    m.recordFrom.store(false);
    m.recording.store(false);
    return;
  }
  if (m.recording.load()) return;
  m.inputL.skip(m.inputL.readable());
  m.inputR.skip(m.inputR.readable());
  m.taken = 0;
  m.recordFrom.store(true);                     // the audio thread notes where it starts
}

AudioIO::Take AudioIO::readInput(float* left, float* right, unsigned frames) {
  Impl& m = *impl;
  Take take;
  const unsigned ready = (unsigned)std::min(m.inputL.readable(), m.inputR.readable());
  take.frames = std::min(frames, ready);
  take.streamAt = m.takeStream.load() + m.taken;
  take.cardAt = m.takeCard.load() + m.taken;
  m.inputL.read(left, take.frames);
  m.inputR.read(right, take.frames);
  m.taken += take.frames;
  return take;
}

unsigned AudioIO::capture(float* left, float* right, unsigned frames) {
  Impl& m = *impl;
  if (m.tapL.empty()) return 0;
  const uint64_t end = m.tapAt.load();
  const unsigned count = (unsigned)std::min<uint64_t>(std::min<uint64_t>(frames, TAP_FRAMES), end);
  for (unsigned i = 0; i < count; i++) {
    const size_t at = (size_t)((end - count + i) % TAP_FRAMES);
    left[i] = m.tapL[at];
    right[i] = m.tapR[at];
  }
  return count;
}

IoStatus AudioIO::status() {
  Impl& m = *impl;
  IoStatus s;
  s.open = m.opened;
  if (!s.open) return s;
  s.flowing = m.flowing.load();
  s.received = m.received.load();
  s.played = m.played.load();
  s.lost = m.lost.load();
  s.buffered = (unsigned)(m.ring.readable() / m.width);
  s.underruns = m.underruns.load();
  s.slips = m.slips.load();
  s.blocks = m.blocks.load();
  s.cardFrames = m.cardFrames.load();
  s.load = m.load.load();
  s.idleSeconds = std::max(0.0, seconds() - m.lastBlock.load());
  s.latencyFrames = m.desk->latencyFrames() + LEAD;
  s.overloads = m.usingAsio ? m.asio.overloads() : 0;
  s.resetWanted = m.usingAsio && m.asio.takeResetRequest();
  s.peaks = m.desk->takePeaks();
  return s;
}

}  // namespace cp
