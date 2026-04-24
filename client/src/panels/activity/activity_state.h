#pragma once

#include <string>
#include <vector>
#include <mutex>
#include <chrono>
#include <atomic>
#include "core/ui/ui_registry.h"

namespace misty::panel {

    enum class ActivityEntryType {
        INFO,
        SUCCESS,
        ERROR
    };

    struct ActivityEntry {
        uint64_t id;
        std::string sender;   // "File", "System", extension name, etc.
        std::string message;
        std::chrono::system_clock::time_point timestamp;
        ActivityEntryType type;
    };

    class ActivityState : public core::UIState {
    public:
        bool is_open = false;

        void add_entry(const std::string& sender, const std::string& message,
                       ActivityEntryType type = ActivityEntryType::INFO) {
            std::lock_guard<std::mutex> lock(mu_);
            ActivityEntry entry;
            entry.id = next_id_++;
            entry.sender = sender;
            entry.message = message;
            entry.timestamp = std::chrono::system_clock::now();
            entry.type = type;
            entries_.push_back(std::move(entry));
            if (entries_.size() > MAX_ENTRIES) {
                entries_.erase(entries_.begin());
            }
        }

        std::vector<ActivityEntry> get_entries() {
            std::lock_guard<std::mutex> lock(mu_);
            return entries_;
        }

        void clear() {
            std::lock_guard<std::mutex> lock(mu_);
            entries_.clear();
        }

        size_t count() {
            std::lock_guard<std::mutex> lock(mu_);
            return entries_.size();
        }

    private:
        static constexpr size_t MAX_ENTRIES = 200;
        std::mutex mu_;
        std::vector<ActivityEntry> entries_;
        std::atomic<uint64_t> next_id_{1};
    };

}
