#pragma once

#include "panels/search/search_state.h"
#include "panels/search/search_impl.h"
#include "core/ui/state_registry.h"
#include "core/threading/worker_pool.h"

#include <functional>

namespace misty::panel {

class SearchPanel {
public:
    SearchPanel(core::StateRegistry& state_registry,
                core::WorkerPool& worker_pool,
                std::string explorer_state_key = "Files",
                std::string search_state_key = "Search");
    ~SearchPanel() = default;

    void render(const std::string& current_path, float available_height);
    void toggle();
    void submit_search(const std::string& query, const std::string& current_path);
    void navigate_to_result(const SearchResult& result);
    void set_navigation_handler(std::function<void(const std::string& path)> handler);

private:
    SearchQuery build_query(const std::string& query_text, const std::string& current_path) const;
    void render_results(SearchState& state, const std::string& current_path);

    core::StateRegistry& state_registry_;
    core::WorkerPool& worker_pool_;
    std::string explorer_state_key_;
    std::string search_state_key_;
    std::function<void(const std::string&)> navigation_handler_;
    SearchImpl search_impl_;
};

} // namespace misty::panel
