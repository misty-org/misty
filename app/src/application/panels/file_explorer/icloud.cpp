#include "panels/file_explorer/file_explorer_panel.h"
#include "panels/activity/download_state.h"
#include "panels/notification/notification_state.h"
#include "panels/services/icloud/icloud_state.h"
#include "panels/services/services_state.h"
#include "panels/workspace/workspace_state.h"

namespace fs = std::filesystem;

namespace misty::panel {
    void FileExplorerPanel::sync_icl_account_mappings() {
        auto& workspace = registry_.get_state<WorkspaceState>("Workspace");
        auto& services = registry_.get_state<ServicesState>("Services");

        workspace.ensure_directories();

        std::lock_guard<std::mutex> svc_lock(services.mu);

        workspace.icl_account_mappings.clear();
        for (const auto& conn : services.icl_connections) {
            if (!conn.is_authenticated) continue;

            ICLAccountMapping mapping;
            mapping.email = conn.profile.email;
            mapping.folder_name = mount_utils::derive_folder_name(conn.profile.email);

            mount_utils::ensure_icl_account_directory(conn.profile.email);

            workspace.icl_account_mappings.push_back(mapping);
        }
    }

    void FileExplorerPanel::navigate_to_icloud_mount_root(bool update_history) {
        auto& state = registry_.get_state<FileExplorerState>("Files");
        auto& workspace = registry_.get_state<WorkspaceState>("Workspace");

        state.last_disconnected_notification_folder.clear();

        // Clear iCloud context since we're at account list level
        {
            auto& icloud_state = registry_.get_state<ICloudState>("iCloud");
            std::lock_guard<std::mutex> icl_lock(icloud_state.mu);
            icloud_state.current_email.clear();
            icloud_state.current_folder_path.clear();
        }

        sync_icl_account_mappings();

        std::string new_path = path_utils::get_icloud_root();

        update_navigation_history(state, new_path, update_history);

        std::vector<UnifiedFileItem> files;
        std::unordered_set<std::string> added_folders;

        // Add connected accounts from mappings
        for (const auto& mapping : workspace.icl_account_mappings) {
            UnifiedFileItem item;
            item.name = mapping.folder_name;
            item.path = new_path + "/" + mapping.folder_name;
            item.is_dir = true;
            item.source = FileSource::ICLOUD;
            item.icl_email = mapping.email;
            files.push_back(item);
            added_folders.insert(mapping.folder_name);
        }

        // Scan local iCloud directory for folders without connected accounts
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

    void FileExplorerPanel::navigate_to_icloud_account(const std::string& folder_name,
                                                         const std::string& relative_path,
                                                         bool update_history,
                                                         bool create_if_missing) {
        auto& state = registry_.get_state<FileExplorerState>("Files");
        auto& workspace = registry_.get_state<WorkspaceState>("Workspace");
        auto& services = registry_.get_state<ServicesState>("Services");

        bool is_connected = services.is_icl_account_folder_connected(folder_name);

        ICLAccountMapping* mapping = workspace.find_icl_account_by_folder(folder_name);
        if (!mapping) {
            sync_icl_account_mappings();
            mapping = workspace.find_icl_account_by_folder(folder_name);
        }

        std::string target_path = path_utils::get_icloud_root() + "/" + folder_name;
        if (!relative_path.empty()) {
            target_path += "/" + relative_path;
        }

        if (!is_connected) {
            if (state.last_disconnected_notification_folder != folder_name) {
                auto& notifications = registry_.get_state<NotificationState>("Notifications");
                notifications.add_notification(
                    "Account Not Connected",
                    "The iCloud account '" + folder_name + "' is not connected. Showing local files only.",
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
        }

        // iCloud folder path is relative_path (e.g., "Documents/Photos")
        std::string icl_folder_path = relative_path; // empty = root

        update_navigation_history(state, target_path, update_history);
        set_active_path(state, target_path);
        reset_selection(state);
        state.error_msg = "";

        // Try to load from cache first
        std::vector<ICloudItem> cached_items;
        if (load_icl_items_from_cache(mapping->email, icl_folder_path, cached_items)) {
            std::vector<UnifiedFileItem> files;
            for (const auto& icl_item : cached_items) {
                UnifiedFileItem item;
                item.name = icl_item.name;
                item.path = target_path + "/" + icl_item.name;
                item.is_dir = icl_item.is_folder;
                item.source = FileSource::ICLOUD;
                item.icl_email = icl_item.email;
                item.icl_path_display = icl_item.path;
                files.push_back(item);
            }
            state.files = std::move(files);
            state.is_loading = false;
        } else {
            state.files.clear();
            state.is_loading = true;
        }

        fetch_icloud_folder(*mapping, icl_folder_path, target_path);
    }

    void FileExplorerPanel::fetch_icloud_folder(const ICLAccountMapping& account,
                                                  const std::string& icl_folder_path,
                                                  const std::string& target_path) {
        auto& services = registry_.get_state<ServicesState>("Services");
        std::string email = account.email;

        services.fetch_icloud_files(email, icl_folder_path,
            [this, email, icl_folder_path, target_path](bool success,
                                                          const std::string& body,
                                                          const std::string& error) {
                handle_folder_fetch({FileSource::ICLOUD, email, icl_folder_path, ""}, target_path, success, body, error);
            });
    }

    void FileExplorerPanel::download_and_open_icl_file(const UnifiedFileItem& file) {
        auto& state = registry_.get_state<FileExplorerState>("Files");
        auto& services = registry_.get_state<ServicesState>("Services");
        auto& downloads = registry_.get_state<DownloadState>("Downloads");
        auto& notifications = registry_.get_state<NotificationState>("Notifications");

        state.downloading_files.insert(file.path);

        uint64_t download_id = downloads.start_download(
            file.name,
            file.path,
            "iCloud",
            file.size
        );

        uint64_t notif_id = notifications.add_notification(
            "Downloading",
            file.name,
            NotificationType::DOWNLOAD,
            15.0f
        );

        // Split icl_path_display into folder_path + filename
        std::string icl_filename = file.name;
        std::string icl_folder;
        size_t slash = file.icl_path_display.rfind('/');
        if (slash != std::string::npos) {
            icl_folder = file.icl_path_display.substr(0, slash);
        }

        services.download_icl_file(
            file.icl_email,
            icl_filename,
            icl_folder,
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


}
