/* ChordPath — native/src/hostthread.cpp
 * See hostthread.h.
 */
#include "hostthread.h"

#include <windows.h>
#include <ole2.h>

#include <condition_variable>
#include <memory>
#include <mutex>
#include <thread>

namespace cp {

namespace {

const UINT RUN_TASK = WM_APP + 71;

struct Host {
  DWORD threadId = 0;
  HWND window = nullptr;
  std::mutex startLock;
  std::condition_variable started;
  bool ready = false;
};

Host& host() {
  static Host* made = new Host();       // lives as long as the process: plugins may still be running at exit
  return *made;
}

LRESULT CALLBACK hostProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam) {
  if (message == RUN_TASK) {
    std::unique_ptr<std::function<void()>> task(reinterpret_cast<std::function<void()>*>(lParam));
    // A task must never take the thread down with it: the caller is told instead (see runOnHost).
    try { (*task)(); } catch (...) {}
    return 0;
  }
  return DefWindowProcW(hwnd, message, wParam, lParam);
}

void hostMain() {
  Host& h = host();
  // Plugins use the clipboard and drag and drop, so the full OLE set-up.
  OleInitialize(nullptr);
  WNDCLASSW wc = {};
  wc.lpfnWndProc = hostProc;
  wc.hInstance = GetModuleHandleW(nullptr);
  wc.lpszClassName = L"ChordPathHostThread";
  RegisterClassW(&wc);
  HWND window = CreateWindowExW(0, wc.lpszClassName, L"ChordPath", WS_OVERLAPPED, 0, 0, 0, 0, nullptr, nullptr, wc.hInstance, nullptr);
  {
    std::lock_guard<std::mutex> lock(h.startLock);
    h.threadId = GetCurrentThreadId();
    h.window = window;
    h.ready = true;
  }
  h.started.notify_all();
  MSG msg;
  while (GetMessageW(&msg, nullptr, 0, 0) > 0) {
    TranslateMessage(&msg);
    DispatchMessageW(&msg);
  }
}

std::once_flag startOnce;

void start() {
  std::call_once(startOnce, [] {
    Host& h = host();
    std::thread(hostMain).detach();
    std::unique_lock<std::mutex> lock(h.startLock);
    h.started.wait(lock, [&h] { return h.ready; });
  });
}

}  // namespace

bool onHostThread() {
  Host& h = host();
  return h.ready && GetCurrentThreadId() == h.threadId;
}

void postToHost(std::function<void()> task) {
  start();
  auto* boxed = new std::function<void()>(std::move(task));
  if (!PostMessageW(host().window, RUN_TASK, 0, reinterpret_cast<LPARAM>(boxed))) delete boxed;
}

void runOnHost(const std::function<void()>& task) {
  start();
  if (onHostThread()) {
    task();
    return;
  }
  std::promise<void> done;
  postToHost([&] {
    try {
      task();
      done.set_value();
    } catch (...) {
      done.set_exception(std::current_exception());
    }
  });
  done.get_future().get();
}

void* hostWindow() {
  start();
  return host().window;
}

}  // namespace cp
