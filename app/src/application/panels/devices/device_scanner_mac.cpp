#ifdef __APPLE__

#include "panels/devices/device_state.h"

#include <sys/mount.h>
#include <filesystem>
#include <algorithm>
#include <unordered_set>

namespace fs = std::filesystem;

namespace misty::panel {

std::vector<MountedDevice> scan_mounted_devices() {
    static const std::unordered_set<std::string> kSkipTypes = {
        "devfs", "autofs", "synthfs", "nullfs", "union",
        "fdesc", "kernfs", "procfs", "linsysfs", "com.apple.osxfuse"
    };

    struct statfs* mounts = nullptr;
    int count = getmntinfo(&mounts, MNT_NOWAIT);
    if (count <= 0) return {};

    std::vector<MountedDevice> result;
    result.reserve(count);

    for (int i = 0; i < count; ++i) {
        const struct statfs& m = mounts[i];

        std::string fstype     = m.f_fstypename;
        std::string mountpoint = m.f_mntonname;

        if (kSkipTypes.count(fstype)) continue;
        if (!(m.f_flags & MNT_LOCAL))  continue;

        if (mountpoint.rfind("/System",  0) == 0) continue;
        if (mountpoint.rfind("/private", 0) == 0) continue;
        if (mountpoint.rfind("/dev",     0) == 0) continue;

        MountedDevice dev;
        dev.fs_type    = fstype;
        dev.mount_path = mountpoint;
        dev.name       = (mountpoint == "/")
            ? "Macintosh HD"
            : fs::path(mountpoint).filename().string();

#ifdef MNT_REMOVABLE
        dev.is_removable = (m.f_flags & MNT_REMOVABLE) != 0;
#else
        dev.is_removable = (mountpoint != "/" &&
                            mountpoint.rfind("/Volumes/", 0) == 0);
#endif

        if (m.f_blocks > 0) {
            dev.total_bytes = static_cast<uint64_t>(m.f_blocks) * m.f_bsize;
            dev.free_bytes  = static_cast<uint64_t>(m.f_bavail) * m.f_bsize;
        }

        result.push_back(std::move(dev));
    }

    std::sort(result.begin(), result.end(), [](const MountedDevice& a, const MountedDevice& b) {
        if (a.mount_path == "/") return true;
        if (b.mount_path == "/") return false;
        return a.name < b.name;
    });

    return result;
}

} // namespace misty::panel

#endif // __APPLE__
