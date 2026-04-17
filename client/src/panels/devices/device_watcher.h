#pragma once

// DeviceWatcher — zero-overhead OS-event-driven mount detection.
//
// Wraps platform APIs that notify when volumes are mounted/unmounted:
//   macOS   — kqueue EVFILT_VNODE on /Volumes  (NOTE_WRITE fires on mount/unmount)
//   Linux   — inotify on /media and /mnt
//   Windows — FindFirstChangeNotification on drive roots
//
// Usage:
//   DeviceWatcher w;
//   // each frame (non-blocking):
//   if (w.has_changed()) { rescan(); }
//
// has_changed() consumes the pending event; the next call returns false
// until another mount/unmount occurs.

namespace misty::panel {

class DeviceWatcher {
public:
    DeviceWatcher();
    ~DeviceWatcher();

    // Non-blocking: returns true if a mount/unmount event arrived since the
    // last call that returned true.  Safe to call every frame.
    bool has_changed();

    // Non-copyable
    DeviceWatcher(const DeviceWatcher&)            = delete;
    DeviceWatcher& operator=(const DeviceWatcher&) = delete;

private:
#if defined(__APPLE__)
    int kq_ = -1;
    int fd_ = -1;
#elif defined(__linux__)
    int ifd_ = -1;
#elif defined(_WIN32)
    void* handle_ = nullptr; // HANDLE
#endif
};

} // namespace misty::panel
