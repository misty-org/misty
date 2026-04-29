#pragma once

#include <string>
#include <vector>
#include <mutex>
#include <filesystem>
#include "core/ui/ui_registry.h"

namespace fs = std::filesystem;

namespace misty::panel {

    // Unified account mapping for all cloud remotes (rclone-based)
    struct RemoteAccountMapping {
        std::string folder_name;    // rclone remote name, used as subfolder
        std::string remote_name;    // rclone remote name (same as folder_name)
        std::string remote_type;    // "onedrive", "drive", "dropbox", etc.
        std::string display_name;   // friendly name, e.g. "OneDrive"
        std::string provider_folder; // provider group folder, e.g. "OneDrive", "Google Drive"
    };

    // Directory management utilities for mount points
    namespace mount_utils {
        inline std::string get_mount_root() {
            const char* home = std::getenv("HOME");
            if (!home) home = "~";
            return std::string(home) + "/misty/mnt";
        }

        // Ensure base mount directory exists
        inline void ensure_mount_directories() {
            std::error_code ec;
            fs::create_directories(get_mount_root(), ec);
        }

        // Ensure a remote's mount directory exists under its provider folder
        inline void ensure_remote_directory(const std::string& provider_folder, const std::string& remote_name) {
            std::error_code ec;
            fs::create_directories(get_mount_root() + "/" + provider_folder + "/" + remote_name, ec);
        }

        // Ensure just the provider type folder exists
        inline void ensure_provider_directory(const std::string& provider_folder) {
            std::error_code ec;
            fs::create_directories(get_mount_root() + "/" + provider_folder, ec);
        }
    }

    struct WorkspaceState : public core::UIState {
        std::mutex mu;

        // Cloud account mappings (managed by workspace, used by file explorer)
        std::vector<RemoteAccountMapping> remote_mappings;

        std::string get_current_mount_path() {
            return mount_utils::get_mount_root();
        }

        // Find remote account by folder name
        RemoteAccountMapping* find_remote_by_folder(const std::string& folder_name) {
            for (auto& mapping : remote_mappings) {
                if (mapping.folder_name == folder_name) {
                    return &mapping;
                }
            }
            return nullptr;
        }

        // Ensure mount directories exist
        void ensure_directories() {
            mount_utils::ensure_mount_directories();
        }
    };

}
