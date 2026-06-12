#pragma once

#include <chrono>
#include <cstdint>
#include <mutex>
#include <string>
#include <vector>

#include "core/ui/state_registry.h"
#include "panels/search/search_impl.h"

namespace misty::panel {

struct SearchState : public core::StateEntry {
    SearchState();

    char query_buf[2048] = "";
    std::vector<SearchResult> results;
    std::string context_path;
    bool is_open = false;
    bool focus_query = false;
    bool just_opened = false;
    int selected_index = 0;
    bool search_pending = false;
    bool search_in_flight = false;
    std::uint64_t request_generation = 0;
    std::chrono::steady_clock::time_point last_input_change_at{};
    std::string last_submitted_query;
    std::string last_err;
    bool results_cached = false;
    bool refresh_in_progress = false;
    bool results_updated = false;
    std::string updated_at;
    std::string request_id;
    std::vector<SearchRemoteStatus> remote_statuses;
    SearchSource last_query_source = SearchSource::LOCAL;
    std::mutex mu;
};

} // namespace misty::panel
