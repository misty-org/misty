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
#include "core/commands/command_manager.h"
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

    void FileExplorerPanel::apply_workspace_mount_if_ready(FileExplorerState& state, WorkspaceState& workspace_state) {
        if (workspace_mount_applied_) return;
        if (!workspace_state.has_fetched || workspace_state.is_fetching) return;

        std::string workspace_path = workspace_state.get_current_mount_path();
        if (workspace_path.empty()) {
            workspace_mount_applied_ = true;
            return;
        }

        printf("DEBUG: render - workspace_path=%s, last_opened_path=%s, initial_start_path_=%s\n",
            workspace_path.c_str(), state.last_opened_path.c_str(), initial_start_path_.c_str());

        if (!state.last_opened_path.empty() && initial_start_path_ == state.last_opened_path) {
            workspace_mount_applied_ = true;
            return;
        }

        std::string current_path = state.current_path;
        bool no_history = state.back_history.empty() && state.forward_history.empty();
        bool is_at_initial = current_path.empty() || current_path == initial_start_path_;
        if (no_history && is_at_initial && state.pending_navigation_path.empty()) {
            state.pending_navigation_path = workspace_path;
        }

        workspace_mount_applied_ = true;
    }

    void FileExplorerPanel::handle_pending_navigation(FileExplorerState& state) {
        if (state.pending_navigation_path.empty()) return;

        std::string path = state.pending_navigation_path;
        printf("Explorer: Detected pending navigation to: %s\n", path.c_str());
        state.pending_navigation_path.clear();
        navigate_to_path(path);
    }

    void FileExplorerPanel::render_search_overlay(SearchState& search_state, const ImVec2& list_start, float list_height) {
        if (!search_state.is_open) return;

        float overlay_h = std::min(350.0f, list_height);
        ImGui::SetCursorPos(list_start);
        ImGui::PushStyleColor(ImGuiCol_ChildBg, ImVec4(0.14f, 0.14f, 0.14f, 0.97f));
        if (ImGui::BeginChild("##search_overlay", {0, overlay_h}, false, ImGuiWindowFlags_NoScrollbar)) {
            bool has_results = false;
            {
                std::lock_guard<std::mutex> lk(search_state.mu);
                has_results = !search_state.cache_results.empty() || !search_state.api_results.empty();
            }

            int pending = search_state.pending_api_tasks.load();
            if (has_results) {
                if (pending > 0) {
                    float t = static_cast<float>(ImGui::GetTime());
                    const char* frames[] = { "|", "/", "-", "\\" };
                    ImGui::TextDisabled("Searching... %s", frames[static_cast<int>(t * 8.0f) % 4]);
                }
                if (search_panel_) search_panel_->render_results(search_state);
            } else if (!search_state.last_submitted_query.empty()) {
                if (pending > 0) {
                    float t = static_cast<float>(ImGui::GetTime());
                    const char* frames[] = { "|", "/", "-", "\\" };
                    ImGui::TextDisabled("Searching... %s", frames[static_cast<int>(t * 8.0f) % 4]);
                } else {
                    ImGui::TextDisabled("No files found");
                }
            }
        }
        ImGui::EndChild();
        ImGui::PopStyleColor();
    }

    void FileExplorerPanel::process_deferred_search_actions(SearchState& search_state) {
        if (search_state.pending_submit && search_panel_) {
            search_state.pending_submit = false;
            std::string q(search_state.query_buf);
            if (q.size() >= 2) search_panel_->submit_search(q);
        }

        if (search_state.pending_navigate_index < 0 || !search_panel_) return;

        int idx = search_state.pending_navigate_index;
        search_state.pending_navigate_index = -1;
        std::lock_guard<std::mutex> lk(search_state.mu);
        std::vector<const SearchResult*> all;
        for (auto& r : search_state.cache_results) all.push_back(&r);
        for (auto& r : search_state.api_results) all.push_back(&r);
        if (idx < static_cast<int>(all.size())) {
            search_panel_->navigate_to_result(*all[idx]);
            search_state.is_open = false;
        }
    }

    void FileExplorerPanel::update_periodic_save(FileExplorerState& state) {
        static double last_save_check = 0.0;
        double now = ImGui::GetTime();
        if (now - last_save_check < 60.0) return;

        last_save_check = now;
        state.save_async(worker_pool_);
    }

    void FileExplorerPanel::update_navigation_history(FileExplorerState& state,
                                                      const std::string& target_path,
                                                      bool update_history) {
        if (!update_history) return;

        std::string current_path_str(state.current_path);
        if (!current_path_str.empty() && current_path_str != target_path) {
            state.back_history.push(current_path_str);
        }
        while (!state.forward_history.empty()) {
            state.forward_history.pop();
        }
    }

    void FileExplorerPanel::set_active_path(FileExplorerState& state, const std::string& path) {
        strncpy(state.current_path, path.c_str(), sizeof(state.current_path) - 1);
        state.current_path[sizeof(state.current_path) - 1] = '\0';
        strncpy(state.search_path, path.c_str(), sizeof(state.search_path) - 1);
        state.search_path[sizeof(state.search_path) - 1] = '\0';
    }

    void FileExplorerPanel::reset_selection(FileExplorerState& state) {
        state.selected_files.clear();
        state.last_selected_index = -1;
    }

    void FileExplorerPanel::clear_cloud_upload_contexts() {
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
    }

    void FileExplorerPanel::render() {
        auto& state = registry_.get_state<FileExplorerState>("Files");
        auto& workspace_state = registry_.get_state<WorkspaceState>("Workspace");
        apply_workspace_mount_if_ready(state, workspace_state);
        handle_pending_navigation(state);

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
            render_search_overlay(search_state, list_start, list_height);

            lock.unlock();
            process_deferred_search_actions(search_state);
            update_periodic_save(state);
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
        update_navigation_history(state, path, update_history);

        worker_pool_.add(
            [this, &state, path, show_hidden]() {
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
                set_active_path(state, new_path);
                reset_selection(state);
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
            
            update_navigation_history(state, path, update_history);
            set_active_path(state, path);
            reset_selection(state);
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
            clear_cloud_upload_contexts();
            state.last_disconnected_notification_folder.clear();
            navigate_to_local_path_async(path, update_history);
        }
        
        state.dirty_ = true; // mark for next async save cycle
    }

    void FileExplorerPanel::sync_account_mappings() {
        auto& workspace = registry_.get_state<WorkspaceState>("Workspace");
        auto& services = registry_.get_state<ServicesState>("Services");

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

            mount_utils::ensure_account_directory(conn.profile.email);

            std::string cached_drive_id, cached_display, cached_email;
            if (load_drive_info_from_cache(conn.profile.id, cached_drive_id, cached_display, cached_email)) {
                mapping.drive_id = cached_drive_id;
            }

            workspace.account_mappings.push_back(mapping);
        }
    }

}
