#include "panels/file_explorer/file_explorer_panel.h"

#include <cstdio>
#include <filesystem>

#include "core/commands/command_manager.h"
#include "core/file_transfer/file_transfer.h"
#include "panels/file_explorer/content/file_explorer_content_util.h"
#include "panels/file_explorer/operations/file_master_operations.h"
#include "panels/file_explorer/state/remote_mount_state.h"

namespace misty::panel {
namespace {

bool is_remote_path(const std::string& path) {
    const std::string mount_root = get_mount_root();
    return !path.empty() && path.rfind(mount_root, 0) == 0;
}

std::string normalized_sync_root(const std::string& path) {
    return std::filesystem::path(path).lexically_normal().string();
}

bool is_virtual_path(const std::string& path) {
    return path.rfind("misty://", 0) == 0;
}

}  // namespace

void FileExplorerPanel::handle_commands() {
    MultiPanel::handle_commands();

    if (auto* active_explorer = dynamic_cast<FileExplorerPanel*>(active_panel())) {
        if (active_explorer != this) {
            active_explorer->handle_file_operation_commands();
            return;
        }
    }

    handle_file_operation_commands();
}

void FileExplorerPanel::handle_file_operation_commands() {
    ImGuiIO& io = ImGui::GetIO();
    if (io.WantTextInput && ImGui::IsAnyItemActive()) {
        return;
    }

    auto& state = registry_.get_state<FileExplorerState>(state_key_);
    const auto& listing = active_listing();
    const bool has_file_master_selection = selected_items_are_file_master_items(ui_.selected_files, listing);
    const bool has_single_file_master_selection = exactly_one_file_master_item_selected(ui_.selected_files, listing);
    const bool has_clipboard = registry_.get_state<ClipboardState>("Clipboard").has_content();

    if (has_file_master_selection && core::CommandManager::get().matches("explorer.copy")) {
        perform_copy(state);
    }
    if (has_file_master_selection && core::CommandManager::get().matches("explorer.cut")) {
        perform_cut(state);
    }
    if (has_clipboard && core::CommandManager::get().matches("explorer.paste")) {
        perform_paste(state);
    }
    if (has_file_master_selection && core::CommandManager::get().matches("explorer.delete")) {
        perform_delete_selected(state);
    }
    if (has_single_file_master_selection && core::CommandManager::get().matches("explorer.rename")) {
        initiate_rename(ui_);
    }
}

void FileExplorerPanel::perform_copy(FileExplorerState& state) {
    (void)state;
    auto& clipboard = registry_.get_state<ClipboardState>("Clipboard");
    clipboard.op = ClipboardOp::COPY;
    clipboard.items = selected_file_items(ui_.selected_files, active_listing());
    clipboard.paths.clear();
    clipboard.paths.reserve(clipboard.items.size());
    for (const auto& item : clipboard.items) {
        clipboard.paths.push_back(item.path);
    }
}

void FileExplorerPanel::perform_cut(FileExplorerState& state) {
    (void)state;
    auto& clipboard = registry_.get_state<ClipboardState>("Clipboard");
    clipboard.op = ClipboardOp::CUT;
    clipboard.items = selected_file_items(ui_.selected_files, active_listing());
    clipboard.paths.clear();
    clipboard.paths.reserve(clipboard.items.size());
    for (const auto& item : clipboard.items) {
        clipboard.paths.push_back(item.path);
    }
}

void FileExplorerPanel::perform_paste(FileExplorerState& state) {
    const std::string dest_dir = state.current_path;
    if (dest_dir.empty()) {
        return;
    }

    auto& clipboard = registry_.get_state<ClipboardState>("Clipboard");
    bool dispatched_cut = false;
    for (const auto& item : clipboard.items) {
        if (!is_file_master_item(item)) {
            continue;
        }
        const bool dispatched = perform_paste_item(state, item, dest_dir, clipboard.op);
        dispatched_cut = dispatched_cut || (dispatched && clipboard.op == ClipboardOp::CUT);
    }

    if (dispatched_cut) {
        clipboard.clear();
    }
}

void FileExplorerPanel::perform_drop_items(FileExplorerState& state,
                                           const std::vector<FileItem>& items,
                                           const std::string& dest_dir,
                                           ClipboardOp op) {
    if (dest_dir.empty()) {
        return;
    }

    for (const auto& item : items) {
        if (!is_file_master_item(item)) {
            continue;
        }
        perform_paste_item(state, item, dest_dir, op);
    }
}

bool FileExplorerPanel::perform_paste_item(FileExplorerState& state,
                                           const FileItem& item,
                                           const std::string& dest_dir,
                                           ClipboardOp op) {
    auto& transfers = registry_.get_state<core::FileTransfer>("FileMasterTransfers");
    const bool dispatched = dispatch_file_master_clipboard_operation(
        worker_pool_,
        transfers,
        item,
        dest_dir,
        op,
        [this, &state](core::FileMasterResult result) {
            if (result.success) {
                request_manual_refresh(state);
            }
        });
    return dispatched;
}

void FileExplorerPanel::download_remote_item(FileExplorerState& state, const FileItem& item) {
    auto& transfers = registry_.get_state<core::FileTransfer>("FileMasterTransfers");
    const bool dispatched = download_remote_file_master_item(worker_pool_, transfers, item, [this, &state](core::FileMasterResult result) {
        if (result.success) {
            request_manual_refresh(state);
        }
    });
    if (!dispatched) {
        return;
    }
}

void FileExplorerPanel::perform_delete_selected(FileExplorerState& state) {
    (void)state;
    auto items = selected_file_items(ui_.selected_files, active_listing());
    auto& transfers = registry_.get_state<core::FileTransfer>("FileMasterTransfers");
    for (const auto& item : items) {
        remove_file_master_item(worker_pool_, transfers, item, [this, &state](core::FileMasterResult result) {
            if (result.success) {
                request_manual_refresh(state);
            }
        });
    }
}

void FileExplorerPanel::initiate_rename(FileExplorerPanel::TransientUiState& ui) {
    auto items = selected_file_items(ui.selected_files, active_listing());
    if (items.size() != 1 || !is_file_master_item(items[0])) {
        return;
    }

    std::snprintf(ui.rename_buffer, sizeof(ui.rename_buffer), "%s", items[0].name.c_str());
    ui.rename_target_path = items[0].path;
    ui.show_rename_modal = true;
}

void FileExplorerPanel::perform_rename_from_modal(FileExplorerPanel::TransientUiState& ui) {
    const std::string new_name(ui.rename_buffer);
    if (new_name.empty() || new_name.find('/') != std::string::npos || ui.rename_target_path.empty()) {
        return;
    }

    const FileItem* item = find_file_item_by_path(active_listing().files, ui.rename_target_path);
    if (!item || item->name == new_name) {
        return;
    }

    auto& transfers = registry_.get_state<core::FileTransfer>("FileMasterTransfers");
    auto& state = registry_.get_state<FileExplorerState>(state_key_);
    rename_file_master_item(worker_pool_, transfers, *item, new_name, [this, &state](core::FileMasterResult result) {
        if (result.success) {
            request_manual_refresh(state);
        }
    });
}

void FileExplorerPanel::create_sync_object_for_current_directory(FileExplorerState& state) {
    const std::string current_path(state.current_path);
    if (current_path.empty() ||
        is_virtual_path(current_path)) {
        return;
    }

    const std::string root = normalized_sync_root(current_path);
    if (file_sync_roots_.count(root) > 0) {
        return;
    }

    std::error_code ec;
    if (is_remote_path(root)) {
        std::filesystem::create_directories(root, ec);
    }
    if (ec || !std::filesystem::is_directory(root)) {
        return;
    }

    auto sync = std::make_unique<core::FileSyncMaster>(root);
    sync->sync_start();
    file_sync_roots_.insert(root);
    file_sync_objects_.push_back(std::move(sync));
}

void FileExplorerPanel::confirm_permanent_delete(FileExplorerPanel::TransientUiState& ui) {
    ui.show_permanent_delete_modal = false;
    ui.permanent_delete_paths.clear();
}

void FileExplorerPanel::retry_permission_delete(FileExplorerPanel::TransientUiState& ui) {
    ui.show_permission_delete_modal = false;
    ui.permission_delete_paths.clear();
    ui.permission_delete_permanent = false;
}

} // namespace misty::panel
