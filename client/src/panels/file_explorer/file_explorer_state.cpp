#include "file_explorer_state.h"
#include <cstdio>
#include <algorithm>
#include <fstream>
#include <filesystem>
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
        item.id = item.path;

        // Infer status based on path (e.g. if in trash)
        const char* home = std::getenv("HOME");
        if (home) {
            std::string trash_dir = std::string(home) + "/misty/.cache/trash";
            // Check if path starts with trash_dir
            if (item.path.rfind(trash_dir, 0) == 0) {
                 item.status = SyncStatus::DELETED;
            }
        }

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

            if (j.contains("last_opened_path")) {
                last_opened_path = j["last_opened_path"].get<std::string>();
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

            // Save last opened path
            j["last_opened_path"] = std::string(current_path);

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
        dirty_ = true;
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
        dirty_ = true;
    }

    void FileExplorerState::move_to_trash(const UnifiedFileItem& item) {
        // Remove if exists to avoid duplicates
        auto it = std::remove_if(trash_files.begin(), trash_files.end(),
            [&](const UnifiedFileItem& f) { return f.path == item.path; });
        trash_files.erase(it, trash_files.end());

        UnifiedFileItem trash_item = item;
        trash_item.status = SyncStatus::DELETED;
        trash_files.push_back(trash_item);
        // Note: Trash persistence is handled by the physical directory, so we don't necessarily need to save trash_files to JSON
        // unless we want to cache it. But navigate_to_path re-reads it.
        // So no save_state() needed here for now.
    }

    void FileExplorerState::track_move(const std::string& old_path, const UnifiedFileItem& new_item) {
        if (new_item.status == SyncStatus::DELETED) {
            // File moved to trash — pull it out of recent entirely
            auto it = std::remove_if(recent_files.begin(), recent_files.end(),
                [&](const UnifiedFileItem& f) { return f.path == old_path; });
            recent_files.erase(it, recent_files.end());
        } else {
            // File renamed / moved — update its entry in recent
            for (auto& f : recent_files) {
                if (f.path == old_path) f = new_item;
            }
        }

        // Always update starred (renames / moves should follow the file)
        for (auto& f : starred_files) {
            if (f.path == old_path) f = new_item;
        }

        dirty_ = true;
    }

    // -------------------------------------------------------------------------
    // save_async — non-blocking write-behind
    //
    // 1. Bail early if nothing changed, or if a write is already in progress.
    // 2. Snapshot state under mu (fast — just copies vectors + a string).
    // 3. Clear dirty_ while still holding the lock so any mutation that races
    //    in after the snapshot will re-set it and be picked up next cycle.
    // 4. Hand the JSON string to a worker thread for the actual file I/O.
    //    Atomic write (write temp → rename) prevents half-written files on crash.
    // -------------------------------------------------------------------------
    void FileExplorerState::save_async(core::WorkerPool& pool) {
        if (!dirty_.load(std::memory_order_relaxed)) return;
        if (save_in_flight_.exchange(true))           return; // already writing

        // Snapshot under lock
        std::string json_str;
        {
            std::lock_guard<std::mutex> lk(mu);
            dirty_.store(false, std::memory_order_relaxed);

            json j;
            j["recent_files"]   = json::array();
            for (const auto& item : recent_files)
                j["recent_files"].push_back(serialize_item(item));

            j["starred_files"]  = json::array();
            for (const auto& item : starred_files)
                j["starred_files"].push_back(serialize_item(item));

            j["last_opened_path"] = std::string(current_path);

            json_str = j.dump(4);
        }

        std::string dest = get_state_file_path();
        if (dest.empty()) { save_in_flight_.store(false); return; }

        // The lambda captures in_flight by raw pointer — safe because the state
        // object outlives the worker (it lives in UIRegistry for the app lifetime).
        auto* in_flight = &save_in_flight_;

        pool.add(
            [json_str = std::move(json_str), dest, in_flight]() {
                std::string tmp = dest + ".tmp";
                try {
                    fs::create_directories(fs::path(dest).parent_path());
                    {
                        std::ofstream f(tmp);
                        if (f) f << json_str;
                    }
                    // Atomic rename — on most filesystems this is a single syscall
                    std::error_code ec;
                    fs::rename(tmp, dest, ec);
                    if (ec) fs::remove(tmp, ec); // clean up temp on failure
                } catch (...) {
                    std::error_code ec;
                    fs::remove(tmp, ec);
                }
                in_flight->store(false);
            },
            []() {},                               // on_finish (unused)
            [in_flight](const std::string&) {      // on_error
                in_flight->store(false);
            }
        );
    }

} // namespace panel
} // namespace misty
