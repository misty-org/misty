#pragma once

#include <string>
#include <vector>
#include <mutex>
#include <atomic>
#include <unordered_set>
#include <fstream>
#include <filesystem>
#include <functional>
#include <nlohmann/json.hpp>
#include "core/ui_registry.h"
#include "core/http_client.h"
#include "core/worker_pool.h"

namespace misty::panel {

    // Upload result callback: (success, error_message)
    using UploadCallback = std::function<void(bool success, const std::string& error_msg)>;

    inline std::string get_onedrive_cache_dir() {
        const char* home = std::getenv("HOME");
        if (!home) home = "~";
        return std::string(home) + "/misty/.cache/onedrive";
    }

    struct OneDriveItem {
        std::string id;
        std::string name;
        int64_t size = 0;
        std::string web_url;
        std::string download_url;
        std::string created_date_time;
        std::string last_modified_date_time;
        bool is_folder = false;
        int folder_child_count = 0;
        std::string mime_type;

        std::string drive_id;
        std::string ms_user_id;
    };

    struct AccountRootContent {
        std::string ms_user_id;
        std::string display_name;
        std::string email;
        std::string drive_id;
        std::vector<OneDriveItem> items;
        bool is_loading = false;
        bool has_error = false;
        std::string error_msg;
    };

    enum class OneDriveViewMode {
        ACCOUNTS_VIEW,  // Shows account folders
        FOLDER_VIEW     // Shows folder contents
    };

    // Cache helpers
    inline std::string get_folder_cache_path(const std::string& ms_user_id, const std::string& folder_id) {
        return get_onedrive_cache_dir() + "/" + ms_user_id + "/" + folder_id + ".json";
    }

    inline std::string get_drive_cache_path(const std::string& ms_user_id) {
        return get_onedrive_cache_dir() + "/" + ms_user_id + "/drive.json";
    }

    inline void save_items_to_cache(const std::string& ms_user_id, const std::string& folder_id,
                                     const std::vector<OneDriveItem>& items) {
        std::string cache_path = get_folder_cache_path(ms_user_id, folder_id);
        std::filesystem::create_directories(std::filesystem::path(cache_path).parent_path());

        nlohmann::json j = nlohmann::json::array();
        for (const auto& item : items) {
            nlohmann::json obj;
            obj["id"] = item.id;
            obj["name"] = item.name;
            obj["size"] = item.size;
            obj["web_url"] = item.web_url;
            obj["download_url"] = item.download_url;
            obj["created_date_time"] = item.created_date_time;
            obj["last_modified_date_time"] = item.last_modified_date_time;
            obj["is_folder"] = item.is_folder;
            obj["folder_child_count"] = item.folder_child_count;
            obj["mime_type"] = item.mime_type;
            obj["drive_id"] = item.drive_id;
            obj["ms_user_id"] = item.ms_user_id;
            j.push_back(obj);
        }

        std::ofstream file(cache_path);
        if (file) {
            file << j.dump();
        }
    }

    inline bool load_items_from_cache(const std::string& ms_user_id, const std::string& folder_id,
                                       std::vector<OneDriveItem>& items) {
        std::string cache_path = get_folder_cache_path(ms_user_id, folder_id);
        std::ifstream file(cache_path);
        if (!file) return false;

        try {
            nlohmann::json j = nlohmann::json::parse(file);
            items.clear();
            for (const auto& obj : j) {
                OneDriveItem item;
                item.id = obj.value("id", std::string(""));
                item.name = obj.value("name", std::string(""));
                item.size = obj.value("size", int64_t(0));
                item.web_url = obj.value("web_url", std::string(""));
                item.download_url = obj.value("download_url", std::string(""));
                item.created_date_time = obj.value("created_date_time", std::string(""));
                item.last_modified_date_time = obj.value("last_modified_date_time", std::string(""));
                item.is_folder = obj.value("is_folder", false);
                item.folder_child_count = obj.value("folder_child_count", 0);
                item.mime_type = obj.value("mime_type", std::string(""));
                item.drive_id = obj.value("drive_id", std::string(""));
                item.ms_user_id = obj.value("ms_user_id", std::string(""));
                items.push_back(item);
            }
            return true;
        } catch (...) {
            return false;
        }
    }

    inline void save_drive_info_to_cache(const std::string& ms_user_id, const std::string& drive_id,
                                          const std::string& display_name, const std::string& email) {
        std::string cache_path = get_drive_cache_path(ms_user_id);
        std::filesystem::create_directories(std::filesystem::path(cache_path).parent_path());

        nlohmann::json j;
        j["drive_id"] = drive_id;
        j["display_name"] = display_name;
        j["email"] = email;

        std::ofstream file(cache_path);
        if (file) {
            file << j.dump();
        }
    }

    inline bool load_drive_info_from_cache(const std::string& ms_user_id, std::string& drive_id,
                                            std::string& display_name, std::string& email) {
        std::string cache_path = get_drive_cache_path(ms_user_id);
        std::ifstream file(cache_path);
        if (!file) return false;

        try {
            nlohmann::json j = nlohmann::json::parse(file);
            drive_id = j.value("drive_id", std::string(""));
            display_name = j.value("display_name", std::string(""));
            email = j.value("email", std::string(""));
            return !drive_id.empty();
        } catch (...) {
            return false;
        }
    }

    struct OneDriveState : public core::UIState {
        OneDriveViewMode view_mode = OneDriveViewMode::ACCOUNTS_VIEW;

        std::vector<AccountRootContent> account_roots;
        bool is_loading_roots = false;
        int pending_root_loads = 0;

        std::string current_ms_user_id;
        std::string current_drive_id;
        std::string current_folder_id;
        std::string current_folder_name;
        std::vector<OneDriveItem> current_items;
        bool is_loading_folder = false;
        std::string error_msg;

        std::unordered_set<std::string> selected_items;
        int last_selected_index = -1;

        std::mutex mu;

        void reset() {
            std::lock_guard<std::mutex> lock(mu);
            view_mode = OneDriveViewMode::ACCOUNTS_VIEW;
            account_roots.clear();
            is_loading_roots = false;
            pending_root_loads = 0;
            current_items.clear();
            selected_items.clear();
            error_msg.clear();
        }

        // Check if we have valid OneDrive context for uploads
        bool has_upload_context() const {
            return !current_drive_id.empty() && !current_folder_id.empty() && !current_ms_user_id.empty();
        }

        // Get current upload context (thread-safe copy)
        struct UploadContext {
            std::string drive_id;
            std::string folder_id;
            std::string ms_user_id;
        };

        UploadContext get_upload_context() {
            std::lock_guard<std::mutex> lock(mu);
            return {current_drive_id, current_folder_id, current_ms_user_id};
        }

        void set_worker_pool(core::WorkerPool& pool) { worker_pool_ = &pool; }

        // Upload a file to the current OneDrive folder
        // Runs asynchronously via WorkerPool
        void upload_file(
            const std::string& local_path,
            core::UploadProgressCallback progress_cb,
            UploadCallback callback
        );

        core::WorkerPool* worker_pool_ = nullptr;
    };
}
