#pragma once

#include <stack>
#include <string>
#include <vector>

#include "panels/file_explorer/state/file_explorer_state.h"
#include "panels/search/search_state.h"

namespace misty::panel {

/**
 * @brief One clickable segment in the breadcrumb toolbar.
 */
struct BreadcrumbSegment {
    std::string label;
    std::string target_path;
};

/**
 * @brief Converts a display icon size into an oversampled texture size.
 */
int oversampled_icon_size(float display_size);

/**
 * @brief Builds breadcrumb segments for a local or remote explorer path.
 */
std::vector<BreadcrumbSegment> build_breadcrumb_segments(const std::string& current_path);

/**
 * @brief Clears any active scoped search state.
 */
void clear_scoped_search(SearchState& search_state);

}  // namespace misty::panel
