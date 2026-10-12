/* ChordPath — native/src/hostthread.h
 * The host thread: one thread, with a Windows message loop of its own, that
 * owns everything with a window or a COM apartment — the plugins, their
 * editor windows and the ASIO driver.
 *
 * Plugins expect all their non-audio calls to come from the thread that also
 * runs their windows. Keeping that thread separate from the one JavaScript
 * runs on means a plugin that is slow to open, or a window being dragged,
 * never holds up the audio passing through.
 */
#pragma once

#include <exception>
#include <functional>
#include <future>
#include <type_traits>
#include <utility>

namespace cp {

bool onHostThread();

// Runs the task on the host thread some time soon and returns at once.
void postToHost(std::function<void()> task);

// Runs the task on the host thread and waits for it. Whatever it throws is
// thrown here instead.
void runOnHost(const std::function<void()>& task);

template <class F>
auto onHost(F&& work) -> decltype(work()) {
  using R = decltype(work());
  if constexpr (std::is_void_v<R>) {
    runOnHost(std::function<void()>(std::forward<F>(work)));
  } else {
    std::promise<R> made;
    runOnHost([&] { made.set_value(work()); });
    return made.get_future().get();
  }
}

// A hidden window on the host thread: what drivers and dialogs are given as
// "the application's window".
void* hostWindow();

}  // namespace cp
