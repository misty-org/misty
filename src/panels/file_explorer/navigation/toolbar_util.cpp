#include "panels/file_explorer/navigation/toolbar_util.h"

#include <algorithm>
#include <cmath>
#include <filesystem>

namespace fs = std::filesystem;

namespace misty::panel {

int oversampled_icon_size(float display_size) {
    return std::max(16, static_cast<int>(std::ceil(display_size * 2.0f)));
}

std::vector<BreadcrumbSegment> build_breadcrumb_segments(const std::string& current_path) {
    std::vector<BreadcrumbSegment> segments;
    if (current_path.empty()) {
        return segments;
    }

    if (current_path == FileExplorerState::VIRTUAL_PATH_RECENT) {
        return {{"Recent", current_path}};
    }
    if (current_path == FileExplorerState::VIRTUAL_PATH_STARRED) {
        return {{"Starred", current_path}};
    }
    if (current_path == FileExplorerState::VIRTUAL_PATH_TRASH) {
        return {{"Trash", current_path}};
    }

    std::error_code ec;
    fs::path path = fs::path(current_path).lexically_normal();
    if (!path.is_absolute()) {
        const fs::path absolute_path = fs::absolute(path, ec);
        if (!ec) {
            path = absolute_path.lexically_normal();
        } else {
            ec.clear();
        }
    }
    fs::path cumulative;

    if (path.is_absolute()) {
        cumulative = path.root_path();
        const std::string root = cumulative.string().empty() ? "/" : cumulative.string();
        segments.push_back({root, root});
    }
    for (const auto& part : path.relative_path()) {
        const std::string label = part.string();
        if (label.empty() || label == ".") {
            continue;
        }
        cumulative /= part;
        segments.push_back({label, cumulative.string()});
    }
    if (segments.empty()) {
        segments.push_back({path.string().empty() ? current_path : path.string(),
                            path.string().empty() ? current_path : path.string()});
    }
    return segments;
}

void clear_scoped_search(SearchState& search_state) {
    std::lock_guard<std::mutex> lock(search_state.mu);
    search_state.is_open = false;
    search_state.focus_query = false;
    search_state.selected_index = 0;
    search_state.results.clear();
    search_state.search_pending = false;
    search_state.search_in_flight = false;
    ++search_state.request_generation;
    search_state.last_submitted_query.clear();
    search_state.last_err.clear();
}

}  // namespace misty::panel
