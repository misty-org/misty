#include "panels/file_explorer/file_explorer_panel.h"
#include "panels/activity/download_state.h"
#include "panels/activity/upload_state.h"
#include "panels/file_sidebar/file_sidebar_state.h"
#include "panels/notification/notification_state.h"
#include "panels/services/services_state.h"
#include "panels/services/remote/remote_state.h"
#include "core/cache/listing_cache.h"
#include "core/net/http_client.h"
#include "core/manager/env_manager.h"
#include <algorithm>
#include <cstdlib>
#include <cstdio>
#include <system_error>

namespace fs = std::filesystem;

namespace misty::panel {
    namespace {
        bool is_permission_error(const std::error_code& ec) {
            if (!ec) return false;
            return ec == std::make_error_code(std::errc::permission_denied) ||
                   ec == std::make_error_code(std::errc::operation_not_permitted);
        }

        std::string local_trash_dir() {
            const char* home = std::getenv("HOME");
            return std::string(home ? home : "/tmp") + "/misty/.cache/trash";
        }

        std::string unique_trash_target_path(const std::string& source_path) {
            const std::string trash_dir = local_trash_dir();
            std::error_code ec;
            fs::create_directories(trash_dir, ec);

            const fs::path source(source_path);
            std::string target = (fs::path(trash_dir) / source.filename()).string();

            int counter = 1;
            while (fs::exists(target)) {
                target = (fs::path(trash_dir) /
                    (source.stem().string() + "_" + std::to_string(counter++) + source.extension().string())).string();
            }
            return target;
        }

        void purge_from_recent(FileExplorerState& state, const std::string& path) {
            auto it = std::remove_if(state.recent_files.begin(), state.recent_files.end(),
                [&](const UnifiedFileItem& f) { return f.path == path; });
            if (it != state.recent_files.end()) {
                state.recent_files.erase(it, state.recent_files.end());
                state.dirty_ = true;
            }
        }
    }

    void FileExplorerPanel::perform_paste(FileExplorerState& state) {
        std::string dest_dir(state.current_path);
        bool dest_is_cloud = path_utils::is_remote_path(dest_dir);

        bool queued_cloud_uploads = false;

        for (const auto& item : state.clipboard_items) {
            bool src_is_cloud = (item.source == FileSource::REMOTE);

            if (!src_is_cloud && !dest_is_cloud) {
                // Local -> Local
                perform_paste_local_to_local(state, item, dest_dir);
            } else if (!dest_is_cloud && src_is_cloud) {
                // Cloud -> Local
                perform_paste_cloud_to_local(state, item, dest_dir);
            } else if (dest_is_cloud) {
                // Local/Cloud -> Cloud (queues into sidebar upload queue)
                perform_paste_to_cloud(state, item, dest_dir);
                queued_cloud_uploads = true;
            }
        }

        // Trigger the sidebar upload queue if we queued any cloud uploads
        if (queued_cloud_uploads) {
            auto& sidebar_state = registry_.get_state<FileSidebarState>("FileSidebar");
            sidebar_state.pending_upload_start = true;
        }

        // Clear clipboard after cut (keep after copy so user can paste multiple times)
        if (state.clipboard_op == ClipboardOp::CUT) {
            state.clipboard_op = ClipboardOp::NONE;
            state.clipboard_paths.clear();
            state.clipboard_items.clear();
        }

        // Refresh directory
        navigate_to_path(std::string(state.current_path), false);
    }

    void FileExplorerPanel::perform_paste_local_to_local(FileExplorerState& state, const UnifiedFileItem& item, const std::string& dest_dir) {
        fs::path src(item.path);
        fs::path dest = fs::path(dest_dir) / src.filename();

        // Avoid overwriting - append suffix if destination exists
        if (fs::exists(dest)) {
            std::string stem = dest.stem().string();
            std::string ext = dest.extension().string();
            int counter = 1;
            while (fs::exists(dest)) {
                dest = fs::path(dest_dir) / (stem + " (" + std::to_string(counter) + ")" + ext);
                counter++;
            }
        }

        std::error_code ec;
        if (state.clipboard_op == ClipboardOp::COPY) {
            if (fs::is_directory(src)) {
                fs::copy(src, dest, fs::copy_options::recursive, ec);
            } else {
                fs::copy_file(src, dest, ec);
            }
        } else if (state.clipboard_op == ClipboardOp::CUT) {
            fs::rename(src, dest, ec);
        }

        if (ec) {
            auto& notif = registry_.get_state<NotificationState>("Notifications");
            notif.add_notification("Paste Failed", ec.message(), NotificationType::ERROR);
        } else {
            auto& notif = registry_.get_state<NotificationState>("Notifications");
            std::string action = (state.clipboard_op == ClipboardOp::COPY) ? "Copied" : "Moved";
            notif.add_notification("Success", action + " " + item.name, NotificationType::SUCCESS);
        }
    }

    void FileExplorerPanel::perform_paste_to_cloud(FileExplorerState& state, const UnifiedFileItem& item, const std::string& dest_dir) {
        // Skip directories
        if (item.is_dir) {
            auto& notif = registry_.get_state<NotificationState>("Notifications");
            notif.add_notification("Paste Skipped", "Folder upload not supported: " + item.name, NotificationType::INFO);
            return;
        }

        if (!fs::exists(item.path)) {
            auto& notif = registry_.get_state<NotificationState>("Notifications");
            notif.add_notification("Paste Failed", "File not available locally: " + item.name + ". Download it first.", NotificationType::ERROR);
            return;
        }

        // Copy the file into the mount directory
        fs::path src(item.path);
        fs::path dest = fs::path(dest_dir) / src.filename();

        if (fs::exists(dest)) {
            std::string stem = dest.stem().string();
            std::string ext = dest.extension().string();
            int counter = 1;
            while (fs::exists(dest)) {
                dest = fs::path(dest_dir) / (stem + " (" + std::to_string(counter) + ")" + ext);
                counter++;
            }
        }

        std::error_code ec;
        if (state.clipboard_op == ClipboardOp::CUT) {
            fs::rename(src, dest, ec);
        } else {
            fs::copy_file(src, dest, ec);
        }

        if (ec) {
            auto& notif = registry_.get_state<NotificationState>("Notifications");
            notif.add_notification("Paste Failed", "Failed to copy to mount: " + ec.message(), NotificationType::ERROR);
            return;
        }

        // Queue into sidebar upload queue
        auto [remote_name, remote_path] = path_utils::parse_remote_name_and_path(dest_dir);

        auto& sidebar_state = registry_.get_state<FileSidebarState>("FileSidebar");
        std::string dest_str = dest.string();
        std::string file_name = dest.filename().string();
        size_t file_size = 0;
        try { file_size = fs::file_size(dest_str); } catch (...) {}

        {
            std::lock_guard<std::mutex> lock(sidebar_state.upload_mutex);
            FileUploadProgress progress;
            progress.file_path = dest_str;
            progress.file_name = file_name;
            progress.file_size = file_size;
            progress.remote_name = remote_name;
            progress.remote_path = remote_path;
            sidebar_state.upload_queue.push_back(std::move(progress));
        }
    }

    void FileExplorerPanel::perform_paste_cloud_to_local(FileExplorerState& state, const UnifiedFileItem& item, const std::string& dest_dir) {
        if (item.is_dir) {
            auto& notif = registry_.get_state<NotificationState>("Notifications");
            notif.add_notification("Paste Skipped", "Folder download not supported: " + item.name, NotificationType::INFO);
            return;
        }

        // If file is synced locally, just copy it
        if (item.status == SyncStatus::SYNCED || item.status == SyncStatus::MODIFIED || fs::exists(item.path)) {
            fs::path src(item.path);
            fs::path dest = fs::path(dest_dir) / src.filename();

            if (fs::exists(dest)) {
                std::string stem = dest.stem().string();
                std::string ext = dest.extension().string();
                int counter = 1;
                while (fs::exists(dest)) {
                    dest = fs::path(dest_dir) / (stem + " (" + std::to_string(counter) + ")" + ext);
                    counter++;
                }
            }

            std::error_code ec;
            if (state.clipboard_op == ClipboardOp::CUT) {
                fs::rename(src, dest, ec);
            } else {
                fs::copy_file(src, dest, ec);
            }

            if (ec) {
                auto& notif = registry_.get_state<NotificationState>("Notifications");
                notif.add_notification("Paste Failed", ec.message(), NotificationType::ERROR);
            } else {
                auto& notif = registry_.get_state<NotificationState>("Notifications");
                std::string action = (state.clipboard_op == ClipboardOp::COPY) ? "Copied" : "Moved";
                notif.add_notification("Success", action + " " + item.name, NotificationType::SUCCESS);
            }
            return;
        }

        // NOT_SYNCED — download from cloud to dest
        auto& services = registry_.get_state<ServicesState>("Services");
        auto& downloads = registry_.get_state<DownloadState>("Downloads");
        auto& notifications = registry_.get_state<NotificationState>("Notifications");

        std::string dest_path = (fs::path(dest_dir) / item.name).string();

        uint64_t download_id = downloads.start_download(
            item.name, dest_path, item.remote_name, item.size);

        uint64_t notif_id = notifications.add_notification(
            "Downloading for Paste", item.name, NotificationType::DOWNLOAD, 15.0f);

        services.download_file(
            item.remote_name, item.remote_path, dest_path,
            [this, download_id](size_t bytes_downloaded, size_t) -> bool {
                auto& downloads = registry_.get_state<DownloadState>("Downloads");
                downloads.update_progress(download_id, static_cast<int64_t>(bytes_downloaded));
                return true;
            },
            [this, file_name = item.name, download_id, notif_id](
                bool success, const std::string& local_path, const std::string& error) {
                auto& downloads = registry_.get_state<DownloadState>("Downloads");
                auto& notifications = registry_.get_state<NotificationState>("Notifications");
                notifications.dismiss(notif_id);
                if (success) {
                    downloads.complete_download(download_id);
                    notifications.add_notification("Paste Complete", file_name, NotificationType::SUCCESS, 5.0f);
                } else {
                    downloads.fail_download(download_id, error);
                    notifications.add_notification("Paste Failed", file_name + ": " + error, NotificationType::ERROR, 5.0f);
                }
            });
    }

    void FileExplorerPanel::trigger_upload(const std::string& local_path, const std::string& dest_dir) {
        auto& uploads = registry_.get_state<UploadState>("Uploads");
        auto& services = registry_.get_state<ServicesState>("Services");
        auto& notifications = registry_.get_state<NotificationState>("Notifications");

        std::string file_name = fs::path(local_path).filename().string();
        int64_t file_size = 0;
        try { file_size = static_cast<int64_t>(fs::file_size(local_path)); } catch (...) {}

        if (path_utils::is_remote_path(dest_dir)) {
            auto [remote_name, remote_path] = path_utils::parse_remote_name_and_path(dest_dir);

            if (remote_name.empty()) {
                notifications.add_notification("Upload Failed", "Cannot upload to mount root. Navigate into a remote folder.", NotificationType::ERROR);
                return;
            }

            uint64_t upload_id = uploads.start_upload(file_name, local_path, remote_name, file_size);
            uploads.set_retry_context(upload_id, remote_name, remote_path);
            notifications.add_notification("Uploading", file_name, NotificationType::DOWNLOAD, 15.0f);

            services.upload_file(remote_name, remote_path, local_path,
                [this, upload_id](size_t bytes_uploaded, size_t total_bytes) -> bool {
                    auto& uploads = registry_.get_state<UploadState>("Uploads");
                    uploads.update_progress(upload_id, static_cast<int64_t>(bytes_uploaded));
                    return true;
                },
                [this, file_name, upload_id](bool success, const std::string& error_msg) {
                    auto& uploads = registry_.get_state<UploadState>("Uploads");
                    auto& notifications = registry_.get_state<NotificationState>("Notifications");
                    if (success) {
                        uploads.complete_upload(upload_id);
                        notifications.add_notification("Upload Complete", file_name, NotificationType::SUCCESS, 5.0f);
                    } else {
                        uploads.fail_upload(upload_id, error_msg);
                        notifications.add_notification("Upload Failed", file_name + ": " + error_msg, NotificationType::ERROR, 5.0f);
                    }
                });
        }
    }

    void FileExplorerPanel::perform_copy(FileExplorerState& state) {
        state.clipboard_op = ClipboardOp::COPY;
        state.clipboard_paths.clear();
        state.clipboard_items.clear();
        for (const auto& sel : state.selected_files) {
            for (const auto& f : state.files) {
                if (f.id == sel) {
                    state.clipboard_paths.push_back(f.path);
                    state.clipboard_items.push_back(f);
                    break;
                }
            }
        }
        auto& notif = registry_.get_state<NotificationState>("Notifications");
        notif.add_notification("Clipboard", "Copied " + std::to_string(state.clipboard_paths.size()) + " items", NotificationType::INFO);
    }

    void FileExplorerPanel::perform_cut(FileExplorerState& state) {
        state.clipboard_op = ClipboardOp::CUT;
        state.clipboard_paths.clear();
        state.clipboard_items.clear();
        for (const auto& sel : state.selected_files) {
            for (const auto& f : state.files) {
                if (f.id == sel) {
                    state.clipboard_paths.push_back(f.path);
                    state.clipboard_items.push_back(f);
                    break;
                }
            }
        }
        auto& notif = registry_.get_state<NotificationState>("Notifications");
        notif.add_notification("Clipboard", "Cut " + std::to_string(state.clipboard_paths.size()) + " items", NotificationType::INFO);
    }

    void FileExplorerPanel::perform_delete_selected(FileExplorerState& state) {
        bool is_trash_view = std::string(state.current_path) == FileExplorerState::VIRTUAL_PATH_TRASH;

        struct DeleteTarget {
            std::string id;
            std::string path;
            UnifiedFileItem item;
        };

        std::vector<DeleteTarget> targets;
        targets.reserve(state.selected_files.size());
        for (const auto& sel : state.selected_files) {
            for (const auto& f : state.files) {
                if (f.id == sel) {
                    targets.push_back({f.id, f.path, f});
                    break;
                }
            }
        }
        if (targets.empty()) return;

        if (is_trash_view) {
            state.permanent_delete_paths.clear();
            for (const auto& t : targets) state.permanent_delete_paths.push_back(t.path);
            state.show_permanent_delete_modal = true;
            return;
        }

        std::vector<DeleteTarget> remote_targets;
        std::vector<std::string> permission_paths;
        size_t local_success_count = 0;
        for (const auto& target : targets) {
            bool is_cloud = target.item.source == FileSource::REMOTE;

            if (is_cloud) {
                state.selected_files.erase(target.id);
                remote_targets.push_back(target);
            } else {
                std::error_code ec;
                std::string trash_path = unique_trash_target_path(target.path);
                fs::rename(target.path, trash_path, ec);
                if (ec) {
                    if (is_permission_error(ec)) {
                        permission_paths.push_back(target.path);
                        continue;
                    }
                    state.error_msg = "Failed to move to trash: " + ec.message();
                } else {
                     UnifiedFileItem item;
                     item.path = trash_path;
                     item.id = item.path;
                     item.name = fs::path(trash_path).filename().string();
                     item.is_dir = fs::is_directory(trash_path);
                     item.status = SyncStatus::DELETED;
                     state.move_to_trash(item);
                     state.track_move(target.path, item);
                     purge_from_recent(state, target.path);
                     state.selected_files.erase(target.id);
                     ++local_success_count;
                }
            }
        }

        if (local_success_count > 0) {
            auto& notif = registry_.get_state<NotificationState>("Notifications");
            notif.add_notification("Deleted", "Deleted " + std::to_string(local_success_count) + " items", NotificationType::SUCCESS);
        }

        if (!permission_paths.empty()) {
            state.permission_delete_paths = std::move(permission_paths);
            state.permission_delete_permanent = is_trash_view;
            state.show_permission_delete_modal = true;
        }

        const bool has_remote_targets = !remote_targets.empty();
        if (has_remote_targets) {
            const std::string origin_path(state.current_path);
            worker_pool_.add(
                [this, remote_targets = std::move(remote_targets), origin_path]() {
                    struct RemoteDeleteResult {
                        std::string id;
                        std::string path;
                        bool success = false;
                        std::string error;
                    };

                    std::vector<RemoteDeleteResult> results;
                    results.reserve(remote_targets.size());
                    for (const auto& target : remote_targets) {
                        std::string error;
                        const bool success = delete_remote_file(target.item, &error);
                        results.push_back({target.id, target.path, success, std::move(error)});
                    }

                    auto& state = registry_.get_state<FileExplorerState>(state_key_);
                    auto& notif = registry_.get_state<NotificationState>("Notifications");

                    size_t remote_success_count = 0;
                    std::string first_error;
                    {
                        std::lock_guard<std::mutex> lock(state.mu);
                        for (const auto& result : results) {
                            state.selected_files.erase(result.id);
                            if (!result.success) {
                                if (first_error.empty()) first_error = result.error;
                                continue;
                            }
                            purge_from_recent(state, result.path);
                            ++remote_success_count;
                        }

                        if (!first_error.empty()) {
                            state.error_msg = first_error;
                        }

                        if (remote_success_count > 0 &&
                            std::string(state.current_path) == origin_path &&
                            state.pending_navigation_path.empty()) {
                            state.pending_navigation_path = origin_path;
                        }
                    }

                    if (remote_success_count > 0) {
                        notif.add_notification("Deleted", "Deleted " + std::to_string(remote_success_count) + " items", NotificationType::SUCCESS);
                    }
                    if (!first_error.empty()) {
                        notif.add_notification("Delete Failed", first_error, NotificationType::ERROR);
                    }
                },
                []() {},
                [this](const std::string& err) {
                    auto& state = registry_.get_state<FileExplorerState>(state_key_);
                    auto& notif = registry_.get_state<NotificationState>("Notifications");
                    {
                        std::lock_guard<std::mutex> lock(state.mu);
                        state.error_msg = err;
                    }
                    notif.add_notification("Delete Failed", err, NotificationType::ERROR);
                }
            );
        }

        if (!has_remote_targets || local_success_count > 0) {
            navigate_to_path(std::string(state.current_path), false);
        }
    }

    void FileExplorerPanel::initiate_rename(FileExplorerState& state) {
        std::string target;
        if (!state.context_menu_target_path.empty()) {
            target = state.context_menu_target_path;
        } else if (state.selected_files.size() == 1) {
            target = state.path_for_selection(*state.selected_files.begin());
        }

        if (!target.empty()) {
            state.rename_target_path = target;
            fs::path p(target);
            std::string filename = p.filename().string();
            strncpy(state.rename_buffer, filename.c_str(), sizeof(state.rename_buffer) - 1);
            state.rename_buffer[sizeof(state.rename_buffer) - 1] = '\0';
            state.show_rename_modal = true;
        }
    }

    bool FileExplorerPanel::perform_delete(FileExplorerState& state,
                                           const std::string& path,
                                           bool* requires_permission) {
        if (requires_permission) *requires_permission = false;

        std::error_code ec;
        fs::remove_all(path, ec);
        if (ec) {
            if (requires_permission && is_permission_error(ec)) {
                *requires_permission = true;
                return false;
            }
            state.error_msg = "Failed to delete: " + ec.message();
            return false;
        }
        state.selected_files.erase(path);
        return true;
    }

    bool FileExplorerPanel::delete_remote_file(const UnifiedFileItem& file,
                                                std::string* error_message) {
        std::string proxy_url = core::EnvManager::get().get("PROXY_SERVICE_URL", "");
        if (proxy_url.empty()) {
            if (error_message) *error_message = "Proxy not configured.";
            return false;
        }

        std::string url = proxy_url + "/api/file?remote=" +
                          core::url_encode(file.remote_name) + "&path=" +
                          core::url_encode(file.remote_path);
        auto resp = core::HTTPClient::get().del(url);
        if (resp.status_code < 200 || resp.status_code >= 300) {
            if (error_message) {
                *error_message = resp.body.empty()
                    ? "Failed to delete remote file: HTTP " + std::to_string(resp.status_code)
                    : "Failed to delete remote file: " + resp.body;
            }
            return false;
        }

        core::listing_cache::clear_remote(file.remote_name);

        std::error_code ec;
        if (fs::exists(file.path, ec)) {
            fs::remove_all(file.path, ec);
        }

        return true;
    }

    void FileExplorerPanel::confirm_permanent_delete(FileExplorerState& state) {
        const std::vector<std::string> to_delete = state.permanent_delete_paths;
        state.show_permanent_delete_modal = false;
        state.permanent_delete_paths.clear();

        if (to_delete.empty()) return;

        std::vector<std::string> permission_paths;
        size_t success_count = 0;
        for (const auto& path : to_delete) {
            bool requires_permission = false;
            if (!perform_delete(state, path, &requires_permission)) {
                if (requires_permission) permission_paths.push_back(path);
                continue;
            }
            auto it = std::remove_if(state.trash_files.begin(), state.trash_files.end(),
                [&](const UnifiedFileItem& item) { return item.path == path; });
            state.trash_files.erase(it, state.trash_files.end());
            purge_from_recent(state, path);
            ++success_count;
        }

        if (success_count > 0) {
            auto& notif = registry_.get_state<NotificationState>("Notifications");
            notif.add_notification("Deleted", "Deleted " + std::to_string(success_count) + " items", NotificationType::SUCCESS);
        }

        if (!permission_paths.empty()) {
            state.permission_delete_paths = std::move(permission_paths);
            state.permission_delete_permanent = true;
            state.show_permission_delete_modal = true;
        }

        navigate_to_path(std::string(state.current_path), false);
    }

    void FileExplorerPanel::retry_permission_delete(FileExplorerState& state) {
        const std::vector<std::string> paths = state.permission_delete_paths;
        const bool permanent_delete = state.permission_delete_permanent;

        state.show_permission_delete_modal = false;
        state.permission_delete_paths.clear();
        state.permission_delete_permanent = false;

        if (paths.empty()) return;

        size_t success_count = 0;
        for (const auto& path : paths) {
            bool success = false;
            if (permanent_delete) {
                success = core::delete_path_with_user_approval(path);
                if (success) {
                    auto it = std::remove_if(state.trash_files.begin(), state.trash_files.end(),
                        [&](const UnifiedFileItem& item) { return item.path == path; });
                    state.trash_files.erase(it, state.trash_files.end());
                }
            } else {
                const std::string target = unique_trash_target_path(path);
                success = core::move_path_with_user_approval(path, target);
                if (success) {
                    UnifiedFileItem item;
                    item.path = target;
                    item.id = item.path;
                    item.name = fs::path(target).filename().string();
                    item.is_dir = fs::is_directory(target);
                    item.status = SyncStatus::DELETED;
                    state.move_to_trash(item);
                    state.track_move(path, item);
                }
            }

            if (!success) {
                state.error_msg = permanent_delete
                    ? "Failed to delete item after permission confirmation."
                    : "Failed to move item to trash after permission confirmation.";
                continue;
            }

            purge_from_recent(state, path);
            state.selected_files.erase(path);
            ++success_count;
        }

        if (success_count > 0) {
            auto& notif = registry_.get_state<NotificationState>("Notifications");
            notif.add_notification("Deleted", "Deleted " + std::to_string(success_count) + " items", NotificationType::SUCCESS);
        }

        navigate_to_path(std::string(state.current_path), false);
    }

}
