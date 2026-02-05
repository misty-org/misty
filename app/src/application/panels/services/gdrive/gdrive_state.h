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
#include "core/ui/ui_registry.h"
#include "core/net/http_client.h"
#include "core/threading/worker_pool.h"

namespace misty::panel {

    // Upload result callback: (success, error_message)
    using GDUploadCallback = std::function<void(bool success, const std::string& error_msg)>;

    inline std::string get_gdrive_cache_dir() {
        const char* home = std::getenv("HOME");
        if (!home) home = "~";
        return std::string(home) + "/misty/.cache/gdrive";
    }

    struct GDriveItem {
        std::string id;
        std::string name;
        int64_t size = 0;
        std::string web_url;
        std::string created_time;
        std::string modified_time;
        bool is_folder = false;
        std::string mime_type;

        std::string gd_user_id;
    };

    struct GDAccountRootContent {
        std::string gd_user_id;
        std::string display_name;
        std::string email;
        std::vector<GDriveItem> items;
        bool is_loading = false;
        bool has_error = false;
        std::string error_msg;
    };

    enum class GDriveViewMode {
        ACCOUNTS_VIEW,  // Shows account folders
        FOLDER_VIEW     // Shows folder contents
    };

    // Cache helpers
    inline std::string get_gd_folder_cache_path(const std::string& gd_user_id, const std::string& folder_id) {
        return get_gdrive_cache_dir() + "/" + gd_user_id + "/" + folder_id + ".json";
    }

    inline std::string get_gd_drive_cache_path(const std::string& gd_user_id) {
        return get_gdrive_cache_dir() + "/" + gd_user_id + "/drive.json";
    }

    inline void save_gd_items_to_cache(const std::string& gd_user_id, const std::string& folder_id,
                                        const std::vector<GDriveItem>& items) {
        std::string cache_path = get_gd_folder_cache_path(gd_user_id, folder_id);
        std::filesystem::create_directories(std::filesystem::path(cache_path).parent_path());

        nlohmann::json j = nlohmann::json::array();
        for (const auto& item : items) {
            nlohmann::json obj;
            obj["id"] = item.id;
            obj["name"] = item.name;
            obj["size"] = item.size;
            obj["web_url"] = item.web_url;
            obj["created_time"] = item.created_time;
            obj["modified_time"] = item.modified_time;
            obj["is_folder"] = item.is_folder;
            obj["mime_type"] = item.mime_type;
            obj["gd_user_id"] = item.gd_user_id;
            j.push_back(obj);
        }

        std::ofstream file(cache_path);
        if (file) {
            file << j.dump();
        }
    }

    inline bool load_gd_items_from_cache(const std::string& gd_user_id, const std::string& folder_id,
                                          std::vector<GDriveItem>& items) {
        std::string cache_path = get_gd_folder_cache_path(gd_user_id, folder_id);
        std::ifstream file(cache_path);
        if (!file) return false;

        try {
            nlohmann::json j = nlohmann::json::parse(file);
            items.clear();
            for (const auto& obj : j) {
                GDriveItem item;
                item.id = obj.value("id", std::string(""));
                item.name = obj.value("name", std::string(""));
                item.size = obj.value("size", int64_t(0));
                item.web_url = obj.value("web_url", std::string(""));
                item.created_time = obj.value("created_time", std::string(""));
                item.modified_time = obj.value("modified_time", std::string(""));
                item.is_folder = obj.value("is_folder", false);
                item.mime_type = obj.value("mime_type", std::string(""));
                item.gd_user_id = obj.value("gd_user_id", std::string(""));
                items.push_back(item);
            }
            return true;
        } catch (...) {
            return false;
        }
    }

    inline void save_gd_drive_info_to_cache(const std::string& gd_user_id,
                                             const std::string& display_name, const std::string& email) {
        std::string cache_path = get_gd_drive_cache_path(gd_user_id);
        std::filesystem::create_directories(std::filesystem::path(cache_path).parent_path());

        nlohmann::json j;
        j["display_name"] = display_name;
        j["email"] = email;

        std::ofstream file(cache_path);
        if (file) {
            file << j.dump();
        }
    }

    inline bool load_gd_drive_info_from_cache(const std::string& gd_user_id,
                                               std::string& display_name, std::string& email) {
        std::string cache_path = get_gd_drive_cache_path(gd_user_id);
        std::ifstream file(cache_path);
        if (!file) return false;

        try {
            nlohmann::json j = nlohmann::json::parse(file);
            display_name = j.value("display_name", std::string(""));
            email = j.value("email", std::string(""));
            return true;
        } catch (...) {
            return false;
        }
    }

    struct GDriveState : public core::UIState {
        GDriveViewMode view_mode = GDriveViewMode::ACCOUNTS_VIEW;

        std::vector<GDAccountRootContent> account_roots;
        bool is_loading_roots = false;
        int pending_root_loads = 0;

        std::string current_gd_user_id;
        std::string current_folder_id;
        std::string current_folder_name;
        std::vector<GDriveItem> current_items;
        bool is_loading_folder = false;
        std::string error_msg;

        std::unordered_set<std::string> selected_items;
        int last_selected_index = -1;

        std::mutex mu;

        void reset() {
            std::lock_guard<std::mutex> lock(mu);
            view_mode = GDriveViewMode::ACCOUNTS_VIEW;
            account_roots.clear();
            is_loading_roots = false;
            pending_root_loads = 0;
            current_items.clear();
            selected_items.clear();
            error_msg.clear();
        }

        // Check if we have valid Google Drive context for uploads
        bool has_upload_context() const {
            return !current_folder_id.empty() && !current_gd_user_id.empty();
        }

        // Get current upload context (thread-safe copy)
        struct UploadContext {
            std::string folder_id;
            std::string gd_user_id;
        };

        UploadContext get_upload_context() {
            std::lock_guard<std::mutex> lock(mu);
            return {current_folder_id, current_gd_user_id};
        }

        void set_worker_pool(core::WorkerPool& pool) { worker_pool_ = &pool; }

        // Upload a file to the current Google Drive folder
        // Runs asynchronously via WorkerPool
        void upload_file(
            const std::string& local_path,
            core::UploadProgressCallback progress_cb,
            GDUploadCallback callback
        );

        void upload_file(
            const std::string& local_path,
            const UploadContext& ctx,
            core::UploadProgressCallback progress_cb,
            GDUploadCallback callback
        );

        core::WorkerPool* worker_pool_ = nullptr;
    };
}
