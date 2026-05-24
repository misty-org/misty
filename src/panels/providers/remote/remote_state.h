#pragma once

#include <string>
#include <mutex>
#include "core/ui/state_registry.h"
#include "core/threading/worker_pool.h"

namespace misty::panel {

    // Upload context for the currently browsed remote folder
    struct RemoteUploadContext {
        std::string remote_name;   // rclone remote name, e.g. "onedrive-john"
        std::string remote_path;   // path within the remote, e.g. "/Documents"
    };

    // Unified remote state — replaces OneDriveState, GDriveState, DropboxState, ICloudState.
    // Tracks the current browsing context for uploads.
    struct RemoteState : public core::StateEntry {
        std::mutex mu;

        // Current browsing context
        std::string current_remote;
        std::string current_path;

        // Check if we have a valid upload context
        bool has_upload_context() const {
            return !current_remote.empty();
        }

        // Get current upload context (thread-safe copy)
        RemoteUploadContext get_upload_context() {
            std::lock_guard<std::mutex> lock(mu);
            return {current_remote, current_path};
        }

        // Set upload context when navigating into a remote folder
        void set_upload_context(const std::string& remote_name, const std::string& path) {
            std::lock_guard<std::mutex> lock(mu);
            current_remote = remote_name;
            current_path = path;
        }

        // Clear upload context when leaving remote folders
        void clear_upload_context() {
            std::lock_guard<std::mutex> lock(mu);
            current_remote.clear();
            current_path.clear();
        }
    };

}
