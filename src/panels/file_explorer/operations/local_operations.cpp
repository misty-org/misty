#include "panels/file_explorer/file_explorer_panel.h"

#include <algorithm>
#include <atomic>
#include <cstdio>
#include <filesystem>

#include "core/commands/command_manager.h"
#include "core/file_transfer/file_transfer.h"
#include "panels/file_explorer/content/file_explorer_content_util.h"
#include "panels/file_explorer/operations/file_operation_jobs.h"
#include "panels/file_explorer/operations/file_master_operations.h"
#include "panels/file_explorer/operations/operation_queue_state.h"
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

std::string clipboard_operation_label(ClipboardOp op) {
    switch (op) {
        case ClipboardOp::CUT:
            return "Move";
        case ClipboardOp::COPY:
            return "Copy";
        case ClipboardOp::NONE:
        default:
            return "File operation";
    }
}

void remove_item_from_listing(FileListingsState& listings,
                              const std::string& source_state_key,
                              const FileItem& item) {
    if (source_state_key.empty()) {
        return;
    }

    FileListing* listing = listings.find(source_state_key);
    if (!listing) {
        return;
    }

    const auto old_size = listing->files.size();
    listing->files.erase(
        std::remove_if(listing->files.begin(), listing->files.end(), [&](const FileItem& candidate) {
            return (!item.id.empty() && candidate.id == item.id) ||
                   (!item.path.empty() && candidate.path == item.path);
        }),
        listing->files.end());

    if (listing->files.size() != old_size) {
        listing->note_listing_changed();
    }
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
    if (rename_mode_active()) {
        auto& session = rename_session_state();
        bool review_modal_open = false;
        {
            std::lock_guard<std::mutex> lock(session.mu);
            review_modal_open = session.review_modal_open;
        }

        if (review_modal_open) {
            if (ImGui::IsKeyPressed(ImGuiKey_Escape)) {
                std::lock_guard<std::mutex> lock(session.mu);
                session.review_modal_open = false;
            }
            return;
        }

        if (ImGui::IsKeyPressed(ImGuiKey_Escape)) {
            cancel_rename_mode();
            return;
        }
        if (ImGui::IsKeyPressed(ImGuiKey_Enter) || ImGui::IsKeyPressed(ImGuiKey_KeypadEnter)) {
            open_rename_review_modal();
            return;
        }
        return;
    }

    if (io.WantTextInput && ImGui::IsAnyItemActive()) {
        return;
    }

    auto& state = registry_.get_state<FileExplorerState>(state_key_);
    const auto& listing = active_listing();
    const bool has_file_master_selection = selected_items_are_file_master_items(ui_.selected_files, listing);
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
    if (has_file_master_selection && core::CommandManager::get().matches("explorer.rename")) {
        initiate_rename(ui_);
    }
}

void FileExplorerPanel::perform_copy(FileExplorerState& state) {
    auto& clipboard = registry_.get_state<ClipboardState>("Clipboard");
    clipboard.op = ClipboardOp::COPY;
    clipboard.items = selected_file_items(ui_.selected_files, active_listing());
    clipboard.source_state_key = state_key_;
    clipboard.source_path = state.current_path;
    clipboard.source_listing_revision = active_listing().listing_revision.load(std::memory_order_relaxed);
    clipboard.paths.clear();
    clipboard.paths.reserve(clipboard.items.size());
    for (const auto& item : clipboard.items) {
        clipboard.paths.push_back(item.path);
    }
}

void FileExplorerPanel::perform_cut(FileExplorerState& state) {
    auto& clipboard = registry_.get_state<ClipboardState>("Clipboard");
    clipboard.op = ClipboardOp::CUT;
    clipboard.items = selected_file_items(ui_.selected_files, active_listing());
    clipboard.source_state_key = state_key_;
    clipboard.source_path = state.current_path;
    clipboard.source_listing_revision = active_listing().listing_revision.load(std::memory_order_relaxed);
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
    const std::string source_state_key = clipboard.source_state_key;
    const uint64_t batch_id = enqueue_clipboard_operation_batch(
        registry_,
        worker_pool_,
        state_key_,
        clipboard.items,
        dest_dir,
        clipboard.op,
        source_state_key,
        [this, &state](const core::FileMasterResult& result) {
            if (result.success) {
                request_manual_refresh(state);
            }
        });

    if (batch_id != 0 && clipboard.op == ClipboardOp::CUT) {
        clipboard.clear();
    }
}

void FileExplorerPanel::perform_drop_items(FileExplorerState& state,
                                           const std::vector<FileItem>& items,
                                           const std::string& dest_dir,
                                           ClipboardOp op,
                                           const std::string& source_state_key) {
    if (dest_dir.empty()) {
        return;
    }

    enqueue_clipboard_operation_batch(
        registry_,
        worker_pool_,
        state_key_,
        items,
        dest_dir,
        op,
        source_state_key,
        [this, &state](const core::FileMasterResult& result) {
            if (result.success) {
                request_manual_refresh(state);
            }
        });
}

bool FileExplorerPanel::perform_paste_item(FileExplorerState& state,
                                           const FileItem& item,
                                           const std::string& dest_dir,
                                           ClipboardOp op,
                                           uint64_t job_id,
                                           const std::string& source_state_key) {
    auto& transfers = registry_.get_state<core::FileTransfer>("FileMasterTransfers");
    add_file_operation_to_job(registry_, job_id);
    const bool dispatched = dispatch_file_master_clipboard_operation(
        worker_pool_,
        transfers,
        item,
        dest_dir,
        op,
        job_id,
        [this, &state, item, op, source_state_key, job_id](core::FileMasterResult result) {
            finish_file_operation_job(registry_, job_id, result.success, result.error_message);
            if (result.success) {
                if (op == ClipboardOp::CUT) {
                    auto& listings = registry_.get_state<FileListingsState>(kFileListingsStateKey);
                    remove_item_from_listing(listings, source_state_key, item);
                }
                request_manual_refresh(state);
            }
        });
    if (!dispatched) {
        cancel_file_operation_in_job(registry_, job_id);
    }
    return dispatched;
}

void FileExplorerPanel::download_remote_item(FileExplorerState& state, const FileItem& item) {
    enqueue_download_operation(
        registry_,
        worker_pool_,
        state_key_,
        item,
        [this, &state](const core::FileMasterResult& result) {
            if (result.success) {
                request_manual_refresh(state);
            }
        });
}

void FileExplorerPanel::perform_delete_selected(FileExplorerState& state) {
    (void)state;
    auto items = selected_file_items(ui_.selected_files, active_listing());
    ui_.permanent_delete_paths.clear();
    ui_.permanent_delete_paths.reserve(items.size());
    for (const auto& item : items) {
        if (is_file_master_item(item)) {
            ui_.permanent_delete_paths.push_back(item.path);
        }
    }
    ui_.show_permanent_delete_modal = !ui_.permanent_delete_paths.empty();
}

void FileExplorerPanel::confirm_permanent_delete(FileExplorerPanel::TransientUiState& ui) {
    auto paths = ui.permanent_delete_paths;
    ui.show_permanent_delete_modal = false;
    ui.permanent_delete_paths.clear();

    auto& state = registry_.get_state<FileExplorerState>(state_key_);
    std::vector<FileItem> items;
    items.reserve(paths.size());
    for (const auto& path : paths) {
        const FileItem* item = find_file_item_by_path(active_listing().files, path);
        if (item && is_file_master_item(*item)) {
            items.push_back(*item);
        }
    }
    enqueue_delete_operation_batch(
        registry_,
        worker_pool_,
        state_key_,
        items,
        [this, &state](const core::FileMasterResult& result) {
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

void FileExplorerPanel::retry_permission_delete(FileExplorerPanel::TransientUiState& ui) {
    ui.show_permission_delete_modal = false;
    ui.permission_delete_paths.clear();
    ui.permission_delete_permanent = false;
}

} // namespace misty::panel
