#include "panels/file_explorer/state/file_sidebar_state.h"

#include <algorithm>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <iostream>

#include <nlohmann/json.hpp>

namespace misty::panel {
namespace {
namespace fs = std::filesystem;

fs::path sidebar_preferences_path() {
    const char* home = std::getenv("HOME");
    if (!home || *home == '\0') {
        home = std::getenv("USERPROFILE");
    }
    if (!home || *home == '\0') {
        return {};
    }
    return fs::path(home) / ".misty" / "config" / "file_sidebar.json";
}

}  // namespace

void create_file(const std::string& file_path) {
    std::cout << "creating file at: " << file_path << std::endl;
    std::ofstream file(file_path);
}

std::string normalize_quick_access_pin_path(const std::string& path) {
    if (path.empty()) {
        return {};
    }
    return fs::path(path).lexically_normal().string();
}

void save_sidebar_preferences(const FileSidebarState& state) {
    const fs::path path = sidebar_preferences_path();
    if (path.empty()) {
        return;
    }
    std::error_code ec;
    fs::create_directories(path.parent_path(), ec);
    nlohmann::json data;
    data["pinned_quick_access_paths"] = state.pinned_quick_access_paths;
    std::ofstream out(path, std::ios::trunc);
    if (out) {
        out << data.dump(2);
    }
}

void load_sidebar_preferences(FileSidebarState& state) {
    if (state.preferences_loaded) {
        return;
    }
    state.preferences_loaded = true;
    const fs::path path = sidebar_preferences_path();
    if (path.empty()) {
        return;
    }
    std::ifstream in(path);
    if (!in) {
        return;
    }
    const auto data = nlohmann::json::parse(in, nullptr, false);
    if (data.is_discarded() || !data.is_object()) {
        return;
    }
    const auto pins = data.value("pinned_quick_access_paths", std::vector<std::string>{});
    for (const auto& pin : pins) {
        const std::string normalized = normalize_quick_access_pin_path(pin);
        if (!normalized.empty() && state.pinned_quick_access_seen.insert(normalized).second) {
            state.pinned_quick_access_paths.push_back(normalized);
        }
    }
}

bool pin_quick_access_path(FileSidebarState& state, const std::string& path) {
    const std::string normalized = normalize_quick_access_pin_path(path);
    if (normalized.empty() || state.pinned_quick_access_seen.count(normalized) > 0) {
        return false;
    }
    std::error_code ec;
    if (!fs::is_directory(normalized, ec) || ec) {
        return false;
    }
    state.pinned_quick_access_paths.push_back(normalized);
    state.pinned_quick_access_seen.insert(normalized);
    save_sidebar_preferences(state);
    return true;
}

bool unpin_quick_access_path(FileSidebarState& state, const std::string& path) {
    const std::string normalized = normalize_quick_access_pin_path(path);
    if (normalized.empty()) {
        return false;
    }
    bool removed = false;
    state.pinned_quick_access_paths.erase(
        std::remove_if(state.pinned_quick_access_paths.begin(),
                       state.pinned_quick_access_paths.end(),
                       [&](const std::string& candidate) {
                           const bool match = normalize_quick_access_pin_path(candidate) == normalized;
                           removed = removed || match;
                           return match;
                       }),
        state.pinned_quick_access_paths.end());
    state.pinned_quick_access_seen.erase(normalized);
    if (removed) {
        save_sidebar_preferences(state);
    }
    return removed;
}

}  // namespace misty::panel
