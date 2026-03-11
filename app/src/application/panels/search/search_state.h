#pragma once

#include <string>
#include <vector>
#include <unordered_set>
#include <mutex>
#include <atomic>
#include <cstring>

#include "core/ui_registry.h"
#include "panels/file_explorer/file_explorer_state.h"

namespace misty::panel {

struct SearchResult {
    std::string name;
    std::string path_display;   // Human-readable: "OneDrive › matthew › Documents"
    std::string virtual_path;   // Navigable by FileExplorerPanel::navigate_to_path()
    FileSource source = FileSource::LOCAL;
    bool is_dir = false;
    int64_t size = 0;
    int fuzzy_score = 0;
    std::string dedup_key;      // "od:{id}" / "gd:{id}" / "dbx:{path}" / "icl:{email}/{path}"

    // Per-provider navigation metadata (mirrors UnifiedFileItem fields)
    std::string od_item_id;
    std::string od_drive_id;
    std::string od_ms_user_id;

    std::string gd_item_id;
    std::string gd_user_id;
    std::string gd_mime_type;

    std::string dbx_item_id;
    std::string dbx_user_id;
    std::string dbx_path_display;

    std::string icl_email;
    std::string icl_path_display;
};

struct SearchState : public core::UIState {
    SearchState() {
        std::memset(query_buf, 0, sizeof(query_buf));
    }

    char query_buf[256] = "";
    std::string last_submitted_query;

    bool is_open = false;
    bool just_opened = false;       // triggers auto-focus on first frame
    bool pending_submit = false;    // set by input bar, consumed by render() after lock release
    int pending_navigate_index = -1; // set by Enter key, consumed by render() after lock release
    int selected_index = 0;

    // Results — cache results are instant, api_results stream in
    std::vector<SearchResult> cache_results;
    std::vector<SearchResult> api_results;

    // Async tracking
    std::atomic<int> pending_api_tasks{0};
    bool api_search_done = false;

    // Stale-result cancellation: incremented on each new submit_search()
    uint64_t query_generation = 0;

    // Deduplication across cache + API results
    std::unordered_set<std::string> seen_ids;

    std::mutex mu;
};

} // namespace misty::panel
