#include "panels/file_explorer/file_explorer_panel.h"
#include "panels/activity/download_state.h"
#include "panels/activity/upload_state.h"
#include "panels/activity/activity_state.h"
#include "panels/file_sidebar/file_sidebar_state.h"
#include "panels/notification/notification_state.h"
#include "panels/services/services_state.h"
#include "panels/services/remote/remote_state.h"
#include "core/cache/listing_cache.h"
#include "core/net/http_client.h"
#include "core/manager/env_manager.h"
#include <algorithm>
#include <atomic>
#include <chrono>
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

        bool remote_file_has_local_mirror(const UnifiedFileItem& item) {
            if (item.path.empty()) {
                return false;
            }
            if (item.source != FileSource::REMOTE || item.is_dir) {
                return false;
            }
            return item.status == SyncStatus::SYNCED ||
                   item.status == SyncStatus::MODIFIED ||
                   fs::exists(item.path);
        }

        bool is_cross_device_error(const std::error_code& ec) {
            return ec == std::make_error_code(std::errc::cross_device_link);
        }

        bool copy_path_then_remove_source(const fs::path& src, const fs::path& dest, std::error_code& ec) {
            ec.clear();
            if (fs::is_directory(src)) {
                fs::copy(src, dest, fs::copy_options::recursive, ec);
            } else {
                fs::copy_file(src, dest, ec);
            }
            if (ec) {
                return false;
            }

            std::error_code remove_ec;
            if (fs::is_directory(src)) {
                fs::remove_all(src, remove_ec);
            } else {
                fs::remove(src, remove_ec);
            }
            if (remove_ec) {
                ec = remove_ec;
                return false;
            }
            return true;
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

        fs::path unique_child_path(const std::string& dest_dir, const std::string& file_name) {
            const fs::path source_name = fs::path(file_name).filename();
            fs::path dest = fs::path(dest_dir) / (source_name.empty() ? fs::path("untitled") : source_name);

            if (fs::exists(dest)) {
                std::string stem = dest.stem().string();
                std::string ext = dest.extension().string();
                int counter = 1;
                while (fs::exists(dest)) {
                    dest = fs::path(dest_dir) / (stem + " (" + std::to_string(counter) + ")" + ext);
                    counter++;
                }
            }

            return dest;
        }

        fs::path cloud_transfer_staging_root() {
            const char* home = std::getenv("HOME");
            return fs::path(home ? home : "/tmp") / "misty" / "tmp" / "transfers";
        }

        fs::path unique_cloud_transfer_staging_path(const std::string& file_name) {
            static std::atomic<uint64_t> counter{0};
            const auto now = std::chrono::steady_clock::now().time_since_epoch();
            const auto ticks = std::chrono::duration_cast<std::chrono::microseconds>(now).count();
            fs::path dir = cloud_transfer_staging_root() /
                (std::to_string(ticks) + "-" + std::to_string(counter.fetch_add(1, std::memory_order_relaxed)));

            std::error_code ec;
            fs::create_directories(dir, ec);

            fs::path safe_name = fs::path(file_name).filename();
            if (safe_name.empty()) {
                safe_name = "download";
            }
            return dir / safe_name;
        }

        std::string join_remote_child_path(const std::string& parent, const std::string& child) {
            std::string clean_child = fs::path(child).filename().string();
            if (clean_child.empty()) {
                clean_child = child;
            }
            if (parent.empty()) {
                return clean_child;
            }
            if (parent.back() == '/') {
                return parent + clean_child;
            }
            return parent + "/" + clean_child;
        }

        void cleanup_cloud_transfer_staging_path(const std::string& path) {
            if (path.empty()) {
                return;
            }

            std::error_code ec;
            fs::path target(path);
            fs::remove_all(target, ec);

            ec.clear();
            fs::path parent = target.parent_path();
            if (!parent.empty()) {
                fs::remove(parent, ec);
            }
        }

        bool queue_cloud_upload(core::UIRegistry& registry,
                                const std::string& local_path,
                                const std::string& file_name,
                                const std::string& remote_name,
                                const std::string& remote_path,
                                bool cleanup_after_upload = false,
                                const std::string& cleanup_path = "") {
            if (remote_name.empty()) {
                auto& activity = registry.get_state<ActivityState>("Activity");
                activity.add_entry("File", "Cannot upload to mount root. Navigate into a remote folder.", ActivityEntryType::ERROR);
                return false;
            }

            std::error_code ec;
            if (!fs::exists(local_path, ec)) {
                auto& activity = registry.get_state<ActivityState>("Activity");
                activity.add_entry("File", "Upload source is missing: " + local_path, ActivityEntryType::ERROR);
                return false;
            }

            auto& sidebar_state = registry.get_state<FileSidebarState>("FileSidebar");
            size_t file_size = 0;
            try { file_size = fs::file_size(local_path); } catch (...) {}

            {
                std::lock_guard<std::mutex> lock(sidebar_state.upload_mutex);
                FileUploadProgress progress;
                progress.file_path = local_path;
                progress.file_name = file_name.empty() ? fs::path(local_path).filename().string() : file_name;
                progress.file_size = file_size;
                progress.remote_name = remote_name;
                progress.remote_path = remote_path;
                progress.cleanup_after_upload = cleanup_after_upload;
                progress.cleanup_path = cleanup_path;
                sidebar_state.upload_queue.push_back(std::move(progress));
            }

            return true;
        }

        void purge_from_recent(FileExplorerState& state, const std::string& path) {
            auto it = std::remove_if(state.recent_files.begin(), state.recent_files.end(),
                [&](const UnifiedFileItem& f) { return f.path == path; });
            if (it != state.recent_files.end()) {
                state.recent_files.erase(it, state.recent_files.end());
                state.dirty_ = true;
            }
        }

        void purge_from_starred(FileExplorerState& state, const std::string& path) {
            auto it = std::remove_if(state.starred_files.begin(), state.starred_files.end(),
                [&](const UnifiedFileItem& f) { return f.path == path; });
            if (it != state.starred_files.end()) {
                state.starred_files.erase(it, state.starred_files.end());
                state.dirty_ = true;
            }
        }

        fs::path normalized_path(const fs::path& path) {
            std::error_code ec;
            fs::path normalized = fs::weakly_canonical(path, ec);
            if (ec) {
                normalized = path.lexically_normal();
            }
            return normalized;
        }

        bool is_same_path(const fs::path& lhs, const fs::path& rhs) {
            return normalized_path(lhs) == normalized_path(rhs);
        }

        bool is_same_or_child_path(const fs::path& maybe_child, const fs::path& maybe_parent) {
            fs::path child = normalized_path(maybe_child);
            fs::path parent = normalized_path(maybe_parent);

            auto child_it = child.begin();
            auto parent_it = parent.begin();
            for (; parent_it != parent.end(); ++parent_it, ++child_it) {
                if (child_it == child.end() || *child_it != *parent_it) {
                    return false;
                }
            }
            return true;
        }

        FileOperationRecord make_single_item_record(FileOperationKind kind,
                                                    const fs::path& source,
                                                    const fs::path& destination,
                                                    bool is_dir,
                                                    std::string description) {
            FileOperationRecord record;
            record.kind = kind;
            record.origin_dir = source.parent_path().string();
            record.destination_dir = destination.parent_path().string();
            record.description = std::move(description);
            record.items.push_back({
                source.string(),
                destination.string(),
                destination.filename().string(),
                is_dir
            });
            return record;
        }

        std::string item_label(const FileOperationItem& item, const fs::path& fallback) {
            if (!item.display_name.empty()) {
                return item.display_name;
            }
            if (!fallback.filename().empty()) {
                return fallback.filename().string();
            }
            return fallback.string();
        }

        void set_journal_error(std::string* error_message, const std::string& message) {
            if (error_message) {
                *error_message = message;
            }
        }

        bool unsafe_remove_target(const fs::path& path) {
            if (path.empty()) {
                return true;
            }

            const fs::path normalized = normalized_path(path);
            return normalized.empty() || normalized == normalized.root_path();
        }

        bool ensure_parent_directory(const fs::path& path, std::string* error_message) {
            const fs::path parent = path.parent_path();
            if (parent.empty()) {
                return true;
            }

            std::error_code ec;
            if (fs::exists(parent, ec)) {
                if (!fs::is_directory(parent, ec)) {
                    set_journal_error(error_message, "Parent path is not a folder: " + parent.string());
                    return false;
                }
                return true;
            }

            fs::create_directories(parent, ec);
            if (ec) {
                set_journal_error(error_message, "Could not create parent folder " + parent.string() + ": " + ec.message());
                return false;
            }
            return true;
        }

        bool validate_move_without_overwrite(const FileOperationItem& item,
                                             const fs::path& source,
                                             const fs::path& destination,
                                             std::string* error_message) {
            if (source.empty() || destination.empty()) {
                set_journal_error(error_message, "Operation record is missing a path.");
                return false;
            }
            if (is_same_path(source, destination)) {
                return true;
            }

            std::error_code ec;
            if (!fs::exists(source, ec)) {
                set_journal_error(error_message, "Cannot move " + item_label(item, source) + ": source no longer exists.");
                return false;
            }
            if (fs::exists(destination, ec)) {
                set_journal_error(error_message, "Cannot move " + item_label(item, destination) + ": destination already exists.");
                return false;
            }
            if (!ensure_parent_directory(destination, error_message)) {
                return false;
            }
            return true;
        }

        bool move_path_without_overwrite(const FileOperationItem& item,
                                         const fs::path& source,
                                         const fs::path& destination,
                                         std::string* error_message) {
            if (!validate_move_without_overwrite(item, source, destination, error_message)) {
                return false;
            }
            if (is_same_path(source, destination)) {
                return true;
            }

            std::error_code ec;
            fs::rename(source, destination, ec);
            if (ec) {
                set_journal_error(error_message, "Could not move " + item_label(item, source) + ": " + ec.message());
                return false;
            }
            return true;
        }

        bool copy_path_without_overwrite(const FileOperationItem& item,
                                         const fs::path& source,
                                         const fs::path& destination,
                                         std::string* error_message) {
            if (source.empty() || destination.empty()) {
                set_journal_error(error_message, "Operation record is missing a path.");
                return false;
            }
            if (is_same_path(source, destination)) {
                set_journal_error(error_message, "Cannot redo copy of " + item_label(item, source) + ": source and destination are the same path.");
                return false;
            }

            std::error_code ec;
            if (!fs::exists(source, ec)) {
                set_journal_error(error_message, "Cannot copy " + item_label(item, source) + ": source no longer exists.");
                return false;
            }
            if (fs::exists(destination, ec)) {
                set_journal_error(error_message, "Cannot copy " + item_label(item, destination) + ": destination already exists.");
                return false;
            }
            if (!ensure_parent_directory(destination, error_message)) {
                return false;
            }

            const bool source_is_dir = item.is_dir || fs::is_directory(source, ec);
            ec.clear();
            if (source_is_dir) {
                fs::copy(source, destination, fs::copy_options::recursive, ec);
            } else {
                fs::copy_file(source, destination, fs::copy_options::none, ec);
            }
            if (ec) {
                set_journal_error(error_message, "Could not copy " + item_label(item, source) + ": " + ec.message());
                return false;
            }
            return true;
        }

        bool remove_copy_destination(FileExplorerState& state,
                                     const FileOperationItem& item,
                                     std::string* error_message) {
            const fs::path destination(item.destination_path);
            if (unsafe_remove_target(destination)) {
                set_journal_error(error_message, "Refusing to remove unsafe path while undoing copy.");
                return false;
            }
            if (!item.source_path.empty() && is_same_path(fs::path(item.source_path), destination)) {
                set_journal_error(error_message, "Refusing to remove copy destination because it matches the source path.");
                return false;
            }

            std::error_code ec;
            if (!fs::exists(destination, ec)) {
                return true;
            }

            fs::remove_all(destination, ec);
            if (ec) {
                set_journal_error(error_message, "Could not remove copied " + item_label(item, destination) + ": " + ec.message());
                return false;
            }
            purge_from_recent(state, destination.string());
            purge_from_starred(state, destination.string());
            return true;
        }

        bool validate_record_moves(const FileOperationRecord& record,
                                   bool undo_direction,
                                   std::string* error_message) {
            for (const auto& item : record.items) {
                const fs::path source = undo_direction
                    ? fs::path(item.destination_path)
                    : fs::path(item.source_path);
                const fs::path destination = undo_direction
                    ? fs::path(item.source_path)
                    : fs::path(item.destination_path);
                if (!validate_move_without_overwrite(item, source, destination, error_message)) {
                    return false;
                }
            }
            return true;
        }

        UnifiedFileItem make_local_operation_item(const fs::path& path,
                                                  const FileOperationItem& source_item,
                                                  SyncStatus status = SyncStatus::LOCAL) {
            UnifiedFileItem item;
            item.path = path.string();
            item.id = item.path;
            item.name = path.filename().empty() ? item_label(source_item, path) : path.filename().string();
            std::error_code ec;
            item.is_dir = fs::is_directory(path, ec);
            if (ec) {
                item.is_dir = source_item.is_dir;
            }
            item.source = FileSource::LOCAL;
            item.status = status;
            item.state_code = status == SyncStatus::DELETED ? "DEL" : "LOC";
            return item;
        }

        void remove_trash_listing(FileExplorerState& state, const std::string& path) {
            auto it = std::remove_if(state.trash_files.begin(), state.trash_files.end(),
                [&](const UnifiedFileItem& item) { return item.path == path; });
            if (it != state.trash_files.end()) {
                state.trash_files.erase(it, state.trash_files.end());
            }
        }
    }

    void FileExplorerPanel::perform_paste(FileExplorerState& state) {
        std::string dest_dir(state.current_path);

        auto& clipboard = registry_.get_state<ClipboardState>("Clipboard");
        const ClipboardOp op_at_paste = clipboard.op;
        const std::vector<UnifiedFileItem> items_to_paste = clipboard.items;

        perform_drop_items(state, items_to_paste, dest_dir, op_at_paste);

        // Clear clipboard after cut (keep after copy so user can paste multiple times)
        if (op_at_paste == ClipboardOp::CUT) {
            clipboard.clear();
        }
    }

    void FileExplorerPanel::perform_drop_items(FileExplorerState& state,
                                               const std::vector<UnifiedFileItem>& items,
                                               const std::string& dest_dir,
                                               ClipboardOp op) {
        if (items.empty() || dest_dir.empty() || op == ClipboardOp::NONE) {
            return;
        }

        std::string effective_dest_dir = dest_dir;
        std::string destination_error;
        const bool dest_is_cloud_path = path_utils::is_remote_path(dest_dir);
        if (dest_is_cloud_path &&
            !resolve_drop_destination_path(dest_dir, effective_dest_dir, &destination_error)) {
            auto& activity = registry_.get_state<ActivityState>("Activity");
            activity.add_entry("File",
                destination_error.empty()
                    ? "Drop ignored: destination is not valid for the selected item."
                    : destination_error,
                ActivityEntryType::ERROR);
            return;
        }

        bool dest_is_cloud = false;
        if (dest_is_cloud_path) {
            std::string remote_name;
            std::string remote_path;
            dest_is_cloud = resolve_remote_path_context(effective_dest_dir, remote_name, remote_path) && !remote_name.empty();
        }
        bool queued_cloud_uploads = false;
        bool started_async_transfer = false;
        size_t skipped_count = 0;

        for (const auto& item : items) {
            if (item.path.empty()) {
                ++skipped_count;
                continue;
            }

            if (op == ClipboardOp::CUT) {
                const fs::path src(item.path);
                const fs::path dest(effective_dest_dir);
                if (is_same_path(src.parent_path(), dest) || (item.is_dir && is_same_or_child_path(dest, src))) {
                    ++skipped_count;
                    continue;
                }
            }

            const bool src_is_cloud = (item.source == FileSource::REMOTE);
            bool handled = false;
            if (!src_is_cloud && !dest_is_cloud_path) {
                // Local -> Local
                perform_paste_local_to_local(state, item, effective_dest_dir, op);
                handled = true;
            } else if (!dest_is_cloud_path && src_is_cloud) {
                // Cloud -> Local
                started_async_transfer = true;
                perform_paste_cloud_to_local(state, item, effective_dest_dir, op);
                handled = true;
            } else if (dest_is_cloud && src_is_cloud) {
                // Cloud -> Cloud: stage through a local temp file, then queue upload.
                started_async_transfer = true;
                perform_paste_cloud_to_cloud(state, item, effective_dest_dir, op);
                handled = true;
            } else if (dest_is_cloud) {
                // Local -> Cloud (queues into sidebar upload queue)
                started_async_transfer = true;
                queued_cloud_uploads = perform_paste_to_cloud(state, item, effective_dest_dir, op) || queued_cloud_uploads;
                handled = true;
            }

            if (!handled) {
                ++skipped_count;
            }
        }

        // Trigger the sidebar upload queue if we queued any cloud uploads
        if (queued_cloud_uploads) {
            auto& sidebar_state = registry_.get_state<FileSidebarState>("FileSidebar");
            sidebar_state.pending_upload_start = true;
        }

        if (skipped_count == items.size()) {
            auto& activity = registry_.get_state<ActivityState>("Activity");
            if (dest_is_cloud_path && !dest_is_cloud) {
                activity.add_entry("File", "Drop ignored: navigate into a specific remote folder before dropping items.", ActivityEntryType::ERROR);
            } else {
                activity.add_entry("File", "Drop ignored: destination is not valid for the selected item.", ActivityEntryType::ERROR);
            }
            return;
        }

        // Synchronous local filesystem operations can refresh immediately.
        // Async cloud transfers should stay in the background without forcing
        // the explorer into a blocking loading state.
        if (!started_async_transfer) {
            navigate_to_path(std::string(state.current_path), false);
            notify_shared_path_refresh(std::string(state.current_path));
            if (effective_dest_dir != std::string(state.current_path)) {
                notify_shared_path_refresh(effective_dest_dir);
            }
        }
    }

    void FileExplorerPanel::perform_paste_local_to_local(FileExplorerState& state, const UnifiedFileItem& item, const std::string& dest_dir, ClipboardOp op) {
        (void)state;
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
        if (op == ClipboardOp::COPY) {
            if (fs::is_directory(src)) {
                fs::copy(src, dest, fs::copy_options::recursive, ec);
            } else {
                fs::copy_file(src, dest, ec);
            }
        } else if (op == ClipboardOp::CUT) {
            fs::rename(src, dest, ec);
            if (is_cross_device_error(ec)) {
                queue_cross_device_move(
                    item,
                    src.parent_path().string(),
                    dest.parent_path().string(),
                    src,
                    dest,
                    [this, item, src, dest]() {
                        record_file_operation(make_single_item_record(
                            FileOperationKind::MoveLocal,
                            src,
                            dest,
                            item.is_dir,
                            "Moved " + item.name));
                    });
                return;
            }
        }

        if (ec) {
            auto& activity = registry_.get_state<ActivityState>("Activity");
            activity.add_entry("File", "Paste failed: " + ec.message(), ActivityEntryType::ERROR);
        } else {
            auto& notif = registry_.get_state<NotificationState>("Notifications");
            std::string action = (op == ClipboardOp::COPY) ? "Copied" : "Moved";
            notif.add_notification(action + " " + item.name);
            record_file_operation(make_single_item_record(
                op == ClipboardOp::COPY ? FileOperationKind::CopyLocal : FileOperationKind::MoveLocal,
                src,
                dest,
                item.is_dir,
                action + " " + item.name));
        }
    }

    bool FileExplorerPanel::perform_paste_to_cloud(FileExplorerState& state, const UnifiedFileItem& item, const std::string& dest_dir, ClipboardOp op) {
        (void)state;
        // Skip directories
        if (item.is_dir) {
            auto& activity = registry_.get_state<ActivityState>("Activity");
            activity.add_entry("File", "Folder upload not supported: " + item.name);
            return false;
        }

        if (!fs::exists(item.path)) {
            auto& activity = registry_.get_state<ActivityState>("Activity");
            activity.add_entry("File", "File not available locally: " + item.name + ". Download it first.", ActivityEntryType::ERROR);
            return false;
        }

        // Copy the file into the mount directory
        fs::path src(item.path);
        fs::path dest = unique_child_path(dest_dir, src.filename().string());

        std::error_code ec;
        if (op == ClipboardOp::CUT) {
            fs::rename(src, dest, ec);
            if (is_cross_device_error(ec)) {
                std::string remote_name;
                std::string remote_path;
                resolve_remote_path_context(dest_dir, remote_name, remote_path);
                queue_cross_device_move(
                    item,
                    src.parent_path().string(),
                    dest.parent_path().string(),
                    src,
                    dest,
                    [this, dest_str = dest.string(), file_name = dest.filename().string(), remote_name, remote_path]() {
                        if (queue_cloud_upload(registry_, dest_str, file_name, remote_name, remote_path)) {
                            auto& sidebar_state = registry_.get_state<FileSidebarState>("FileSidebar");
                            sidebar_state.pending_upload_start = true;
                        }
                    });
                return true;
            }
        } else {
            fs::copy_file(src, dest, ec);
        }

        if (ec) {
            auto& activity = registry_.get_state<ActivityState>("Activity");
            activity.add_entry("File", "Paste failed: " + ec.message(), ActivityEntryType::ERROR);
            return false;
        }

        // Queue into sidebar upload queue
        std::string remote_name;
        std::string remote_path;
        resolve_remote_path_context(dest_dir, remote_name, remote_path);

        std::string dest_str = dest.string();
        std::string file_name = dest.filename().string();
        return queue_cloud_upload(registry_, dest_str, file_name, remote_name, remote_path);
    }

    bool FileExplorerPanel::perform_paste_cloud_to_cloud(FileExplorerState& state, const UnifiedFileItem& item, const std::string& dest_dir, ClipboardOp op) {
        (void)state;

        std::string remote_name;
        std::string remote_path;
        resolve_remote_path_context(dest_dir, remote_name, remote_path);
        if (remote_name.empty()) {
            auto& activity = registry_.get_state<ActivityState>("Activity");
            activity.add_entry("File", "Cannot upload to mount root. Navigate into a remote folder.", ActivityEntryType::ERROR);
            return false;
        }

        if (item.is_dir) {
            auto& services = registry_.get_state<ServicesState>("Services");
            auto& notifications = registry_.get_state<NotificationState>("Notifications");

            const std::string dest_folder_path = join_remote_child_path(remote_path, item.name);
            uint64_t notif_id = notifications.add_notification("transferring...", 15.0f);

            services.transfer_folder(
                item.remote_name, item.remote_path, remote_name, dest_folder_path,
                [registry = &registry_, item, op, file_name = item.name, notif_id](bool success,
                                                                                    const std::string&,
                                                                                    const std::string& error) {
                    auto& notifications = registry->get_state<NotificationState>("Notifications");
                    notifications.dismiss(notif_id);
                    if (success) {
                        if (op == ClipboardOp::CUT) {
                            std::string delete_error;
                            if (!FileExplorerPanel::delete_remote_file_impl(item, &delete_error)) {
                                notifications.add_notification("Transferred " + file_name);
                                auto& activity = registry->get_state<ActivityState>("Activity");
                                activity.add_entry("File", "Remote move copied the folder, but failed to remove the source: " + delete_error,
                                    ActivityEntryType::ERROR);
                            } else {
                                notifications.add_notification("Moved " + file_name);
                            }
                        } else {
                            notifications.add_notification("Transferred " + file_name);
                        }
                    } else {
                        auto& activity = registry->get_state<ActivityState>("Activity");
                        activity.add_entry("File", "Folder transfer failed: " + file_name + ": " + error, ActivityEntryType::ERROR);
                    }
                });
            return true;
        }

        fs::path dest = unique_child_path(dest_dir, item.name);
        fs::path staging_path = unique_cloud_transfer_staging_path(dest.filename().string());

        auto& services = registry_.get_state<ServicesState>("Services");
        auto& downloads = registry_.get_state<DownloadState>("Downloads");
        auto& notifications = registry_.get_state<NotificationState>("Notifications");

        const std::string staging_str = staging_path.string();
        const std::string dest_file_name = dest.filename().string();

        uint64_t download_id = downloads.start_download(
            item.name, staging_str, item.remote_name, item.size);
        uint64_t notif_id = notifications.add_notification("preparing transfer...", 15.0f);

        services.download_file(
            item.remote_name, item.remote_path, staging_str,
            [registry = &registry_, download_id](size_t bytes_downloaded, size_t) -> bool {
                auto& downloads = registry->get_state<DownloadState>("Downloads");
                downloads.update_progress(download_id, static_cast<int64_t>(bytes_downloaded));
                return true;
            },
            [registry = &registry_,
             item,
             op,
             file_name = dest_file_name,
             source_name = item.name,
             staging_str,
             remote_name,
             remote_path,
             download_id,
             notif_id](bool success, const std::string& local_path, const std::string& error) {
                auto& downloads = registry->get_state<DownloadState>("Downloads");
                auto& notifications = registry->get_state<NotificationState>("Notifications");
                notifications.dismiss(notif_id);

                if (!success) {
                    downloads.fail_download(download_id, error);
                    cleanup_cloud_transfer_staging_path(staging_str);
                    auto& activity = registry->get_state<ActivityState>("Activity");
                    activity.add_entry("File", "Cloud transfer failed: " + source_name + ": " + error, ActivityEntryType::ERROR);
                    return;
                }

                downloads.complete_download(download_id);
                if (op != ClipboardOp::CUT) {
                    if (queue_cloud_upload(*registry, local_path, file_name, remote_name, remote_path,
                                           true, staging_str)) {
                        auto& sidebar_state = registry->get_state<FileSidebarState>("FileSidebar");
                        sidebar_state.pending_upload_start = true;
                    } else {
                        cleanup_cloud_transfer_staging_path(staging_str);
                    }
                    return;
                }

                auto& services = registry->get_state<ServicesState>("Services");
                services.upload_file(
                    remote_name,
                    remote_path,
                    local_path,
                    nullptr,
                    [registry, item, file_name, source_name, staging_str](bool upload_success,
                                                                          const std::string& upload_error) {
                        cleanup_cloud_transfer_staging_path(staging_str);
                        if (!upload_success) {
                            auto& activity = registry->get_state<ActivityState>("Activity");
                            activity.add_entry("File", "Cloud move failed: " + source_name + ": " + upload_error,
                                ActivityEntryType::ERROR);
                            return;
                        }

                        std::string delete_error;
                        if (!FileExplorerPanel::delete_remote_file_impl(item, &delete_error)) {
                            auto& notifications = registry->get_state<NotificationState>("Notifications");
                            notifications.add_notification("Copied " + file_name);
                            auto& activity = registry->get_state<ActivityState>("Activity");
                            activity.add_entry("File", "Cloud move uploaded the file, but failed to remove the source: " + delete_error,
                                ActivityEntryType::ERROR);
                            return;
                        }

                        auto& notifications = registry->get_state<NotificationState>("Notifications");
                        notifications.add_notification("Moved " + file_name);
                    });
            });

        return true;
    }

    void FileExplorerPanel::perform_paste_cloud_to_local(FileExplorerState& state, const UnifiedFileItem& item, const std::string& dest_dir, ClipboardOp op) {
        (void)state;
        const std::string source_dir = fs::path(item.path).parent_path().string();

        if (item.is_dir) {
            fs::path dest = unique_child_path(dest_dir, item.name);
            fs::path staging_path = unique_cloud_transfer_staging_path(dest.filename().string());

            auto& services = registry_.get_state<ServicesState>("Services");
            auto& notifications = registry_.get_state<NotificationState>("Notifications");
            uint64_t notif_id = notifications.add_notification("downloading folder...", 15.0f);

            services.download_folder(
                item.remote_name,
                item.remote_path,
                staging_path.string(),
                [this,
                 registry = &registry_,
                 item,
                 op,
                 dest_dir,
                 source_dir,
                 dest_path = dest.string(),
                 staging_str = staging_path.string(),
                 notif_id](bool success, const std::string& local_path, const std::string& error) {
                    auto& notifications = registry->get_state<NotificationState>("Notifications");
                    notifications.dismiss(notif_id);

                    if (!success) {
                        cleanup_cloud_transfer_staging_path(staging_str);
                        auto& activity = registry->get_state<ActivityState>("Activity");
                        activity.add_entry("File", "Folder paste failed: " + item.name + ": " + error, ActivityEntryType::ERROR);
                        return;
                    }

                    struct FolderTransferResult {
                        std::string error;
                    };

                    auto result = std::make_shared<FolderTransferResult>();
                    const std::string transfer_source = local_path.empty() ? staging_str : local_path;
                    worker_pool_.add(
                        [result, transfer_source, dest_path, op, staging_str]() {
                            std::error_code ec;
                            if (op == ClipboardOp::CUT) {
                                fs::rename(transfer_source, dest_path, ec);
                                if (is_cross_device_error(ec)) {
                                    if (!copy_path_then_remove_source(transfer_source, dest_path, ec)) {
                                        result->error = ec.message();
                                    }
                                } else if (ec) {
                                    result->error = ec.message();
                                }
                            } else {
                                fs::copy(transfer_source, dest_path, fs::copy_options::recursive, ec);
                                if (ec) {
                                    result->error = ec.message();
                                }
                            }
                            cleanup_cloud_transfer_staging_path(staging_str);
                        },
                        [this, registry, item, op, source_dir, dest_dir, result]() {
                            if (!result->error.empty()) {
                                auto& activity = registry->get_state<ActivityState>("Activity");
                                activity.add_entry("File", "Folder paste failed: " + item.name + ": " + result->error,
                                    ActivityEntryType::ERROR);
                                return;
                            }

                            auto& notifications = registry->get_state<NotificationState>("Notifications");
                            if (op == ClipboardOp::CUT) {
                                std::string delete_error;
                                if (!FileExplorerPanel::delete_remote_file_impl(item, &delete_error)) {
                                    notifications.add_notification("Copied " + item.name);
                                    auto& activity = registry->get_state<ActivityState>("Activity");
                                    activity.add_entry("File", "Move completed locally, but failed to remove remote source: " + delete_error,
                                        ActivityEntryType::ERROR);
                                } else {
                                    notifications.add_notification("Moved " + item.name);
                                }
                            } else {
                                notifications.add_notification("Copied " + item.name);
                            }

                            request_background_move_refresh(source_dir, dest_dir);
                        },
                        [registry, item](const std::string& err_msg) {
                            auto& activity = registry->get_state<ActivityState>("Activity");
                            activity.add_entry("File", "Folder paste failed: " + item.name + ": " + err_msg,
                                ActivityEntryType::ERROR);
                        });
                });
            return;
        }

        // If file is mirrored locally, use it as the transfer source. For CUT
        // we still remove the cloud object after the local copy succeeds.
        if (remote_file_has_local_mirror(item)) {
            fs::path src(item.path);
            fs::path dest = unique_child_path(dest_dir, src.filename().string());

            std::error_code ec;
            fs::copy_file(src, dest, ec);

            if (ec) {
                auto& activity = registry_.get_state<ActivityState>("Activity");
                activity.add_entry("File", "Paste failed: " + ec.message(), ActivityEntryType::ERROR);
            } else {
                auto& notif = registry_.get_state<NotificationState>("Notifications");
                if (op == ClipboardOp::CUT) {
                    std::string delete_error;
                    if (!delete_remote_file(item, &delete_error)) {
                        notif.add_notification("Copied " + item.name);
                        auto& activity = registry_.get_state<ActivityState>("Activity");
                        activity.add_entry("File", "Move completed locally, but failed to remove remote source: " + delete_error,
                            ActivityEntryType::ERROR);
                    } else {
                        notif.add_notification("Moved " + item.name);
                    }
                } else {
                    notif.add_notification("Copied " + item.name);
                }
                request_background_move_refresh(source_dir, dest_dir);
            }
            return;
        }

        // NOT_SYNCED — download from cloud to dest
        auto& services = registry_.get_state<ServicesState>("Services");
        auto& downloads = registry_.get_state<DownloadState>("Downloads");
        auto& notifications = registry_.get_state<NotificationState>("Notifications");

        std::string dest_path = unique_child_path(dest_dir, item.name).string();

        uint64_t download_id = downloads.start_download(
            item.name, dest_path, item.remote_name, item.size);

        uint64_t notif_id = notifications.add_notification("downloading...", 15.0f);

        services.download_file(
            item.remote_name, item.remote_path, dest_path,
            [registry = &registry_, download_id](size_t bytes_downloaded, size_t) -> bool {
                auto& downloads = registry->get_state<DownloadState>("Downloads");
                downloads.update_progress(download_id, static_cast<int64_t>(bytes_downloaded));
                return true;
            },
            [this, registry = &registry_, item, op, file_name = item.name, download_id, notif_id, source_dir, dest_dir](
                bool success, const std::string& local_path, const std::string& error) {
                (void)local_path;
                auto& downloads = registry->get_state<DownloadState>("Downloads");
                auto& notifications = registry->get_state<NotificationState>("Notifications");
                notifications.dismiss(notif_id);
                if (success) {
                    downloads.complete_download(download_id);
                    if (op == ClipboardOp::CUT) {
                        std::string delete_error;
                        if (!FileExplorerPanel::delete_remote_file_impl(item, &delete_error)) {
                            notifications.add_notification("Copied " + file_name);
                            auto& activity = registry->get_state<ActivityState>("Activity");
                            activity.add_entry("File", "Move completed locally, but failed to remove remote source: " + delete_error,
                            ActivityEntryType::ERROR);
                        } else {
                            notifications.add_notification("Moved " + file_name);
                        }
                    } else {
                        notifications.add_notification("Copied " + file_name);
                    }
                    this->request_background_move_refresh(source_dir, dest_dir);
                } else {
                    downloads.fail_download(download_id, error);
                    auto& activity = registry->get_state<ActivityState>("Activity");
                    activity.add_entry("File", "Paste failed: " + file_name + ": " + error, ActivityEntryType::ERROR);
                }
            });
    }

    void FileExplorerPanel::queue_cross_device_move(const UnifiedFileItem& item,
                                                    const std::string& source_dir,
                                                    const std::string& dest_dir,
                                                    const fs::path& src,
                                                    const fs::path& dest,
                                                    std::function<void()> on_success) {
        auto& activity = registry_.get_state<ActivityState>("Activity");
        activity.add_entry("File", "Moving " + item.name + " in the background.", ActivityEntryType::INFO);

        struct MoveResult {
            std::string error;
        };

        auto result = std::make_shared<MoveResult>();
        worker_pool_.add(
            [result, src, dest]() {
                std::error_code ec;
                if (!copy_path_then_remove_source(src, dest, ec)) {
                    result->error = ec.message();
                }
            },
            [this, result, item, source_dir, dest_dir, on_success = std::move(on_success)]() mutable {
                if (!result->error.empty()) {
                    auto& activity = registry_.get_state<ActivityState>("Activity");
                    activity.add_entry("File", "Background move failed: " + item.name + ": " + result->error,
                        ActivityEntryType::ERROR);
                    request_background_move_refresh(source_dir, dest_dir);
                    return;
                }

                if (on_success) {
                    on_success();
                }

                auto& activity = registry_.get_state<ActivityState>("Activity");
                activity.add_entry("File", "Moved " + item.name, ActivityEntryType::SUCCESS);

                auto& notifications = registry_.get_state<NotificationState>("Notifications");
                notifications.add_notification("Moved " + item.name);

                request_background_move_refresh(source_dir, dest_dir);
            },
            [this, item, source_dir, dest_dir](const std::string& err_msg) {
                auto& activity = registry_.get_state<ActivityState>("Activity");
                activity.add_entry("File", "Background move failed: " + item.name + ": " + err_msg,
                    ActivityEntryType::ERROR);
                request_background_move_refresh(source_dir, dest_dir);
            });
    }

    void FileExplorerPanel::request_background_move_refresh(const std::string& source_dir,
                                                            const std::string& dest_dir) {
        auto& state = registry_.get_state<FileExplorerState>(state_key_);
        {
            std::lock_guard<std::mutex> lock(state.mu);
            const std::string effective_path = !state.pending_navigation_path.empty()
                ? state.pending_navigation_path
                : std::string(state.current_path);
            if (effective_path == source_dir || effective_path == dest_dir) {
                state.pending_navigation_path = effective_path;
            }
        }

        notify_shared_path_refresh(source_dir);
        if (dest_dir != source_dir) {
            notify_shared_path_refresh(dest_dir);
        }
    }

    void FileExplorerPanel::trigger_upload(const std::string& local_path, const std::string& dest_dir) {
        auto& uploads = registry_.get_state<UploadState>("Uploads");
        auto& services = registry_.get_state<ServicesState>("Services");
        auto& notifications = registry_.get_state<NotificationState>("Notifications");

        std::string file_name = fs::path(local_path).filename().string();
        int64_t file_size = 0;
        try { file_size = static_cast<int64_t>(fs::file_size(local_path)); } catch (...) {}

        if (path_utils::is_remote_path(dest_dir)) {
            std::string remote_name;
            std::string remote_path;
            resolve_remote_path_context(dest_dir, remote_name, remote_path);

            if (remote_name.empty()) {
                auto& activity = registry_.get_state<ActivityState>("Activity");
                activity.add_entry("File", "Cannot upload to mount root. Navigate into a remote folder.", ActivityEntryType::ERROR);
                return;
            }

            uint64_t upload_id = uploads.start_upload(file_name, local_path, remote_name, file_size);
            uploads.set_retry_context(upload_id, remote_name, remote_path);
            notifications.add_notification("uploading...", 15.0f);

            services.upload_file(remote_name, remote_path, local_path,
                [registry = &registry_, upload_id](size_t bytes_uploaded, size_t total_bytes) -> bool {
                    auto& uploads = registry->get_state<UploadState>("Uploads");
                    uploads.update_progress(upload_id, static_cast<int64_t>(bytes_uploaded));
                    return true;
                },
                [registry = &registry_, file_name, upload_id](bool success, const std::string& error_msg) {
                    auto& uploads = registry->get_state<UploadState>("Uploads");
                    auto& notifications = registry->get_state<NotificationState>("Notifications");
                    if (success) {
                        uploads.complete_upload(upload_id);
                        notifications.add_notification("Uploaded " + file_name);
                    } else {
                        uploads.fail_upload(upload_id, error_msg);
                        auto& activity = registry->get_state<ActivityState>("Activity");
                        activity.add_entry("File", "Upload failed: " + file_name + ": " + error_msg, ActivityEntryType::ERROR);
                    }
                });
        }
    }

    void FileExplorerPanel::record_file_operation(FileOperationRecord record) {
        if (record.items.empty()) {
            return;
        }
        auto& journal = registry_.get_state<FileOperationJournalState>("FileOperationJournal");
        journal.push(std::move(record));
    }

    void FileExplorerPanel::perform_undo(FileExplorerState& state) {
        auto& journal = registry_.get_state<FileOperationJournalState>("FileOperationJournal");
        const FileOperationRecord* record = journal.peek_undo();
        if (record == nullptr) {
            auto& notif = registry_.get_state<NotificationState>("Notifications");
            notif.add_notification("Nothing to undo");
            return;
        }
        const std::string origin_dir = record->origin_dir;
        const std::string destination_dir = record->destination_dir;
        const std::string description = record->description.empty()
            ? file_operation_kind_label(record->kind)
            : record->description;

        std::string error;
        if (!undo_file_operation(state, *record, &error)) {
            auto& activity = registry_.get_state<ActivityState>("Activity");
            activity.add_entry("File", error.empty() ? "Undo is not implemented for this operation yet." : error,
                ActivityEntryType::ERROR);
            return;
        }

        FileOperationRecord completed;
        if (journal.take_undo(completed)) {
            journal.complete_undo(std::move(completed));
        }
        state.selected_files.clear();
        navigate_to_path(std::string(state.current_path), false);
        notify_shared_path_refresh(std::string(state.current_path));
        if (!origin_dir.empty()) {
            notify_shared_path_refresh(origin_dir);
        }
        if (!destination_dir.empty() && destination_dir != origin_dir) {
            notify_shared_path_refresh(destination_dir);
        }
        auto& notif = registry_.get_state<NotificationState>("Notifications");
        notif.add_notification("Undid " + description);
    }

    void FileExplorerPanel::perform_redo(FileExplorerState& state) {
        auto& journal = registry_.get_state<FileOperationJournalState>("FileOperationJournal");
        const FileOperationRecord* record = journal.peek_redo();
        if (record == nullptr) {
            auto& notif = registry_.get_state<NotificationState>("Notifications");
            notif.add_notification("Nothing to redo");
            return;
        }
        const std::string origin_dir = record->origin_dir;
        const std::string destination_dir = record->destination_dir;
        const std::string description = record->description.empty()
            ? file_operation_kind_label(record->kind)
            : record->description;

        std::string error;
        if (!redo_file_operation(state, *record, &error)) {
            auto& activity = registry_.get_state<ActivityState>("Activity");
            activity.add_entry("File", error.empty() ? "Redo is not implemented for this operation yet." : error,
                ActivityEntryType::ERROR);
            return;
        }

        FileOperationRecord completed;
        if (journal.take_redo(completed)) {
            journal.complete_redo(std::move(completed));
        }
        state.selected_files.clear();
        navigate_to_path(std::string(state.current_path), false);
        notify_shared_path_refresh(std::string(state.current_path));
        if (!origin_dir.empty()) {
            notify_shared_path_refresh(origin_dir);
        }
        if (!destination_dir.empty() && destination_dir != origin_dir) {
            notify_shared_path_refresh(destination_dir);
        }
        auto& notif = registry_.get_state<NotificationState>("Notifications");
        notif.add_notification("Redid " + description);
    }

    bool FileExplorerPanel::undo_file_operation(FileExplorerState& state,
                                                const FileOperationRecord& record,
                                                std::string* error_message) {
        (void)state;
        switch (record.kind) {
            case FileOperationKind::CopyLocal:
                for (auto it = record.items.rbegin(); it != record.items.rend(); ++it) {
                    if (!remove_copy_destination(state, *it, error_message)) {
                        return false;
                    }
                }
                return true;
            case FileOperationKind::MoveLocal:
            case FileOperationKind::RenameLocal:
                if (!validate_record_moves(record, true, error_message)) {
                    return false;
                }
                for (auto it = record.items.rbegin(); it != record.items.rend(); ++it) {
                    const fs::path source(it->source_path);
                    const fs::path destination(it->destination_path);
                    if (!move_path_without_overwrite(*it, destination, source, error_message)) {
                        return false;
                    }
                    state.track_move(destination.string(), make_local_operation_item(source, *it));
                }
                return true;
            case FileOperationKind::TrashLocal:
                if (!validate_record_moves(record, true, error_message)) {
                    return false;
                }
                for (auto it = record.items.rbegin(); it != record.items.rend(); ++it) {
                    const fs::path source(it->source_path);
                    const fs::path trash_path(it->destination_path);
                    if (!move_path_without_overwrite(*it, trash_path, source, error_message)) {
                        return false;
                    }
                    remove_trash_listing(state, trash_path.string());
                    state.track_move(trash_path.string(), make_local_operation_item(source, *it));
                }
                return true;
            case FileOperationKind::UploadToRemote:
            case FileOperationKind::DownloadFromRemote:
            case FileOperationKind::RemoteDelete:
            case FileOperationKind::PermanentDeleteLocal:
            case FileOperationKind::Custom:
                break;
        }

        if (error_message) {
            *error_message = "Undo is only available for local copy, move, rename, and trash operations right now.";
        }
        return false;
    }

    bool FileExplorerPanel::redo_file_operation(FileExplorerState& state,
                                                const FileOperationRecord& record,
                                                std::string* error_message) {
        (void)state;
        switch (record.kind) {
            case FileOperationKind::CopyLocal:
                for (const auto& item : record.items) {
                    if (!copy_path_without_overwrite(item,
                            fs::path(item.source_path),
                            fs::path(item.destination_path),
                            error_message)) {
                        return false;
                    }
                }
                return true;
            case FileOperationKind::MoveLocal:
            case FileOperationKind::RenameLocal:
                if (!validate_record_moves(record, false, error_message)) {
                    return false;
                }
                for (const auto& item : record.items) {
                    const fs::path source(item.source_path);
                    const fs::path destination(item.destination_path);
                    if (!move_path_without_overwrite(item, source, destination, error_message)) {
                        return false;
                    }
                    state.track_move(source.string(), make_local_operation_item(destination, item));
                }
                return true;
            case FileOperationKind::TrashLocal:
                if (!validate_record_moves(record, false, error_message)) {
                    return false;
                }
                for (const auto& item : record.items) {
                    const fs::path source(item.source_path);
                    const fs::path trash_path(item.destination_path);
                    if (!move_path_without_overwrite(item, source, trash_path, error_message)) {
                        return false;
                    }
                    UnifiedFileItem trash_item = make_local_operation_item(trash_path, item, SyncStatus::DELETED);
                    trash_item.name = item_label(item, trash_path);
                    state.move_to_trash(trash_item);
                    state.track_move(source.string(), trash_item);
                    purge_from_recent(state, source.string());
                }
                return true;
            case FileOperationKind::UploadToRemote:
            case FileOperationKind::DownloadFromRemote:
            case FileOperationKind::RemoteDelete:
            case FileOperationKind::PermanentDeleteLocal:
            case FileOperationKind::Custom:
                break;
        }

        if (error_message) {
            *error_message = "Redo is only available for local copy, move, rename, and trash operations right now.";
        }
        return false;
    }

    void FileExplorerPanel::perform_copy(FileExplorerState& state) {
        auto& clipboard = registry_.get_state<ClipboardState>("Clipboard");
        clipboard.op = ClipboardOp::COPY;
        clipboard.paths.clear();
        clipboard.items.clear();
        for (const auto& sel : state.selected_files) {
            for (const auto& f : state.files) {
                if (f.id == sel) {
                    clipboard.paths.push_back(f.path);
                    clipboard.items.push_back(f);
                    break;
                }
            }
        }
        size_t n = clipboard.paths.size();
        auto& notif = registry_.get_state<NotificationState>("Notifications");
        notif.add_notification("Copied " + std::to_string(n) + (n == 1 ? " item" : " items"));
    }

    void FileExplorerPanel::perform_cut(FileExplorerState& state) {
        auto& clipboard = registry_.get_state<ClipboardState>("Clipboard");
        clipboard.op = ClipboardOp::CUT;
        clipboard.paths.clear();
        clipboard.items.clear();
        for (const auto& sel : state.selected_files) {
            for (const auto& f : state.files) {
                if (f.id == sel) {
                    clipboard.paths.push_back(f.path);
                    clipboard.items.push_back(f);
                    break;
                }
            }
        }
        size_t n = clipboard.paths.size();
        auto& notif = registry_.get_state<NotificationState>("Notifications");
        notif.add_notification("Cut " + std::to_string(n) + (n == 1 ? " item" : " items"));
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
        FileOperationRecord local_trash_record;
        local_trash_record.kind = FileOperationKind::TrashLocal;
        local_trash_record.origin_dir = std::string(state.current_path);
        local_trash_record.description = "Moved items to trash";
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
                     local_trash_record.items.push_back({
                         target.path,
                         trash_path,
                         target.item.name,
                         target.item.is_dir
                     });
                     ++local_success_count;
                }
            }
        }

        if (local_success_count > 0) {
            auto& notif = registry_.get_state<NotificationState>("Notifications");
            notif.add_notification("Deleted " + std::to_string(local_success_count) + (local_success_count == 1 ? " item" : " items"));
            record_file_operation(std::move(local_trash_record));
        }

        if (!permission_paths.empty()) {
            state.permission_delete_paths = std::move(permission_paths);
            state.permission_delete_permanent = is_trash_view;
            state.show_permission_delete_modal = true;
        }

        const bool has_remote_targets = !remote_targets.empty();
        if (has_remote_targets) {
            const std::string origin_path(state.current_path);
            for (const auto& target : remote_targets) {
                state.deleting_files.insert(target.path);
            }
            worker_pool_.add(
                [registry = &registry_, state_key = state_key_, remote_targets = std::move(remote_targets), origin_path]() {
                    struct RemoteDeleteResult {
                        std::string id;
                        std::string path;
                        bool success = false;
                        std::string error;
                    };

                    constexpr size_t kDeleteProgressChunk = 8;
                    std::vector<RemoteDeleteResult> results;
                    results.reserve(remote_targets.size());
                    std::vector<RemoteDeleteResult> pending_updates;
                    pending_updates.reserve(kDeleteProgressChunk);

                    auto apply_progress = [&](std::vector<RemoteDeleteResult>& chunk) {
                        if (chunk.empty()) {
                            return;
                        }

                        auto& state = registry->get_state<FileExplorerState>(state_key);
                        std::lock_guard<std::mutex> lock(state.mu);
                        const bool same_dir = std::string(state.current_path) == origin_path &&
                                              state.pending_navigation_path.empty();

                        for (const auto& result : chunk) {
                            state.selected_files.erase(result.id);
                            state.deleting_files.erase(result.path);
                            if (!result.success) {
                                continue;
                            }
                            purge_from_recent(state, result.path);
                        }

                        if (!same_dir) {
                            chunk.clear();
                            return;
                        }

                        state.files.erase(
                            std::remove_if(state.files.begin(), state.files.end(),
                                [&](const UnifiedFileItem& file) {
                                    for (const auto& result : chunk) {
                                        if (result.success && file.path == result.path) {
                                            return true;
                                        }
                                    }
                                    return false;
                                }),
                            state.files.end());
                        state.sort_dirty = true;
                        chunk.clear();
                    };

                    for (const auto& target : remote_targets) {
                        std::string error;
                        const bool success = FileExplorerPanel::delete_remote_file_impl(target.item, &error);
                        RemoteDeleteResult result{target.id, target.path, success, std::move(error)};
                        results.push_back(result);
                        pending_updates.push_back(std::move(result));
                        if (pending_updates.size() >= kDeleteProgressChunk) {
                            apply_progress(pending_updates);
                        }
                    }
                    apply_progress(pending_updates);

                    auto& state = registry->get_state<FileExplorerState>(state_key);
                    auto& notif = registry->get_state<NotificationState>("Notifications");

                    size_t remote_success_count = 0;
                    std::string first_error;
                    {
                        std::lock_guard<std::mutex> lock(state.mu);
                        for (const auto& result : results) {
                            state.selected_files.erase(result.id);
                            state.deleting_files.erase(result.path);
                            if (!result.success) {
                                if (first_error.empty()) first_error = result.error;
                                continue;
                            }
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
                        notif.add_notification("Deleted " + std::to_string(remote_success_count) + (remote_success_count == 1 ? " item" : " items"));
                    }
                    if (!first_error.empty()) {
                        auto& activity = registry->get_state<ActivityState>("Activity");
                        activity.add_entry("File", "Delete failed: " + first_error, ActivityEntryType::ERROR);
                    }
                },
                []() {},
                [registry = &registry_, state_key = state_key_](const std::string& err) {
                    auto& state = registry->get_state<FileExplorerState>(state_key);
                    {
                        std::lock_guard<std::mutex> lock(state.mu);
                        state.deleting_files.clear();
                        state.error_msg = err;
                    }
                    auto& activity = registry->get_state<ActivityState>("Activity");
                    activity.add_entry("File", "Delete failed: " + err, ActivityEntryType::ERROR);
                }
            );
        }

        if (!has_remote_targets || local_success_count > 0) {
            navigate_to_path(std::string(state.current_path), false);
            notify_shared_path_refresh(std::string(state.current_path));
        }
    }

    void FileExplorerPanel::perform_delete_local_selected(FileExplorerState& state) {
        // Clears the local mirror of selected remote files. The cloud copy is
        // untouched — after the next refetch, the proxy will report state=REM
        // because its local-dir scan sees the file missing, and the sync badge
        // flips back to not-synced. This is the "uncache" gesture users expect
        // alongside the full "Delete" that removes the cloud object too.
        struct LocalCacheTarget {
            std::string id;
            std::string path;
            UnifiedFileItem item;
        };

        std::vector<LocalCacheTarget> targets;
        targets.reserve(state.selected_files.size());
        for (const auto& sel : state.selected_files) {
            for (const auto& f : state.files) {
                if (f.id != sel) continue;
                if (f.source != FileSource::REMOTE) break;
                if (!fs::exists(f.path)) break;
                targets.push_back({f.id, f.path, f});
                break;
            }
        }
        if (targets.empty()) return;

        size_t success_count = 0;
        std::vector<std::string> permission_paths;
        FileOperationRecord local_trash_record;
        local_trash_record.kind = FileOperationKind::TrashLocal;
        local_trash_record.origin_dir = std::string(state.current_path);
        local_trash_record.description = "Cleared local copies";
        for (const auto& target : targets) {
            std::error_code ec;
            const std::string trash_path = unique_trash_target_path(target.path);
            fs::rename(target.path, trash_path, ec);
            if (ec) {
                if (is_permission_error(ec)) {
                    permission_paths.push_back(target.path);
                    continue;
                }
                state.error_msg = "Failed to move to trash: " + ec.message();
                continue;
            }
            UnifiedFileItem trashed;
            trashed.path = trash_path;
            trashed.id = trashed.path;
            trashed.name = fs::path(trash_path).filename().string();
            trashed.is_dir = fs::is_directory(trash_path);
            trashed.status = SyncStatus::DELETED;
            state.move_to_trash(trashed);
            purge_from_recent(state, target.path);
            state.selected_files.erase(target.id);
            local_trash_record.items.push_back({
                target.path,
                trash_path,
                target.item.name,
                target.item.is_dir
            });
            ++success_count;

            // Flip the DB row to local_exists=false immediately so the next
            // listing reflects REM without waiting for a full refetch scan.
            if (!target.item.remote_name.empty() && !target.item.remote_path.empty()) {
                auto& services = registry_.get_state<ServicesState>("Services");
                services.mark_local_dirty(target.item.remote_name, target.item.remote_path,
                    /*local_exists*/ false, target.item.is_dir, "", 0,
                    [](bool, const std::string&, const std::string&) {});
            }
        }

        if (success_count > 0) {
            auto& notif = registry_.get_state<NotificationState>("Notifications");
            notif.add_notification("Cleared local copy of " + std::to_string(success_count) + (success_count == 1 ? " item" : " items"));
            record_file_operation(std::move(local_trash_record));
        }
        if (!permission_paths.empty()) {
            state.permission_delete_paths = std::move(permission_paths);
            state.permission_delete_permanent = false;
            state.show_permission_delete_modal = true;
        }
        if (success_count > 0) {
            navigate_to_path(std::string(state.current_path), false);
            notify_shared_path_refresh(std::string(state.current_path));
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
        return delete_remote_file_impl(file, error_message);
    }

    bool FileExplorerPanel::delete_remote_file_impl(const UnifiedFileItem& file,
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
            notif.add_notification("Deleted " + std::to_string(success_count) + (success_count == 1 ? " item" : " items"));
        }

        if (!permission_paths.empty()) {
            state.permission_delete_paths = std::move(permission_paths);
            state.permission_delete_permanent = true;
            state.show_permission_delete_modal = true;
        }

        navigate_to_path(std::string(state.current_path), false);
        notify_shared_path_refresh(std::string(state.current_path));
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
            notif.add_notification("Deleted " + std::to_string(success_count) + (success_count == 1 ? " item" : " items"));
        }

        navigate_to_path(std::string(state.current_path), false);
        notify_shared_path_refresh(std::string(state.current_path));
    }

}
