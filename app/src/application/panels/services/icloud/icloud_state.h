#pragma once

#include <string>
#include <vector>
#include <mutex>
#include <unordered_set>
#include <fstream>
#include <filesystem>
#include <functional>
#include <nlohmann/json.hpp>
#include "core/ui_registry.h"
#include "core/http_client.h"
#include "core/worker_pool.h"

namespace misty::panel {

    inline std::string get_icloud_cache_dir() {
        const char* home = std::getenv("HOME");
        if (!home) home = "~";
        return std::string(home) + "/misty/.cache/icloud";
    }

    struct ICloudItem {
        std::string name;
        std::string path;     // full path in iCloud Drive
        bool is_folder = false;
        std::string email;    // owner account email
    };

    struct ICloudAccountRootContent {
        std::string email;
        std::vector<ICloudItem> items;
        bool is_loading = false;
        bool has_error = false;
        std::string error_msg;
    };

    enum class ICloudViewMode {
        ACCOUNTS_VIEW,
        FOLDER_VIEW
    };

    inline std::string get_icl_folder_cache_path(const std::string& email, const std::string& folder_path) {
        std::string safe_email = email;
        for (auto& c : safe_email) {
            if (c == '@' || c == '.') c = '_';
        }
        std::string safe_path = folder_path.empty() ? "_root_" : folder_path;
        for (auto& c : safe_path) {
            if (c == '/') c = '_';
        }
        return get_icloud_cache_dir() + "/" + safe_email + "/" + safe_path + ".json";
    }

    inline void save_icl_items_to_cache(const std::string& email, const std::string& folder_path,
                                         const std::vector<ICloudItem>& items) {
        std::string cache_path = get_icl_folder_cache_path(email, folder_path);
        std::filesystem::create_directories(std::filesystem::path(cache_path).parent_path());

        nlohmann::json j = nlohmann::json::array();
        for (const auto& item : items) {
            nlohmann::json obj;
            obj["name"] = item.name;
            obj["path"] = item.path;
            obj["is_folder"] = item.is_folder;
            obj["email"] = item.email;
            j.push_back(obj);
        }

        std::ofstream file(cache_path);
        if (file) {
            file << j.dump();
        }
    }

    inline bool load_icl_items_from_cache(const std::string& email, const std::string& folder_path,
                                           std::vector<ICloudItem>& items) {
        std::string cache_path = get_icl_folder_cache_path(email, folder_path);
        std::ifstream file(cache_path);
        if (!file) return false;

        try {
            nlohmann::json j = nlohmann::json::parse(file);
            items.clear();
            for (const auto& obj : j) {
                ICloudItem item;
                item.name = obj.value("name", std::string(""));
                item.path = obj.value("path", std::string(""));
                item.is_folder = obj.value("is_folder", false);
                item.email = obj.value("email", std::string(""));
                items.push_back(item);
            }
            return true;
        } catch (...) {
            return false;
        }
    }

    struct ICloudState : public core::UIState {
        ICloudViewMode view_mode = ICloudViewMode::ACCOUNTS_VIEW;

        std::vector<ICloudAccountRootContent> account_roots;
        bool is_loading_roots = false;

        std::string current_email;
        std::string current_folder_path;
        std::string current_folder_name;
        std::vector<ICloudItem> current_items;
        bool is_loading_folder = false;
        std::string error_msg;

        std::unordered_set<std::string> selected_items;
        int last_selected_index = -1;

        std::mutex mu;

        void reset() {
            std::lock_guard<std::mutex> lock(mu);
            view_mode = ICloudViewMode::ACCOUNTS_VIEW;
            account_roots.clear();
            is_loading_roots = false;
            current_items.clear();
            selected_items.clear();
            error_msg.clear();
        }

        bool has_upload_context() const {
            return !current_email.empty();
        }

        void set_worker_pool(core::WorkerPool& pool) { worker_pool_ = &pool; }

        core::WorkerPool* worker_pool_ = nullptr;
    };
}
