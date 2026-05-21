#include "activity_state.h"

#include <algorithm>
#include <cstdlib>
#include <filesystem>
#include <fstream>

#include <nlohmann/json.hpp>

namespace misty::panel {

namespace {
namespace fs = std::filesystem;
using json = nlohmann::json;

std::string state_file_path() {
    const char* home = std::getenv("HOME");
    if (!home) {
        return "";
    }
    return (fs::path(home) / ".misty" / ".cache" / "activity_state.json").string();
}

int64_t to_epoch_millis(std::chrono::system_clock::time_point tp) {
    return std::chrono::duration_cast<std::chrono::milliseconds>(tp.time_since_epoch()).count();
}

std::chrono::system_clock::time_point from_epoch_millis(int64_t ms) {
    return std::chrono::system_clock::time_point(std::chrono::milliseconds(ms));
}

json serialize_entry(const ActivityEntry& entry) {
    return json{
        {"id", entry.id},
        {"sender", entry.sender},
        {"message", entry.message},
        {"timestamp_ms", to_epoch_millis(entry.timestamp)},
        {"type", static_cast<int>(entry.type)},
    };
}

ActivityEntry deserialize_entry(const json& j) {
    ActivityEntry entry;
    entry.id = j.value("id", uint64_t{0});
    entry.sender = j.value("sender", std::string{});
    entry.message = j.value("message", std::string{});
    entry.timestamp = from_epoch_millis(j.value("timestamp_ms", int64_t{0}));
    entry.type = static_cast<ActivityEntryType>(j.value("type", static_cast<int>(ActivityEntryType::INFO)));
    return entry;
}
} // namespace

ActivityState::ActivityState() {
    load_state();
}

void ActivityState::add_entry(const std::string& sender, const std::string& message,
                              ActivityEntryType type) {
    {
        std::lock_guard<std::mutex> lock(mu_);
        ActivityEntry entry;
        entry.id = next_id_++;
        entry.sender = sender;
        entry.message = message;
        entry.timestamp = std::chrono::system_clock::now();
        entry.type = type;
        entries_.push_back(std::move(entry));
        if (!is_open) {
            ++unread_count_;
        }
        if (entries_.size() > MAX_ENTRIES) {
            entries_.erase(entries_.begin(), entries_.begin() + static_cast<std::ptrdiff_t>(entries_.size() - MAX_ENTRIES));
        }
        const size_t max_unread = entries_.size();
        if (unread_count_.load() > max_unread) {
            unread_count_ = max_unread;
        }
    }
    persist_state();
}

void ActivityState::clear() {
    {
        std::lock_guard<std::mutex> lock(mu_);
        entries_.clear();
        unread_count_ = 0;
    }
    persist_state();
}

void ActivityState::mark_all_read() {
    if (unread_count_.exchange(0) == 0) {
        return;
    }
    persist_state();
}

void ActivityState::load_state() {
    const std::string path = state_file_path();
    if (path.empty() || !fs::exists(path)) {
        return;
    }

    try {
        std::ifstream input(path);
        json j = json::parse(input, nullptr, true, true);

        std::vector<ActivityEntry> loaded_entries;
        uint64_t next_id = 1;
        if (j.contains("entries") && j["entries"].is_array()) {
            for (const auto& item : j["entries"]) {
                ActivityEntry entry = deserialize_entry(item);
                next_id = std::max(next_id, entry.id + 1);
                loaded_entries.push_back(std::move(entry));
            }
        }
        if (loaded_entries.size() > MAX_ENTRIES) {
            loaded_entries.erase(
                loaded_entries.begin(),
                loaded_entries.begin() + static_cast<std::ptrdiff_t>(loaded_entries.size() - MAX_ENTRIES));
        }

        {
            std::lock_guard<std::mutex> lock(mu_);
            entries_ = std::move(loaded_entries);
            next_id_ = next_id;
            const size_t saved_unread = j.value("unread_count", size_t{0});
            unread_count_ = std::min(saved_unread, entries_.size());
        }
    } catch (...) {
    }
}

void ActivityState::persist_state() {
    const std::string path = state_file_path();
    if (path.empty()) {
        return;
    }

    json j;
    {
        std::lock_guard<std::mutex> lock(mu_);
        j["entries"] = json::array();
        for (const auto& entry : entries_) {
            j["entries"].push_back(serialize_entry(entry));
        }
        j["unread_count"] = std::min(unread_count_.load(), entries_.size());
    }

    try {
        fs::create_directories(fs::path(path).parent_path());
        std::ofstream output(path);
        output << j.dump(2);
    } catch (...) {
    }
}

} // namespace misty::panel
