#include "panels/file_explorer/file_explorer_panel.h"
#include "panels/activity/download_state.h"
#include "panels/notification/notification_state.h"
#include "panels/services/gdrive/gdrive_state.h"
#include "panels/services/services_state.h"
#include "panels/workspace/workspace_state.h"

namespace fs = std::filesystem;

namespace misty::panel {
    void FileExplorerPanel::sync_gd_account_mappings() {
        auto& workspace = registry_.get_state<WorkspaceState>("Workspace");
        auto& services = registry_.get_state<ServicesState>("Services");

        workspace.ensure_directories();

        std::lock_guard<std::mutex> svc_lock(services.mu);

        workspace.gd_account_mappings.clear();
        for (const auto& conn : services.gd_connections) {
            if (!conn.is_authenticated) continue;

            GDAccountMapping mapping;
            mapping.gd_user_id = conn.profile.id;
            mapping.display_name = conn.profile.display_name;
            mapping.email = conn.profile.email;
            mapping.folder_name = mount_utils::derive_folder_name(conn.profile.email);

            mount_utils::ensure_gd_account_directory(conn.profile.email);

            workspace.gd_account_mappings.push_back(mapping);
        }
    }

    void FileExplorerPanel::navigate_to_gdrive_mount_root(bool update_history) {
        auto& state = registry_.get_state<FileExplorerState>("Files");
        auto& workspace = registry_.get_state<WorkspaceState>("Workspace");

        state.last_disconnected_notification_folder.clear();

        // Clear GDrive upload context
        {
            auto& gdrive_state = registry_.get_state<GDriveState>("GDrive");
            std::lock_guard<std::mutex> gd_lock(gdrive_state.mu);
            gdrive_state.current_gd_user_id.clear();
            gdrive_state.current_folder_id.clear();
        }

        sync_gd_account_mappings();

        std::string new_path = path_utils::get_gdrive_root();

        update_navigation_history(state, new_path, update_history);

        std::vector<UnifiedFileItem> files;
        std::unordered_set<std::string> added_folders;

        // Add connected accounts from mappings
        for (const auto& mapping : workspace.gd_account_mappings) {
            UnifiedFileItem item;
            item.name = mapping.folder_name;
            item.path = new_path + "/" + mapping.folder_name;
            item.is_dir = true;
            item.source = FileSource::GDRIVE;
            item.gd_user_id = mapping.gd_user_id;
            files.push_back(item);
            added_folders.insert(mapping.folder_name);
        }

        // Scan local GoogleDrive directory for folders without connected accounts
        std::error_code ec;
        if (fs::exists(new_path, ec) && fs::is_directory(new_path, ec)) {
            for (const auto& entry : fs::directory_iterator(new_path, ec)) {
                if (entry.is_directory()) {
                    std::string folder_name = entry.path().filename().string();
                    if (added_folders.count(folder_name) > 0 || folder_name[0] == '.') {
                        continue;
                    }

                    UnifiedFileItem item;
                    item.name = folder_name;
                    item.path = new_path + "/" + folder_name;
                    item.is_dir = true;
                    item.source = FileSource::LOCAL;
                    files.push_back(item);
                }
            }
        }

        state.files = std::move(files);
        set_active_path(state, new_path);
        state.is_loading = false;
        reset_selection(state);
        state.error_msg = "";
    }

    void FileExplorerPanel::navigate_to_gdrive_account(const std::string& folder_name,
                                                        const std::string& relative_path,
                                                        bool update_history,
                                                        bool create_if_missing) {
        auto& state = registry_.get_state<FileExplorerState>("Files");
        auto& workspace = registry_.get_state<WorkspaceState>("Workspace");
        auto& services = registry_.get_state<ServicesState>("Services");

        bool is_connected = services.is_gd_account_folder_connected(folder_name);

        GDAccountMapping* mapping = workspace.find_gd_account_by_folder(folder_name);
        if (!mapping) {
            sync_gd_account_mappings();
            mapping = workspace.find_gd_account_by_folder(folder_name);
        }

        std::string target_path = path_utils::get_gdrive_root() + "/" + folder_name;
        if (!relative_path.empty()) {
            target_path += "/" + relative_path;
        }

        if (!is_connected) {
            if (state.last_disconnected_notification_folder != folder_name) {
                auto& notifications = registry_.get_state<NotificationState>("Notifications");
                notifications.add_notification(
                    "Account Not Connected",
                    "The Google Drive account '" + folder_name + "' is not connected. Showing local files only.",
                    NotificationType::INFO,
                    8.0f
                );
                state.last_disconnected_notification_folder = folder_name;
            }

            if (!mapping) {
                if (!fs::exists(target_path)) {
                    state.error_msg = "Path does not exist: " + target_path;
                    return;
                }
                if (!fs::is_directory(target_path)) {
                    state.error_msg = "Path is not a directory: " + target_path;
                    return;
                }
                navigate_to_local_path(state, target_path, update_history);
                return;
            }
        } else {
            state.last_disconnected_notification_folder.clear();
        }

        if (!mapping) {
            state.error_msg = "Account not found: " + folder_name;
            return;
        }

        if (create_if_missing) {
            std::error_code ec;
            fs::create_directories(target_path, ec);
            if (ec) {
                state.error_msg = "Failed to create directory: " + target_path;
                return;
            }
        } else {
            if (!fs::exists(target_path)) {
                state.error_msg = "Path does not exist: " + target_path;
                return;
            }
            if (!fs::is_directory(target_path)) {
                state.error_msg = "Path is not a directory: " + target_path;
                return;
            }
        }

        std::string folder_id = resolve_gd_folder_id_from_cache(*mapping, relative_path);

        update_navigation_history(state, target_path, update_history);
        set_active_path(state, target_path);
        reset_selection(state);
        state.error_msg = "";

        // Try to load from cache first
        std::vector<GDriveItem> cached_items;
        if (load_gd_items_from_cache(mapping->gd_user_id, folder_id, cached_items)) {
            std::vector<UnifiedFileItem> files;
            for (const auto& gd_item : cached_items) {
                UnifiedFileItem item;
                item.name = gd_item.name;
                item.path = target_path + "/" + gd_item.name;
                item.is_dir = gd_item.is_folder;
                item.size = gd_item.size;
                item.last_modified = gd_item.modified_time.length() >= 10
                                     ? gd_item.modified_time.substr(0, 10) : "";
                item.source = FileSource::GDRIVE;
                item.gd_item_id = gd_item.id;
                item.gd_user_id = gd_item.gd_user_id;
                item.gd_mime_type = gd_item.mime_type;
                item.gd_web_url = gd_item.web_url;
                files.push_back(item);
            }
            state.files = std::move(files);
            state.is_loading = false;
        } else {
            state.files.clear();
            state.is_loading = true;
        }

        fetch_gdrive_folder(*mapping, folder_id, target_path);
    }

    std::string FileExplorerPanel::resolve_gd_folder_id_from_cache(const GDAccountMapping& account,
                                                                     const std::string& relative_path) {
        if (relative_path.empty()) {
            return "root";
        }

        auto components = path_utils::split_path(relative_path);
        std::string folder_id = "root";

        for (const auto& name : components) {
            std::vector<GDriveItem> items;
            if (!load_gd_items_from_cache(account.gd_user_id, folder_id, items)) {
                return folder_id;
            }

            bool found = false;
            for (const auto& item : items) {
                if (item.is_folder && item.name == name) {
                    folder_id = item.id;
                    found = true;
                    break;
                }
            }

            if (!found) {
                return folder_id;
            }
        }

        return folder_id;
    }

    void FileExplorerPanel::fetch_gdrive_folder(const GDAccountMapping& account,
                                                  const std::string& folder_id,
                                                  const std::string& target_path) {
        auto& services = registry_.get_state<ServicesState>("Services");
        std::string gd_user_id = account.gd_user_id;

        services.fetch_gdrive_files(gd_user_id, folder_id,
            [this, gd_user_id, folder_id, target_path](bool success,
                                                         const std::string& body,
                                                         const std::string& error) {
                handle_folder_fetch({FileSource::GDRIVE, gd_user_id, folder_id, ""}, target_path, success, body, error);
            });
    }

    void FileExplorerPanel::download_and_open_gd_file(const UnifiedFileItem& file) {
        auto& state = registry_.get_state<FileExplorerState>("Files");
        auto& services = registry_.get_state<ServicesState>("Services");
        auto& downloads = registry_.get_state<DownloadState>("Downloads");
        auto& notifications = registry_.get_state<NotificationState>("Notifications");

        state.downloading_files.insert(file.path);

        uint64_t download_id = downloads.start_download(
            file.name,
            file.path,
            "Google Drive",
            file.size
        );

        uint64_t notif_id = notifications.add_notification(
            "Downloading",
            file.name,
            NotificationType::DOWNLOAD,
            15.0f
        );

        services.download_gd_file(
            file.gd_user_id,
            file.gd_item_id,
            file.path,
            [this, download_id](size_t bytes_downloaded, size_t /*total_bytes*/) -> bool {
                auto& downloads = registry_.get_state<DownloadState>("Downloads");
                downloads.update_progress(download_id, static_cast<int64_t>(bytes_downloaded));
                return true;
            },
            [this, path = file.path, file_name = file.name, download_id, notif_id](
                bool success, const std::string& local_path, const std::string& error) {

                auto& state = registry_.get_state<FileExplorerState>("Files");
                auto& downloads = registry_.get_state<DownloadState>("Downloads");
                auto& notifications = registry_.get_state<NotificationState>("Notifications");

                state.downloading_files.erase(path);
                notifications.dismiss(notif_id);

                if (success) {
                    downloads.complete_download(download_id);
                    notifications.add_notification(
                        "Download Complete",
                        file_name,
                        NotificationType::SUCCESS,
                        5.0f
                    );
                    open_file(local_path);
                } else {
                    downloads.fail_download(download_id, error);
                    notifications.add_notification(
                        "Download Failed",
                        file_name + ": " + error,
                        NotificationType::ERROR,
                        5.0f
                    );
                    state.error_msg = "Download failed: " + error;
                }
            }
        );
    }

    void FileExplorerPanel::download_and_open_file(const UnifiedFileItem& file) {
        auto& state = registry_.get_state<FileExplorerState>("Files");
        auto& services = registry_.get_state<ServicesState>("Services");
        auto& downloads = registry_.get_state<DownloadState>("Downloads");
        auto& notifications = registry_.get_state<NotificationState>("Notifications");

        // Mark as downloading in file explorer state
        state.downloading_files.insert(file.path);

        // Register download in download state
        uint64_t download_id = downloads.start_download(
            file.name,
            file.path,
            "OneDrive",
            file.size
        );

        // Show notification and store ID to dismiss later
        uint64_t notif_id = notifications.add_notification(
            "Downloading",
            file.name,
            NotificationType::DOWNLOAD,
            15.0f
        );

        // Download the file
        services.download_file(
            file.od_ms_user_id,
            file.od_drive_id,
            file.od_item_id,
            file.path,
            [this, download_id](size_t bytes_downloaded, size_t /*total_bytes*/) -> bool {
                auto& downloads = registry_.get_state<DownloadState>("Downloads");
                downloads.update_progress(download_id, static_cast<int64_t>(bytes_downloaded));
                return true;
            },
            [this, path = file.path, file_name = file.name, download_id, notif_id](
                bool success, const std::string& local_path, const std::string& error) {

                auto& state = registry_.get_state<FileExplorerState>("Files");
                auto& downloads = registry_.get_state<DownloadState>("Downloads");
                auto& notifications = registry_.get_state<NotificationState>("Notifications");

                // Remove from downloading set
                state.downloading_files.erase(path);

                // Dismiss the "Downloading" notification
                notifications.dismiss(notif_id);

                if (success) {
                    // Update download state
                    downloads.complete_download(download_id);

                    // Show success notification
                    notifications.add_notification(
                        "Download Complete",
                        file_name,
                        NotificationType::SUCCESS,
                        5.0f
                    );

                    // Open the downloaded file
                    open_file(local_path);
                } else {
                    // Update download state
                    downloads.fail_download(download_id, error);

                    // Show error notification
                    notifications.add_notification(
                        "Download Failed",
                        file_name + ": " + error,
                        NotificationType::ERROR,
                        5.0f
                    );

                    state.error_msg = "Download failed: " + error;
                }
            }
        );
    }

    // ==================== Dropbox Navigation ====================


}
