#include "panels/file_explorer/file_explorer_panel.h"
#include "panels/workspace/workspace_state.h"
#include "panels/services/onedrive/onedrive_state.h"
#include "panels/services/gdrive/gdrive_state.h"
#include "panels/services/dropbox/dropbox_state.h"
#include "panels/services/icloud/icloud_state.h"
#include "panels/services/services_state.h"
#include "panels/activity/download_state.h"
#include "panels/activity/upload_state.h"
#include "panels/notification/notification_state.h"
#include "panels/file_sidebar/file_sidebar_state.h"
#include "panels/search/search_state.h"
#include "panels/search/search_panel.h"
#include "core/manager/asset_manager.h"
#include <nlohmann/json.hpp>
#include <algorithm>
#include <chrono>
#include <cstdio>


namespace fs = std::filesystem;

using namespace misty::core;

namespace misty::panel {

    FileExplorerPanel::FileExplorerPanel(UIRegistry& registry, WorkerPool& worker_pool, std::shared_ptr<MistyClient> client)
        : registry_(registry), worker_pool_(worker_pool), client_(std::move(client)) {

        auto& workspace_state = registry_.get_state<WorkspaceState>("Workspace");
        auto& file_explorer_state = registry_.get_state<FileExplorerState>("Files");

        // Ensure mount directories exist (~/misty/mnt and ~/misty/mnt/OneDrive)
        workspace_state.ensure_directories();

        // Load persistent state (Recent, Starred)
        file_explorer_state.load_state();

        // Initialize services state with worker pool
        auto& services_state = registry_.get_state<ServicesState>("Services");
        services_state.init(worker_pool_);

        // Sync account mappings to create account directories
        sync_account_mappings();
        sync_gd_account_mappings();
        sync_dbx_account_mappings();
        sync_icl_account_mappings();

        // Fetch workspaces if not already done
        if (!workspace_state.has_fetched) {
            workspace_state.fetch_workspaces_async(worker_pool_);
        }

        // Use workspace mount path if available, otherwise fall back to client mount path
        std::string start_path = workspace_state.get_current_mount_path();
        if (start_path.empty() && client_) {
            start_path = client_->GetClientMountPath();
        }

        // Restore last opened path if valid
        if (!file_explorer_state.last_opened_path.empty()) {
            std::string saved_path = file_explorer_state.last_opened_path;
            
            printf("DEBUG: Constructor - Found last_opened_path: %s\n", saved_path.c_str());

            bool is_valid = true;
            
            // Check if it's a virtual path
            if (saved_path.rfind("misty://", 0) == 0) {
                 // Always valid
            } else if (path_utils::is_onedrive_path(saved_path) || path_utils::is_gdrive_path(saved_path) || path_utils::is_dropbox_path(saved_path) || path_utils::is_icloud_path(saved_path)) {
                 // Assume valid for cloud paths (will show error or reconnect if not)
            } else {
                 // Check local existence
                 if (!fs::exists(saved_path) || !fs::is_directory(saved_path)) {
                     is_valid = false;
                 }
            }
            
            if (is_valid) {
                start_path = saved_path;
                printf("DEBUG: Constructor - Using saved path: %s\n", start_path.c_str());
            } else {
                printf("DEBUG: Constructor - Saved path was invalid\n");
            }
        } else {
             printf("DEBUG: Constructor - No last_opened_path found\n");
        }

        initial_start_path_ = start_path;

        // Create directory if it doesn't exist
        if (!start_path.empty()) {
            std::error_code ec;
            fs::create_directories(start_path, ec);
        }

        // Set as pending navigation - will be processed in render()
        file_explorer_state.pending_navigation_path = start_path;
    }

    void FileExplorerPanel::render() {
        auto& state = registry_.get_state<FileExplorerState>("Files");
        auto& workspace_state = registry_.get_state<WorkspaceState>("Workspace");

        if (!workspace_mount_applied_) {
            if (workspace_state.has_fetched && !workspace_state.is_fetching) {
                std::string workspace_path = workspace_state.get_current_mount_path();
                if (!workspace_path.empty()) {
                    printf("DEBUG: render - workspace_path=%s, last_opened_path=%s, initial_start_path_=%s\n", 
                        workspace_path.c_str(), state.last_opened_path.c_str(), initial_start_path_.c_str());
                    if (!state.last_opened_path.empty() && initial_start_path_ == state.last_opened_path) {
                        workspace_mount_applied_ = true;
                    } else {
                        std::string current_path = state.current_path;
                        bool no_history = state.back_history.empty() && state.forward_history.empty();
                        bool is_at_initial = current_path.empty() || current_path == initial_start_path_;
                        if (no_history && is_at_initial && state.pending_navigation_path.empty()) {
                            state.pending_navigation_path = workspace_path;
                        }
                        workspace_mount_applied_ = true;
                    }
                } else {
                    workspace_mount_applied_ = true;
                }
            }
        }

        // Check for pending navigation from external code (e.g., sidebar)
        if (!state.pending_navigation_path.empty()) {
            std::string path = state.pending_navigation_path;
            printf("Explorer: Detected pending navigation to: %s\n", path.c_str());
            state.pending_navigation_path.clear();
            navigate_to_path(path);
        }

        ImGuiWindowFlags file_explorer_flags = ImGuiWindowFlags_NoTitleBar |
            ImGuiWindowFlags_NoMove |
            ImGuiWindowFlags_NoCollapse |
            ImGuiWindowFlags_NoResize;

        auto& search_state = registry_.get_state<SearchState>("Search");

        ImGui::PushStyleColor(ImGuiCol_WindowBg, ImVec4(0.18f, 0.18f, 0.18f, 1.0f));

        if (ImGui::Begin("File Explorer", nullptr, file_explorer_flags)) {
            std::unique_lock<std::mutex> lock(state.mu);

            // TopBar
            if (ImGui::BeginChild("TopBar", ImVec2(0, 50), false, ImGuiWindowFlags_NoScrollbar)) {
                ImGui::SetCursorPosY(8.0f);
                show_nav_history(state, 30.0f, 8.0f);
                ImGui::SameLine(0, 8.0f);
                ImGui::SetCursorPosY(7.0f);
                show_search_bar(state);
            }
            ImGui::EndChild();

            ImGui::Separator();
            if (search_state.is_open) {
                show_inline_search(state, search_state);  // input bar only; no locks inside
            }

            // Save window-relative position of the list area before rendering it.
            // We'll reuse this to position the overlay child on top.
            ImVec2 list_start   = ImGui::GetCursorPos();
            float  list_height  = ImGui::GetContentRegionAvail().y;

            show_directory_contents(state);
            show_error_modal(state.error_msg, "FileExplorerError");

            // ── Search results overlay ──────────────────────────────────────────
            // Drawn inside the same File Explorer window, but after the directory
            // list child — so it sits on top with no cross-window z-order issues.
            if (search_state.is_open) {
                float overlay_h = std::min(350.0f, list_height);
                // Reposition cursor back to list_start to overlap the file list
                ImGui::SetCursorPos(list_start);
                ImGui::PushStyleColor(ImGuiCol_ChildBg, ImVec4(0.14f, 0.14f, 0.14f, 0.97f));
                if (ImGui::BeginChild("##search_overlay", {0, overlay_h}, false,
                        ImGuiWindowFlags_NoScrollbar)) {
                    bool has_results = false;
                    {
                        std::lock_guard<std::mutex> lk(search_state.mu);
                        has_results = !search_state.cache_results.empty() ||
                                      !search_state.api_results.empty();
                    }
                    int pending = search_state.pending_api_tasks.load();
                    if (has_results) {
                        if (pending > 0) {
                            float t = static_cast<float>(ImGui::GetTime());
                            const char* frames[] = { "|", "/", "-", "\\" };
                            ImGui::TextDisabled("Searching... %s", frames[(int)(t * 8.0f) % 4]);
                        }
                        if (search_panel_) search_panel_->render_results(search_state);
                    } else if (!search_state.last_submitted_query.empty()) {
                        if (pending > 0) {
                            float t = static_cast<float>(ImGui::GetTime());
                            const char* frames[] = { "|", "/", "-", "\\" };
                            ImGui::TextDisabled("Searching... %s", frames[(int)(t * 8.0f) % 4]);
                        } else {
                            ImGui::TextDisabled("No files found");
                        }
                    }
                }
                ImGui::EndChild();
                ImGui::PopStyleColor();
            }

            lock.unlock();

            // Deferred submit — after fe_state.mu is released
            if (search_state.pending_submit && search_panel_) {
                search_state.pending_submit = false;
                std::string q(search_state.query_buf);
                if (q.size() >= 2) search_panel_->submit_search(q);
            }

            // Deferred Enter navigation — after fe_state.mu is released
            if (search_state.pending_navigate_index >= 0 && search_panel_) {
                int idx = search_state.pending_navigate_index;
                search_state.pending_navigate_index = -1;
                std::lock_guard<std::mutex> lk(search_state.mu);
                std::vector<const SearchResult*> all;
                for (auto& r : search_state.cache_results) all.push_back(&r);
                for (auto& r : search_state.api_results)   all.push_back(&r);
                if (idx < static_cast<int>(all.size())) {
                    search_panel_->navigate_to_result(*all[idx]);
                    search_state.is_open = false;
                }
            }

            // Periodic write-behind save — runs every 60s, dispatches to worker
            // thread only when something actually changed (dirty flag).
            static double last_save_check = 0.0;
            double now = ImGui::GetTime();
            if (now - last_save_check >= 60.0) {
                last_save_check = now;
                state.save_async(worker_pool_);
            }
        }
        ImGui::End();
        ImGui::PopStyleColor();
    }

    void FileExplorerPanel::navigate_to_local_path_async(const std::string& path, bool update_history) {
        auto& state = registry_.get_state<FileExplorerState>("Files");

        // Immediately signal loading — UI stays responsive while worker scans
        state.is_loading = true;
        state.error_msg  = "";

        // Snapshot volatile UI state before leaving the UI thread
        const bool show_hidden = state.show_hidden;

        // History update is fast (no I/O) — do it synchronously now so
        // back/forward buttons are correct even before the scan completes.
        if (update_history) {
            std::string cur(state.current_path);
            if (!cur.empty() && cur != path) {
                state.back_history.push(cur);
            }
            while (!state.forward_history.empty()) state.forward_history.pop();
        }

        worker_pool_.add(
            [&state, path, show_hidden]() {
                std::vector<UnifiedFileItem> new_files;
                std::string new_path;

                try {
                    new_path = fs::canonical(fs::path(path)).generic_string();
                } catch (...) {
                    new_path = path;
                }

                try {
                    for (const auto& entry : fs::directory_iterator(path)) {
                        std::string fname = entry.path().filename().generic_string();
                        if (!show_hidden && !fname.empty() && fname[0] == '.') continue;

                        UnifiedFileItem item;
                        item.path   = entry.path().generic_string();
                        item.name   = fname;
                        item.is_dir = entry.is_directory();
                        item.source = FileSource::LOCAL;
                        item.status = SyncStatus::LOCAL;

                        if (!item.is_dir) {
                            try { item.size = fs::file_size(entry.path()); } catch (...) {}
                        }
                        try {
                            auto ftime = fs::last_write_time(entry.path());
                            auto sctp  = std::chrono::time_point_cast<std::chrono::system_clock::duration>(
                                ftime - fs::file_time_type::clock::now() + std::chrono::system_clock::now());
                            auto t = std::chrono::system_clock::to_time_t(sctp);
                            char buf[32];
                            std::strftime(buf, sizeof(buf), "%Y-%m-%d %H:%M", std::localtime(&t));
                            item.last_modified = buf;
                        } catch (...) {}

                        new_files.push_back(std::move(item));
                    }
                } catch (const std::exception& e) {
                    std::lock_guard<std::mutex> lk(state.mu);
                    state.error_msg  = e.what();
                    state.is_loading = false;
                    return;
                }

                // Apply results under lock
                std::lock_guard<std::mutex> lk(state.mu);
                state.files = std::move(new_files);
                strncpy(state.current_path, new_path.c_str(), sizeof(state.current_path) - 1);
                state.current_path[sizeof(state.current_path) - 1] = '\0';
                strncpy(state.search_path, new_path.c_str(), sizeof(state.search_path) - 1);
                state.selected_files.clear();
                state.last_selected_index = -1;
                state.is_loading = false;
            },
            []() {},
            [&state](const std::string& err) {
                state.error_msg  = err;
                state.is_loading = false;
            }
        );
    }

    void FileExplorerPanel::navigate_to_path(const std::string& path, bool update_history, bool create_if_missing) {
        printf("Explorer: navigate_to_path called with: %s\n", path.c_str());
        auto& state = registry_.get_state<FileExplorerState>("Files");

        // Virtual Paths Logic
        if (path.rfind("misty://", 0) == 0) {
            printf("Explorer: Handling virtual path: %s\n", path.c_str());
            state.is_loading = true;
            state.files.clear();
            
            if (path == FileExplorerState::VIRTUAL_PATH_RECENT) {
                printf("Explorer: Loading Recent Files (count: %zu)\n", state.recent_files.size());
                state.files.assign(state.recent_files.begin(), state.recent_files.end());
            } else if (path == FileExplorerState::VIRTUAL_PATH_STARRED) {
                printf("Explorer: Loading Starred Files (count: %zu)\n", state.starred_files.size());
                state.files = state.starred_files;
            } else if (path == FileExplorerState::VIRTUAL_PATH_TRASH) {
                printf("Explorer: Loading Trash Files\n");
                // Read from disk to ensure persistence
                state.files.clear();
                state.trash_files.clear(); // Re-sync cache
                
                std::string trash_dir = std::string(std::getenv("HOME")) + "/misty/.cache/trash";
                if (fs::exists(trash_dir)) {
                    printf("Explorer: Reading trash dir: %s\n", trash_dir.c_str());
                    for (const auto& entry : fs::directory_iterator(trash_dir)) {
                        UnifiedFileItem item;
                        item.path = entry.path().string();
                        item.name = entry.path().filename().string();
                        item.is_dir = entry.is_directory();
                        item.source = FileSource::LOCAL; // It's local now
                        item.status = SyncStatus::DELETED;
                        
                         try {
                            if (!item.is_dir) item.size = fs::file_size(entry.path());
                            
                            auto ftime = fs::last_write_time(entry.path());
                            auto sctp = std::chrono::time_point_cast<std::chrono::system_clock::duration>(
                                ftime - fs::file_time_type::clock::now() + std::chrono::system_clock::now()
                            );
                            auto time_t_val = std::chrono::system_clock::to_time_t(sctp);
                            char buf[32];
                            std::strftime(buf, sizeof(buf), "%Y-%m-%d %H:%M", std::localtime(&time_t_val));
                            item.last_modified = buf;
                        } catch (...) {}

                        state.files.push_back(item);
                        state.trash_files.push_back(item);
                    }
                }
            }
            
            if (update_history) {
                std::string current_path_str(state.current_path);
                if (!current_path_str.empty() && current_path_str != path) {
                    state.back_history.push(current_path_str);
                }
                while (!state.forward_history.empty()) state.forward_history.pop();
            }
            
            strncpy(state.current_path, path.c_str(), sizeof(state.current_path) - 1);
            state.current_path[sizeof(state.current_path) - 1] = '\0';
            strncpy(state.search_path, path.c_str(), sizeof(state.search_path) - 1);
            
            state.selected_files.clear();
            state.last_selected_index = -1;
            state.is_loading = false;
            printf("Explorer: Virtual path loaded. File count: %zu\n", state.files.size());
            return;
        }

        if (path_utils::is_onedrive_path(path)) {
            // OneDrive path - parse and route
            auto [folder_name, relative_path] = path_utils::parse_onedrive_path(path);

            if (folder_name.empty()) {
                // At OneDrive mount root - show accounts
                navigate_to_onedrive_mount_root(update_history);
            } else {
                // Navigate into specific account
                navigate_to_onedrive_account(folder_name, relative_path, update_history, create_if_missing);
            }
        } else if (path_utils::is_gdrive_path(path)) {
            // Google Drive path - parse and route
            auto [folder_name, relative_path] = path_utils::parse_gdrive_path(path);

            if (folder_name.empty()) {
                navigate_to_gdrive_mount_root(update_history);
            } else {
                navigate_to_gdrive_account(folder_name, relative_path, update_history, create_if_missing);
            }
        } else if (path_utils::is_dropbox_path(path)) {
            // Dropbox path - parse and route
            auto [folder_name, relative_path] = path_utils::parse_dropbox_path(path);

            if (folder_name.empty()) {
                navigate_to_dropbox_mount_root(update_history);
            } else {
                navigate_to_dropbox_account(folder_name, relative_path, update_history, create_if_missing);
            }
        } else if (path_utils::is_icloud_path(path)) {
            // iCloud path - parse and route
            auto [folder_name, relative_path] = path_utils::parse_icloud_path(path);

            if (folder_name.empty()) {
                navigate_to_icloud_mount_root(update_history);
            } else {
                navigate_to_icloud_account(folder_name, relative_path, update_history, create_if_missing);
            }
        } else {
            // Local path - clear cloud upload contexts and notification tracking
            {
                auto& onedrive_state = registry_.get_state<OneDriveState>("OneDrive");
                std::lock_guard<std::mutex> od_lock(onedrive_state.mu);
                onedrive_state.current_ms_user_id.clear();
                onedrive_state.current_drive_id.clear();
                onedrive_state.current_folder_id.clear();
            }
            {
                auto& gdrive_state = registry_.get_state<GDriveState>("GDrive");
                std::lock_guard<std::mutex> gd_lock(gdrive_state.mu);
                gdrive_state.current_gd_user_id.clear();
                gdrive_state.current_folder_id.clear();
            }
            {
                auto& dropbox_state = registry_.get_state<DropboxState>("Dropbox");
                std::lock_guard<std::mutex> dbx_lock(dropbox_state.mu);
                dropbox_state.current_dbx_user_id.clear();
                dropbox_state.current_folder_path.clear();
            }
            {
                auto& icloud_state = registry_.get_state<ICloudState>("iCloud");
                std::lock_guard<std::mutex> icl_lock(icloud_state.mu);
                icloud_state.current_email.clear();
                icloud_state.current_folder_path.clear();
            }
            state.last_disconnected_notification_folder.clear();
            navigate_to_local_path_async(path, update_history);
        }
        
        state.dirty_ = true; // mark for next async save cycle
    }

    void FileExplorerPanel::sync_account_mappings() {
        auto& workspace = registry_.get_state<WorkspaceState>("Workspace");
        auto& services = registry_.get_state<ServicesState>("Services");

        // Ensure base mount directories exist
        workspace.ensure_directories();

        std::lock_guard<std::mutex> svc_lock(services.mu);

        workspace.account_mappings.clear();
        for (const auto& conn : services.ms_connections) {
            if (!conn.is_authenticated) continue;

            AccountMapping mapping;
            mapping.ms_user_id = conn.profile.id;
            mapping.display_name = conn.profile.display_name;
            mapping.email = conn.profile.email;
            mapping.folder_name = mount_utils::derive_folder_name(conn.profile.email);

            // Create the account directory on disk
            mount_utils::ensure_account_directory(conn.profile.email);

            // Try to load cached drive_id
            std::string cached_drive_id, cached_display, cached_email;
            if (load_drive_info_from_cache(conn.profile.id, cached_drive_id, cached_display, cached_email)) {
                mapping.drive_id = cached_drive_id;
            }

            workspace.account_mappings.push_back(mapping);
        }
    }

    void FileExplorerPanel::navigate_to_onedrive_mount_root(bool update_history) {
        auto& state = registry_.get_state<FileExplorerState>("Files");
        auto& workspace = registry_.get_state<WorkspaceState>("Workspace");
        auto& services = registry_.get_state<ServicesState>("Services");

        // Clear disconnected notification tracking since we're at the account list level
        state.last_disconnected_notification_folder.clear();

        // Clear OneDrive upload context since we're at account list level
        {
            auto& onedrive_state = registry_.get_state<OneDriveState>("OneDrive");
            std::lock_guard<std::mutex> od_lock(onedrive_state.mu);
            onedrive_state.current_ms_user_id.clear();
            onedrive_state.current_drive_id.clear();
            onedrive_state.current_folder_id.clear();
        }

        // Sync account mappings from services state
        sync_account_mappings();

        std::string new_path = path_utils::get_onedrive_root();

        if (update_history) {
            std::string current_path_str(state.current_path);
            if (!current_path_str.empty() && current_path_str != new_path) {
                state.back_history.push(current_path_str);
            }
            while (!state.forward_history.empty()) {
                state.forward_history.pop();
            }
        }

        // Build files list from both connected accounts and local folders
        std::vector<UnifiedFileItem> files;
        std::unordered_set<std::string> added_folders;

        // First add connected accounts from mappings
        for (const auto& mapping : workspace.account_mappings) {
            UnifiedFileItem item;
            item.name = mapping.folder_name;
            item.path = new_path + "/" + mapping.folder_name;
            item.is_dir = true;
            item.source = FileSource::ONEDRIVE;
            item.od_ms_user_id = mapping.ms_user_id;
            item.od_drive_id = mapping.drive_id;
            files.push_back(item);
            added_folders.insert(mapping.folder_name);
        }

        // Then scan the local OneDrive directory for folders without connected accounts
        std::error_code ec;
        if (fs::exists(new_path, ec) && fs::is_directory(new_path, ec)) {
            for (const auto& entry : fs::directory_iterator(new_path, ec)) {
                if (entry.is_directory()) {
                    std::string folder_name = entry.path().filename().string();
                    // Skip if already added from mappings or hidden folders
                    if (added_folders.count(folder_name) > 0 || folder_name[0] == '.') {
                        continue;
                    }

                    // This is a local folder without a connected account
                    UnifiedFileItem item;
                    item.name = folder_name;
                    item.path = new_path + "/" + folder_name;
                    item.is_dir = true;
                    item.source = FileSource::LOCAL;  // Mark as local since not connected
                    files.push_back(item);
                }
            }
        }

        state.files = std::move(files);
        strncpy(state.current_path, new_path.c_str(), sizeof(state.current_path) - 1);
        state.current_path[sizeof(state.current_path) - 1] = '\0';
        strncpy(state.search_path, new_path.c_str(), sizeof(state.search_path) - 1);

        state.is_loading = false;
        state.selected_files.clear();
        state.last_selected_index = -1;
        state.error_msg = "";
    }

    void FileExplorerPanel::navigate_to_onedrive_account(const std::string& folder_name,
                                                          const std::string& relative_path,
                                                          bool update_history,
                                                          bool create_if_missing) {
        auto& state = registry_.get_state<FileExplorerState>("Files");
        auto& workspace = registry_.get_state<WorkspaceState>("Workspace");
        auto& services = registry_.get_state<ServicesState>("Services");

        // Check if this account is connected
        bool is_connected = services.is_account_folder_connected(folder_name);

        // Find account mapping in workspace state
        AccountMapping* mapping = workspace.find_account_by_folder(folder_name);
        if (!mapping) {
            // Try syncing account mappings and retry
            sync_account_mappings();
            mapping = workspace.find_account_by_folder(folder_name);
        }

        std::string target_path = path_utils::get_onedrive_root() + "/" + folder_name;
        if (!relative_path.empty()) {
            target_path += "/" + relative_path;
        }

        // If account not connected, show notification and fall through to local file browsing
        if (!is_connected) {
            // Only show notification if we haven't shown one for this folder already
            if (state.last_disconnected_notification_folder != folder_name) {
                auto& notifications = registry_.get_state<NotificationState>("Notifications");
                notifications.add_notification(
                    "Account Not Connected",
                    "The OneDrive account '" + folder_name + "' is not connected. Showing local files only.",
                    NotificationType::INFO,
                    8.0f  // Show for 8 seconds
                );
                state.last_disconnected_notification_folder = folder_name;
            }

            // Fall through to show local files even without mapping
            if (!mapping) {
                // No mapping exists - just show local filesystem
                if (!fs::exists(target_path)) {
                    state.error_msg = "Path does not exist: " + target_path;
                    return;
                }
                if (!fs::is_directory(target_path)) {
                    state.error_msg = "Path is not a directory: " + target_path;
                    return;
                }

                // Navigate as local path
                navigate_to_local_path(state, target_path, update_history);
                return;
            }
        } else {
            // Account is connected - clear notification tracking
            state.last_disconnected_notification_folder.clear();
        }

        if (!mapping) {
            state.error_msg = "Account not found: " + folder_name;
            return;
        }

        if (create_if_missing) {
            // Create the directory locally so the path is always valid on disk
            std::error_code ec;
            fs::create_directories(target_path, ec);
            if (ec) {
                state.error_msg = "Failed to create directory: " + target_path;
                return;
            }
        } else {
            // Check if path exists - if not, show error (user typed invalid path)
            if (!fs::exists(target_path)) {
                state.error_msg = "Path does not exist: " + target_path;
                return;
            }
            if (!fs::is_directory(target_path)) {
                state.error_msg = "Path is not a directory: " + target_path;
                return;
            }
        }

        // Resolve folder ID from cache
        std::string folder_id = resolve_folder_id_from_cache(*mapping, relative_path);

        if (update_history) {
            std::string current_path_str(state.current_path);
            if (!current_path_str.empty() && current_path_str != target_path) {
                state.back_history.push(current_path_str);
            }
            while (!state.forward_history.empty()) {
                state.forward_history.pop();
            }
        }

        // Update path immediately
        strncpy(state.current_path, target_path.c_str(), sizeof(state.current_path) - 1);
        state.current_path[sizeof(state.current_path) - 1] = '\0';
        strncpy(state.search_path, target_path.c_str(), sizeof(state.search_path) - 1);

        state.selected_files.clear();
        state.last_selected_index = -1;
        state.error_msg = "";

        // Try to load from cache first
        std::vector<OneDriveItem> cached_items;
        if (load_items_from_cache(mapping->ms_user_id, folder_id, cached_items)) {
            // Convert to UnifiedFileItem
            std::vector<UnifiedFileItem> files;
            for (const auto& od_item : cached_items) {
                UnifiedFileItem item;
                item.name = od_item.name;
                item.path = target_path + "/" + od_item.name;
                item.is_dir = od_item.is_folder;
                item.size = od_item.size;
                item.last_modified = od_item.last_modified_date_time.substr(0, 10);
                item.source = FileSource::ONEDRIVE;
                item.od_item_id = od_item.id;
                item.od_drive_id = od_item.drive_id;
                item.od_ms_user_id = od_item.ms_user_id;
                item.od_web_url = od_item.web_url;
                files.push_back(item);
            }
            state.files = std::move(files);
            state.is_loading = false;
        } else {
            state.files.clear();
            state.is_loading = true;
        }

        // Fetch in background
        fetch_onedrive_folder(*mapping, folder_id, target_path);
    }

    std::string FileExplorerPanel::resolve_folder_id_from_cache(const AccountMapping& account,
                                                                  const std::string& relative_path) {
        if (relative_path.empty()) {
            return "root";
        }

        auto components = path_utils::split_path(relative_path);
        std::string folder_id = "root";

        for (const auto& name : components) {
            std::vector<OneDriveItem> items;
            if (!load_items_from_cache(account.ms_user_id, folder_id, items)) {
                // Cache miss - return current folder_id, fetch will handle the rest
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
                // Path component not found in cache
                return folder_id;
            }
        }

        return folder_id;
    }

    void FileExplorerPanel::fetch_onedrive_folder(const AccountMapping& account,
                                                   const std::string& folder_id,
                                                   const std::string& target_path) {
        auto& services = registry_.get_state<ServicesState>("Services");
        std::string ms_user_id = account.ms_user_id;
        std::string drive_id = account.drive_id;

        // If we don't have drive_id, fetch it first
        if (drive_id.empty()) {
            services.fetch_drive(ms_user_id,
                [this, ms_user_id, folder_id, target_path](const std::string& user_id,
                                                           const std::string& fetched_drive_id,
                                                           bool success,
                                                           const std::string& error) {
                    if (!success) {
                        auto& state = registry_.get_state<FileExplorerState>("Files");
                        std::lock_guard<std::mutex> lock(state.mu);
                        state.is_loading = false;
                        if (state.files.empty()) {
                            state.error_msg = error;
                        }
                        return;
                    }

                    // Update account mapping with drive_id
                    {
                        auto& workspace = registry_.get_state<WorkspaceState>("Workspace");
                        for (auto& mapping : workspace.account_mappings) {
                            if (mapping.ms_user_id == user_id) {
                                mapping.drive_id = fetched_drive_id;
                                save_drive_info_to_cache(user_id, fetched_drive_id,
                                                        mapping.display_name, mapping.email);
                                break;
                            }
                        }
                    }

                    // Now fetch the folder
                    auto& svc = registry_.get_state<ServicesState>("Services");
                    svc.fetch_onedrive_files(user_id, fetched_drive_id, folder_id,
                        [this, user_id, fetched_drive_id, folder_id, target_path](bool success,
                                                                                   const std::string& body,
                                                                                   const std::string& error) {
                            handle_folder_fetch({FileSource::ONEDRIVE, user_id, folder_id, fetched_drive_id}, target_path, success, body, error);
                        });
                });
        } else {
            // We have drive_id, fetch files directly
            services.fetch_onedrive_files(ms_user_id, drive_id, folder_id,
                [this, ms_user_id, drive_id, folder_id, target_path](bool success,
                                                                      const std::string& body,
                                                                      const std::string& error) {
                    handle_folder_fetch({FileSource::ONEDRIVE, ms_user_id, folder_id, drive_id}, target_path, success, body, error);
                });
        }
    }

    void FileExplorerPanel::handle_folder_fetch(const CloudFolderContext& ctx,
                                                  const std::string& target_path,
                                                  bool success,
                                                  const std::string& body,
                                                  const std::string& error) {
        auto& state = registry_.get_state<FileExplorerState>("Files");
        std::lock_guard<std::mutex> lock(state.mu);

        state.is_loading = false;

        // Only update if we're still at this path
        if (std::string(state.current_path) != target_path) {
            return;
        }

        // Update upload context for the active service, clear others
        switch (ctx.service) {
            case FileSource::ONEDRIVE: {
                auto& onedrive_state = registry_.get_state<OneDriveState>("OneDrive");
                std::lock_guard<std::mutex> od_lock(onedrive_state.mu);
                onedrive_state.current_ms_user_id = ctx.user_id;
                onedrive_state.current_drive_id = ctx.drive_id;
                onedrive_state.current_folder_id = ctx.folder_id;
                break;
            }
            case FileSource::GDRIVE: {
                auto& gdrive_state = registry_.get_state<GDriveState>("GDrive");
                std::lock_guard<std::mutex> gd_lock(gdrive_state.mu);
                gdrive_state.current_gd_user_id = ctx.user_id;
                gdrive_state.current_folder_id = ctx.folder_id;
                break;
            }
            case FileSource::DROPBOX: {
                auto& dropbox_state = registry_.get_state<DropboxState>("Dropbox");
                std::lock_guard<std::mutex> dbx_lock(dropbox_state.mu);
                dropbox_state.current_dbx_user_id = ctx.user_id;
                dropbox_state.current_folder_path = ctx.folder_id;
                break;
            }
            case FileSource::ICLOUD: {
                auto& icloud_state = registry_.get_state<ICloudState>("iCloud");
                std::lock_guard<std::mutex> icl_lock(icloud_state.mu);
                icloud_state.current_email = ctx.user_id;
                icloud_state.current_folder_path = ctx.folder_id;
                break;
            }
            default: break;
        }
        // Clear inactive services' upload contexts
        if (ctx.service != FileSource::ONEDRIVE) {
            auto& onedrive_state = registry_.get_state<OneDriveState>("OneDrive");
            std::lock_guard<std::mutex> od_lock(onedrive_state.mu);
            onedrive_state.current_ms_user_id.clear();
            onedrive_state.current_drive_id.clear();
            onedrive_state.current_folder_id.clear();
        }
        if (ctx.service != FileSource::GDRIVE) {
            auto& gdrive_state = registry_.get_state<GDriveState>("GDrive");
            std::lock_guard<std::mutex> gd_lock(gdrive_state.mu);
            gdrive_state.current_gd_user_id.clear();
            gdrive_state.current_folder_id.clear();
        }
        if (ctx.service != FileSource::DROPBOX) {
            auto& dropbox_state = registry_.get_state<DropboxState>("Dropbox");
            std::lock_guard<std::mutex> dbx_lock(dropbox_state.mu);
            dropbox_state.current_dbx_user_id.clear();
            dropbox_state.current_folder_path.clear();
        }
        if (ctx.service != FileSource::ICLOUD) {
            auto& icloud_state = registry_.get_state<ICloudState>("iCloud");
            std::lock_guard<std::mutex> icl_lock(icloud_state.mu);
            icloud_state.current_email.clear();
            icloud_state.current_folder_path.clear();
        }

        if (success) {
            std::vector<UnifiedFileItem> files;

            try {
                auto json = nlohmann::json::parse(body);

                switch (ctx.service) {
                    case FileSource::ONEDRIVE: {
                        std::vector<OneDriveItem> od_items;
                        auto values = json.value("value", nlohmann::json::array());

                        for (const auto& item : values) {
                            OneDriveItem odi;
                            odi.id = item.value("id", std::string(""));
                            odi.name = item.value("name", std::string(""));
                            odi.size = item.value("size", int64_t(0));
                            odi.web_url = item.value("webUrl", std::string(""));
                            odi.last_modified_date_time = item.value("lastModifiedDateTime", std::string(""));
                            odi.is_folder = item.contains("folder");
                            if (odi.is_folder && item["folder"].contains("childCount")) {
                                odi.folder_child_count = item["folder"]["childCount"].get<int>();
                            }
                            odi.drive_id = ctx.drive_id;
                            odi.ms_user_id = ctx.user_id;
                            od_items.push_back(odi);

                            UnifiedFileItem ufi;
                            ufi.name = odi.name;
                            ufi.path = target_path + "/" + odi.name;
                            ufi.is_dir = odi.is_folder;
                            ufi.size = odi.size;
                            ufi.last_modified = odi.last_modified_date_time.length() >= 10
                                                ? odi.last_modified_date_time.substr(0, 10) : "";
                            ufi.source = FileSource::ONEDRIVE;
                            ufi.od_item_id = odi.id;
                            ufi.od_drive_id = ctx.drive_id;
                            ufi.od_ms_user_id = ctx.user_id;
                            ufi.od_web_url = odi.web_url;
                            files.push_back(ufi);
                        }

                        state.files = std::move(files);
                        save_items_to_cache(ctx.user_id, ctx.folder_id, od_items);
                        break;
                    }
                    case FileSource::GDRIVE: {
                        std::vector<GDriveItem> gd_items;
                        auto values = json.value("files", nlohmann::json::array());

                        for (const auto& item : values) {
                            GDriveItem gdi;
                            gdi.id = item.value("id", std::string(""));
                            gdi.name = item.value("name", std::string(""));
                            if (item.contains("size")) {
                                if (item["size"].is_string()) {
                                    try { gdi.size = std::stoll(item["size"].get<std::string>()); } catch (...) { gdi.size = 0; }
                                } else {
                                    gdi.size = item["size"].get<int64_t>();
                                }
                            }
                            gdi.web_url = item.value("webViewLink", std::string(""));
                            gdi.created_time = item.value("createdTime", std::string(""));
                            gdi.modified_time = item.value("modifiedTime", std::string(""));
                            gdi.mime_type = item.value("mimeType", std::string(""));
                            gdi.is_folder = (gdi.mime_type == "application/vnd.google-apps.folder");
                            gdi.gd_user_id = ctx.user_id;
                            gd_items.push_back(gdi);

                            UnifiedFileItem ufi;
                            ufi.name = gdi.name;
                            ufi.path = target_path + "/" + gdi.name;
                            ufi.is_dir = gdi.is_folder;
                            ufi.size = gdi.size;
                            ufi.last_modified = gdi.modified_time.length() >= 10
                                                ? gdi.modified_time.substr(0, 10) : "";
                            ufi.source = FileSource::GDRIVE;
                            ufi.gd_item_id = gdi.id;
                            ufi.gd_user_id = ctx.user_id;
                            ufi.gd_mime_type = gdi.mime_type;
                            ufi.gd_web_url = gdi.web_url;
                            files.push_back(ufi);
                        }

                        state.files = std::move(files);
                        save_gd_items_to_cache(ctx.user_id, ctx.folder_id, gd_items);
                        break;
                    }
                    case FileSource::DROPBOX: {
                        std::vector<DropboxItem> dbx_items;
                        auto entries = json.value("entries", nlohmann::json::array());

                        for (const auto& entry : entries) {
                            DropboxItem dbi;
                            std::string tag = entry.value(".tag", std::string(""));
                            dbi.id = entry.value("id", std::string(""));
                            dbi.name = entry.value("name", std::string(""));
                            dbi.path_display = entry.value("path_display", std::string(""));
                            dbi.path_lower = entry.value("path_lower", std::string(""));
                            dbi.is_folder = (tag == "folder");
                            if (!dbi.is_folder) {
                                dbi.size = entry.value("size", int64_t(0));
                                dbi.server_modified = entry.value("server_modified", std::string(""));
                            }
                            dbi.dbx_user_id = ctx.user_id;
                            dbx_items.push_back(dbi);

                            UnifiedFileItem ufi;
                            ufi.name = dbi.name;
                            ufi.path = target_path + "/" + dbi.name;
                            ufi.is_dir = dbi.is_folder;
                            ufi.size = dbi.size;
                            ufi.last_modified = dbi.server_modified.length() >= 10
                                                ? dbi.server_modified.substr(0, 10) : "";
                            ufi.source = FileSource::DROPBOX;
                            ufi.dbx_item_id = dbi.id;
                            ufi.dbx_user_id = ctx.user_id;
                            ufi.dbx_path_display = dbi.path_display;
                            files.push_back(ufi);
                        }

                        state.files = std::move(files);
                        save_dbx_items_to_cache(ctx.user_id, ctx.folder_id, dbx_items);
                        break;
                    }
                    case FileSource::ICLOUD: {
                        std::vector<ICloudItem> icl_items;
                        auto items_arr = json.value("items", nlohmann::json::array());
                        // Build folder path prefix for iCloud Drive path tracking
                        std::string icl_parent_path = ctx.folder_id; // e.g., "" or "Documents"

                        for (const auto& item : items_arr) {
                            std::string name = item.value("name", std::string(""));
                            bool is_folder = item.value("is_folder", false);
                            if (name.empty()) continue;

                            // Security: reject path traversal attempts in names
                            if (name.find('/') != std::string::npos || name.find("..") != std::string::npos) {
                                continue;
                            }

                            ICloudItem icl_item;
                            icl_item.name = name;
                            icl_item.path = icl_parent_path.empty() ? name : icl_parent_path + "/" + name;
                            icl_item.is_folder = is_folder;
                            icl_item.email = ctx.user_id;
                            icl_items.push_back(icl_item);

                            UnifiedFileItem ufi;
                            ufi.name = name;
                            ufi.path = target_path + "/" + name;
                            ufi.is_dir = is_folder;
                            ufi.source = FileSource::ICLOUD;
                            ufi.icl_email = ctx.user_id;
                            ufi.icl_path_display = icl_item.path;
                            files.push_back(ufi);
                        }

                        state.files = std::move(files);
                        save_icl_items_to_cache(ctx.user_id, ctx.folder_id, icl_items);
                        break;
                    }
                    default: break;
                }

                // Determine sync status for all items
                for (auto& ufi : state.files) {
                    if (ufi.is_dir) {
                        ufi.status = SyncStatus::LOCAL;
                    } else {
                        std::error_code ec;
                        if (fs::exists(ufi.path, ec)) {
                            // GDrive special case: online docs with size 0
                            if (ufi.source == FileSource::GDRIVE && ufi.size == 0 &&
                                ufi.gd_mime_type.rfind("application/vnd.google-apps.", 0) == 0) {
                                ufi.status = SyncStatus::SYNCED;
                            } else {
                                uintmax_t local_size = fs::file_size(ufi.path, ec);
                                if (!ec && local_size == (uintmax_t)ufi.size) {
                                    ufi.status = SyncStatus::SYNCED;
                                } else {
                                    ufi.status = SyncStatus::MODIFIED;
                                }
                            }
                        } else {
                            ufi.status = SyncStatus::NOT_SYNCED;
                        }
                    }
                }

            } catch (const std::exception& e) {
                if (state.files.empty()) {
                    state.error_msg = std::string("Parse error: ") + e.what();
                }
            }
        } else if (state.files.empty()) {
            state.error_msg = error;
        }
    }

    void FileExplorerPanel::show_inline_search(FileExplorerState& state, SearchState& search_state) {
        // Input bar (full width minus close button)
        ImGui::PushStyleVar(ImGuiStyleVar_FramePadding, ImVec2(10, 7));
        ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 4.0f);
        ImGui::PushStyleColor(ImGuiCol_FrameBg, ImVec4(0.18f, 0.18f, 0.18f, 1.0f));

        const float close_w = 28.0f;
        const float spacing = 6.0f;
        ImGui::SetNextItemWidth(ImGui::GetContentRegionAvail().x - close_w - spacing);

        if (search_state.just_opened) {
            ImGui::SetKeyboardFocusHere();
            search_state.just_opened = false;
        }

        bool changed = ImGui::InputTextWithHint("##inline_search", "Search files and cloud providers...",
            search_state.query_buf, sizeof(search_state.query_buf));

        ImGui::PopStyleColor();

        // Close button
        ImGui::SameLine(0, spacing);
        ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0, 0, 0, 0));
        ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.35f, 0.35f, 0.35f, 1.0f));
        ImGui::PushStyleColor(ImGuiCol_ButtonActive, ImVec4(0.25f, 0.25f, 0.25f, 1.0f));
        // Close — no mutex acquired (fe_state.mu is held; results cleared on next open)
        if (ImGui::Button("x", ImVec2(close_w, 0))) {
            search_state.is_open = false;
            std::memset(search_state.query_buf, 0, sizeof(search_state.query_buf));
        }
        ImGui::PopStyleColor(3);
        ImGui::PopStyleVar(2);

        // Esc to close — no mutex acquired
        if (ImGui::IsKeyPressed(ImGuiKey_Escape, false)) {
            search_state.is_open = false;
            std::memset(search_state.query_buf, 0, sizeof(search_state.query_buf));
            return;
        }

        // Debounce: set flag only — submit_search is called AFTER fe_state.mu is released
        static auto last_change = std::chrono::steady_clock::now();
        if (changed) last_change = std::chrono::steady_clock::now();
        float elapsed_ms = std::chrono::duration<float, std::milli>(
            std::chrono::steady_clock::now() - last_change).count();
        std::string q(search_state.query_buf);
        if (q.size() >= 2 && q != search_state.last_submitted_query && elapsed_ms >= 500.0f)
            search_state.pending_submit = true;

        // Arrow navigation — selected_index is main-thread-only, no lock needed
        if (ImGui::IsKeyPressed(ImGuiKey_UpArrow, true) && search_state.selected_index > 0)
            --search_state.selected_index;
        if (ImGui::IsKeyPressed(ImGuiKey_DownArrow, true))
            ++search_state.selected_index;

        // Enter: defer navigation until after fe_state.mu is released
        if (ImGui::IsKeyPressed(ImGuiKey_Enter, false))
            search_state.pending_navigate_index = search_state.selected_index;
    }

    void FileExplorerPanel::show_nav_history(FileExplorerState& state, float button_width, float spacing) {
        ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 4.0f);
        ImGui::PushStyleVar(ImGuiStyleVar_FramePadding, ImVec2(6.0f, 6.0f));

        bool can_back = !state.back_history.empty();
        if (!can_back) ImGui::BeginDisabled();
        if (ImGui::Button("<", ImVec2(button_width, 0))) {
            if (!state.back_history.empty()) {
                state.forward_history.push(std::string(state.current_path));
                std::string target = state.back_history.top();
                state.back_history.pop();
                navigate_to_path(target, false);
            }
        }
        if (!can_back) ImGui::EndDisabled();

        ImGui::SameLine(0, spacing);

        bool can_fwd = !state.forward_history.empty();
        if (!can_fwd) ImGui::BeginDisabled();
        if (ImGui::Button(">", ImVec2(button_width, 0))) {
            if (!state.forward_history.empty()) {
                state.back_history.push(std::string(state.current_path));
                std::string target = state.forward_history.top();
                state.forward_history.pop();
                navigate_to_path(target, false);
            }
        }
        if (!can_fwd) ImGui::EndDisabled();

        // Refresh button
        ImGui::SameLine(0, spacing);
        ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.21f, 0.21f, 0.21f, 1.0f));
        ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.28f, 0.28f, 0.28f, 1.0f));
        ImGui::PushStyleColor(ImGuiCol_ButtonActive, ImVec4(0.16f, 0.16f, 0.16f, 1.0f));
        auto& sync_tex = core::AssetManager::get().get_svg_texture("sync-16", 16);
        if (sync_tex.id != 0) {
            if (ImGui::ImageButton("##refresh", sync_tex.id, ImVec2(16, 16), ImVec2(0, 0), ImVec2(1, 1),
                    ImVec4(0, 0, 0, 0), ImVec4(0.7f, 0.7f, 0.7f, 1.0f))) {
                std::string current(state.current_path);
                if (!current.empty()) navigate_to_path(current, false);
            }
        } else {
            if (ImGui::Button("R", ImVec2(button_width, 0))) {
                std::string current(state.current_path);
                if (!current.empty()) navigate_to_path(current, false);
            }
        }
        if (ImGui::IsItemHovered()) ImGui::SetTooltip("Refresh");
        ImGui::PopStyleColor(3);

        ImGui::PopStyleVar(2);
    }

    void FileExplorerPanel::show_search_bar(FileExplorerState& state) {

        ImGui::PushStyleVar(ImGuiStyleVar_FramePadding, ImVec2(10, 8));
        ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 4.0f);

        const float btn_size = 32.0f;
        const float spacing = 8.0f;
        // Two buttons: search icon + options (···)
        const float total_available = ImGui::GetContentRegionAvail().x;
        const float path_width = std::max(100.0f, total_available - (btn_size + spacing) * 2);

        // --- Path bar ---
        ImGui::PushStyleColor(ImGuiCol_FrameBg, ImVec4(0.21f, 0.21f, 0.21f, 1.0f));
        ImGui::SetNextItemWidth(path_width);
        bool entered = ImGui::InputTextWithHint("##path", "Go to path...",
            state.search_path,
            sizeof(state.search_path) - 1,
            ImGuiInputTextFlags_EnterReturnsTrue);
        if (entered) {
            navigate_to_path(state.search_path, true, false);
        }
        ImGui::PopStyleColor();

        ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.21f, 0.21f, 0.21f, 1.0f));
        ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.28f, 0.28f, 0.28f, 1.0f));
        ImGui::PushStyleColor(ImGuiCol_ButtonActive, ImVec4(0.16f, 0.16f, 0.16f, 1.0f));

        // --- Search icon (opens inline search) ---
        ImGui::SameLine(0, spacing);
        auto& search_tex = core::AssetManager::get().get_svg_texture("search-16", 16);
        if (search_tex.id != 0) {
            if (ImGui::ImageButton("##opensearch", search_tex.id,
                    ImVec2(16, 16), ImVec2(0, 0), ImVec2(1, 1),
                    ImVec4(0, 0, 0, 0), ImVec4(0.7f, 0.7f, 0.7f, 1.0f))) {
                registry_.get_state<SearchState>("Search").is_open = true;
            }
        } else {
            if (ImGui::Button("S", ImVec2(btn_size, 0)))
                registry_.get_state<SearchState>("Search").is_open = true;
        }
        if (ImGui::IsItemHovered()) ImGui::SetTooltip("Search (Cmd+K)");

        // Options (···) button
        ImGui::SameLine(0, spacing);
        if (ImGui::Button("···", ImVec2(btn_size, 0))) {
            ImGui::OpenPopup("ViewOptionsPopup");
        }
        if (ImGui::IsItemHovered()) {
            ImGui::SetTooltip("View Options");
        }

        ImGui::PopStyleColor(3);

        // View options popup
        ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(12.0f, 8.0f));
        ImGui::PushStyleVar(ImGuiStyleVar_ItemSpacing, ImVec2(10.0f, 6.0f));
        ImGui::PushStyleColor(ImGuiCol_PopupBg, ImVec4(0.15f, 0.15f, 0.15f, 0.95f));
        ImGui::PushStyleColor(ImGuiCol_Border, ImVec4(0.3f, 0.3f, 0.3f, 0.6f));

        if (ImGui::BeginPopup("ViewOptionsPopup")) {
            if (ImGui::MenuItem("List View", nullptr, !state.grid_view)) {
                state.grid_view = false;
            }
            if (ImGui::MenuItem("Grid View", nullptr, state.grid_view)) {
                state.grid_view = true;
            }

            bool is_local = !path_utils::is_onedrive_path(state.current_path)
                         && !path_utils::is_gdrive_path(state.current_path)
                         && !path_utils::is_dropbox_path(state.current_path)
                         && !path_utils::is_icloud_path(state.current_path);
            if (is_local) {
                ImGui::Separator();
                if (ImGui::MenuItem("Show Hidden Files", nullptr, state.show_hidden)) {
                    state.show_hidden = !state.show_hidden;
                    std::string current(state.current_path);
                    if (!current.empty()) {
                        navigate_to_path(current, false);
                    }
                }
            }

            ImGui::EndPopup();
        }

        ImGui::PopStyleColor(2);
        ImGui::PopStyleVar(2);

        ImGui::PopStyleVar(2);
    }

    void FileExplorerPanel::show_directory_contents(FileExplorerState& state) {
        static ImGuiTableFlags flags = ImGuiTableFlags_Reorderable | ImGuiTableFlags_Sortable |
            ImGuiTableFlags_Hideable |
            ImGuiTableFlags_ScrollY | ImGuiTableFlags_Resizable;

        // Keyboard shortcuts
        if (state.is_loading) {
            ImGui::Text("Loading...");
            return;
        }

        // Keyboard shortcuts - only allowed when not loading
        ImGuiIO& io = ImGui::GetIO();
        if (ImGui::IsWindowFocused(ImGuiFocusedFlags_RootAndChildWindows) && !io.WantTextInput) {
            // Check both Ctrl and Super (Cmd) to be robust across configurations
            bool ctrl = io.KeyCtrl || io.KeySuper;

            if (ctrl && ImGui::IsKeyPressed(ImGuiKey_C)) {
                perform_copy(state);
            }
            if (ctrl && ImGui::IsKeyPressed(ImGuiKey_X)) {
                perform_cut(state);
            }
            if (ctrl && ImGui::IsKeyPressed(ImGuiKey_V)) {
                if (state.clipboard_op != ClipboardOp::NONE && !state.clipboard_items.empty()) {
                    perform_paste(state);
                }
            }
            if (ImGui::IsKeyPressed(ImGuiKey_Delete) || ImGui::IsKeyPressed(ImGuiKey_Backspace)) {
                if (!state.selected_files.empty()) {
                    perform_delete_selected(state);
                }
            }
            if (ImGui::IsKeyPressed(ImGuiKey_F2)) {
                if (!state.selected_files.empty()) {
                    initiate_rename(state);
                }
            }
        }

        // Light gray selection; hover on selected items stays the same gray
        ImGui::PushStyleColor(ImGuiCol_Header,        ImVec4(0.45f, 0.45f, 0.45f, 0.35f));  // selected
        ImGui::PushStyleColor(ImGuiCol_HeaderHovered,  ImVec4(0.45f, 0.45f, 0.45f, 0.35f)); // selected + hovered (no change)
        ImGui::PushStyleColor(ImGuiCol_HeaderActive,   ImVec4(0.45f, 0.45f, 0.45f, 0.45f)); // click

        if (state.grid_view) {
            // Grid layout
            const float cell_w = 100.0f;
            const float cell_h = 90.0f;
            const float padding = 8.0f;
            float avail_w = ImGui::GetContentRegionAvail().x;
            int cols = std::max(1, (int)(avail_w / (cell_w + padding)));

            ImGui::PushStyleVar(ImGuiStyleVar_ItemSpacing, ImVec2(padding, padding));

            if (state.files.empty()) {
                ImGui::TextDisabled("No files found...");
            } else {
                // Wrap in a child window for scrolling
                ImGui::BeginChild("##grid_scroll", ImVec2(0, 0), false, ImGuiWindowFlags_NoScrollbar);
                for (int i = 0; i < (int)state.files.size(); i++) {
                    if (i % cols != 0) ImGui::SameLine();
                    show_grid_item(state, i, cell_w, cell_h);
                }

                // Background right-click in grid
                if (ImGui::IsMouseClicked(ImGuiMouseButton_Right)
                    && ImGui::IsWindowHovered(ImGuiHoveredFlags_AllowWhenBlockedByPopup)
                    && !ImGui::IsAnyItemHovered()
                    && !ImGui::IsPopupOpen("FileContextMenu")) {
                    state.context_menu_target_path.clear();
                    state.selected_files.clear();
                    ImGui::OpenPopup("BackgroundContextMenu");
                }

                show_context_menu(state);
                show_background_context_menu(state);
                ImGui::EndChild();
            }

            ImGui::PopStyleVar();
        } else {
            // List/table layout
            if (ImGui::BeginTable("FileTable", 5, flags)) {
                ImGui::TableSetupColumn("Name", ImGuiTableColumnFlags_WidthStretch);
                ImGui::TableSetupColumn("Size", ImGuiTableColumnFlags_WidthFixed, 80.0f);
                ImGui::TableSetupColumn("Type", ImGuiTableColumnFlags_WidthFixed, 80.0f);
                ImGui::TableSetupColumn("Last Modified", ImGuiTableColumnFlags_WidthFixed, 150.0f);
                ImGui::TableSetupColumn("Status", ImGuiTableColumnFlags_WidthFixed, 60.0f);
                ImGui::TableHeadersRow();

                if (state.files.empty()) {
                    ImGui::TableNextRow();
                    ImGui::TableNextColumn();
                    float column_width = ImGui::GetColumnWidth();

                    const char* text = "No files found...";
                    float text_width = ImGui::CalcTextSize(text).x;
                    float padding = (column_width - text_width) * 0.5f;
                    if (padding > 0) {
                        ImGui::SetCursorPosX(ImGui::GetCursorPosX() + padding);
                    }
                    ImGui::TextDisabled("%s", text);
                }
                else {
                    for (int i = 0; i < (int)state.files.size(); i++) {
                        show_file_item(state, i);
                    }
                }
                if (ImGuiTableSortSpecs* sorts_specs = ImGui::TableGetSortSpecs()) {
                    if (sorts_specs->SpecsDirty) {
                        sorts_specs->SpecsDirty = false;
                    }
                }

                // Context menu popup (must be inside the table scope for ID stack)
                show_context_menu(state);

                // Background right-click (empty space in table)
                if (ImGui::IsMouseClicked(ImGuiMouseButton_Right)
                    && ImGui::IsWindowHovered(ImGuiHoveredFlags_AllowWhenBlockedByPopup)
                    && !ImGui::IsAnyItemHovered()
                    && !ImGui::IsPopupOpen("FileContextMenu")) {
                    state.context_menu_target_path.clear();
                    state.selected_files.clear();
                    ImGui::OpenPopup("BackgroundContextMenu");
                }

                show_background_context_menu(state);

                ImGui::EndTable();
            }
        }

        ImGui::PopStyleColor(3);

        // Modals (rendered outside table)
        show_rename_modal(state);
        show_new_entry_modal(state);
    }

    void FileExplorerPanel::show_file_item(FileExplorerState& state, int i) {
        ImGuiIO& io = ImGui::GetIO();
        const UnifiedFileItem& file = state.files[i];

        bool is_currently_selected = state.selected_files.count(file.path) > 0;

        // Determine icon based on file type/state
        std::string icon_name = "file-16";
        if (state.is_downloading(file.path)) {
            icon_name = "download-16";
        } else if (file.is_dir) {
            icon_name = "file-directory-fill-16";
        } else {
            // Check extension
            std::string ext = fs::path(file.name).extension().string();
            // Simple extension mapping
            if (ext == ".cpp" || ext == ".h" || ext == ".hpp" || ext == ".c" || ext == ".cc" || 
                ext == ".js" || ext == ".ts" || ext == ".html" || ext == ".css" || ext == ".json" ||
                ext == ".py" || ext == ".go" || ext == ".rs" || ext == ".java") {
                icon_name = "file-code-16";
            } else if (ext == ".png" || ext == ".jpg" || ext == ".jpeg" || ext == ".gif" || ext == ".svg" || ext == ".webp") {
                icon_name = "file-media-16";
            } else if (ext == ".mp4" || ext == ".mov" || ext == ".avi" || ext == ".mkv") {
                icon_name = "video-16";
            } else if (ext == ".zip" || ext == ".tar" || ext == ".gz" || ext == ".7z" || ext == ".rar") {
                icon_name = "file-zip-16";
            }
        }

        auto& icon = AssetManager::get().get_svg_texture(icon_name, 16);

        // Increase row height for improved padding
        float row_height = 32.0f;
        ImGui::TableNextRow(ImGuiTableRowFlags_None, row_height);
        ImGui::TableNextColumn();

        // Unique ID for Selectable
        std::string label_id = "##";
        if (!file.dbx_item_id.empty()) {
            label_id += file.dbx_item_id;
        } else if (!file.gd_item_id.empty()) {
            label_id += file.gd_item_id;
        } else if (!file.od_item_id.empty()) {
            label_id += file.od_item_id;
        } else {
            label_id += file.path;
        }

        // Draw Selectable (full row width/height, handles background and interaction)
        ImVec2 p = ImGui::GetCursorScreenPos();

        // Render Selectable
        if (ImGui::Selectable(label_id.c_str(), is_currently_selected, ImGuiSelectableFlags_SpanAllColumns | ImGuiSelectableFlags_AllowDoubleClick, ImVec2(0, row_height))) {
            if (io.KeyCtrl) {
                if (is_currently_selected) state.selected_files.erase(file.path);
                else state.selected_files.insert(file.path);
            }
            else if (io.KeyShift && state.last_selected_index != -1) {
                state.selected_files.clear();
                int start = std::min(state.last_selected_index, i);
                int end = std::max(state.last_selected_index, i);
                for (int j = start; j <= end; j++) state.selected_files.insert(state.files[j].path);
            }
            else {
                state.selected_files.clear();
                state.selected_files.insert(file.path);
            }
            state.last_selected_index = i;
        }

        // Draw hover gradient (left-to-right fade) when not selected
        if (ImGui::IsItemHovered() && !is_currently_selected) {
            ImDrawList* dl = ImGui::GetWindowDrawList();
            ImVec2 row_min = p;
            ImVec2 row_max = ImVec2(p.x + ImGui::GetContentRegionAvail().x, p.y + row_height);
            ImU32 col_left  = ImGui::IsItemActive()
                ? IM_COL32(255, 255, 255, 30)
                : IM_COL32(255, 255, 255, 20);
            ImU32 col_right = IM_COL32(255, 255, 255, 0);
            dl->AddRectFilledMultiColor(row_min, row_max, col_left, col_right, col_right, col_left);
        }

        // Context menu logic (moved here to apply to the entire Selectable row)
        if (ImGui::IsItemClicked(ImGuiMouseButton_Right)) {
            state.context_menu_target_path = file.path;
            if (!is_currently_selected) {
                state.selected_files.clear();
                state.selected_files.insert(file.path);
                state.last_selected_index = i;
            }
            ImGui::OpenPopup("FileContextMenu");
        }

        // Double click logic (must check IsItemHovered on the selectable)
        if (ImGui::IsItemHovered() && ImGui::IsMouseDoubleClicked(0)) {
            if (file.is_dir) {
                // Copy path before navigating — navigate_to_path replaces state.files,
                // which invalidates the `file` reference.
                std::string nav_path = file.path;
                navigate_to_path(nav_path);
                return; // state.files replaced; `file` ref is dangling
            }
            else {
                // Open file logic
                if (file.source == FileSource::LOCAL) {
                    state.add_recent(file);
                    open_file(file.path);
                } else if (file.source == FileSource::ONEDRIVE) {
                    if (fs::exists(file.path)) {
                        state.add_recent(file);
                        open_file(file.path);
                    } else if (!state.is_downloading(file.path)) {
                        state.add_recent(file);
                        download_and_open_file(file);
                    }
                } else if (file.source == FileSource::GDRIVE) {
                    if (file.gd_mime_type.rfind("application/vnd.google-apps.", 0) == 0
                        && file.gd_mime_type != "application/vnd.google-apps.folder") {
                        if (!file.gd_web_url.empty()) {
                            state.add_recent(file);
                            open_file(file.gd_web_url);
                        }
                    } else if (fs::exists(file.path)) {
                        state.add_recent(file);
                        open_file(file.path);
                    } else if (!state.is_downloading(file.path)) {
                        state.add_recent(file);
                        download_and_open_gd_file(file);
                    }
                } else if (file.source == FileSource::ICLOUD) {
                    if (file.is_dir) {
                        navigate_to_path(file.path);
                    } else if (fs::exists(file.path)) {
                        state.add_recent(file);
                        open_file(file.path);
                    } else if (!state.is_downloading(file.path)) {
                        state.add_recent(file);
                        download_and_open_icl_file(file);
                    }
                } else if (file.source == FileSource::DROPBOX) {
                    if (fs::exists(file.path)) {
                        state.add_recent(file);
                        open_file(file.path);
                    } else if (!state.is_downloading(file.path)) {
                        state.add_recent(file);
                        download_and_open_dbx_file(file);
                    }
                }
            }
        }

        // Draw Icon and Name
        // Center icon and text vertically in the row
        float content_padding_y = (row_height - 16.0f) / 2.0f;
        ImVec2 icon_p = ImVec2(p.x + 4.0f, p.y + content_padding_y);
        ImGui::SetCursorScreenPos(icon_p);
        if (icon.id != 0) {
            ImU32 icon_col = file.is_dir ? IM_COL32(230, 191, 76, 255) : IM_COL32(100, 170, 230, 255);
            ImGui::GetWindowDrawList()->AddImage(
                icon.id, icon_p, ImVec2(icon_p.x + 16, icon_p.y + 16),
                ImVec2(0, 0), ImVec2(1, 1), icon_col);
        }
        ImGui::Dummy(ImVec2(16, 16));

        ImGui::SameLine(0, 8.0f);
        // Center text vertically
        float text_y_offset = (row_height - ImGui::GetTextLineHeight()) / 2.0f;
        ImGui::SetCursorScreenPos(ImVec2(ImGui::GetCursorScreenPos().x, p.y + text_y_offset));
        ImGui::TextUnformatted(file.name.c_str());



        // Size column
        ImGui::TableNextColumn();
        ImGui::SetCursorPosY(ImGui::GetCursorPosY() + text_y_offset);
        if (!file.is_dir && file.size > 0) {
            if (file.size < 1024) {
                ImGui::Text("%lld B", file.size);
            } else if (file.size < 1024 * 1024) {
                ImGui::Text("%.1f KB", file.size / 1024.0);
            } else if (file.size < 1024 * 1024 * 1024) {
                ImGui::Text("%.1f MB", file.size / (1024.0 * 1024.0));
            } else {
                ImGui::Text("%.1f GB", file.size / (1024.0 * 1024.0 * 1024.0));
            }
        } else {
            ImGui::Text("-");
        }

        // Type column
        ImGui::TableNextColumn();
        ImGui::SetCursorPosY(ImGui::GetCursorPosY() + text_y_offset);
        ImGui::Text("%s", file.is_dir ? "Folder" : "File");

        // Modified column
        ImGui::TableNextColumn();
        ImGui::SetCursorPosY(ImGui::GetCursorPosY() + text_y_offset);
        if (!file.last_modified.empty()) {
            ImGui::Text("%s", file.last_modified.c_str());
        } else {
            ImGui::Text("-");
        }

        // Status column (Right side)
        ImGui::TableNextColumn();
        
        ImU32 dot_color;
        if (file.status == SyncStatus::DELETED)    dot_color = IM_COL32(0, 0, 0, 255);     // Black
        else if (file.status == SyncStatus::SYNCED) dot_color = IM_COL32(0, 150, 0, 255); // Green
        else if (file.status == SyncStatus::LOCAL) dot_color = IM_COL32(150, 150, 150, 255);
        else if (file.status == SyncStatus::MODIFIED) dot_color = IM_COL32(241, 196, 15, 255); // Yellow
        else if (file.status == SyncStatus::NOT_SYNCED) dot_color = IM_COL32(231, 76, 60, 255); // Red

        ImVec2 p_dot = ImGui::GetCursorScreenPos();
        // Allow for custom centering since we manually place the dot
        ImGui::GetWindowDrawList()->AddCircleFilled(ImVec2(p_dot.x + 20.0f, p.y + row_height * 0.5f), 4.0f, dot_color);
    }

    // ==================== Grid Item ====================

    void FileExplorerPanel::show_grid_item(FileExplorerState& state, int i, float cell_w, float cell_h) {
        ImGuiIO& io = ImGui::GetIO();
        const UnifiedFileItem& file = state.files[i];
        bool is_selected = state.selected_files.count(file.path) > 0;

        // Determine icon
        std::string icon_name = "file-16";
        if (state.is_downloading(file.path)) {
            icon_name = "download-16";
        } else if (file.is_dir) {
            icon_name = "file-directory-fill-16";
        } else {
            std::string ext = fs::path(file.name).extension().string();
            if (ext == ".cpp" || ext == ".h" || ext == ".hpp" || ext == ".c" || ext == ".cc" ||
                ext == ".js" || ext == ".ts" || ext == ".html" || ext == ".css" || ext == ".json" ||
                ext == ".py" || ext == ".go" || ext == ".rs" || ext == ".java") {
                icon_name = "file-code-16";
            } else if (ext == ".png" || ext == ".jpg" || ext == ".jpeg" || ext == ".gif" || ext == ".svg" || ext == ".webp") {
                icon_name = "file-media-16";
            } else if (ext == ".mp4" || ext == ".mov" || ext == ".avi" || ext == ".mkv") {
                icon_name = "video-16";
            } else if (ext == ".zip" || ext == ".tar" || ext == ".gz" || ext == ".7z" || ext == ".rar") {
                icon_name = "file-zip-16";
            }
        }
        auto& icon = AssetManager::get().get_svg_texture(icon_name, 32);

        ImVec2 cell_pos = ImGui::GetCursorScreenPos();

        // InvisibleButton for interaction (sized to full cell)
        std::string btn_id = "##grid_" + std::to_string(i);
        bool clicked = ImGui::InvisibleButton(btn_id.c_str(), ImVec2(cell_w, cell_h));

        bool hovered = ImGui::IsItemHovered();
        bool double_clicked = hovered && ImGui::IsMouseDoubleClicked(0);

        // Background fill
        ImDrawList* dl = ImGui::GetWindowDrawList();
        ImVec2 cell_max = ImVec2(cell_pos.x + cell_w, cell_pos.y + cell_h);
        if (is_selected) {
            dl->AddRectFilled(cell_pos, cell_max, IM_COL32(255, 255, 255, 40), 6.0f);
        } else if (hovered) {
            dl->AddRectFilled(cell_pos, cell_max, IM_COL32(255, 255, 255, 20), 6.0f);
        }

        // Icon (centered, 32px)
        const float icon_size = 32.0f;
        float icon_x = cell_pos.x + (cell_w - icon_size) * 0.5f;
        float icon_y = cell_pos.y + 10.0f;
        if (icon.id != 0) {
            ImU32 icon_col = file.is_dir ? IM_COL32(230, 191, 76, 255) : IM_COL32(100, 170, 230, 255);
            dl->AddImage(icon.id, ImVec2(icon_x, icon_y), ImVec2(icon_x + icon_size, icon_y + icon_size),
                ImVec2(0, 0), ImVec2(1, 1), icon_col);
        }

        // Name (centered, clipped to cell width)
        float text_y = icon_y + icon_size + 6.0f;
        ImVec2 name_size = ImGui::CalcTextSize(file.name.c_str(), nullptr, false, cell_w - 4.0f);
        float text_x = cell_pos.x + (cell_w - std::min(name_size.x, cell_w - 4.0f)) * 0.5f;
        dl->AddText(ImGui::GetFont(), ImGui::GetFontSize(),
            ImVec2(text_x, text_y),
            is_selected ? IM_COL32(255, 255, 255, 255) : IM_COL32(212, 212, 216, 255),
            file.name.c_str(), nullptr, cell_w - 4.0f);

        // Click selection
        if (clicked) {
            if (io.KeyCtrl) {
                if (is_selected) state.selected_files.erase(file.path);
                else state.selected_files.insert(file.path);
            } else if (io.KeyShift && state.last_selected_index != -1) {
                state.selected_files.clear();
                int start = std::min(state.last_selected_index, i);
                int end = std::max(state.last_selected_index, i);
                for (int j = start; j <= end; j++) state.selected_files.insert(state.files[j].path);
            } else {
                state.selected_files.clear();
                state.selected_files.insert(file.path);
            }
            state.last_selected_index = i;
        }

        // Double-click navigation / open
        if (double_clicked) {
            if (file.is_dir) {
                std::string nav_path = file.path;
                navigate_to_path(nav_path);
                return;
            } else {
                if (file.source == FileSource::LOCAL) {
                    state.add_recent(file);
                    open_file(file.path);
                } else if (file.source == FileSource::ONEDRIVE) {
                    if (fs::exists(file.path)) { state.add_recent(file); open_file(file.path); }
                    else if (!state.is_downloading(file.path)) { state.add_recent(file); download_and_open_file(file); }
                } else if (file.source == FileSource::GDRIVE) {
                    if (fs::exists(file.path)) { state.add_recent(file); open_file(file.path); }
                    else if (!state.is_downloading(file.path)) { state.add_recent(file); download_and_open_gd_file(file); }
                } else if (file.source == FileSource::DROPBOX) {
                    if (fs::exists(file.path)) { state.add_recent(file); open_file(file.path); }
                    else if (!state.is_downloading(file.path)) { state.add_recent(file); download_and_open_dbx_file(file); }
                } else if (file.source == FileSource::ICLOUD) {
                    if (fs::exists(file.path)) { state.add_recent(file); open_file(file.path); }
                    else if (!state.is_downloading(file.path)) { state.add_recent(file); download_and_open_icl_file(file); }
                }
            }
        }

        // Right-click context menu
        if (ImGui::IsItemClicked(ImGuiMouseButton_Right)) {
            state.context_menu_target_path = file.path;
            if (!is_selected) {
                state.selected_files.clear();
                state.selected_files.insert(file.path);
                state.last_selected_index = i;
            }
            ImGui::OpenPopup("FileContextMenu");
        }
    }

    // ==================== Context Menu & File Operations ====================

    void FileExplorerPanel::show_context_menu(FileExplorerState& state) {
        ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(12.0f, 8.0f));
        ImGui::PushStyleVar(ImGuiStyleVar_ItemSpacing, ImVec2(10.0f, 6.0f));
        ImGui::PushStyleVar(ImGuiStyleVar_PopupRounding, 6.0f);
        ImGui::PushStyleColor(ImGuiCol_PopupBg, ImVec4(0.15f, 0.15f, 0.15f, 0.95f));
        ImGui::PushStyleColor(ImGuiCol_Border, ImVec4(0.3f, 0.3f, 0.3f, 0.6f));

        if (ImGui::BeginPopup("FileContextMenu")) {

            // Determine if target is a local file
            // REMOVED: bool is_local = ...
            // We now check individual file status to determine capabilities.

            bool show_menu = false;
            SyncStatus status = SyncStatus::LOCAL; // Default
            
            for (const auto& f : state.files) {
                if (f.path == state.context_menu_target_path) {
                    status = f.status;
                    show_menu = true;
                    break;
                }
            }

            if (show_menu) {
                // Determine if we can modify this file (Copy/Cut/Rename/Delete)
                // Determine if we can modify this file (Copy/Cut/Rename/Delete)
                // Logical rule: Can modify if it's local OR (synced/modified and exists locally)
                // The user said: "allow ... for those files that are "local" or have green/yellow dots"
                // Actually if it's NOT_SYNCED (Red), we probably can't Copy/Cut content locally, but we might be able to Rename/Delete the cloud reference?
                // User said: "since we know we 'downloaded' them".
                // So strict check: LOCAL or SYNCED or MODIFIED.
                
                // However, show_context_menu logic handles "is_local" based on path prefix.
                // If it's a cloud path, is_local is false.
                // Wait, the existing code: bool is_local = !path_utils::is_onedrive_path(...)
                // This variable 'is_local' means "Associated with Local File Source" in a broad sense?
                // Actually my variable 'is_local' in show_context_menu determines if we show the menu AT ALL.
                // Lines 811: bool is_local = true (default) is overridden?
                // No, line 822: if (is_local) ...
                
                // I need to check the status of the specific target file.
                // But context_menu_target_path is just a string.
                // I need to find the SyncStatus of that file.
                // I can look it up in state.files?
                SyncStatus target_status = SyncStatus::LOCAL;
                for(const auto& f : state.files) {
                    if(f.path == state.context_menu_target_path) {
                        target_status = f.status;
                        break;
                    }
                }
                
                // Check if all selected files are available locally (LOCAL, SYNCED, or MODIFIED)
                bool all_local_available = true;
                bool is_trash_view = (std::string(state.current_path) == FileExplorerState::VIRTUAL_PATH_TRASH);
                
                // If selection is empty, nothing is available
                if (state.selected_files.empty()) {
                    all_local_available = false;
                } else {
                    for (const auto& f : state.files) {
                        if (state.selected_files.count(f.path) > 0) {
                            bool is_avail = (f.status == SyncStatus::LOCAL || 
                                             f.status == SyncStatus::SYNCED || 
                                             f.status == SyncStatus::MODIFIED);
                            if (!is_avail) {
                                all_local_available = false;
                                break; 
                            }
                        }
                    }
                }

                // Copy/Cut require local availability
                if (all_local_available) {
                    if (ImGui::MenuItem("Copy", "Cmd+C")) {
                        perform_copy(state);
                    }

                    if (ImGui::MenuItem("Cut", "Cmd+X")) {
                        perform_cut(state);
                    }
                } else {
                    ImGui::MenuItem("Copy", "Cmd+C", false, false);
                    ImGui::MenuItem("Cut", "Cmd+X", false, false);
                }

                bool can_paste = state.clipboard_op != ClipboardOp::NONE && !state.clipboard_items.empty();
                if (ImGui::MenuItem("Paste", "Cmd+V", false, can_paste)) {
                    perform_paste(state);
                }

                ImGui::Separator();

                // Rename requires local availability AND single selection
                if (all_local_available && state.selected_files.size() == 1) {
                    if (ImGui::MenuItem("Rename", "F2")) {
                        initiate_rename(state);
                    }
                } else {
                    ImGui::MenuItem("Rename", "F2", false, false);
                }

                ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(1.0f, 0.4f, 0.4f, 1.0f));
                // Delete requires local availability OR being in trash
                if (all_local_available || is_trash_view) {
                    if (ImGui::MenuItem("Delete", "Del")) { 
                        perform_delete_selected(state);
                    }
                } else {
                    ImGui::MenuItem("Delete", "Del", false, false); 
                }
                ImGui::PopStyleColor();

                ImGui::Separator();

                // Star/Unstar
                bool is_starred = state.is_starred(state.context_menu_target_path);
                if (ImGui::MenuItem(is_starred ? "Remove from Starred" : "Add to Starred")) {
                    for (const auto& f : state.files) {
                        if (f.path == state.context_menu_target_path) {
                            state.toggle_star(f);
                            auto& notif = registry_.get_state<NotificationState>("Notifications");
                            if (is_starred) {
                                notif.add_notification("Starred", "Removed from starred", NotificationType::SUCCESS);
                            } else {
                                notif.add_notification("Starred", "Added to starred", NotificationType::SUCCESS);
                            }
                            break;
                        }
                    }
                }
                
                ImGui::Separator();

                if (ImGui::MenuItem("New File")) {
                    state.new_entry_is_dir = false;
                    state.new_entry_name_buffer[0] = '\0';
                    state.show_new_entry_modal = true;
                }

                if (ImGui::MenuItem("New Folder")) {
                    state.new_entry_is_dir = true;
                    state.new_entry_name_buffer[0] = '\0';
                    state.show_new_entry_modal = true;
                }
            } else {
                // Cloud file - limited menu
                if (ImGui::MenuItem("Copy Path")) {
                    ImGui::SetClipboardText(state.context_menu_target_path.c_str());
                }
            }

            ImGui::EndPopup();
        }

        ImGui::PopStyleColor(2);
        ImGui::PopStyleVar(3);
    }

    void FileExplorerPanel::show_rename_modal(FileExplorerState& state) {
        if (state.show_rename_modal) {
            ImGui::OpenPopup("Rename##Modal");
        }

        ImGui::SetNextWindowPos(ImGui::GetMainViewport()->GetCenter(), ImGuiCond_Appearing, ImVec2(0.5f, 0.5f));
        ImGui::SetNextWindowSize(ImVec2(400, 0), ImGuiCond_Appearing);

        ImGui::PushStyleVar(ImGuiStyleVar_WindowRounding, 8.0f);
        ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(20.0f, 16.0f));
        ImGui::PushStyleColor(ImGuiCol_PopupBg, ImVec4(0.16f, 0.16f, 0.16f, 1.0f));

        if (ImGui::BeginPopupModal("Rename##Modal", &state.show_rename_modal,
            ImGuiWindowFlags_NoResize | ImGuiWindowFlags_NoMove | ImGuiWindowFlags_AlwaysAutoResize)) {

            ImGui::Text("Enter new name:");
            ImGui::Spacing();

            ImGui::PushStyleVar(ImGuiStyleVar_FramePadding, ImVec2(10, 8));
            ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 4.0f);
            ImGui::PushStyleColor(ImGuiCol_FrameBg, ImVec4(0.21f, 0.21f, 0.21f, 1.0f));

            float width = ImGui::GetContentRegionAvail().x;
            ImGui::SetNextItemWidth(width);

            bool entered = ImGui::InputText("##rename_input", state.rename_buffer,
                sizeof(state.rename_buffer), ImGuiInputTextFlags_EnterReturnsTrue);

            // Auto-focus the input on first appearance
            if (ImGui::IsWindowAppearing()) {
                ImGui::SetKeyboardFocusHere(-1);
            }

            ImGui::PopStyleColor();
            ImGui::PopStyleVar(2);

            ImGui::Spacing();
            ImGui::Spacing();

            float button_width = (width - 8.0f) * 0.5f;

            ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 4.0f);

            ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.2f, 0.5f, 0.9f, 1.0f));
            ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.3f, 0.6f, 1.0f, 1.0f));
            if (ImGui::Button("Rename", ImVec2(button_width, 32)) || entered) {
                std::string new_name(state.rename_buffer);
                if (!new_name.empty() && !state.rename_target_path.empty()) {
                    fs::path old_path(state.rename_target_path);
                    fs::path new_path = old_path.parent_path() / new_name;
                    std::error_code ec;
                    fs::rename(old_path, new_path, ec);
                    if (!ec) {
                        auto& notif = registry_.get_state<NotificationState>("Notifications");
                        notif.add_notification("Renamed", "Renamed to " + new_name, NotificationType::SUCCESS);
                        
                        // Refresh
                        navigate_to_path(std::string(state.current_path), false);
                    }
                }
                state.show_rename_modal = false;
                ImGui::CloseCurrentPopup();
            }
            ImGui::PopStyleColor(2);

            ImGui::SameLine(0, 8.0f);

            ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.3f, 0.3f, 0.3f, 1.0f));
            ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.4f, 0.4f, 0.4f, 1.0f));
            if (ImGui::Button("Cancel", ImVec2(button_width, 32))) {
                state.show_rename_modal = false;
                ImGui::CloseCurrentPopup();
            }
            ImGui::PopStyleColor(2);

            ImGui::PopStyleVar();

            ImGui::EndPopup();
        }

        ImGui::PopStyleColor();
        ImGui::PopStyleVar(2);
    }

    void FileExplorerPanel::show_background_context_menu(FileExplorerState& state) {
        ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(12.0f, 8.0f));
        ImGui::PushStyleVar(ImGuiStyleVar_ItemSpacing, ImVec2(10.0f, 6.0f));
        ImGui::PushStyleVar(ImGuiStyleVar_PopupRounding, 6.0f);
        ImGui::PushStyleColor(ImGuiCol_PopupBg, ImVec4(0.15f, 0.15f, 0.15f, 0.95f));
        ImGui::PushStyleColor(ImGuiCol_Border, ImVec4(0.3f, 0.3f, 0.3f, 0.6f));

        if (ImGui::BeginPopup("BackgroundContextMenu")) {
            bool is_cloud = path_utils::is_onedrive_path(state.current_path)
                          || path_utils::is_gdrive_path(state.current_path)
                          || path_utils::is_dropbox_path(state.current_path);
            bool is_local = !is_cloud;

            // Paste is available in both local and cloud directories
            bool can_paste = state.clipboard_op != ClipboardOp::NONE && !state.clipboard_items.empty();
            if (ImGui::MenuItem("Paste", "Cmd+V", false, can_paste)) {
                perform_paste(state);
            }

            ImGui::Separator();

            if (ImGui::MenuItem("New File")) {
                state.new_entry_is_dir = false;
                state.new_entry_name_buffer[0] = '\0';
                state.show_new_entry_modal = true;
            }

            if (ImGui::MenuItem("New Folder")) {
                state.new_entry_is_dir = true;
                state.new_entry_name_buffer[0] = '\0';
                state.show_new_entry_modal = true;
            }

            if (is_local) {
                ImGui::Separator();
                if (ImGui::MenuItem("Show Hidden Files", nullptr, state.show_hidden)) {
                    state.show_hidden = !state.show_hidden;
                    navigate_to_path(std::string(state.current_path), false);
                }
            }

            ImGui::EndPopup();
        }

        ImGui::PopStyleColor(2);
        ImGui::PopStyleVar(3);
    }

    void FileExplorerPanel::show_new_entry_modal(FileExplorerState& state) {
        const char* title = state.new_entry_is_dir ? "New Folder##explorer" : "New File##explorer";

        if (state.show_new_entry_modal) {
            ImGui::OpenPopup(title);
            state.show_new_entry_modal = false;
        }

        ImGui::SetNextWindowPos(ImGui::GetMainViewport()->GetCenter(), ImGuiCond_Appearing, ImVec2(0.5f, 0.5f));
        ImGui::SetNextWindowSize(ImVec2(400, 0), ImGuiCond_Appearing);

        ImGui::PushStyleVar(ImGuiStyleVar_WindowRounding, 8.0f);
        ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(20.0f, 16.0f));
        ImGui::PushStyleColor(ImGuiCol_PopupBg, ImVec4(0.16f, 0.16f, 0.16f, 1.0f));

        if (ImGui::BeginPopupModal(title, nullptr,
            ImGuiWindowFlags_NoResize | ImGuiWindowFlags_NoMove | ImGuiWindowFlags_AlwaysAutoResize)) {

            ImGui::Text("%s name:", state.new_entry_is_dir ? "Folder" : "File");
            ImGui::Spacing();

            ImGui::PushStyleVar(ImGuiStyleVar_FramePadding, ImVec2(10, 8));
            ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 4.0f);
            ImGui::PushStyleColor(ImGuiCol_FrameBg, ImVec4(0.21f, 0.21f, 0.21f, 1.0f));

            float width = ImGui::GetContentRegionAvail().x;
            ImGui::SetNextItemWidth(width);

            bool entered = ImGui::InputText("##new_entry_input", state.new_entry_name_buffer,
                sizeof(state.new_entry_name_buffer), ImGuiInputTextFlags_EnterReturnsTrue);

            if (ImGui::IsWindowAppearing()) {
                ImGui::SetKeyboardFocusHere(-1);
            }

            ImGui::PopStyleColor();
            ImGui::PopStyleVar(2);

            ImGui::Spacing();
            ImGui::Spacing();

            float button_width = (width - 8.0f) * 0.5f;

            ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 4.0f);

            ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.2f, 0.5f, 0.9f, 1.0f));
            ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.3f, 0.6f, 1.0f, 1.0f));
            if (ImGui::Button("Create##new_entry", ImVec2(button_width, 32)) || entered) {
                std::string name(state.new_entry_name_buffer);
                std::string current_dir(state.current_path);
                bool is_cloud_dir = path_utils::is_onedrive_path(current_dir)
                                 || path_utils::is_gdrive_path(current_dir)
                                 || path_utils::is_dropbox_path(current_dir);

                if (!name.empty()) {
                    fs::path p = fs::path(current_dir) / name;
                    std::error_code ec;

                    if (state.new_entry_is_dir) {
                        // Create local directory
                        fs::create_directory(p, ec);

                        // Also create on cloud if in cloud directory
                        if (!ec && is_cloud_dir) {
                            auto& services = registry_.get_state<ServicesState>("Services");
                            auto& notif = registry_.get_state<NotificationState>("Notifications");

                            if (path_utils::is_onedrive_path(current_dir)) {
                                auto& od_state = registry_.get_state<OneDriveState>("OneDrive");
                                if (od_state.has_upload_context()) {
                                    auto ctx = od_state.get_upload_context();
                                    services.create_onedrive_folder(ctx.ms_user_id, ctx.drive_id, ctx.folder_id, name,
                                        [this, name](bool success, const std::string&, const std::string& error) {
                                            auto& notif = registry_.get_state<NotificationState>("Notifications");
                                            if (success) {
                                                notif.add_notification("Created", "Folder " + name + " created on OneDrive", NotificationType::SUCCESS);
                                            } else {
                                                notif.add_notification("Cloud Error", "Failed to create folder on OneDrive: " + error, NotificationType::ERROR);
                                            }
                                        });
                                }
                            } else if (path_utils::is_gdrive_path(current_dir)) {
                                auto& gd_state = registry_.get_state<GDriveState>("GDrive");
                                if (gd_state.has_upload_context()) {
                                    auto ctx = gd_state.get_upload_context();
                                    services.create_gdrive_folder(ctx.gd_user_id, ctx.folder_id, name,
                                        [this, name](bool success, const std::string&, const std::string& error) {
                                            auto& notif = registry_.get_state<NotificationState>("Notifications");
                                            if (success) {
                                                notif.add_notification("Created", "Folder " + name + " created on Google Drive", NotificationType::SUCCESS);
                                            } else {
                                                notif.add_notification("Cloud Error", "Failed to create folder on Google Drive: " + error, NotificationType::ERROR);
                                            }
                                        });
                                }
                            } else if (path_utils::is_dropbox_path(current_dir)) {
                                auto& dbx_state = registry_.get_state<DropboxState>("Dropbox");
                                if (dbx_state.has_upload_context()) {
                                    auto ctx = dbx_state.get_upload_context();
                                    services.create_dbx_folder(ctx.dbx_user_id, ctx.folder_path, name,
                                        [this, name](bool success, const std::string&, const std::string& error) {
                                            auto& notif = registry_.get_state<NotificationState>("Notifications");
                                            if (success) {
                                                notif.add_notification("Created", "Folder " + name + " created on Dropbox", NotificationType::SUCCESS);
                                            } else {
                                                notif.add_notification("Cloud Error", "Failed to create folder on Dropbox: " + error, NotificationType::ERROR);
                                            }
                                        });
                                }
                            }
                        }
                    } else {
                        // Create empty file locally
                        if (auto f = std::fopen(p.string().c_str(), "w")) {
                            std::fclose(f);
                        }

                        // Upload to cloud if in cloud directory
                        if (is_cloud_dir) {
                            trigger_upload(p.string(), current_dir);
                        }
                    }

                    if (!ec) {
                        auto& notif = registry_.get_state<NotificationState>("Notifications");
                        notif.add_notification("Created", std::string(state.new_entry_is_dir ? "Folder " : "File ") + name + " created", NotificationType::SUCCESS);
                        navigate_to_path(current_dir, false);
                    }
                }
                state.new_entry_name_buffer[0] = '\0';
                ImGui::CloseCurrentPopup();
            }
            ImGui::PopStyleColor(2);

            ImGui::SameLine(0, 8.0f);

            ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.3f, 0.3f, 0.3f, 1.0f));
            ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.4f, 0.4f, 0.4f, 1.0f));
            if (ImGui::Button("Cancel##new_entry", ImVec2(button_width, 32))) {
                state.new_entry_name_buffer[0] = '\0';
                ImGui::CloseCurrentPopup();
            }
            ImGui::PopStyleColor(2);

            ImGui::PopStyleVar();

            ImGui::EndPopup();
        }

        ImGui::PopStyleColor();
        ImGui::PopStyleVar(2);
    }

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
            uint64_t upload_id = uploads.start_upload(file_name, local_path, "OneDrive", file_size);
            notifications.add_notification("Uploading", file_name, NotificationType::DOWNLOAD, 15.0f);

            od_state.upload_file(local_path,
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
            uint64_t upload_id = uploads.start_upload(file_name, local_path, "Google Drive", file_size);
            notifications.add_notification("Uploading", file_name, NotificationType::DOWNLOAD, 15.0f);

            gd_state.upload_file(local_path,
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
            uint64_t upload_id = uploads.start_upload(file_name, local_path, "Dropbox", file_size);
            notifications.add_notification("Uploading", file_name, NotificationType::DOWNLOAD, 15.0f);

            dbx_state.upload_file(local_path,
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
            if (is_trash_view) {
                // Permanent Delete
                perform_delete(state, path);
                
                // Remove from state.trash_files
                auto it = std::remove_if(state.trash_files.begin(), state.trash_files.end(),
                    [&](const UnifiedFileItem& item) { return item.path == path; });
                state.trash_files.erase(it, state.trash_files.end());
            } else {
                // Move to Trash (Local only, Cloud deletes directly)
                bool is_cloud = path_utils::is_onedrive_path(path) || path_utils::is_gdrive_path(path) || path_utils::is_dropbox_path(path) || path_utils::is_icloud_path(path);

                if (is_cloud) {
                     printf("Explorer: Deleting cloud file directly\n");
                     perform_delete(state, path);
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

        if (update_history) {
            std::string current_path_str(state.current_path);
            if (!current_path_str.empty() && current_path_str != new_path) {
                state.back_history.push(current_path_str);
            }
            while (!state.forward_history.empty()) {
                state.forward_history.pop();
            }
        }

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
        strncpy(state.current_path, new_path.c_str(), sizeof(state.current_path) - 1);
        state.current_path[sizeof(state.current_path) - 1] = '\0';
        strncpy(state.search_path, new_path.c_str(), sizeof(state.search_path) - 1);

        state.is_loading = false;
        state.selected_files.clear();
        state.last_selected_index = -1;
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

        if (update_history) {
            std::string current_path_str(state.current_path);
            if (!current_path_str.empty() && current_path_str != target_path) {
                state.back_history.push(current_path_str);
            }
            while (!state.forward_history.empty()) {
                state.forward_history.pop();
            }
        }

        strncpy(state.current_path, target_path.c_str(), sizeof(state.current_path) - 1);
        state.current_path[sizeof(state.current_path) - 1] = '\0';
        strncpy(state.search_path, target_path.c_str(), sizeof(state.search_path) - 1);

        state.selected_files.clear();
        state.last_selected_index = -1;
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

        if (update_history) {
            std::string current_path_str(state.current_path);
            if (!current_path_str.empty() && current_path_str != new_path) {
                state.back_history.push(current_path_str);
            }
            while (!state.forward_history.empty()) {
                state.forward_history.pop();
            }
        }

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
        strncpy(state.current_path, new_path.c_str(), sizeof(state.current_path) - 1);
        state.current_path[sizeof(state.current_path) - 1] = '\0';
        strncpy(state.search_path, new_path.c_str(), sizeof(state.search_path) - 1);

        state.is_loading = false;
        state.selected_files.clear();
        state.last_selected_index = -1;
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

        if (update_history) {
            std::string current_path_str(state.current_path);
            if (!current_path_str.empty() && current_path_str != target_path) {
                state.back_history.push(current_path_str);
            }
            while (!state.forward_history.empty()) {
                state.forward_history.pop();
            }
        }

        strncpy(state.current_path, target_path.c_str(), sizeof(state.current_path) - 1);
        state.current_path[sizeof(state.current_path) - 1] = '\0';
        strncpy(state.search_path, target_path.c_str(), sizeof(state.search_path) - 1);

        state.selected_files.clear();
        state.last_selected_index = -1;
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

        if (update_history) {
            std::string current_path_str(state.current_path);
            if (!current_path_str.empty() && current_path_str != new_path) {
                state.back_history.push(current_path_str);
            }
            while (!state.forward_history.empty()) {
                state.forward_history.pop();
            }
        }

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
        strncpy(state.current_path, new_path.c_str(), sizeof(state.current_path) - 1);
        state.current_path[sizeof(state.current_path) - 1] = '\0';
        strncpy(state.search_path, new_path.c_str(), sizeof(state.search_path) - 1);

        state.is_loading = false;
        state.selected_files.clear();
        state.last_selected_index = -1;
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

        if (update_history) {
            std::string current_path_str(state.current_path);
            if (!current_path_str.empty() && current_path_str != target_path) {
                state.back_history.push(current_path_str);
            }
            while (!state.forward_history.empty()) {
                state.forward_history.pop();
            }
        }

        strncpy(state.current_path, target_path.c_str(), sizeof(state.current_path) - 1);
        state.current_path[sizeof(state.current_path) - 1] = '\0';
        strncpy(state.search_path, target_path.c_str(), sizeof(state.search_path) - 1);

        state.selected_files.clear();
        state.last_selected_index = -1;
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
