#include "panels/file_explorer/file_explorer_panel.h"
#include "panels/services/services_state.h"
#include "panels/services/remote/remote_state.h"
#include "panels/activity/download_state.h"
#include "panels/notification/notification_state.h"
#include "panels/workspace/workspace_state.h"
#include <nlohmann/json.hpp>
#include <cstdio>

namespace fs = std::filesystem;

namespace misty::panel {

    void FileExplorerPanel::navigate_to_remote_mount_root(bool update_history) {
        auto& state = registry_.get_state<FileExplorerState>("Files");
        auto& workspace = registry_.get_state<WorkspaceState>("Workspace");

        std::string mount_root = path_utils::get_mount_root();

        state.is_loading = true;
        state.files.clear();

        // Sync mappings first
        sync_account_mappings();

        // Create a virtual folder entry for each connected remote
        for (const auto& mapping : workspace.remote_mappings) {
            UnifiedFileItem item;
            item.name = mapping.folder_name;
            item.path = mount_root + "/" + mapping.folder_name;
            item.is_dir = true;
            item.source = FileSource::REMOTE;
            item.status = SyncStatus::SYNCED;
            item.remote_name = mapping.remote_name;
            state.files.push_back(item);
        }

        update_navigation_history(state, mount_root, update_history);
        set_active_path(state, mount_root);
        reset_selection(state);
        state.is_loading = false;

        // Clear upload context when at mount root
        auto& remote_state = registry_.get_state<RemoteState>("Remote");
        remote_state.clear_upload_context();
    }

    void FileExplorerPanel::navigate_to_remote(const std::string& remote_name,
                                                 const std::string& path,
                                                 bool update_history,
                                                 bool create_if_missing) {
        auto& state = registry_.get_state<FileExplorerState>("Files");
        auto& services = registry_.get_state<ServicesState>("Services");

        // Check if the remote is connected
        if (!services.is_remote_connected(remote_name)) {
            // Show notification if we haven't already for this folder
            if (state.last_disconnected_notification_folder != remote_name) {
                state.last_disconnected_notification_folder = remote_name;
                auto& notifications = registry_.get_state<NotificationState>("Notifications");
                notifications.add_notification(
                    "Not Connected",
                    "Remote '" + remote_name + "' is not connected. Go to Services to connect.",
                    NotificationType::ERROR,
                    5.0f
                );
            }
            navigate_to_remote_mount_root(update_history);
            return;
        }

        std::string mount_root = path_utils::get_mount_root();
        std::string target_path = mount_root + "/" + remote_name;
        if (!path.empty()) {
            target_path += "/" + path;
        }

        // Ensure the mount directory exists locally
        if (create_if_missing) {
            mount_utils::ensure_remote_directory(remote_name);
        }

        // Set upload context
        auto& remote_state = registry_.get_state<RemoteState>("Remote");
        remote_state.set_upload_context(remote_name, path);

        // Fetch files from remote via proxy
        fetch_remote_folder(remote_name, path, target_path);

        update_navigation_history(state, target_path, update_history);
        set_active_path(state, target_path);
    }

    void FileExplorerPanel::fetch_remote_folder(const std::string& remote_name,
                                                  const std::string& remote_path,
                                                  const std::string& target_path) {
        auto& state = registry_.get_state<FileExplorerState>("Files");
        auto& services = registry_.get_state<ServicesState>("Services");

        state.is_loading = true;
        state.error_msg.clear();

        services.fetch_files(remote_name, remote_path,
            [this, remote_name, target_path](bool success, const std::string& body, const std::string& error) {
                handle_remote_folder_fetch(remote_name, target_path, success, body, error);
            });
    }

    void FileExplorerPanel::handle_remote_folder_fetch(const std::string& remote_name,
                                                         const std::string& target_path,
                                                         bool success,
                                                         const std::string& body,
                                                         const std::string& error) {
        auto& state = registry_.get_state<FileExplorerState>("Files");

        if (!success) {
            std::lock_guard<std::mutex> lock(state.mu);
            state.error_msg = "Failed to list remote: " + error;
            state.is_loading = false;
            return;
        }

        try {
            auto json = nlohmann::json::parse(body);
            auto items_json = json.value("items", nlohmann::json::array());
            std::string resp_remote = json.value("remote", remote_name);
            std::string resp_path = json.value("path", std::string(""));

            std::vector<UnifiedFileItem> new_files;
            for (const auto& item_json : items_json) {
                UnifiedFileItem item;
                item.name = item_json.value("name", std::string(""));
                item.is_dir = item_json.value("is_dir", false);
                item.size = item_json.value("size", int64_t(0));
                item.mime_type = item_json.value("mime_type", std::string(""));
                item.source = FileSource::REMOTE;
                item.status = SyncStatus::NOT_SYNCED;
                item.remote_name = resp_remote;

                // Build item paths
                std::string item_remote_path = item_json.value("path", std::string(""));
                item.remote_path = item_remote_path;
                item.path = path_utils::get_mount_root() + "/" + resp_remote + "/" + item_remote_path;

                // Parse mod_time
                std::string mod_time = item_json.value("mod_time", std::string(""));
                if (!mod_time.empty() && mod_time.size() >= 16) {
                    // ISO format: "2024-01-15T10:30:00Z" -> "2024-01-15 10:30"
                    item.last_modified = mod_time.substr(0, 10) + " " + mod_time.substr(11, 5);
                }

                // Check if file is synced locally
                if (!item.is_dir) {
                    std::error_code ec;
                    if (fs::exists(item.path, ec)) {
                        item.status = SyncStatus::SYNCED;
                    }
                }

                new_files.push_back(std::move(item));
            }

            std::lock_guard<std::mutex> lock(state.mu);
            state.files = std::move(new_files);
            reset_selection(state);
            state.is_loading = false;
            state.error_msg.clear();
        } catch (const std::exception& e) {
            std::lock_guard<std::mutex> lock(state.mu);
            state.error_msg = std::string("Failed to parse remote response: ") + e.what();
            state.is_loading = false;
        }
    }

    void FileExplorerPanel::download_and_open_remote_file(const UnifiedFileItem& file) {
        auto& services = registry_.get_state<ServicesState>("Services");
        auto& downloads = registry_.get_state<DownloadState>("Downloads");
        auto& notifications = registry_.get_state<NotificationState>("Notifications");
        auto& state = registry_.get_state<FileExplorerState>("Files");

        // Mark as downloading
        state.downloading_files.insert(file.path);

        // Ensure local directory exists
        std::string local_path = file.path;
        std::error_code ec;
        fs::create_directories(fs::path(local_path).parent_path(), ec);

        uint64_t download_id = downloads.start_download(
            file.name, local_path, file.remote_name, file.size);

        uint64_t notif_id = notifications.add_notification(
            "Downloading", file.name, NotificationType::DOWNLOAD, 15.0f);

        services.download_file(
            file.remote_name, file.remote_path, local_path,
            [this, download_id](size_t bytes_downloaded, size_t) -> bool {
                auto& downloads = registry_.get_state<DownloadState>("Downloads");
                downloads.update_progress(download_id, static_cast<int64_t>(bytes_downloaded));
                return true;
            },
            [this, file_name = file.name, file_path = file.path, download_id, notif_id](
                bool success, const std::string& local_path, const std::string& error) {
                auto& downloads = registry_.get_state<DownloadState>("Downloads");
                auto& notifications = registry_.get_state<NotificationState>("Notifications");
                auto& state = registry_.get_state<FileExplorerState>("Files");

                notifications.dismiss(notif_id);
                state.downloading_files.erase(file_path);

                if (success) {
                    downloads.complete_download(download_id);
                    notifications.add_notification("Download Complete", file_name, NotificationType::SUCCESS, 5.0f);
                    core::open_path_default(local_path);

                    // Update sync status in file list
                    std::lock_guard<std::mutex> lock(state.mu);
                    for (auto& f : state.files) {
                        if (f.path == file_path) {
                            f.status = SyncStatus::SYNCED;
                            break;
                        }
                    }
                } else {
                    downloads.fail_download(download_id, error);
                    notifications.add_notification("Download Failed", file_name + ": " + error, NotificationType::ERROR, 5.0f);
                }
            });
    }

}
