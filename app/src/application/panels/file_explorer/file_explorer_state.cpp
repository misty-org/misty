#include "file_explorer_state.h"
#include <cstdio>
#include <algorithm>
#include <fstream>
#include <iostream>
#include <filesystem>
#include "application/core/asset_manager.h" // For getting app data path if needed, or just use HOME
#include <nlohmann/json.hpp>

namespace misty {
namespace panel {

    namespace fs = std::filesystem;
    using json = nlohmann::json;

    // Helper to get persistent state path
    static std::string get_state_file_path() {
        const char* home = std::getenv("HOME");
        if (!home) return "";
        std::string path = std::string(home) + "/misty/.cache/explorer_state.json";
        return path;
    }

    // Helper to serialize UnifiedFileItem
    static json serialize_item(const UnifiedFileItem& item) {
        return json{
            {"path", item.path},
            {"name", item.name},
            {"is_dir", item.is_dir},
            {"size", item.size},
            {"last_modified", item.last_modified},
            {"source", (int)item.source}
            // Add other fields as needed
        };
    }

    // Helper to deserialize UnifiedFileItem
    static UnifiedFileItem deserialize_item(const json& j) {
        UnifiedFileItem item;
        item.path = j.value("path", "");
        item.name = j.value("name", "");
        item.is_dir = j.value("is_dir", false);
        item.size = j.value("size", (int64_t)0);
        item.last_modified = j.value("last_modified", "");
        item.source = (FileSource)j.value("source", (int)FileSource::LOCAL);
        
        // Infer status/other fields based on path existence if needed
        // For now, keep simple
        return item;
    }

    void FileExplorerState::load_state() {
        std::string path = get_state_file_path();
        if (path.empty() || !fs::exists(path)) return;

        try {
            std::ifstream f(path);
            json j = json::parse(f);

            if (j.contains("recent_files")) {
                recent_files.clear();
                for (const auto& item_json : j["recent_files"]) {
                    recent_files.push_back(deserialize_item(item_json));
                }
            }

            if (j.contains("starred_files")) {
                starred_files.clear();
                for (const auto& item_json : j["starred_files"]) {
                    starred_files.push_back(deserialize_item(item_json));
                }
            }
            
            printf("FileExplorerState: Loaded state from %s (Recent: %zu, Starred: %zu)\n", 
                path.c_str(), recent_files.size(), starred_files.size());

        } catch (const std::exception& e) {
            printf("FileExplorerState: Failed to load state: %s\n", e.what());
        }
    }

    void FileExplorerState::save_state() {
        std::string path = get_state_file_path();
        if (path.empty()) return;

        try {
            // Ensure directory
            fs::create_directories(fs::path(path).parent_path());

            json j;
            j["recent_files"] = json::array();
            for (const auto& item : recent_files) {
                j["recent_files"].push_back(serialize_item(item));
            }

            j["starred_files"] = json::array();
            for (const auto& item : starred_files) {
                j["starred_files"].push_back(serialize_item(item));
            }

            std::ofstream f(path);
            f << j.dump(4);
            
            printf("FileExplorerState: Saved state to %s\n", path.c_str());

        } catch (const std::exception& e) {
            printf("FileExplorerState: Failed to save state: %s\n", e.what());
        }
    }

    bool FileExplorerState::is_starred(const std::string& path) const {
        for (const auto& item : starred_files) {
            if (item.path == path) return true;
        }
        return false;
    }

    void FileExplorerState::toggle_star(const UnifiedFileItem& item) {
        auto it = std::find_if(starred_files.begin(), starred_files.end(), 
            [&](const UnifiedFileItem& f) { return f.path == item.path; });
        
        if (it != starred_files.end()) {
            starred_files.erase(it);
        } else {
            starred_files.push_back(item);
        }
        save_state(); // Persist change
    }

    void FileExplorerState::add_recent(const UnifiedFileItem& item) {
        // Remove if already exists to move to top
        auto it = std::remove_if(recent_files.begin(), recent_files.end(),
            [&](const UnifiedFileItem& f) { return f.path == item.path; });
        recent_files.erase(it, recent_files.end());
        
        recent_files.push_front(item);
        if (recent_files.size() > 20) {
            recent_files.pop_back();
        }
        save_state(); // Persist change
    }

    void FileExplorerState::move_to_trash(const UnifiedFileItem& item) {
        trash_files.push_back(item);
        // Note: Trash persistence is handled by the physical directory, so we don't necessarily need to save trash_files to JSON
        // unless we want to cache it. But navigate_to_path re-reads it.
        // So no save_state() needed here for now.
    }

} // namespace panel
} // namespace misty
