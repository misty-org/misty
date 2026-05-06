#pragma once

#include <cstdlib>
#include <filesystem>
#include <string>
#include <vector>

#include "core/ui/ui_registry.h"

namespace misty::panel {

struct RemoteAccountMapping {
    std::string remote_name;
    std::string remote_type;
    std::string display_name;
    std::string provider_folder;
    std::string folder_name;
};

namespace mount_utils {
    inline std::string get_mount_root() {
        const char* home = std::getenv("HOME");
        if (!home || !home[0]) {
            return "./misty/mnt";
        }
        return std::string(home) + "/misty/mnt";
    }

    inline void ensure_provider_directory(const std::string& provider_folder) {
        if (provider_folder.empty()) {
            return;
        }
        std::error_code ec;
        std::filesystem::create_directories(
            std::filesystem::path(get_mount_root()) / provider_folder,
            ec
        );
    }

    inline void ensure_remote_directory(const std::string& provider_folder, const std::string& folder_name) {
        if (provider_folder.empty() || folder_name.empty()) {
            return;
        }
        std::error_code ec;
        std::filesystem::create_directories(
            std::filesystem::path(get_mount_root()) / provider_folder / folder_name,
            ec
        );
    }
}

struct RemoteMountState : public core::UIState {
    std::vector<RemoteAccountMapping> remote_mappings;

    void ensure_directories() const {
        std::error_code ec;
        std::filesystem::create_directories(mount_utils::get_mount_root(), ec);
        (void)ec;
    }
};

}
