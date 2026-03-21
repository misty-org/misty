#include "panels/file_explorer/file_explorer_panel.h"
#include "panels/activity/download_state.h"
#include "panels/notification/notification_state.h"
#include "panels/services/dropbox/dropbox_state.h"
#include "panels/services/services_state.h"
#include "panels/workspace/workspace_state.h"

namespace fs = std::filesystem;

namespace misty::panel {
    void FileExplorerPanel::sync_dbx_account_mappings() {
        auto& workspace = registry_.get_state<WorkspaceState>("Workspace");
        auto& services = registry_.get_state<ServicesState>("Services");

        workspace.ensure_directories();

        std::lock_guard<std::mutex> svc_lock(services.mu);

        workspace.dbx_account_mappings.clear();
        for (const auto& conn : services.dbx_connections) {
            if (!conn.is_authenticated) continue;

            DBXAccountMapping mapping;
            mapping.dbx_user_id = conn.profile.id;
            mapping.display_name = conn.profile.display_name;
            mapping.email = conn.profile.email;
            mapping.folder_name = mount_utils::derive_folder_name(conn.profile.email);

            mount_utils::ensure_dbx_account_directory(conn.profile.email);

            workspace.dbx_account_mappings.push_back(mapping);
        }
    }

    void FileExplorerPanel::navigate_to_dropbox_mount_root(bool update_history) {
        auto& state = registry_.get_state<FileExplorerState>("Files");
        auto& workspace = registry_.get_state<WorkspaceState>("Workspace");

        state.last_disconnected_notification_folder.clear();

        // Clear Dropbox upload context
        {
            auto& dropbox_state = registry_.get_state<DropboxState>("Dropbox");
            std::lock_guard<std::mutex> dbx_lock(dropbox_state.mu);
            dropbox_state.current_dbx_user_id.clear();
            dropbox_state.current_folder_path.clear();
        }

        sync_dbx_account_mappings();

        std::string new_path = path_utils::get_dropbox_root();

        update_navigation_history(state, new_path, update_history);

        std::vector<UnifiedFileItem> files;
        std::unordered_set<std::string> added_folders;

        // Add connected accounts from mappings
        for (const auto& mapping : workspace.dbx_account_mappings) {
            UnifiedFileItem item;
            item.name = mapping.folder_name;
            item.path = new_path + "/" + mapping.folder_name;
            item.is_dir = true;
            item.source = FileSource::DROPBOX;
            item.dbx_user_id = mapping.dbx_user_id;
            files.push_back(item);
            added_folders.insert(mapping.folder_name);
        }

        // Scan local Dropbox directory for folders without connected accounts
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

    void FileExplorerPanel::navigate_to_dropbox_account(const std::string& folder_name,
                                                         const std::string& relative_path,
                                                         bool update_history,
                                                         bool create_if_missing) {
        auto& state = registry_.get_state<FileExplorerState>("Files");
        auto& workspace = registry_.get_state<WorkspaceState>("Workspace");
        auto& services = registry_.get_state<ServicesState>("Services");

        bool is_connected = services.is_dbx_account_folder_connected(folder_name);

        DBXAccountMapping* mapping = workspace.find_dbx_account_by_folder(folder_name);
        if (!mapping) {
            sync_dbx_account_mappings();
            mapping = workspace.find_dbx_account_by_folder(folder_name);
        }

        std::string target_path = path_utils::get_dropbox_root() + "/" + folder_name;
        if (!relative_path.empty()) {
            target_path += "/" + relative_path;
        }

        if (!is_connected) {
            if (state.last_disconnected_notification_folder != folder_name) {
                auto& notifications = registry_.get_state<NotificationState>("Notifications");
                notifications.add_notification(
                    "Account Not Connected",
                    "The Dropbox account '" + folder_name + "' is not connected. Showing local files only.",
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

        // For Dropbox, folder_path is relative to the Dropbox root
        // e.g., relative_path = "Documents/Photos" → folder_path = "/Documents/Photos"
        // Empty relative_path → folder_path = "" (root)
        std::string dbx_folder_path = "";
        if (!relative_path.empty()) {
            dbx_folder_path = "/" + relative_path;
        }

        update_navigation_history(state, target_path, update_history);
        set_active_path(state, target_path);
        reset_selection(state);
        state.error_msg = "";

        // Try to load from cache first
        std::vector<DropboxItem> cached_items;
        if (load_dbx_items_from_cache(mapping->dbx_user_id, dbx_folder_path, cached_items)) {
            std::vector<UnifiedFileItem> files;
            for (const auto& dbx_item : cached_items) {
                UnifiedFileItem item;
                item.name = dbx_item.name;
                item.path = target_path + "/" + dbx_item.name;
                item.is_dir = dbx_item.is_folder;
                item.size = dbx_item.size;
                item.last_modified = dbx_item.server_modified.length() >= 10
                                     ? dbx_item.server_modified.substr(0, 10) : "";
                item.source = FileSource::DROPBOX;
                item.dbx_item_id = dbx_item.id;
                item.dbx_user_id = dbx_item.dbx_user_id;
                item.dbx_path_display = dbx_item.path_display;
                files.push_back(item);
            }
            state.files = std::move(files);
            state.is_loading = false;
        } else {
            state.files.clear();
            state.is_loading = true;
        }

        fetch_dropbox_folder(*mapping, dbx_folder_path, target_path);
    }

    void FileExplorerPanel::fetch_dropbox_folder(const DBXAccountMapping& account,
                                                   const std::string& folder_path,
                                                   const std::string& target_path) {
        auto& services = registry_.get_state<ServicesState>("Services");
        std::string dbx_user_id = account.dbx_user_id;

        services.fetch_dropbox_files(dbx_user_id, folder_path,
            [this, dbx_user_id, folder_path, target_path](bool success,
                                                            const std::string& body,
                                                            const std::string& error) {
                handle_folder_fetch({FileSource::DROPBOX, dbx_user_id, folder_path, ""}, target_path, success, body, error);
            });
    }

    void FileExplorerPanel::download_and_open_dbx_file(const UnifiedFileItem& file) {
        auto& state = registry_.get_state<FileExplorerState>("Files");
        auto& services = registry_.get_state<ServicesState>("Services");
        auto& downloads = registry_.get_state<DownloadState>("Downloads");
        auto& notifications = registry_.get_state<NotificationState>("Notifications");

        state.downloading_files.insert(file.path);

        uint64_t download_id = downloads.start_download(
            file.name,
            file.path,
            "Dropbox",
            file.size
        );

        uint64_t notif_id = notifications.add_notification(
            "Downloading",
            file.name,
            NotificationType::DOWNLOAD,
            15.0f
        );

        services.download_dbx_file(
            file.dbx_user_id,
            file.dbx_path_display,
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

    // ==================== iCloud Navigation ====================


}
