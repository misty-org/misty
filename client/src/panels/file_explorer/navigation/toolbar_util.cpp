#include "panels/file_explorer/navigation/toolbar_util.h"

#include <algorithm>
#include <cmath>
#include <cstdlib>
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

    const char* home = std::getenv("HOME");
    const std::string home_path = home ? home : "";
    const fs::path path(current_path);
    fs::path cumulative;

    if (!home_path.empty() && current_path.rfind(home_path, 0) == 0) {
        cumulative = fs::path(home_path);
        segments.push_back({"~", cumulative.string()});
        std::error_code ec;
        const fs::path relative = fs::relative(path, cumulative, ec);
        if (!ec) {
            for (const auto& part : relative) {
                cumulative /= part;
                segments.push_back({part.string(), cumulative.string()});
            }
            return segments;
        }
    }

    if (path.is_absolute()) {
        cumulative = path.root_path();
        const std::string root = cumulative.string().empty() ? "/" : cumulative.string();
        segments.push_back({root, root});
    }
    for (const auto& part : path.relative_path()) {
        cumulative /= part;
        segments.push_back({part.string(), cumulative.string()});
    }
    if (segments.empty()) {
        segments.push_back({current_path, current_path});
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

void discard_current_history_entries(std::stack<std::string>& history, const std::string& current_path) {
    while (!history.empty() && path_utils::same_history_path(history.top(), current_path)) {
        history.pop();
    }
}

void push_history_entry_if_distinct(std::stack<std::string>& history, const std::string& path) {
    if (path.empty()) {
        return;
    }
    if (!history.empty() && path_utils::same_history_path(history.top(), path)) {
        return;
    }
    history.push(path);
}

}  // namespace misty::panel
