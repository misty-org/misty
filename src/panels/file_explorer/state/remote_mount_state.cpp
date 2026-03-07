#include "panels/file_explorer/state/remote_mount_state.h"
#include <system_error>
#include <filesystem>

namespace fs = std::filesystem;

namespace misty::panel {
    void RemoteMountState::ensure_mount_root() const {
        std::error_code ec;
        const auto path = fs::path(get_mount_root());
        fs::create_directories(path, ec);
        if (ec) {
            throw fs::filesystem_error(
                "Failed to create mount root directory",
                path,
                ec
            );
        }
    }

    std::string get_mount_root() {
        const char* home = std::getenv("HOME");
        if (!home || !home[0]) {
            return "./.misty/mnt";
        }
        return std::string(home) + "/.misty/mnt";
    }

    void ensure_parent_directory(const RemoteMountParent& parent) {
        const auto path = fs::path(get_mount_root()) / parent.remote_name;

        std::error_code ec;
        fs::create_directories(path, ec);
    }

    void ensure_child_directory(const RemoteMountChild& child) {
        const auto path = fs::path(get_mount_root()) / child.parent.remote_name / child.child_name;

        std::error_code ec;
        fs::create_directories(path, ec);
    }


} // namespace misty::panel
