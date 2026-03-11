#pragma once

#include <string>
#include <vector>

namespace misty::panel {

// Represents a single mounted volume visible to the user.
struct MountedDevice {
    std::string name;         // Volume label ("Macintosh HD", "USB Drive", …)
    std::string mount_path;   // Absolute mount point ("/", "/Volumes/USB", …)
    std::string fs_type;      // Filesystem type ("apfs", "exfat", "ntfs", "ext4", …)
    bool is_removable = false;
    uint64_t total_bytes = 0;
    uint64_t free_bytes  = 0;
};

// Returns the current list of user-accessible mounted volumes.
// Fast — reads the kernel mount table; safe to call on the UI thread.
std::vector<MountedDevice> scan_mounted_devices();

} // namespace misty::panel
