#ifdef __linux__

#include "panels/devices/device_watcher.h"

#include <climits>
#include <cstdint>
#include <sys/inotify.h>
#include <unistd.h>

namespace misty::panel {

DeviceWatcher::DeviceWatcher() {
    ifd_ = inotify_init1(IN_NONBLOCK | IN_CLOEXEC);
    if (ifd_ < 0) return;

    const uint32_t mask = IN_CREATE | IN_DELETE | IN_MOVED_FROM | IN_MOVED_TO;
    inotify_add_watch(ifd_, "/media",     mask);
    inotify_add_watch(ifd_, "/mnt",       mask);
    inotify_add_watch(ifd_, "/run/media", mask);
}

DeviceWatcher::~DeviceWatcher() {
    if (ifd_ >= 0) close(ifd_);
}

bool DeviceWatcher::has_changed() {
    if (ifd_ < 0) return false;
    char buf[sizeof(struct inotify_event) + NAME_MAX + 1];
    bool got_event = false;
    while (read(ifd_, buf, sizeof(buf)) > 0)
        got_event = true;
    return got_event;
}

} // namespace misty::panel

#endif // __linux__
