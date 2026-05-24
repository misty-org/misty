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
    bool is_open = false;
    bool focus_query = false;
    int selected_index = 0;
    bool search_pending = false;
    bool search_in_flight = false;
    std::uint64_t request_generation = 0;
    std::chrono::steady_clock::time_point last_input_change_at{};
    std::string last_submitted_query;
    std::string last_err;
    std::mutex mu;
};

} // namespace misty::panel
