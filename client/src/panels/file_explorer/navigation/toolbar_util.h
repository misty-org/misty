#pragma once

#include <stack>
#include <string>
#include <vector>

#include "panels/file_explorer/state/file_explorer_state.h"
#include "panels/search/search_state.h"

namespace misty::panel {

struct BreadcrumbSegment {
    std::string label;
    std::string target_path;
};

int oversampled_icon_size(float display_size);

std::vector<BreadcrumbSegment> build_breadcrumb_segments(const std::string& current_path);

void clear_scoped_search(SearchState& search_state);

void discard_current_history_entries(std::stack<std::string>& history, const std::string& current_path);

void push_history_entry_if_distinct(std::stack<std::string>& history, const std::string& path);

}  // namespace misty::panel
