#include "panels/file_explorer/file_explorer_panel.h"

#include <cstdio>
#include <filesystem>
#include <stdexcept>

#include "core/file_master/file_master_local.h"
#include "core/file_transfer/file_transfer.h"
#include "core/manager/env_manager.h"
#include "core/net/http_client.h"
#include "panels/notification/notification_state.h"
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

void notify(core::StateRegistry& registry, const std::string& message, float duration = 4.0f) {
    registry.get_state<NotificationState>("Notifications").add_notification(message, duration);
}

std::vector<FileItem> selected_items(const FileExplorerPanel::TransientUiState& ui, const FileListing& listing) {
    std::vector<FileItem> items;
    items.reserve(ui.selected_files.size());
    for (const auto& selected_id : ui.selected_files) {
        for (const auto& item : listing.files) {
            if (item.id == selected_id) {
                items.push_back(item);
                break;
            }
        }
    }
    return items;
}

}  // namespace

core::FileMasterProps FileExplorerPanel::make_local_props(const FileItem& item,
                                                          const std::string& dest_path) const {
    core::FileMasterProps props;
    props.file_name = item.name;
    props.local_source.path = item.path;
    props.local_dest.path = dest_path;
    return props;
}

void FileExplorerPanel::perform_copy(FileExplorerState& state) {
    (void)state;
    auto& clipboard = registry_.get_state<ClipboardState>("Clipboard");
    clipboard.op = ClipboardOp::COPY;
    clipboard.items = selected_items(ui_, active_listing());
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
    clipboard.items = selected_items(ui_, active_listing());
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
    bool dispatched_cut = false;
    for (const auto& item : clipboard.items) {
        if (is_remote_path(item.path)) {
            continue;
        }
        const bool dispatched = perform_paste_local_to_local(state, item, dest_dir, clipboard.op);
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

bool FileExplorerPanel::perform_paste_local_to_local(FileExplorerState& state,
                                                     const FileItem& item,
                                                     const std::string& dest_dir,
                                                     ClipboardOp op) {
    (void)state;
    if (dest_dir.empty() || op == ClipboardOp::NONE) {
        return false;
    }

    std::filesystem::path resolved_dest = std::filesystem::path(dest_dir) / item.name;
    std::error_code ec;
    if (std::filesystem::equivalent(std::filesystem::path(item.path), resolved_dest, ec) && !ec) {
        return false;
    }

    auto& transfers = registry_.get_state<core::FileTransfer>("FileMasterTransfers");
    core::FileMasterLocal file_master(worker_pool_, &transfers);
    const auto props = make_local_props(item, resolved_dest.string());
    if (op == ClipboardOp::CUT) {
        file_master.cut(props, {});
        return true;
    } else if (op == ClipboardOp::COPY) {
        file_master.copy(props, {});
        return true;
    }
    return false;
}

void FileExplorerPanel::download_remote_item(FileExplorerState& state, const FileItem& item) {
    if (item.type != FileType::REMOTE || item.is_dir || item.sync_remote_name.empty() || item.sync_remote_path.empty()) {
        return;
    }

    const std::string proxy_url = core::EnvManager::get().get("PROXY_SERVICE_URL", "");
    if (proxy_url.empty()) {
        notify(registry_, "Cannot download remote file: PROXY_SERVICE_URL is not configured.");
        return;
    }

    const std::string url = proxy_url +
        "/api/remote/file/download?remote=" + core::url_encode(item.sync_remote_name) +
        "&path=" + core::url_encode(item.sync_remote_path);
    const std::string local_path = item.path;
    const std::string file_name = item.name;

    notify(registry_, "Downloading " + file_name + "...");
    worker_pool_.add(
        [url, local_path]() {
            std::filesystem::path destination(local_path);
            std::error_code ec;
            std::filesystem::create_directories(destination.parent_path(), ec);
            if (ec) {
                throw std::runtime_error("failed to create download directory: " + ec.message());
            }

            auto result = core::HTTPClient::get().download_to_file(
                url,
                local_path,
                {{"Accept", "application/octet-stream"}});
            if (!result.success) {
                throw std::runtime_error(result.error_message.empty() ? "download failed" : result.error_message);
            }
        },
        [this, &state, file_name]() {
            notify(registry_, "Downloaded " + file_name);
            request_manual_refresh(state);
        },
        [this, file_name](const std::string& err) {
            notify(registry_, "Failed to download " + file_name + ": " + err, 6.0f);
        }
    );
}

void FileExplorerPanel::create_sync_object_for_current_directory(FileExplorerState& state) {
    const std::string current_path(state.current_path);
    if (current_path.empty() ||
        is_virtual_path(current_path)) {
        notify(registry_, "Open a folder before creating a sync object.");
        return;
    }

    const std::string root = normalized_sync_root(current_path);
    if (file_sync_roots_.count(root) > 0) {
        notify(registry_, "A sync object is already running for this folder.");
        return;
    }

    std::error_code ec;
    if (is_remote_path(root)) {
        std::filesystem::create_directories(root, ec);
    }
    if (ec || !std::filesystem::is_directory(root)) {
        notify(registry_, "Could not create sync object for this folder.", 5.0f);
        return;
    }

    auto sync = std::make_unique<core::FileSyncMaster>(root);
    sync->sync_start();
    file_sync_roots_.insert(root);
    file_sync_objects_.push_back(std::move(sync));
    notify(registry_, "Created sync object for " + root);
}

void FileExplorerPanel::perform_delete_selected(FileExplorerState& state) {
    (void)state;
    auto items = selected_items(ui_, active_listing());
    auto& transfers = registry_.get_state<core::FileTransfer>("FileMasterTransfers");
    core::FileMasterLocal file_master(worker_pool_, &transfers);
    for (const auto& item : items) {
        if (is_remote_path(item.path)) {
            continue;
        }
        file_master.remove(make_local_props(item), {});
    }
}

void FileExplorerPanel::initiate_rename(FileExplorerPanel::TransientUiState& ui) {
    auto items = selected_items(ui, active_listing());
    if (items.size() != 1) {
        return;
    }

    std::snprintf(ui.rename_buffer, sizeof(ui.rename_buffer), "%s", items[0].name.c_str());
    ui.rename_target_path = items[0].path;
    ui.show_rename_modal = true;
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
