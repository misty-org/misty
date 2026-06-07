#pragma once

#include <atomic>
#include <cstdint>
#include <mutex>
#include <string>
#include <vector>

#include "core/file_sync/file_sync_compare.h"
#include "core/ui/state_registry.h"

namespace misty::panel {

struct FileSyncCompareState : public core::StateEntry {
    mutable std::mutex mu;
    bool initialized = false;
    bool compare_mode = false;
    bool diff_tray_open = false;
    bool compare_in_flight = false;
    bool loading_pairs = false;
    bool watch_mode = false;
    bool stale = false;
    int64_t active_pair_id = 0;
    int64_t last_watch_refresh_ms = 0;
    int64_t last_compare_started_ms = 0;
    int64_t last_compared_at_ms = 0;
    std::string error_message;
    std::string left_state_key;
    std::string right_state_key;
    core::FileSyncEndpoint last_left;
    core::FileSyncEndpoint last_right;
    std::vector<core::FileSyncPair> saved_pairs;
    std::vector<core::FileSyncCompareRow> rows;
    std::atomic<uint64_t> compare_revision{0};
};

}  // namespace misty::panel
