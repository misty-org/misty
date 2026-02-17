#include "panels/file_explorer/file_explorer_panel.h"
#include "panels/services/services_state.h"
#include "panels/services/remote/remote_state.h"
#include "panels/activity/download_state.h"
#include "panels/activity/activity_state.h"
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
        auto& state = registry_.get_state<FileExplorerState>(state_key_);
        auto& workspace = registry_.get_state<WorkspaceState>("Workspace");

        std::string mount_root = path_utils::get_mount_root();

        sync_account_mappings();

        // Collect unique provider folders
        std::set<std::string> seen;
        std::vector<UnifiedFileItem> new_files;
        for (const auto& mapping : workspace.remote_mappings) {
            if (seen.count(mapping.provider_folder)) continue;
            seen.insert(mapping.provider_folder);

            UnifiedFileItem item;
            item.name = mapping.provider_folder;
            item.path = mount_root + "/" + mapping.provider_folder;
            item.id = make_file_id(item.path, true);
            item.is_dir = true;
            item.source = FileSource::REMOTE;
            item.status = SyncStatus::SYNCED;
            new_files.push_back(std::move(item));
        }

        update_navigation_history(state, mount_root, update_history);
        state.files = std::move(new_files);
        set_active_path(state, mount_root);
        state.current_dir_watched = false;
        reset_selection(state);
        state.is_loading = false;
        state.show_loading_animation = false;
        state.sort_dirty = true;

        auto& remote_state = registry_.get_state<RemoteState>("Remote");
        remote_state.clear_upload_context();
    }

    // Navigate to ~/misty/mnt/OneDrive/ — show remotes of this provider type
    void FileExplorerPanel::navigate_to_provider_folder(const std::string& provider_folder, bool update_history) {
        auto& state = registry_.get_state<FileExplorerState>(state_key_);
        auto& workspace = registry_.get_state<WorkspaceState>("Workspace");

        std::string mount_root = path_utils::get_mount_root();
        std::string target_path = mount_root + "/" + provider_folder;

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
        std::vector<UnifiedFileItem> new_files;
        for (const auto* mapping : matches) {
            UnifiedFileItem item;
            item.name = mapping->folder_name;
            item.path = target_path + "/" + mapping->folder_name;
            item.id = make_file_id(item.path, true);
            item.is_dir = true;
            item.source = FileSource::REMOTE;
            item.status = SyncStatus::SYNCED;
            item.remote_name = mapping->remote_name;
            new_files.push_back(std::move(item));
        }

        update_navigation_history(state, target_path, update_history);
        state.files = std::move(new_files);
        set_active_path(state, target_path);
        state.current_dir_watched = false;
        reset_selection(state);
        state.is_loading = false;
        state.show_loading_animation = false;
        state.sort_dirty = true;

        auto& remote_state = registry_.get_state<RemoteState>("Remote");
        remote_state.clear_upload_context();
    }

    void FileExplorerPanel::navigate_to_remote(const std::string& remote_name,
                                                 const std::string& path,
                                                 bool update_history,
                                                 bool create_if_missing,
                                                 uint64_t navigation_generation) {
        auto& state = registry_.get_state<FileExplorerState>(state_key_);
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
                auto& activity = registry_.get_state<ActivityState>("Activity");
                activity.add_entry("System",
                    "Remote '" + resolved_remote_name + "' is not connected. Go to Services to connect.",
                    ActivityEntryType::ERROR);
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
        auto& state = registry_.get_state<FileExplorerState>(state_key_);

        // Mark loading immediately on the UI thread so interactions are blocked
        // while the listing resolves, but delay the spinner slightly so fast
        // cache hits don't flash the animation for a single frame.
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
        state.loading_animation_ready_at = std::chrono::steady_clock::now() + std::chrono::milliseconds(120);
        state.error_msg.clear();

        // Stale-while-revalidate, fully off the UI thread:
        //   1. Worker thread loads the cached indexed listing (disk I/O) and, on
        //      hit, parses + applies it via handle_remote_folder_fetch().
        //   2. Worker thread triggers POST /api/sync/refetch to update proxy-side
        //      metadata, then follows with GET /api/sync/list so UI reads come
        //      from indexed sync rows rather than the mutation response.
        worker_pool_.add(
            [registry = &registry_, state_key = state_key_, remote_name, remote_path, target_path, navigation_generation]() {
                auto& services = registry->get_state<ServicesState>("Services");

                std::string cached_body;
                bool had_cache = core::listing_cache::load(remote_name, remote_path, cached_body);
                if (had_cache) {
                    FileExplorerPanel::apply_remote_folder_fetch(
                        *registry, state_key, remote_name, target_path, navigation_generation, true, cached_body, "");
                }

                services.refetch_sync_items(remote_name, remote_path,
                    [registry, state_key, remote_name, remote_path, target_path, had_cache, navigation_generation]
                    (bool success, const std::string&, const std::string& error) {
                        if (!success) {
                            if (!had_cache) {
                                // No cache to fall back on — surface the error.
                                FileExplorerPanel::apply_remote_folder_fetch(
                                    *registry, state_key, remote_name, target_path, navigation_generation, false, "", error);
                            } else {
                                // Already showed cached content; revalidation failed silently.
                                printf("revalidate failed for %s/%s: %s\n",
                                       remote_name.c_str(), remote_path.c_str(), error.c_str());
                            }
                            return;
                        }

                        auto& services = registry->get_state<ServicesState>("Services");
                        services.fetch_sync_items(remote_name, remote_path,
                            [registry, state_key, remote_name, remote_path, target_path, had_cache, navigation_generation]
                            (bool list_success, const std::string& list_body, const std::string& list_error) {
                                if (list_success) {
                                    core::listing_cache::save(remote_name, remote_path, list_body);
                                    FileExplorerPanel::apply_remote_folder_fetch(
                                        *registry, state_key, remote_name, target_path, navigation_generation, true, list_body, "");
                                } else if (!had_cache) {
                                    FileExplorerPanel::apply_remote_folder_fetch(
                                        *registry, state_key, remote_name, target_path, navigation_generation, false, "", list_error);
                                } else {
                                    printf("sync list failed for %s/%s: %s\n",
                                           remote_name.c_str(), remote_path.c_str(), list_error.c_str());
                                }
                            });
                    });
            },
            []() {},
            [registry = &registry_, state_key = state_key_, target_path, navigation_generation](const std::string& err) {
                FileExplorerPanel::apply_remote_folder_fetch(
                    *registry, state_key, "", target_path, navigation_generation, false, "", err);
            }
        );
    }

    void FileExplorerPanel::handle_remote_folder_fetch(const std::string& remote_name,
                                                         const std::string& target_path,
                                                         uint64_t navigation_generation,
                                                         bool success,
                                                         const std::string& body,
                                                         const std::string& error,
                                                         bool preserve_selection) {
        apply_remote_folder_fetch(
            registry_, state_key_, remote_name, target_path, navigation_generation, success, body, error, preserve_selection);
    }

    void FileExplorerPanel::apply_remote_folder_fetch(core::UIRegistry& registry,
                                                      const std::string& state_key,
                                                      const std::string& remote_name,
                                                      const std::string& target_path,
                                                      uint64_t navigation_generation,
                                                      bool success,
                                                      const std::string& body,
                                                      const std::string& error,
                                                      bool preserve_selection) {
        auto& state = registry.get_state<FileExplorerState>(state_key);

        if (!success) {
            std::lock_guard<std::mutex> lock(state.mu);
            if (state.navigation_generation.load(std::memory_order_relaxed) != navigation_generation ||
                std::string(state.current_path) != target_path) {
                return;
            }
            state.error_msg = "Failed to list remote: " + error;
            state.is_loading = false;
            state.show_loading_animation = false;
            state.sort_dirty = true;
            return;
        }

        try {
            auto json = nlohmann::json::parse(body);
            auto items_json = json.value("items", nlohmann::json::array());
            std::string resp_remote = json.value("remote", remote_name);
            std::string resp_path = json.value("path", std::string(""));
            const bool watched = json.value("watched", false);
            // Look up provider folder for constructing local paths
            auto& workspace = registry.get_state<WorkspaceState>("Workspace");
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
                item.remote_name = resp_remote;
                item.state_code = item_json.value("state", std::string("REM"));
                item.sync_dirty = item_json.value("sync_dirty", false);
                item.sync_direction = item_json.value("sync_direction", std::string(""));

                // Build item paths
                std::string item_remote_path = item_json.value("path", std::string(""));
                item.remote_path = item_remote_path;
                item.path = item_json.value("local_path", std::string(""));
                if (item.path.empty()) {
                    item.path = path_utils::get_mount_root() + "/" + provider_folder + "/" + folder_name + "/" + item_remote_path;
                }
                item.id = make_file_id(item.path, true);

                if (item.state_code == "MOD") item.status = SyncStatus::MODIFIED;
                else if (item.state_code == "REM") item.status = SyncStatus::NOT_SYNCED;
                else item.status = SyncStatus::SYNCED;

                // Parse mod_time
                std::string mod_time = item_json.value("mod_time", std::string(""));
                if (!mod_time.empty() && mod_time.size() >= 16) {
                    item.last_modified = mod_time.substr(0, 10) + " " + mod_time.substr(11, 5);
                }

                new_files.push_back(std::move(item));
            }
            std::lock_guard<std::mutex> lock(state.mu);
            if (state.navigation_generation.load(std::memory_order_relaxed) != navigation_generation ||
                std::string(state.current_path) != target_path) {
                return;
            }
            std::unordered_set<std::string> selected_paths;
            if (preserve_selection) {
                for (const auto& sel_id : state.selected_files) {
                    selected_paths.insert(state.path_for_selection(sel_id));
                }
            }
            state.files = std::move(new_files);
            state.current_dir_watched = watched;
            state.sync_watch_request_in_flight = false;
            if (preserve_selection) {
                state.selected_files.clear();
                state.last_selected_index = -1;
                for (int index = 0; index < static_cast<int>(state.files.size()); ++index) {
                    if (selected_paths.count(state.files[index].path) == 0) {
                        continue;
                    }
                    state.selected_files.insert(state.files[index].id);
                    state.last_selected_index = index;
                }
            } else {
                state.selected_files.clear();
                state.last_selected_index = -1;
            }
            state.is_loading = false;
            state.show_loading_animation = false;
            state.sort_dirty = true;
            state.error_msg.clear();
        } catch (const std::exception& e) {
            std::lock_guard<std::mutex> lock(state.mu);
            if (state.navigation_generation.load(std::memory_order_relaxed) != navigation_generation ||
                std::string(state.current_path) != target_path) {
                return;
            }
            state.error_msg = std::string("Failed to parse remote response: ") + e.what();
            state.is_loading = false;
            state.show_loading_animation = false;
            state.sort_dirty = true;
        }
    }

    void FileExplorerPanel::download_remote_file(const UnifiedFileItem& file) {
        auto& services = registry_.get_state<ServicesState>("Services");
        auto& downloads = registry_.get_state<DownloadState>("Downloads");
        auto& notifications = registry_.get_state<NotificationState>("Notifications");
        auto& state = registry_.get_state<FileExplorerState>(state_key_);

        // Mark as downloading
        state.downloading_files.insert(file.path);

        // Ensure local directory exists
        std::string local_path = file.path;
        std::error_code ec;
        fs::create_directories(fs::path(local_path).parent_path(), ec);

        uint64_t download_id = downloads.start_download(
            file.name, local_path, file.remote_name, file.size);

        uint64_t notif_id = notifications.add_notification("downloading...", 15.0f);

        services.download_file(
            file.remote_name, file.remote_path, local_path,
            [registry = &registry_, download_id](size_t bytes_downloaded, size_t) -> bool {
                auto& downloads = registry->get_state<DownloadState>("Downloads");
                downloads.update_progress(download_id, static_cast<int64_t>(bytes_downloaded));
                return true;
            },
            [registry = &registry_, state_key = state_key_, file_name = file.name, file_path = file.path, download_id, notif_id](
                bool success, const std::string& local_path, const std::string& error) {
                auto& downloads = registry->get_state<DownloadState>("Downloads");
                auto& notifications = registry->get_state<NotificationState>("Notifications");
                auto& state = registry->get_state<FileExplorerState>(state_key);

                notifications.dismiss(notif_id);
                state.downloading_files.erase(file_path);

                if (success) {
                    downloads.complete_download(download_id);
                    notifications.add_notification("Downloaded " + file_name);

                    std::lock_guard<std::mutex> lock(state.mu);
                    for (auto& f : state.files) {
                        if (f.path == file_path) {
                            f.status = SyncStatus::SYNCED;
                            f.state_code = "LOC";
                            f.sync_dirty = false;
                            f.sync_direction = "none";
                            break;
                        }
                    }
                } else {
                    downloads.fail_download(download_id, error);
                    auto& activity = registry->get_state<ActivityState>("Activity");
                    activity.add_entry("File", "Download failed: " + file_name + ": " + error, ActivityEntryType::ERROR);
                }
            });
    }

}
