#include "panels/file_explorer/file_explorer_panel.h"
#include "panels/services/services_state.h"
#include "panels/services/remote/remote_state.h"
#include "panels/activity/download_state.h"
#include "panels/notification/notification_state.h"
#include "panels/workspace/workspace_state.h"
#include "core/cache/listing_cache.h"
#include <nlohmann/json.hpp>
#include <cstdio>
#include <set>

namespace fs = std::filesystem;

namespace misty::panel {

    // Navigate to ~/misty/mnt/ — show one entry per provider type
    void FileExplorerPanel::navigate_to_remote_mount_root(bool update_history) {
        auto& state = registry_.get_state<FileExplorerState>("Files");
        auto& workspace = registry_.get_state<WorkspaceState>("Workspace");

        std::string mount_root = path_utils::get_mount_root();

        state.is_loading = true;
        state.show_loading_animation = false;
        state.files.clear();

        sync_account_mappings();

        // Collect unique provider folders
        std::set<std::string> seen;
        for (const auto& mapping : workspace.remote_mappings) {
            if (seen.count(mapping.provider_folder)) continue;
            seen.insert(mapping.provider_folder);

            UnifiedFileItem item;
            item.name = mapping.provider_folder;
            item.path = mount_root + "/" + mapping.provider_folder;
            item.is_dir = true;
            item.source = FileSource::REMOTE;
            item.status = SyncStatus::SYNCED;
            state.files.push_back(item);
        }

        update_navigation_history(state, mount_root, update_history);
        set_active_path(state, mount_root);
        reset_selection(state);
        state.is_loading = false;
        state.show_loading_animation = false;

        auto& remote_state = registry_.get_state<RemoteState>("Remote");
        remote_state.clear_upload_context();
    }

    // Navigate to ~/misty/mnt/OneDrive/ — show remotes of this provider type
    void FileExplorerPanel::navigate_to_provider_folder(const std::string& provider_folder, bool update_history) {
        auto& state = registry_.get_state<FileExplorerState>("Files");
        auto& workspace = registry_.get_state<WorkspaceState>("Workspace");

        std::string mount_root = path_utils::get_mount_root();
        std::string target_path = mount_root + "/" + provider_folder;

        state.is_loading = true;
        state.show_loading_animation = false;
        state.files.clear();

        sync_account_mappings();

        // Collect remotes matching this provider folder
        std::vector<const RemoteAccountMapping*> matches;
        for (const auto& mapping : workspace.remote_mappings) {
            if (mapping.provider_folder == provider_folder) {
                matches.push_back(&mapping);
            }
        }

        // Always show the account listing here, even when there's only one
        // account connected. Skipping straight into the lone account makes
        // navigation behavior depend on how many remotes exist, which is
        // confusing — clicking "Google Drive" should always land on the
        // account list page regardless of count.
        for (const auto* mapping : matches) {
            UnifiedFileItem item;
            item.name = mapping->folder_name;
            item.path = target_path + "/" + mapping->folder_name;
            item.is_dir = true;
            item.source = FileSource::REMOTE;
            item.status = SyncStatus::SYNCED;
            item.remote_name = mapping->remote_name;
            state.files.push_back(item);
        }

        update_navigation_history(state, target_path, update_history);
        set_active_path(state, target_path);
        reset_selection(state);
        state.is_loading = false;
        state.show_loading_animation = false;

        auto& remote_state = registry_.get_state<RemoteState>("Remote");
        remote_state.clear_upload_context();
    }

    void FileExplorerPanel::navigate_to_remote(const std::string& remote_name,
                                                 const std::string& path,
                                                 bool update_history,
                                                 bool create_if_missing,
                                                 uint64_t navigation_generation) {
        auto& state = registry_.get_state<FileExplorerState>("Files");
        auto& services = registry_.get_state<ServicesState>("Services");
        auto& workspace = registry_.get_state<WorkspaceState>("Workspace");

        std::string resolved_remote_name = remote_name;
        std::string folder_name = remote_name;
        for (const auto& mapping : workspace.remote_mappings) {
            if (mapping.remote_name == remote_name || mapping.folder_name == remote_name) {
                resolved_remote_name = mapping.remote_name;
                folder_name = mapping.folder_name;
                break;
            }
        }

        // Check if the remote is connected
        if (!services.is_remote_connected(resolved_remote_name)) {
            if (state.last_disconnected_notification_folder != resolved_remote_name) {
                state.last_disconnected_notification_folder = resolved_remote_name;
                auto& notifications = registry_.get_state<NotificationState>("Notifications");
                notifications.add_notification(
                    "Not Connected",
                    "Remote '" + resolved_remote_name + "' is not connected. Go to Services to connect.",
                    NotificationType::ERROR,
                    5.0f
                );
            }
            navigate_to_remote_mount_root(update_history);
            return;
        }

        // Find the provider folder for this remote
        std::string provider_folder;
        for (const auto& mapping : workspace.remote_mappings) {
            if (mapping.remote_name == resolved_remote_name) {
                provider_folder = mapping.provider_folder;
                folder_name = mapping.folder_name;
                break;
            }
        }

        std::string mount_root = path_utils::get_mount_root();
        std::string target_path = mount_root + "/" + provider_folder + "/" + folder_name;
        if (!path.empty()) {
            target_path += "/" + path;
        }

        // Ensure the mount directory exists locally
        if (create_if_missing && !provider_folder.empty()) {
            mount_utils::ensure_remote_directory(provider_folder, folder_name);
        }

        // Set upload context
        auto& remote_state = registry_.get_state<RemoteState>("Remote");
        remote_state.set_upload_context(resolved_remote_name, path);

        // Fetch files from remote via proxy
        fetch_remote_folder(resolved_remote_name, path, target_path, navigation_generation);

        update_navigation_history(state, target_path, update_history);
        set_active_path(state, target_path);
    }

    void FileExplorerPanel::fetch_remote_folder(const std::string& remote_name,
                                                  const std::string& remote_path,
                                                  const std::string& target_path,
                                                  uint64_t navigation_generation) {
        auto& state = registry_.get_state<FileExplorerState>("Files");

        printf("fetch_remote_folder: remote=%s path=%s target=%s\n",
               remote_name.c_str(), remote_path.c_str(), target_path.c_str());

        // Mark loading immediately on the UI thread so the next render shows
        // a loading animation. The cache check below runs on a worker, so we don't yet
        // know whether we'll get an instant cache hit — being optimistic and
        // showing the animation for one frame is fine.
        //
        // NOTE: Do NOT take state.mu here. This function is reached from click
        // handlers inside the panel's render(), which already holds state.mu
        // for the entire render scope (file_explorer_panel.cpp:257). Acquiring
        // it again would self-deadlock the UI thread (std::mutex is non-recursive).
        // The convention used by navigate_to_local_path_async is the same:
        // UI thread writes is_loading without a lock; worker clears it under
        // the lock when results land.
        state.is_loading = true;
        state.show_loading_animation = true;
        state.error_msg.clear();

        // Stale-while-revalidate, fully off the UI thread:
        //   1. Worker thread loads cache (disk I/O) and, on hit, parses + applies
        //      the cached body via handle_remote_folder_fetch().
        //   2. Worker thread then kicks off services.fetch_files(), which itself
        //      runs on a worker and whose callback is also on a worker thread —
        //      so the network response, cache save, and final parse all stay
        //      off the UI thread.
        worker_pool_.add(
            [this, remote_name, remote_path, target_path, navigation_generation]() {
                auto& services = registry_.get_state<ServicesState>("Services");

                std::string cached_body;
                bool had_cache = core::listing_cache::load(remote_name, remote_path, cached_body);
                if (had_cache) {
                    handle_remote_folder_fetch(remote_name, target_path, navigation_generation, true, cached_body, "");
                }

                services.fetch_files(remote_name, remote_path,
                    [this, remote_name, remote_path, target_path, had_cache, navigation_generation]
                    (bool success, const std::string& body, const std::string& error) {
                        if (success) {
                            core::listing_cache::save(remote_name, remote_path, body);
                            handle_remote_folder_fetch(remote_name, target_path, navigation_generation, true, body, "");
                        } else if (!had_cache) {
                            // No cache to fall back on — surface the error.
                            handle_remote_folder_fetch(remote_name, target_path, navigation_generation, false, "", error);
                        } else {
                            // Already showed cached content; revalidation failed silently.
                            printf("revalidate failed for %s/%s: %s\n",
                                   remote_name.c_str(), remote_path.c_str(), error.c_str());
                        }
                    });
            },
            []() {},
            [this, target_path, navigation_generation](const std::string& err) {
                handle_remote_folder_fetch("", target_path, navigation_generation, false, "", err);
            }
        );
    }

    void FileExplorerPanel::handle_remote_folder_fetch(const std::string& remote_name,
                                                         const std::string& target_path,
                                                         uint64_t navigation_generation,
                                                         bool success,
                                                         const std::string& body,
                                                         const std::string& error) {
        auto& state = registry_.get_state<FileExplorerState>("Files");

        if (!success) {
            printf("handle_remote_folder_fetch FAILED: %s\n", error.c_str());
            std::lock_guard<std::mutex> lock(state.mu);
            if (state.navigation_generation.load(std::memory_order_relaxed) != navigation_generation ||
                std::string(state.current_path) != target_path) {
                return;
            }
            state.error_msg = "Failed to list remote: " + error;
            state.is_loading = false;
            state.show_loading_animation = false;
            return;
        }

        try {
            auto json = nlohmann::json::parse(body);
            auto items_json = json.value("items", nlohmann::json::array());
            std::string resp_remote = json.value("remote", remote_name);
            std::string resp_path = json.value("path", std::string(""));

            // Look up provider folder for constructing local paths
            auto& workspace = registry_.get_state<WorkspaceState>("Workspace");
            std::string provider_folder;
            std::string folder_name = resp_remote;
            for (const auto& mapping : workspace.remote_mappings) {
                if (mapping.remote_name == resp_remote) {
                    provider_folder = mapping.provider_folder;
                    folder_name = mapping.folder_name;
                    break;
                }
            }

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
                item.path = path_utils::get_mount_root() + "/" + provider_folder + "/" + folder_name + "/" + item_remote_path;

                // Parse mod_time
                std::string mod_time = item_json.value("mod_time", std::string(""));
                if (!mod_time.empty() && mod_time.size() >= 16) {
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

            printf("handle_remote_folder_fetch: got %zu items for %s\n", new_files.size(), resp_remote.c_str());

            std::lock_guard<std::mutex> lock(state.mu);
            if (state.navigation_generation.load(std::memory_order_relaxed) != navigation_generation ||
                std::string(state.current_path) != target_path) {
                return;
            }
            state.files = std::move(new_files);
            reset_selection(state);
            state.is_loading = false;
            state.show_loading_animation = false;
            state.error_msg.clear();
        } catch (const std::exception& e) {
            printf("handle_remote_folder_fetch PARSE ERROR: %s\n", e.what());
            std::lock_guard<std::mutex> lock(state.mu);
            if (state.navigation_generation.load(std::memory_order_relaxed) != navigation_generation ||
                std::string(state.current_path) != target_path) {
                return;
            }
            state.error_msg = std::string("Failed to parse remote response: ") + e.what();
            state.is_loading = false;
            state.show_loading_animation = false;
        }
    }

    void FileExplorerPanel::download_remote_file(const UnifiedFileItem& file) {
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
