#pragma once

#include <string>
#include <vector>
#include <mutex>
#include <chrono>
#include <atomic>
#include "imgui.h"
#include "core/ui/state_registry.h"

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

    class ActivityState : public core::StateEntry {
    public:
        ActivityState();

        bool is_open = false;
        ImVec2 button_min{0.0f, 0.0f};
        ImVec2 button_max{0.0f, 0.0f};
        bool has_button_rect = false;

        void add_entry(const std::string& sender, const std::string& message,
                       ActivityEntryType type = ActivityEntryType::INFO);

        std::vector<ActivityEntry> get_entries() {
            std::lock_guard<std::mutex> lock(mu_);
            return entries_;
        }

        void clear();

        size_t count() {
            std::lock_guard<std::mutex> lock(mu_);
            return entries_.size();
        }

        size_t unread_count() const {
            return unread_count_.load();
        }

        void mark_all_read();

    private:
        void load_state();
        void persist_state();

        static constexpr size_t MAX_ENTRIES = 200;
        std::mutex mu_;
        std::vector<ActivityEntry> entries_;
        std::atomic<uint64_t> next_id_{1};
        std::atomic<size_t> unread_count_{0};
    };

}
