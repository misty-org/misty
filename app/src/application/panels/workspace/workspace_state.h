#pragma once

#include <string>
#include <vector>
#include <memory>
#include <mutex>
#include <atomic>
#include <filesystem>
#include "core/ui/ui_registry.h"
#include "core/net/http_client.h"
#include "core/manager/env_manager.h"
#include "core/threading/worker_pool.h"
#include <nlohmann/json.hpp>

namespace fs = std::filesystem;

namespace misty::panel {

    struct WorkspaceInfo {
        std::string workspace_id;
        std::string workspace_name;
        std::string mount_path;
    };

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

        std::vector<WorkspaceInfo> workspaces;

        int selected_workspace_index = 0;
        std::atomic<bool> is_fetching = false;
        std::atomic<bool> has_fetched = false;
        std::string error_msg = "";

        // Cloud account mappings (managed by workspace, used by file explorer)
        std::vector<RemoteAccountMapping> remote_mappings;

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

        void fetch_workspaces_async(core::WorkerPool& worker_pool) {
            {
                std::lock_guard<std::mutex> lock(mu);
                if (is_fetching) {
                    return;
                }
                is_fetching = true;
                error_msg = "";
            }

            struct FetchResult {
                bool success = false;
                std::vector<WorkspaceInfo> workspaces;
                std::string error_msg;
            };

            auto result = std::make_shared<FetchResult>();

            worker_pool.add(
                [this, result]() {
                    std::string proxy_url = core::EnvManager::get().get("PROXY_SERVICE_URL", "");
                    if (proxy_url.empty()) {
                        result->error_msg = "PROXY_SERVICE_URL is not set";
                        return;
                    }

                    core::HttpResponse response = core::HTTPClient::get().get(proxy_url + "/api/workspaces");
                    if (response.status_code >= 200 && response.status_code < 300) {
                        try {
                            auto json = nlohmann::json::parse(response.body);
                            if (!json.is_array()) {
                                result->error_msg = "Invalid workspaces response (expected array)";
                                return;
                            }

                            std::vector<WorkspaceInfo> new_workspaces;
                            for (const auto& ws_json : json) {
                                WorkspaceInfo ws;
                                ws.workspace_id = ws_json.value("workspace_id", "");
                                ws.workspace_name = ws_json.value("workspace_name", "");
                                ws.mount_path = ws_json.value("mount_path", "");
                                new_workspaces.push_back(ws);
                            }

                            result->success = true;
                            result->workspaces = std::move(new_workspaces);
                        } catch (const std::exception& ex) {
                            result->error_msg = std::string("Failed to parse workspaces JSON: ") + ex.what();
                        }
                    } else {
                        result->error_msg = "Failed to fetch workspaces (" + std::to_string(response.status_code) + ")";
                    }
                },
                [this, result]() {
                    std::lock_guard<std::mutex> lock(mu);
                    if (result->success) {
                        workspaces = std::move(result->workspaces);
                        if (selected_workspace_index >= static_cast<int>(workspaces.size())) {
                            selected_workspace_index = static_cast<int>(workspaces.empty() ? 0 : workspaces.size() - 1);
                        }
                        has_fetched = true;
                        error_msg.clear();
                    } else if (!result->error_msg.empty()) {
                        error_msg = result->error_msg;
                    }
                    is_fetching = false;
                },
                [this](const std::string& err) {
                    std::lock_guard<std::mutex> lock(mu);
                    error_msg = err;
                    is_fetching = false;
                }
            );
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
