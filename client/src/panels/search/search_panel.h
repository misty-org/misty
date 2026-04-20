#pragma once

#include "panels/search/search_state.h"
#include "panels/workspace/workspace_state.h"
#include "core/ui/ui_registry.h"
#include "core/threading/worker_pool.h"

namespace misty::panel {

class SearchPanel {
public:
    SearchPanel(core::UIRegistry& ui_registry,
                core::WorkerPool& worker_pool,
                std::string explorer_state_key = "Files",
                std::string search_state_key = "Search");
    ~SearchPanel() = default;

    void render();  // no-op; search is rendered inline by FileExplorerPanel
    void toggle();
    void submit_search(const std::string& query);
    void navigate_to_result(const SearchResult& result);
    void render_results(SearchState& state);

private:
    void scan_local(SearchState& state, const std::string& query, uint64_t generation, const std::string& local_root);
    void search_remote_scope(SearchState& state,
                             const std::string& query,
                             uint64_t generation,
                             const std::string& remote_name,
                             const std::string& remote_path,
                             const std::string& provider_folder,
                             const std::string& folder_name);

    core::UIRegistry& ui_registry_;
    core::WorkerPool& worker_pool_;
    std::string explorer_state_key_;
    std::string search_state_key_;
};

} // namespace misty::panel
