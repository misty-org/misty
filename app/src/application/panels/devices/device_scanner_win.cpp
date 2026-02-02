#ifdef _WIN32

#include "panels/devices/device_state.h"

#include <windows.h>

namespace misty::panel {

std::vector<MountedDevice> scan_mounted_devices() {
    std::vector<MountedDevice> result;

    DWORD drives = GetLogicalDrives();
    for (int i = 0; i < 26; ++i) {
        if (!(drives & (1 << i))) continue;

        char letter  = 'A' + i;
        std::string path = std::string(1, letter) + ":\\";

        UINT type = GetDriveTypeA(path.c_str());
        if (type == DRIVE_UNKNOWN || type == DRIVE_NO_ROOT_DIR) continue;

        MountedDevice dev;
        dev.mount_path   = path;
        dev.is_removable = (type == DRIVE_REMOVABLE);

        char volName[MAX_PATH + 1] = {};
        char fsName [MAX_PATH + 1] = {};
        GetVolumeInformationA(path.c_str(),
                              volName, sizeof(volName),
                              nullptr, nullptr, nullptr,
                              fsName,  sizeof(fsName));

        dev.name    = volName[0] ? std::string(volName) : path;
        dev.fs_type = fsName;

        ULARGE_INTEGER freeBytesAvail{}, totalBytes{};
        if (GetDiskFreeSpaceExA(path.c_str(), &freeBytesAvail, &totalBytes, nullptr)) {
            dev.total_bytes = totalBytes.QuadPart;
            dev.free_bytes  = freeBytesAvail.QuadPart;
        }

        result.push_back(std::move(dev));
    }

    return result;
}

} // namespace misty::panel

#endif // _WIN32
