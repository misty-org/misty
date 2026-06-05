#include "panels/file_explorer/state/file_explorer_state.h"

namespace misty::panel {

FileExplorerState::FileExplorerState() {
    std::memset(current_path, 0, sizeof(current_path));
    std::memset(search_path, 0, sizeof(search_path));
}

void FileExplorerState::clear_state() {
    while (!back_history.empty()) {
        back_history.pop();
    }
    while (!forward_history.empty()) {
        forward_history.pop();
    }
    current_path[0] = '\0';
    search_path[0] = '\0';
    selected_files.clear();
    selected_files_by_path.clear();
    last_selected_index_by_path.clear();
    pending_transfer_refresh_epoch.store(0, std::memory_order_relaxed);
    handled_transfer_refresh_epoch = 0;
}

}  // namespace misty::panel
