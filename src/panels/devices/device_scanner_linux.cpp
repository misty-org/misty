#ifdef __linux__

#include "panels/devices/device_state.h"

#include <mntent.h>
#include <sys/statvfs.h>
#include <filesystem>
#include <algorithm>
#include <unordered_set>

namespace fs = std::filesystem;

namespace misty::panel {

std::vector<MountedDevice> scan_mounted_devices() {
    static const std::unordered_set<std::string> kSkipTypes = {
        "sysfs", "proc", "devtmpfs", "devpts", "tmpfs", "cgroup", "cgroup2",
        "pstore", "bpf", "tracefs", "configfs", "securityfs", "efivarfs",
        "autofs", "mqueue", "hugetlbfs", "debugfs", "overlay", "squashfs",
        "ramfs", "fuse.gvfsd-fuse", "nsfs", "binfmt_misc", "fusectl"
    };

    FILE* fp = setmntent("/proc/mounts", "r");
    if (!fp) return {};

    std::vector<MountedDevice> result;
    struct mntent* ent;

    while ((ent = getmntent(fp)) != nullptr) {
        std::string fstype     = ent->mnt_type;
        std::string mountpoint = ent->mnt_dir;

        if (kSkipTypes.count(fstype)) continue;

        bool show = (mountpoint == "/")                          ||
                    mountpoint.rfind("/media/",     0) == 0      ||
                    mountpoint.rfind("/mnt/",       0) == 0      ||
                    mountpoint.rfind("/run/media/", 0) == 0;
        if (!show) continue;

        MountedDevice dev;
        dev.fs_type    = fstype;
        dev.mount_path = mountpoint;
        dev.name       = (mountpoint == "/")
            ? "Root"
            : fs::path(mountpoint).filename().string();

        dev.is_removable = (mountpoint.rfind("/media/",     0) == 0 ||
                            mountpoint.rfind("/run/media/", 0) == 0);

        struct statvfs sv{};
        if (statvfs(mountpoint.c_str(), &sv) == 0) {
            dev.total_bytes = static_cast<uint64_t>(sv.f_blocks) * sv.f_frsize;
            dev.free_bytes  = static_cast<uint64_t>(sv.f_bavail) * sv.f_frsize;
        }

        result.push_back(std::move(dev));
    }

    endmntent(fp);

    std::sort(result.begin(), result.end(), [](const MountedDevice& a, const MountedDevice& b) {
        if (a.mount_path == "/") return true;
        if (b.mount_path == "/") return false;
        return a.name < b.name;
    });

    return result;
}

} // namespace misty::panel

#endif // __linux__
