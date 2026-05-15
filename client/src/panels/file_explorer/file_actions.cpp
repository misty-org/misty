#include "panels/file_explorer/file_explorer_panel.h"

namespace misty::panel {

void FileExplorerPanel::perform_copy(FileExplorerState& state) {
    (void)state;
}

void FileExplorerPanel::perform_cut(FileExplorerState& state) {
    (void)state;
}

void FileExplorerPanel::perform_paste(FileExplorerState& state) {
    (void)state;
}

void FileExplorerPanel::perform_undo(FileExplorerState& state) {
    (void)state;
}

void FileExplorerPanel::perform_redo(FileExplorerState& state) {
    (void)state;
}

void FileExplorerPanel::perform_drop_items(FileExplorerState& state,
                                           const std::vector<UnifiedFileItem>& items,
                                           const std::string& dest_dir,
                                           ClipboardOp op) {
    (void)state;
    (void)items;
    (void)dest_dir;
    (void)op;
}

void FileExplorerPanel::perform_paste_local_to_local(FileExplorerState& state,
                                                     const UnifiedFileItem& item,
                                                     const std::string& dest_dir,
                                                     ClipboardOp op) {
    (void)state;
    (void)item;
    (void)dest_dir;
    (void)op;
}

void FileExplorerPanel::queue_cross_device_move(const UnifiedFileItem& item,
                                                const std::string& source_dir,
                                                const std::string& dest_dir,
                                                const std::filesystem::path& src,
                                                const std::filesystem::path& dest,
                                                std::function<void()> on_success) {
    (void)item;
    (void)source_dir;
    (void)dest_dir;
    (void)src;
    (void)dest;
    (void)on_success;
}

void FileExplorerPanel::request_background_move_refresh(const std::string& source_dir,
                                                        const std::string& dest_dir) {
    (void)source_dir;
    (void)dest_dir;
}

void FileExplorerPanel::perform_delete_selected(FileExplorerState& state) {
    (void)state;
}

void FileExplorerPanel::perform_delete_local_selected(FileExplorerState& state) {
    (void)state;
}

bool FileExplorerPanel::perform_delete(FileExplorerState& state,
                                       const std::string& path,
                                       bool* requires_permission) {
    (void)state;
    std::error_code ec;
    const bool removed = std::filesystem::remove_all(path, ec) > 0 && !ec;
    if (requires_permission) {
        *requires_permission = false;
    }
    return removed;
}

void FileExplorerPanel::initiate_rename(FileExplorerState& state) {
    (void)state;
}

void FileExplorerPanel::confirm_permanent_delete(FileExplorerState& state) {
    state.show_permanent_delete_modal = false;
    state.permanent_delete_paths.clear();
}

void FileExplorerPanel::retry_permission_delete(FileExplorerState& state) {
    state.show_permission_delete_modal = false;
    state.permission_delete_paths.clear();
    state.permission_delete_permanent = false;
}

void FileExplorerPanel::record_file_operation(FileOperationRecord record) {
    (void)record;
}

bool FileExplorerPanel::undo_file_operation(FileExplorerState& state,
                                            const FileOperationRecord& record,
                                            std::string* error_message) {
    (void)state;
    (void)record;
    if (error_message) {
        *error_message = "Undo disabled in minimalist mode.";
    }
    return false;
}

bool FileExplorerPanel::redo_file_operation(FileExplorerState& state,
                                            const FileOperationRecord& record,
                                            std::string* error_message) {
    (void)state;
    (void)record;
    if (error_message) {
        *error_message = "Redo disabled in minimalist mode.";
    }
    return false;
}

} // namespace misty::panel
