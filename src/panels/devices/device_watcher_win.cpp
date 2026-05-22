#ifdef _WIN32

#include "panels/devices/device_watcher.h"

#include <windows.h>

namespace misty::panel {

DeviceWatcher::DeviceWatcher() {
    handle_ = FindFirstChangeNotificationA(
        "\\", FALSE, FILE_NOTIFY_CHANGE_DIR_NAME);
}

DeviceWatcher::~DeviceWatcher() {
    if (handle_ && handle_ != INVALID_HANDLE_VALUE)
        FindCloseChangeNotification(static_cast<HANDLE>(handle_));
}

bool DeviceWatcher::has_changed() {
    if (!handle_ || handle_ == INVALID_HANDLE_VALUE) return false;
    DWORD r = WaitForSingleObject(static_cast<HANDLE>(handle_), 0);
    if (r == WAIT_OBJECT_0) {
        FindNextChangeNotification(static_cast<HANDLE>(handle_));
        return true;
    }
    return false;
}

} // namespace misty::panel

#endif // _WIN32
