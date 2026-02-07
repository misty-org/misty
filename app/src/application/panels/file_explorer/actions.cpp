#include "panels/file_explorer/file_explorer_panel.h"
#include "panels/activity/download_state.h"
#include "panels/activity/upload_state.h"
#include "panels/file_sidebar/file_sidebar_state.h"
#include "panels/notification/notification_state.h"
#include "panels/services/dropbox/dropbox_state.h"
#include "panels/services/gdrive/gdrive_state.h"
#include "panels/services/onedrive/onedrive_state.h"
#include "panels/services/services_state.h"
#include <algorithm>
#include <cstdio>

namespace fs = std::filesystem;

namespace misty::panel {
    void FileExplorerPanel::perform_paste(FileExplorerState& state) {
        std::string dest_dir(state.current_path);
        bool dest_is_cloud = path_utils::is_onedrive_path(dest_dir)
                          || path_utils::is_gdrive_path(dest_dir)
                          || path_utils::is_dropbox_path(dest_dir)
                          || path_utils::is_icloud_path(dest_dir);

        bool queued_cloud_uploads = false;

        for (const auto& item : state.clipboard_items) {
            bool src_is_cloud = (item.source == FileSource::ONEDRIVE
                              || item.source == FileSource::GDRIVE
                              || item.source == FileSource::DROPBOX
                              || item.source == FileSource::ICLOUD);

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
        // Skip directories — cloud upload only supports files
        if (item.is_dir) {
            auto& notif = registry_.get_state<NotificationState>("Notifications");
            notif.add_notification("Paste Skipped", "Folder upload not supported: " + item.name, NotificationType::INFO);
            return;
        }

        // Source file must exist locally (either local file or synced cloud file)
        if (!fs::exists(item.path)) {
            auto& notif = registry_.get_state<NotificationState>("Notifications");
            notif.add_notification("Paste Failed", "File not available locally: " + item.name + ". Download it first.", NotificationType::ERROR);
            return;
        }

        // Copy the file into the mount directory
        fs::path src(item.path);
        fs::path dest = fs::path(dest_dir) / src.filename();

        // Deduplicate name
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

        // Determine upload target from destination path
        UploadTarget target;
        if (path_utils::is_onedrive_path(dest_dir)) {
            target = UploadTarget::ONEDRIVE;
        } else if (path_utils::is_gdrive_path(dest_dir)) {
            target = UploadTarget::GDRIVE;
        } else {
            target = UploadTarget::DROPBOX;
        }

        // Queue into sidebar upload queue for batch processing
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
            progress.target_service = target;
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
            item.name, dest_path,
            item.source == FileSource::ONEDRIVE ? "OneDrive" :
            item.source == FileSource::GDRIVE ? "Google Drive" :
            item.source == FileSource::DROPBOX ? "Dropbox" : "iCloud",
            item.size
        );

        uint64_t notif_id = notifications.add_notification(
            "Downloading for Paste",
            item.name,
            NotificationType::DOWNLOAD,
            15.0f
        );

        if (item.source == FileSource::ONEDRIVE) {
            services.download_file(
                item.od_ms_user_id, item.od_drive_id, item.od_item_id, dest_path,
                [this, download_id](size_t bytes_downloaded, size_t /*total_bytes*/) -> bool {
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
        } else if (item.source == FileSource::GDRIVE) {
            services.download_gd_file(
                item.gd_user_id, item.gd_item_id, dest_path,
                [this, download_id](size_t bytes_downloaded, size_t /*total_bytes*/) -> bool {
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
        } else if (item.source == FileSource::DROPBOX) {
            services.download_dbx_file(
                item.dbx_user_id, item.dbx_path_display, dest_path,
                [this, download_id](size_t bytes_downloaded, size_t /*total_bytes*/) -> bool {
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
        } else if (item.source == FileSource::ICLOUD) {
            // Split icl_path_display into folder_path + filename
            std::string icl_filename = item.name;
            std::string icl_folder;
            size_t slash = item.icl_path_display.rfind('/');
            if (slash != std::string::npos) {
                icl_folder = item.icl_path_display.substr(0, slash);
            }
            services.download_icl_file(
                item.icl_email, icl_filename, icl_folder, dest_path,
                [this, download_id](size_t bytes_downloaded, size_t /*total_bytes*/) -> bool {
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
    }

    void FileExplorerPanel::trigger_upload(const std::string& local_path, const std::string& dest_dir) {
        auto& uploads = registry_.get_state<UploadState>("Uploads");
        auto& notifications = registry_.get_state<NotificationState>("Notifications");

        std::string file_name = fs::path(local_path).filename().string();
        int64_t file_size = 0;
        try { file_size = static_cast<int64_t>(fs::file_size(local_path)); } catch (...) {}

        if (path_utils::is_onedrive_path(dest_dir)) {
            auto& od_state = registry_.get_state<OneDriveState>("OneDrive");
            if (!od_state.has_upload_context()) {
                notifications.add_notification("Upload Failed", "No OneDrive upload context. Navigate to a OneDrive folder first.", NotificationType::ERROR);
                return;
            }
            auto ctx = od_state.get_upload_context();
            uint64_t upload_id = uploads.start_upload(file_name, local_path, "OneDrive", file_size);
            uploads.set_onedrive_retry_context(upload_id, ctx.ms_user_id, ctx.drive_id, ctx.folder_id);
            notifications.add_notification("Uploading", file_name, NotificationType::DOWNLOAD, 15.0f);

            od_state.upload_file(local_path, ctx,
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
        } else if (path_utils::is_gdrive_path(dest_dir)) {
            auto& gd_state = registry_.get_state<GDriveState>("GDrive");
            if (!gd_state.has_upload_context()) {
                notifications.add_notification("Upload Failed", "No Google Drive upload context. Navigate to a Google Drive folder first.", NotificationType::ERROR);
                return;
            }
            auto ctx = gd_state.get_upload_context();
            uint64_t upload_id = uploads.start_upload(file_name, local_path, "Google Drive", file_size);
            uploads.set_gdrive_retry_context(upload_id, ctx.gd_user_id, ctx.folder_id);
            notifications.add_notification("Uploading", file_name, NotificationType::DOWNLOAD, 15.0f);

            gd_state.upload_file(local_path, ctx,
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
        } else if (path_utils::is_dropbox_path(dest_dir)) {
            auto& dbx_state = registry_.get_state<DropboxState>("Dropbox");
            if (!dbx_state.has_upload_context()) {
                notifications.add_notification("Upload Failed", "No Dropbox upload context. Navigate to a Dropbox folder first.", NotificationType::ERROR);
                return;
            }
            auto ctx = dbx_state.get_upload_context();
            uint64_t upload_id = uploads.start_upload(file_name, local_path, "Dropbox", file_size);
            uploads.set_dropbox_retry_context(upload_id, ctx.dbx_user_id, ctx.folder_path);
            notifications.add_notification("Uploading", file_name, NotificationType::DOWNLOAD, 15.0f);

            dbx_state.upload_file(local_path, ctx,
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
            state.clipboard_paths.push_back(sel);
            // Look up full metadata from state.files
            for (const auto& f : state.files) {
                if (f.path == sel) {
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
            state.clipboard_paths.push_back(sel);
            for (const auto& f : state.files) {
                if (f.path == sel) {
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
        printf("Explorer: perform_delete_selected. is_trash_view=%d\n", is_trash_view);
        
        std::vector<std::string> to_delete(state.selected_files.begin(), state.selected_files.end());
        for (const auto& path : to_delete) {
            printf("Explorer: Deleting path: %s\n", path.c_str());
            auto purge_from_recent = [&](const std::string& p) {
                auto it = std::remove_if(state.recent_files.begin(), state.recent_files.end(),
                    [&](const UnifiedFileItem& f) { return f.path == p; });
                if (it != state.recent_files.end()) {
                    state.recent_files.erase(it, state.recent_files.end());
                    state.dirty_ = true;
                }
            };

            if (is_trash_view) {
                // Permanent Delete
                perform_delete(state, path);

                // Remove from trash list and recent (trash path may still be in recent
                // if track_move ran before this permanent delete)
                auto it = std::remove_if(state.trash_files.begin(), state.trash_files.end(),
                    [&](const UnifiedFileItem& item) { return item.path == path; });
                state.trash_files.erase(it, state.trash_files.end());
                purge_from_recent(path);
            } else {
                // Move to Trash (Local only, Cloud deletes directly)
                bool is_cloud = path_utils::is_onedrive_path(path) || path_utils::is_gdrive_path(path) || path_utils::is_dropbox_path(path) || path_utils::is_icloud_path(path);

                if (is_cloud) {
                     printf("Explorer: Deleting cloud file directly\n");
                     perform_delete(state, path);
                     purge_from_recent(path);
                } else {
                    // Local: Move to ~/misty/.cache/trash
                    std::string trash_dir = std::string(std::getenv("HOME")) + "/misty/.cache/trash";
                    printf("Explorer: Moving to trash dir: %s\n", trash_dir.c_str());
                    std::error_code ec;
                    fs::create_directories(trash_dir, ec);
                    
                    std::string filename = fs::path(path).filename().string();
                    std::string target = trash_dir + "/" + filename;
                    
                    // Handle duplicate names in trash
                    int counter = 1;
                    while (fs::exists(target)) {
                        target = trash_dir + "/" + fs::path(path).stem().string() + "_" + std::to_string(counter++) + fs::path(path).extension().string();
                    }

                    printf("Explorer: Renaming %s to %s\n", path.c_str(), target.c_str());
                    fs::rename(path, target, ec);
                    if (ec) {
                        printf("Explorer: Failed to move to trash: %s\n", ec.message().c_str());
                        state.error_msg = "Failed to move to trash: " + ec.message();
                    } else {
                         // Add to virtual trash list
                         UnifiedFileItem item;
                         item.path = target; // Point to trash location
                         item.name = fs::path(target).filename().string(); // Use new name
                         item.is_dir = fs::is_directory(target);
                         item.status = SyncStatus::DELETED; // Mark as soft deleted
                         state.move_to_trash(item);
                         
                         // Update Recent/Starred if they point to this file
                         state.track_move(path, item);
                    }
                }
            }
        }
        
        auto& notif = registry_.get_state<NotificationState>("Notifications");
        notif.add_notification("Deleted", "Deleted " + std::to_string(to_delete.size()) + " items", NotificationType::SUCCESS);

        // Refresh directory
        navigate_to_path(std::string(state.current_path), false);
    }

    void FileExplorerPanel::initiate_rename(FileExplorerState& state) {
        // Prefer context menu target if set, otherwise single selected file
        std::string target;
        if (!state.context_menu_target_path.empty()) {
            target = state.context_menu_target_path;
        } else if (state.selected_files.size() == 1) {
            target = *state.selected_files.begin();
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

    void FileExplorerPanel::perform_delete(FileExplorerState& state, const std::string& path) {
        std::error_code ec;
        fs::remove_all(path, ec);
        if (ec) {
            state.error_msg = "Failed to delete: " + ec.message();
        }
        state.selected_files.erase(path);
    }

    // ==================== Google Drive Methods ====================


}
