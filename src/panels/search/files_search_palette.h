#pragma once

#include "core/threading/worker_pool.h"
#include "core/ui/state_registry.h"
#include "panels/search/search_impl.h"
#include "panels/search/search_state.h"

#include <functional>
#include <string>
#include <vector>

#include <imgui.h>

namespace misty::panel {

class FilesSearchPalette {
public:
    using LocalResultProvider = std::function<std::vector<SearchResult>(const SearchQuery&)>;
    using ExecuteHandler = std::function<void(const SearchResult&)>;

    FilesSearchPalette(core::StateRegistry& state_registry,
                       core::WorkerPool& worker_pool,
                       std::string state_key = "Files_SearchPalette");

    void set_local_result_provider(LocalResultProvider provider);
    void set_execute_handler(ExecuteHandler handler);

    void open(const std::string& current_path);
    void close();
    bool is_open() const;
    std::string current_query() const;

    void render(const std::string& current_path, const ImVec2& viewport_pos, const ImVec2& viewport_size);

private:
    SearchQuery build_query(const std::string& raw_query, const std::string& current_path) const;
    void submit_search(const SearchQuery& query);
    void render_results(SearchState& state);
    void activate_selected_result(SearchState& state);

    core::StateRegistry& state_registry_;
    core::WorkerPool& worker_pool_;
    std::string state_key_;
    LocalResultProvider local_result_provider_;
    ExecuteHandler execute_handler_;
    SearchImpl search_impl_;
};

} // namespace misty::panel
