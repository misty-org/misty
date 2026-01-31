#pragma once

#include <string>
#include <vector>
#include <mutex>
#include <filesystem>
#include "core/ui_registry.h"
#include "core/http_client.h"
#include <nlohmann/json.hpp>

namespace fs = std::filesystem;

namespace minidfs::panel {

    struct WorkspaceInfo {
        std::string workspace_id;
        std::string workspace_name;
        std::string mount_path;
    };

    // Account mapping for cloud services (OneDrive, etc.)
    struct AccountMapping {
        std::string folder_name;    // Derived from email: "matthew"
        std::string ms_user_id;     // Internal Microsoft user ID
        std::string drive_id;       // Cached drive ID
        std::string display_name;
        std::string email;
    };

    // Directory management utilities for mount points
    namespace mount_utils {
        inline std::string get_mount_root() {
            const char* home = std::getenv("HOME");
            if (!home) home = "~";
            return std::string(home) + "/misty/mnt";
        }

        inline std::string get_onedrive_root() {
            return get_mount_root() + "/OneDrive";
        }

        // Derive folder name from email: matthew@outlook.com → "matthew"
        inline std::string derive_folder_name(const std::string& email) {
            if (email.empty()) return "unknown";

            size_t at_pos = email.find('@');
            if (at_pos == std::string::npos) return email;

            return email.substr(0, at_pos);
        }

        // Ensure base mount directories exist
        inline void ensure_mount_directories() {
            std::error_code ec;
            fs::create_directories(get_mount_root(), ec);
            fs::create_directories(get_onedrive_root(), ec);
        }

        // Create account directory and return the path
        inline std::string ensure_account_directory(const std::string& email) {
            std::string folder_name = derive_folder_name(email);
            std::string account_path = get_onedrive_root() + "/" + folder_name;
            std::error_code ec;
            fs::create_directories(account_path, ec);
            return account_path;
        }
    }

    struct WorkspaceState : public core::UIState {
        std::mutex mu;

        std::vector<WorkspaceInfo> workspaces;

        int selected_workspace_index = 0;
        bool is_fetching = false;
        bool has_fetched = false;
        std::string error_msg = "";

        // Cloud account mappings (managed by workspace, used by file explorer)
        std::vector<AccountMapping> account_mappings;

        // Get currently selected workspace
        WorkspaceInfo* get_current_workspace() {
            std::lock_guard<std::mutex> lock(mu);
            if (workspaces.empty() || selected_workspace_index < 0 ||
                selected_workspace_index >= static_cast<int>(workspaces.size())) {
                return nullptr;
            }
            return &workspaces[selected_workspace_index];
        }

        // Get current workspace's mount point
        std::string get_current_mount_path() {
            auto* ws = get_current_workspace();
            return ws ? ws->mount_path : "";
        }

        // Get current workspace's name
        std::string get_current_workspace_name() {
            auto* ws = get_current_workspace();
            return ws ? ws->workspace_name : "No Workspace";
        }

        // Get current workspace's ID
        std::string get_current_workspace_id() {
            auto* ws = get_current_workspace();
            return ws ? ws->workspace_id : "";
        }

        void fetch_workspaces() {
            if (is_fetching) {
                return;
            }

            is_fetching = true;
            error_msg = "";

            core::HttpResponse response = core::HttpClient::get().get("http://localhost:3000/api/workspaces");
            if (response.status_code >= 200 && response.status_code < 300) {
                try {
                    auto json = nlohmann::json::parse(response.body);

                    std::vector<WorkspaceInfo> new_workspaces;

                    if (json.is_array()) {
                        for (const auto& ws_json : json) {
                            WorkspaceInfo ws;
                            ws.workspace_id = ws_json.value("workspace_id", "");
                            ws.workspace_name = ws_json.value("workspace_name", "");
                            ws.mount_path = ws_json.value("mount_path", "");
                            new_workspaces.push_back(ws);
                        }
                    }

                    {
                        std::lock_guard<std::mutex> lock(mu);
                        workspaces = std::move(new_workspaces);
                    }

                    has_fetched = true;

                } catch (const std::exception& ex) {
                    error_msg = std::string("Failed to parse workspaces JSON: ") + ex.what();
                }
            } else {
                error_msg = "Failed to fetch workspaces (" + std::to_string(response.status_code) + ")";
            }

            is_fetching = false;
        }

        // Select workspace by index and return whether it changed
        bool select_workspace(int index) {
            std::lock_guard<std::mutex> lock(mu);
            if (index < 0 || index >= static_cast<int>(workspaces.size())) {
                return false;
            }
            if (selected_workspace_index != index) {
                selected_workspace_index = index;
                return true;
            }
            return false;
        }

        // Find account by folder name
        AccountMapping* find_account_by_folder(const std::string& folder_name) {
            for (auto& mapping : account_mappings) {
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
