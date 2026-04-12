#ifdef __APPLE__

#include "panels/devices/device_watcher.h"

#include <sys/event.h>
#include <sys/time.h>
#include <fcntl.h>
#include <unistd.h>

namespace misty::panel {

DeviceWatcher::DeviceWatcher() {
    kq_ = kqueue();
    fd_ = open("/Volumes", O_RDONLY | O_EVTONLY | O_CLOEXEC);
    if (kq_ < 0 || fd_ < 0) return;

    struct kevent ev;
    EV_SET(&ev, fd_, EVFILT_VNODE, EV_ADD | EV_CLEAR,
           NOTE_WRITE | NOTE_DELETE | NOTE_RENAME, 0, nullptr);
    kevent(kq_, &ev, 1, nullptr, 0, nullptr);
}

DeviceWatcher::~DeviceWatcher() {
    if (fd_ >= 0) close(fd_);
    if (kq_ >= 0) close(kq_);
}

bool DeviceWatcher::has_changed() {
    if (kq_ < 0) return false;
    struct kevent ev;
    struct timespec ts = {0, 0};
    return kevent(kq_, nullptr, 0, &ev, 1, &ts) > 0;
}

} // namespace misty::panel

#endif // __APPLE__
