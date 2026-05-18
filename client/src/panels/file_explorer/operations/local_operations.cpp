#include "panels/file_explorer/file_explorer_panel.h"

#include <cstdio>
#include <filesystem>

#include "core/file_master/file_master_local.h"
#include "core/file_transfer/file_transfer.h"
#include "panels/file_explorer/state/remote_mount_state.h"

namespace misty::panel {
namespace {

bool is_remote_path(const std::string& path) {
    const std::string mount_root = mount_utils::get_mount_root();
    return !path.empty() && path.rfind(mount_root, 0) == 0;
}

std::vector<UnifiedFileItem> selected_items(const FileExplorerState& state) {
    std::vector<UnifiedFileItem> items;
    items.reserve(state.selected_files.size());
    for (const auto& selected_id : state.selected_files) {
        for (const auto& item : state.files) {
            if (item.id == selected_id) {
                items.push_back(item);
                break;
            }
        }
    }
    return items;
}

}  // namespace

core::FileMasterProps FileExplorerPanel::make_local_props(const UnifiedFileItem& item,
                                                          const std::string& dest_path) const {
    core::FileMasterProps props;
    props.file_name = item.name;
    props.local_source.path = item.path;
    props.local_dest.path = dest_path;
    return props;
}

void FileExplorerPanel::perform_copy(FileExplorerState& state) {
    auto& clipboard = registry_.get_state<ClipboardState>("Clipboard");
    clipboard.op = ClipboardOp::COPY;
    clipboard.items = selected_items(state);
    clipboard.paths.clear();
    clipboard.paths.reserve(clipboard.items.size());
    for (const auto& item : clipboard.items) {
        clipboard.paths.push_back(item.path);
    }
}

void FileExplorerPanel::perform_cut(FileExplorerState& state) {
    auto& clipboard = registry_.get_state<ClipboardState>("Clipboard");
    clipboard.op = ClipboardOp::CUT;
    clipboard.items = selected_items(state);
    clipboard.paths.clear();
    clipboard.paths.reserve(clipboard.items.size());
    for (const auto& item : clipboard.items) {
        clipboard.paths.push_back(item.path);
    }
}

void FileExplorerPanel::perform_paste(FileExplorerState& state) {
    const std::string dest_dir = state.current_path;
    if (dest_dir.empty() || is_remote_path(dest_dir)) {
        return;
    }

    auto& clipboard = registry_.get_state<ClipboardState>("Clipboard");
    for (const auto& item : clipboard.items) {
        if (is_remote_path(item.path)) {
            continue;
        }
        perform_paste_local_to_local(state, item, dest_dir, clipboard.op);
    }
}

void FileExplorerPanel::perform_drop_items(FileExplorerState& state,
                                           const std::vector<UnifiedFileItem>& items,
                                           const std::string& dest_dir,
                                           ClipboardOp op) {
    if (dest_dir.empty() || is_remote_path(dest_dir)) {
        return;
    }

    for (const auto& item : items) {
        if (is_remote_path(item.path)) {
            continue;
        }
        perform_paste_local_to_local(state, item, dest_dir, op);
    }
}

void FileExplorerPanel::perform_paste_local_to_local(FileExplorerState& state,
                                                     const UnifiedFileItem& item,
                                                     const std::string& dest_dir,
                                                     ClipboardOp op) {
    (void)state;
    if (dest_dir.empty() || op == ClipboardOp::NONE) {
        return;
    }

    std::filesystem::path resolved_dest = std::filesystem::path(dest_dir) / item.name;
    std::error_code ec;
    if (std::filesystem::equivalent(std::filesystem::path(item.path), resolved_dest, ec) && !ec) {
        return;
    }

    core::FileMasterLocal file_master(worker_pool_);
    const auto props = make_local_props(item, resolved_dest.string());
    if (op == ClipboardOp::CUT) {
        file_master.cut(props, {});
    } else if (op == ClipboardOp::COPY) {
        file_master.copy(props, {});
    }
}

void FileExplorerPanel::perform_delete_selected(FileExplorerState& state) {
    auto items = selected_items(state);
    core::FileMasterLocal file_master(worker_pool_);
    for (const auto& item : items) {
        if (is_remote_path(item.path)) {
            continue;
        }
        file_master.remove(make_local_props(item), {});
    }
}

void FileExplorerPanel::initiate_rename(FileExplorerState& state) {
    auto items = selected_items(state);
    if (items.size() != 1) {
        return;
    }

    std::snprintf(state.rename_buffer, sizeof(state.rename_buffer), "%s", items[0].name.c_str());
    state.rename_target_path = items[0].path;
    state.show_rename_modal = true;
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

} // namespace misty::panel
