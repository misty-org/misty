#include "panels/file_explorer/file_explorer_panel.h"
#include "panels/workspace/workspace_state.h"
#include "panels/services/onedrive/onedrive_state.h"
#include "panels/services/gdrive/gdrive_state.h"
#include "panels/services/services_state.h"
#include "panels/activity/download_state.h"
#include "panels/notification/notification_state.h"
#include "core/asset_manager.h"
#include <nlohmann/json.hpp>
#include <cstdio>


namespace fs = std::filesystem;

using namespace misty::core;

namespace misty::panel {

    FileExplorerPanel::FileExplorerPanel(UIRegistry& registry, WorkerPool& worker_pool, std::shared_ptr<MistyClient> client)
        : registry_(registry), worker_pool_(worker_pool), client_(std::move(client)) {

        auto& workspace_state = registry_.get_state<WorkspaceState>("Workspace");
        auto& file_explorer_state = registry_.get_state<FileExplorerState>("FileExplorer");

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
            } else if (path_utils::is_onedrive_path(saved_path) || path_utils::is_gdrive_path(saved_path)) {
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
        auto& state = registry_.get_state<FileExplorerState>("FileExplorer");
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

        ImGui::PushStyleColor(ImGuiCol_WindowBg, ImVec4(0.18f, 0.18f, 0.18f, 1.0f));

        if (ImGui::Begin("File Explorer", nullptr, file_explorer_flags)) {
            std::lock_guard<std::mutex> lock(state.mu);

            // Unified rendering - same for local and OneDrive
            if (ImGui::BeginChild("TopBar", ImVec2(0, 50), false, ImGuiWindowFlags_NoScrollbar)) {
                ImGui::SetCursorPosY(8.0f);

                show_nav_history(state, 30.0f, 8.0f);

                ImGui::SameLine(0, 8.0f);
                ImGui::SetCursorPosY(7.0f);

                show_search_bar(state);
            }
            ImGui::EndChild();

            ImGui::Separator();
            show_directory_contents(state);
            show_error_modal(state.error_msg, "FileExplorerError");
        }
        ImGui::End();
        ImGui::PopStyleColor();
    }

    void FileExplorerPanel::navigate_to_path(const std::string& path, bool update_history, bool create_if_missing) {
        printf("Explorer: navigate_to_path called with: %s\n", path.c_str());
        auto& state = registry_.get_state<FileExplorerState>("FileExplorer");

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
        } else {
            // Local path - clear OneDrive and GDrive upload context and notification tracking
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
            state.last_disconnected_notification_folder.clear();
            navigate_to_local_path(state, path, update_history);
        }
        
        // Persist state after successful navigation
        state.save_state();
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
        auto& state = registry_.get_state<FileExplorerState>("FileExplorer");
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
        auto& state = registry_.get_state<FileExplorerState>("FileExplorer");
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
                        auto& state = registry_.get_state<FileExplorerState>("FileExplorer");
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
                            handle_folder_fetch_response(user_id, fetched_drive_id, folder_id, target_path, success, body, error);
                        });
                });
        } else {
            // We have drive_id, fetch files directly
            services.fetch_onedrive_files(ms_user_id, drive_id, folder_id,
                [this, ms_user_id, drive_id, folder_id, target_path](bool success,
                                                                      const std::string& body,
                                                                      const std::string& error) {
                    handle_folder_fetch_response(ms_user_id, drive_id, folder_id, target_path, success, body, error);
                });
        }
    }

    void FileExplorerPanel::handle_folder_fetch_response(const std::string& ms_user_id,
                                                          const std::string& drive_id,
                                                          const std::string& folder_id,
                                                          const std::string& target_path,
                                                          bool success,
                                                          const std::string& body,
                                                          const std::string& error) {
        auto& state = registry_.get_state<FileExplorerState>("FileExplorer");
        std::lock_guard<std::mutex> lock(state.mu);

        state.is_loading = false;

        // Only update if we're still at this path
        if (std::string(state.current_path) != target_path) {
            return;
        }

        // Update OneDriveState with current folder context for uploads
        {
            auto& onedrive_state = registry_.get_state<OneDriveState>("OneDrive");
            std::lock_guard<std::mutex> od_lock(onedrive_state.mu);
            onedrive_state.current_ms_user_id = ms_user_id;
            onedrive_state.current_drive_id = drive_id;
            onedrive_state.current_folder_id = folder_id;
        }

        if (success) {
            std::vector<OneDriveItem> od_items;
            std::vector<UnifiedFileItem> files;

            try {
                auto json = nlohmann::json::parse(body);
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
                    odi.drive_id = drive_id;
                    odi.ms_user_id = ms_user_id;
                    od_items.push_back(odi);

                    // Convert to UnifiedFileItem
                    UnifiedFileItem ufi;
                    ufi.name = odi.name;
                    ufi.path = target_path + "/" + odi.name;
                    ufi.is_dir = odi.is_folder;
                    ufi.size = odi.size;
                    ufi.last_modified = odi.last_modified_date_time.length() >= 10
                                        ? odi.last_modified_date_time.substr(0, 10) : "";
                    ufi.source = FileSource::ONEDRIVE;
                    ufi.od_item_id = odi.id;
                    ufi.od_drive_id = drive_id;
                    ufi.od_ms_user_id = ms_user_id;
                    ufi.od_web_url = odi.web_url;

                    // Determine sync status
                    if (ufi.is_dir) {
                        ufi.status = SyncStatus::LOCAL; // Directories are navigable
                    } else {
                        // Check if file exists locally
                        std::error_code ec;
                        if (fs::exists(ufi.path, ec)) {
                           // Check size or modification time
                           uintmax_t local_size = fs::file_size(ufi.path, ec);
                           if (!ec && local_size == (uintmax_t)ufi.size) {
                               ufi.status = SyncStatus::SYNCED;
                           } else {
                               ufi.status = SyncStatus::MODIFIED;
                           }
                        } else {
                            ufi.status = SyncStatus::NOT_SYNCED;
                        }
                    }

                    files.push_back(ufi);
                }

                state.files = std::move(files);
                // Save to cache
                save_items_to_cache(ms_user_id, folder_id, od_items);

            } catch (const std::exception& e) {
                if (state.files.empty()) {
                    state.error_msg = std::string("Parse error: ") + e.what();
                }
            }
        } else if (state.files.empty()) {
            state.error_msg = error;
        }
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

        ImGui::PopStyleVar(2);
    }

    void FileExplorerPanel::show_search_bar(FileExplorerState& state) {

        ImGui::PushStyleVar(ImGuiStyleVar_FramePadding, ImVec2(10, 8));
        ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 4.0f);

        ImGui::PushStyleColor(ImGuiCol_FrameBg, ImVec4(0.21f, 0.21f, 0.21f, 1.0f));

        float refresh_btn_size = 32.0f;
        float spacing = 8.0f;
        float available_width = ImGui::GetContentRegionAvail().x - refresh_btn_size - spacing;
        ImGui::SetNextItemWidth(available_width);

        bool entered = ImGui::InputTextWithHint("##search", "Search or enter path...",
            state.search_path,
            sizeof(state.search_path) - 1,
            ImGuiInputTextFlags_EnterReturnsTrue);

        if (entered) {
            // Don't auto-create directories when user types path manually
            navigate_to_path(state.search_path, true, false);
        }

        ImGui::PopStyleColor();

        // Refresh button
        ImGui::SameLine(0, spacing);
        ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.21f, 0.21f, 0.21f, 1.0f));
        ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.28f, 0.28f, 0.28f, 1.0f));
        ImGui::PushStyleColor(ImGuiCol_ButtonActive, ImVec4(0.16f, 0.16f, 0.16f, 1.0f));

        auto& sync_tex = core::AssetManager::get().get_svg_texture("sync-16", 16);
        if (sync_tex.id != 0) {
            if (ImGui::ImageButton("##refresh", sync_tex.id,
                    ImVec2(16, 16), ImVec2(0, 0), ImVec2(1, 1),
                    ImVec4(0, 0, 0, 0), ImVec4(0.7f, 0.7f, 0.7f, 1.0f))) {
                // Re-navigate to current path to force a refetch
                std::string current(state.current_path);
                if (!current.empty()) {
                    navigate_to_path(current, false);
                }
            }
            if (ImGui::IsItemHovered()) {
                ImGui::SetTooltip("Refresh");
            }
        } else {
            if (ImGui::Button("R", ImVec2(refresh_btn_size, 0))) {
                std::string current(state.current_path);
                if (!current.empty()) {
                    navigate_to_path(current, false);
                }
            }
            if (ImGui::IsItemHovered()) {
                ImGui::SetTooltip("Refresh");
            }
        }

        ImGui::PopStyleColor(3);
        ImGui::PopStyleVar(2);
    }

    void FileExplorerPanel::show_directory_contents(FileExplorerState& state) {
        static ImGuiTableFlags flags = ImGuiTableFlags_Reorderable | ImGuiTableFlags_Sortable |
            ImGuiTableFlags_Hideable | ImGuiTableFlags_RowBg |
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
                if (state.clipboard_op != ClipboardOp::NONE && !state.clipboard_paths.empty()) {
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
            // Use IsMouseClicked to match item behavior and avoid "double menu" on release
            // Also ensure FileContextMenu isn't already open
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
            icon_name = "file-directory-16";
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
        if (!file.gd_item_id.empty()) {
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
                navigate_to_path(file.path);
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
                }
            }
        }

        // Draw Icon and Name
        // Center icon and text vertically in the row
        float content_padding_y = (row_height - 16.0f) / 2.0f;
        ImGui::SetCursorScreenPos(ImVec2(p.x + 4.0f, p.y + content_padding_y));
        ImGui::Image(icon.id, ImVec2(16, 16));
        
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

                bool can_paste = state.clipboard_op != ClipboardOp::NONE && !state.clipboard_paths.empty();
                // Paste should be allowed in directory regardless of sync status of the directory itself?
                // Usually yes.
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
            bool is_local = !path_utils::is_onedrive_path(state.current_path)
                         && !path_utils::is_gdrive_path(state.current_path);

            if (is_local) {
                bool can_paste = state.clipboard_op != ClipboardOp::NONE && !state.clipboard_paths.empty();
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
            } else {
                ImGui::TextDisabled("No actions available");
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
                if (!name.empty()) {
                    fs::path p = fs::path(state.current_path) / name;
                    std::error_code ec;
                    if (state.new_entry_is_dir) {
                        fs::create_directory(p, ec);
                    } else {
                        // Create empty file by opening and closing
                        if (auto f = std::fopen(p.string().c_str(), "w")) {
                            std::fclose(f);
                        }
                    }
                    if (!ec) {
                        auto& notif = registry_.get_state<NotificationState>("Notifications");
                        notif.add_notification("Created", std::string(state.new_entry_is_dir ? "Folder " : "File ") + name + " created", NotificationType::SUCCESS);
                        navigate_to_path(std::string(state.current_path), false);
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

        for (const auto& src_path : state.clipboard_paths) {
            fs::path src(src_path);
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
        }

        auto& notif = registry_.get_state<NotificationState>("Notifications");
        std::string msg = (state.clipboard_op == ClipboardOp::COPY ? "Copied " : "Moved ") + std::to_string(state.clipboard_paths.size()) + " items";
        notif.add_notification("Success", msg, NotificationType::SUCCESS);

        // Clear clipboard after cut (keep after copy so user can paste multiple times)
        if (state.clipboard_op == ClipboardOp::CUT) {
            state.clipboard_op = ClipboardOp::NONE;
            state.clipboard_paths.clear(); // Clear paths
        }

        // Refresh directory
        navigate_to_path(std::string(state.current_path), false);
    }

    void FileExplorerPanel::perform_copy(FileExplorerState& state) {
        state.clipboard_op = ClipboardOp::COPY;
        state.clipboard_paths.clear();
        // If context menu target is set and valid, use that. Otherwise use selected files.
        // But usually context menu setting *also* sets selection if not selected.
        // Shortcuts will rely on selection.
        for (const auto& sel : state.selected_files) {
            state.clipboard_paths.push_back(sel);
        }
        auto& notif = registry_.get_state<NotificationState>("Notifications");
        notif.add_notification("Clipboard", "Copied " + std::to_string(state.clipboard_paths.size()) + " items", NotificationType::INFO);
    }

    void FileExplorerPanel::perform_cut(FileExplorerState& state) {
        state.clipboard_op = ClipboardOp::CUT;
        state.clipboard_paths.clear();
        for (const auto& sel : state.selected_files) {
            state.clipboard_paths.push_back(sel);
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
                bool is_cloud = path_utils::is_onedrive_path(path) || path_utils::is_gdrive_path(path);
                
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
        auto& state = registry_.get_state<FileExplorerState>("FileExplorer");
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
        auto& state = registry_.get_state<FileExplorerState>("FileExplorer");
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
                handle_gd_folder_fetch_response(gd_user_id, folder_id, target_path, success, body, error);
            });
    }

    void FileExplorerPanel::handle_gd_folder_fetch_response(const std::string& gd_user_id,
                                                              const std::string& folder_id,
                                                              const std::string& target_path,
                                                              bool success,
                                                              const std::string& body,
                                                              const std::string& error) {
        auto& state = registry_.get_state<FileExplorerState>("FileExplorer");
        std::lock_guard<std::mutex> lock(state.mu);

        state.is_loading = false;

        if (std::string(state.current_path) != target_path) {
            return;
        }

        // Update GDriveState with current folder context for uploads
        {
            auto& gdrive_state = registry_.get_state<GDriveState>("GDrive");
            std::lock_guard<std::mutex> gd_lock(gdrive_state.mu);
            gdrive_state.current_gd_user_id = gd_user_id;
            gdrive_state.current_folder_id = folder_id;
        }

        if (success) {
            std::vector<GDriveItem> gd_items;
            std::vector<UnifiedFileItem> files;

            try {
                auto json = nlohmann::json::parse(body);
                auto values = json.value("files", nlohmann::json::array());

                for (const auto& item : values) {
                    GDriveItem gdi;
                    gdi.id = item.value("id", std::string(""));
                    gdi.name = item.value("name", std::string(""));
                    // Google Drive API returns size as a string
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
                    gdi.gd_user_id = gd_user_id;
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
                    ufi.gd_user_id = gd_user_id;
                    ufi.gd_mime_type = gdi.mime_type;
                    ufi.gd_web_url = gdi.web_url;

                    // Determine sync status
                    if (ufi.is_dir) {
                        ufi.status = SyncStatus::LOCAL;
                    } else {
                        // Check if file exists locally
                        std::error_code ec;
                        if (fs::exists(ufi.path, ec)) {
                           // Check size or modification time (GDrive size might be 0 for online docs)
                           if (gdi.size == 0 && gdi.mime_type.rfind("application/vnd.google-apps.", 0) == 0) {
                               // Online doc - if it exists locally it's probably a link file
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

                    files.push_back(ufi);
                }

                state.files = std::move(files);
                save_gd_items_to_cache(gd_user_id, folder_id, gd_items);

            } catch (const std::exception& e) {
                if (state.files.empty()) {
                    state.error_msg = std::string("Parse error: ") + e.what();
                }
            }
        } else if (state.files.empty()) {
            state.error_msg = error;
        }
    }

    void FileExplorerPanel::download_and_open_gd_file(const UnifiedFileItem& file) {
        auto& state = registry_.get_state<FileExplorerState>("FileExplorer");
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

                auto& state = registry_.get_state<FileExplorerState>("FileExplorer");
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
        auto& state = registry_.get_state<FileExplorerState>("FileExplorer");
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

                auto& state = registry_.get_state<FileExplorerState>("FileExplorer");
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

}
