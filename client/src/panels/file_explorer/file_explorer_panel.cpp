#include "panels/file_explorer/file_explorer_panel.h"

#include <algorithm>
#include <cstring>
#include <cstdlib>
#include <filesystem>
#include <nlohmann/json.hpp>

namespace fs = std::filesystem;
using json = nlohmann::json;

using namespace misty::core;

namespace misty::panel {

namespace {
std::vector<std::string> stack_to_vector(std::stack<std::string> values) {
    std::vector<std::string> ordered;
    ordered.reserve(values.size());
    while (!values.empty()) {
        ordered.push_back(values.top());
        values.pop();
    }
    std::reverse(ordered.begin(), ordered.end());
    return ordered;
}

std::stack<std::string> vector_to_stack(const json& values) {
    std::stack<std::string> out;
    if (!values.is_array()) {
        return out;
    }
    for (const auto& value : values) {
        if (value.is_string()) {
            out.push(value.get<std::string>());
        }
    }
    return out;
}

std::string default_local_start_path() {
    if (const char* home = std::getenv("HOME")) {
        return home;
    }
    return fs::current_path().string();
}
}  // namespace

FileExplorerPanel::FileExplorerPanel(UIRegistry& registry,
                                     WorkerPool& worker_pool,
                                     FileExplorerPanelProps props)
    : MultiPanel(props.panel_id),
      registry_(registry),
      worker_pool_(worker_pool),
      state_key_(std::move(props.state_key)),
      owns_state_cleanup_(props.owns_state_cleanup) {
    auto& file_explorer_state = registry_.get_state<FileExplorerState>(state_key_);

    if (props.restore_persistent_state) {
        file_explorer_state.load_state();
    }

    std::string start_path = default_local_start_path();

    if (!props.initial_path_override.empty()) {
        start_path = std::move(props.initial_path_override);
    } else if (props.restore_persistent_state && !file_explorer_state.last_opened_path.empty()) {
        std::string saved_path = file_explorer_state.last_opened_path;

        bool is_valid = true;
        if (saved_path.rfind("misty://", 0) != 0) {
            if (!fs::exists(saved_path) || !fs::is_directory(saved_path)) {
                is_valid = false;
            }
        }

        if (is_valid) {
            start_path = saved_path;
        }
    }

    if (!start_path.empty()) {
        std::error_code ec;
        fs::create_directories(start_path, ec);
    }

    file_explorer_state.pending_navigation_path = start_path;

    sidebar_panel_ = std::make_shared<FileSidebarPanel>(registry, worker_pool);
    sidebar_panel_->set_mount_path_provider([]() -> std::string {
        if (const char* home = std::getenv("HOME")) {
            return home;
        }
        return {};
    });
    sidebar_panel_->set_active_explorer_state_key_provider([this]() -> std::string {
        return active_explorer_state_key();
    });
    sidebar_panel_->set_file_drop_handler(
        [this](const std::string& source_state_key, const std::string& dest_path, ClipboardOp op) {
            drop_selected_items_to_path(source_state_key, dest_path, op);
        });
}

FileExplorerPanel::~FileExplorerPanel() = default;

std::string FileExplorerPanel::save_restore_state() const {
    const auto& state = const_cast<core::UIRegistry&>(registry_).get_state<FileExplorerState>(state_key_);
    json data;
    data["current_path"] = std::string(state.current_path);
    data["pending_navigation_path"] = state.pending_navigation_path;
    data["show_hidden"] = state.show_hidden;
    data["grid_view"] = state.grid_view;
    data["back_history"] = stack_to_vector(state.back_history);
    data["forward_history"] = stack_to_vector(state.forward_history);
    return data.dump();
}

void FileExplorerPanel::load_restore_state(const std::string& encoded_state) {
    if (encoded_state.empty()) {
        return;
    }

    json data = json::parse(encoded_state, nullptr, false);
    if (data.is_discarded()) {
        return;
    }

    auto& state = registry_.get_state<FileExplorerState>(state_key_);
    std::lock_guard<std::mutex> lock(state.mu);
    state.clear_transient_ui_state();
    state.files.clear();
    state.show_hidden = data.value("show_hidden", state.show_hidden);
    state.grid_view = data.value("grid_view", state.grid_view);
    state.back_history = vector_to_stack(data.value("back_history", json::array()));
    state.forward_history = vector_to_stack(data.value("forward_history", json::array()));
    state.pending_navigation_path = data.value("pending_navigation_path", std::string());
    const std::string current_path = data.value("current_path", std::string());
    if (state.pending_navigation_path.empty()) {
        state.pending_navigation_path = current_path;
    }
    std::strncpy(state.current_path, current_path.c_str(), sizeof(state.current_path) - 1);
    state.current_path[sizeof(state.current_path) - 1] = '\0';
    std::strncpy(state.search_path, current_path.c_str(), sizeof(state.search_path) - 1);
    state.search_path[sizeof(state.search_path) - 1] = '\0';
    state.is_loading = false;
    state.show_loading_animation = false;
    state.sort_dirty = true;
    state.note_listing_changed();
}

void FileExplorerPanel::release_state() {
    if (!owns_state_cleanup_) {
        return;
    }
    if (!registry_.has_state(state_key_)) {
        return;
    }
    {
        auto& state = registry_.get_state<FileExplorerState>(state_key_);
        std::lock_guard<std::mutex> lock(state.mu);
        state.clear_for_state_release();
    }
    registry_.erase_state(state_key_);
}

void FileExplorerPanel::render_sidebar() {
    sidebar_panel_->render();
}

void FileExplorerPanel::render_content() {
    render();
}

}  // namespace misty::panel
