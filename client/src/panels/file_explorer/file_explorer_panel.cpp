#include "panels/file_explorer/file_explorer_panel.h"

#include <cstdlib>
#include <filesystem>

namespace fs = std::filesystem;

using namespace misty::core;

namespace misty::panel {

namespace {
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
      state_key_(std::move(props.state_key)) {
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

void FileExplorerPanel::render_sidebar() {
    sidebar_panel_->render();
}

void FileExplorerPanel::render_content() {
    render();
}

}  // namespace misty::panel
