#include "panels/file_explorer/state/library_state.h"

#include <algorithm>
#include <cstdio>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <nlohmann/json.hpp>

namespace fs = std::filesystem;
using json = nlohmann::json;

namespace misty::panel {
namespace {

std::string get_state_file_path() {
    const char* home = std::getenv("HOME");
    if (!home) {
        return "";
    }
    return std::string(home) + "/.misty/.cache/explorer_state.json";
}

json serialize_item(const FileItem& item) {
    return json{
        {"path", item.path},
        {"name", item.name},
        {"id", item.id},
        {"is_dir", item.is_dir},
        {"size", item.size},
        {"last_modified", item.last_modified},
        {"mime_type", item.mime_type},
        {"type", static_cast<int>(item.type)}
    };
}

FileItem deserialize_item(const json& j) {
    FileItem item;
    item.path = j.value("path", "");
    item.name = j.value("name", "");
    item.id = j.value("id", item.path);
    item.is_dir = j.value("is_dir", false);
    item.size = j.value("size", static_cast<int64_t>(0));
    item.last_modified = j.value("last_modified", "");
    item.mime_type = j.value("mime_type", "");
    const int type_value = j.value("type", static_cast<int>(FileType::LOCAL));
    if (type_value >= static_cast<int>(FileType::LOCAL) &&
        type_value <= static_cast<int>(FileType::VIRTUAL)) {
        item.type = static_cast<FileType>(type_value);
    }
    if (item.id.empty()) {
        item.id = item.path;
    }
    return item;
}

}  // namespace

bool write_library_snapshot(LibraryState& state, bool block_for_lock) {
    const std::string path = get_state_file_path();
    if (path.empty()) {
        return false;
    }

    json j;
    {
        std::unique_lock<std::mutex> lock(state.mu, std::defer_lock);
        if (block_for_lock) {
            lock.lock();
        } else if (!lock.try_lock()) {
            return false;
        }

        j["recent_files"] = json::array();
        for (const auto& item : state.recent_files) {
            j["recent_files"].push_back(serialize_item(item));
        }

        j["starred_files"] = json::array();
        for (const auto& item : state.starred_files) {
            j["starred_files"].push_back(serialize_item(item));
        }

        j["last_opened_path"] = state.last_opened_path;
        state.dirty = false;
    }

    try {
        fs::create_directories(fs::path(path).parent_path());
        const std::string tmp = path + ".tmp";
        {
            std::ofstream f(tmp);
            f << j.dump(4);
        }
        std::error_code ec;
        fs::rename(tmp, path, ec);
        if (ec) {
            fs::remove(tmp, ec);
            std::ofstream f(path);
            f << j.dump(4);
        }
        std::printf("LibraryState: Saved state to %s\n", path.c_str());
        return true;
    } catch (const std::exception& e) {
        std::printf("LibraryState: Failed to save state: %s\n", e.what());
        return false;
    }
}

void LibraryState::load() {
    const std::string path = get_state_file_path();
    if (path.empty() || !fs::exists(path)) {
        return;
    }

    try {
        std::ifstream f(path);
        json j = json::parse(f);
        std::lock_guard<std::mutex> lock(mu);

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

        dirty = false;
    } catch (const std::exception& e) {
        std::printf("LibraryState: Failed to load state: %s\n", e.what());
    }
}

void LibraryState::save() {
    (void)write_library_snapshot(*this, true);
}

void LibraryState::save_best_effort() {
    if (!write_library_snapshot(*this, false)) {
        std::printf("LibraryState: Skipped best-effort save; state is busy.\n");
    }
}

bool LibraryState::is_starred(const std::string& path) const {
    for (const auto& item : starred_files) {
        if (item.path == path) {
            return true;
        }
    }
    return false;
}

void LibraryState::toggle_star(const FileItem& item) {
    std::lock_guard<std::mutex> lock(mu);
    auto it = std::find_if(starred_files.begin(), starred_files.end(),
        [&](const FileItem& f) { return f.path == item.path; });

    if (it != starred_files.end()) {
        starred_files.erase(it);
    } else {
        starred_files.push_back(item);
    }
    dirty = true;
}

void LibraryState::add_recent(const FileItem& item) {
    std::lock_guard<std::mutex> lock(mu);
    auto it = std::remove_if(recent_files.begin(), recent_files.end(),
        [&](const FileItem& f) { return f.path == item.path; });
    recent_files.erase(it, recent_files.end());

    recent_files.push_front(item);
    if (recent_files.size() > 20) {
        recent_files.pop_back();
    }
    dirty = true;
}

void LibraryState::track_move(const std::string& old_path, const FileItem& new_item) {
    std::lock_guard<std::mutex> lock(mu);
    if (new_item.type == FileType::DELETED) {
        auto it = std::remove_if(recent_files.begin(), recent_files.end(),
            [&](const FileItem& f) { return f.path == old_path; });
        recent_files.erase(it, recent_files.end());
    } else {
        for (auto& f : recent_files) {
            if (f.path == old_path) {
                f = new_item;
            }
        }
    }

    for (auto& f : starred_files) {
        if (f.path == old_path) {
            f = new_item;
        }
    }

    dirty = true;
}

void LibraryState::save_async(core::WorkerPool& pool) {
    if (!dirty.load(std::memory_order_relaxed)) {
        return;
    }
    if (save_in_flight_.exchange(true)) {
        return;
    }

    std::string json_str;
    {
        std::lock_guard<std::mutex> lock(mu);
        dirty.store(false, std::memory_order_relaxed);

        json j;
        j["recent_files"] = json::array();
        for (const auto& item : recent_files) {
            j["recent_files"].push_back(serialize_item(item));
        }

        j["starred_files"] = json::array();
        for (const auto& item : starred_files) {
            j["starred_files"].push_back(serialize_item(item));
        }

        j["last_opened_path"] = last_opened_path;
        json_str = j.dump(4);
    }

    const std::string dest = get_state_file_path();
    if (dest.empty()) {
        save_in_flight_.store(false);
        return;
    }

    auto* in_flight = &save_in_flight_;
    pool.add(
        [json_str = std::move(json_str), dest, in_flight]() {
            const std::string tmp = dest + ".tmp";
            try {
                fs::create_directories(fs::path(dest).parent_path());
                {
                    std::ofstream f(tmp);
                    if (f) {
                        f << json_str;
                    }
                }
                std::error_code ec;
                fs::rename(tmp, dest, ec);
                if (ec) {
                    fs::remove(tmp, ec);
                }
            } catch (...) {
                std::error_code ec;
                fs::remove(tmp, ec);
            }
            in_flight->store(false);
        },
        []() {},
        [in_flight](const std::string&) {
            in_flight->store(false);
        }
    );
}

}  // namespace misty::panel
