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
    using DBXUploadCallback = std::function<void(bool success, const std::string& error_msg)>;

    inline std::string get_dropbox_cache_dir() {
        const char* home = std::getenv("HOME");
        if (!home) home = "~";
        return std::string(home) + "/misty/.cache/dropbox";
    }

    struct DropboxItem {
        std::string id;
        std::string name;
        int64_t size = 0;
        std::string path_display;
        std::string path_lower;
        std::string server_modified;
        bool is_folder = false;

        std::string dbx_user_id;
    };

    struct DBXAccountRootContent {
        std::string dbx_user_id;
        std::string display_name;
        std::string email;
        std::vector<DropboxItem> items;
        bool is_loading = false;
        bool has_error = false;
        std::string error_msg;
    };

    enum class DropboxViewMode {
        ACCOUNTS_VIEW,  // Shows account folders
        FOLDER_VIEW     // Shows folder contents
    };

    // Cache helpers
    inline std::string get_dbx_folder_cache_path(const std::string& dbx_user_id, const std::string& folder_path) {
        // Use a hash-like encoding for folder_path since it contains slashes
        std::string safe_path = folder_path;
        if (safe_path.empty()) safe_path = "_root_";
        for (auto& c : safe_path) {
            if (c == '/') c = '_';
        }
        return get_dropbox_cache_dir() + "/" + dbx_user_id + "/" + safe_path + ".json";
    }

    inline std::string get_dbx_drive_cache_path(const std::string& dbx_user_id) {
        return get_dropbox_cache_dir() + "/" + dbx_user_id + "/drive.json";
    }

    inline void save_dbx_items_to_cache(const std::string& dbx_user_id, const std::string& folder_path,
                                         const std::vector<DropboxItem>& items) {
        std::string cache_path = get_dbx_folder_cache_path(dbx_user_id, folder_path);
        std::filesystem::create_directories(std::filesystem::path(cache_path).parent_path());

        nlohmann::json j = nlohmann::json::array();
        for (const auto& item : items) {
            nlohmann::json obj;
            obj["id"] = item.id;
            obj["name"] = item.name;
            obj["size"] = item.size;
            obj["path_display"] = item.path_display;
            obj["path_lower"] = item.path_lower;
            obj["server_modified"] = item.server_modified;
            obj["is_folder"] = item.is_folder;
            obj["dbx_user_id"] = item.dbx_user_id;
            j.push_back(obj);
        }

        std::ofstream file(cache_path);
        if (file) {
            file << j.dump();
        }
    }

    inline bool load_dbx_items_from_cache(const std::string& dbx_user_id, const std::string& folder_path,
                                           std::vector<DropboxItem>& items) {
        std::string cache_path = get_dbx_folder_cache_path(dbx_user_id, folder_path);
        std::ifstream file(cache_path);
        if (!file) return false;

        try {
            nlohmann::json j = nlohmann::json::parse(file);
            items.clear();
            for (const auto& obj : j) {
                DropboxItem item;
                item.id = obj.value("id", std::string(""));
                item.name = obj.value("name", std::string(""));
                item.size = obj.value("size", int64_t(0));
                item.path_display = obj.value("path_display", std::string(""));
                item.path_lower = obj.value("path_lower", std::string(""));
                item.server_modified = obj.value("server_modified", std::string(""));
                item.is_folder = obj.value("is_folder", false);
                item.dbx_user_id = obj.value("dbx_user_id", std::string(""));
                items.push_back(item);
            }
            return true;
        } catch (...) {
            return false;
        }
    }

    inline void save_dbx_drive_info_to_cache(const std::string& dbx_user_id,
                                              const std::string& display_name, const std::string& email) {
        std::string cache_path = get_dbx_drive_cache_path(dbx_user_id);
        std::filesystem::create_directories(std::filesystem::path(cache_path).parent_path());

        nlohmann::json j;
        j["display_name"] = display_name;
        j["email"] = email;

        std::ofstream file(cache_path);
        if (file) {
            file << j.dump();
        }
    }

    inline bool load_dbx_drive_info_from_cache(const std::string& dbx_user_id,
                                                std::string& display_name, std::string& email) {
        std::string cache_path = get_dbx_drive_cache_path(dbx_user_id);
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

    struct DropboxState : public core::UIState {
        DropboxViewMode view_mode = DropboxViewMode::ACCOUNTS_VIEW;

        std::vector<DBXAccountRootContent> account_roots;
        bool is_loading_roots = false;
        int pending_root_loads = 0;

        std::string current_dbx_user_id;
        std::string current_folder_path;  // Dropbox uses paths, not IDs
        std::string current_folder_name;
        std::vector<DropboxItem> current_items;
        bool is_loading_folder = false;
        std::string error_msg;

        std::unordered_set<std::string> selected_items;
        int last_selected_index = -1;

        std::mutex mu;

        void reset() {
            std::lock_guard<std::mutex> lock(mu);
            view_mode = DropboxViewMode::ACCOUNTS_VIEW;
            account_roots.clear();
            is_loading_roots = false;
            pending_root_loads = 0;
            current_items.clear();
            selected_items.clear();
            error_msg.clear();
        }

        // Check if we have valid Dropbox context for uploads
        bool has_upload_context() const {
            return !current_dbx_user_id.empty();
        }

        // Get current upload context (thread-safe copy)
        struct UploadContext {
            std::string folder_path;
            std::string dbx_user_id;
        };

        UploadContext get_upload_context() {
            std::lock_guard<std::mutex> lock(mu);
            return {current_folder_path, current_dbx_user_id};
        }

        void set_worker_pool(core::WorkerPool& pool) { worker_pool_ = &pool; }

        // Upload a file to the current Dropbox folder
        void upload_file(
            const std::string& local_path,
            core::UploadProgressCallback progress_cb,
            DBXUploadCallback callback
        );

        void upload_file(
            const std::string& local_path,
            const UploadContext& ctx,
            core::UploadProgressCallback progress_cb,
            DBXUploadCallback callback
        );

        core::WorkerPool* worker_pool_ = nullptr;
    };
}
