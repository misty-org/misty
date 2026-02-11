#include "panels/file_explorer/file_explorer_panel.h"
#include "panels/workspace/workspace_state.h"
#include "panels/services/onedrive/onedrive_state.h"
#include "panels/services/gdrive/gdrive_state.h"
#include "panels/services/services_state.h"
#include "panels/activity/download_state.h"
#include "panels/notification/notification_state.h"
#include <nlohmann/json.hpp>


namespace fs = std::filesystem;

using namespace minidfs::core;

namespace minidfs::panel {

    FileExplorerPanel::FileExplorerPanel(UIRegistry& registry, WorkerPool& worker_pool, std::shared_ptr<MiniDFSClient> client)
        : registry_(registry), worker_pool_(worker_pool), client_(std::move(client)) {

        auto& workspace_state = registry_.get_state<WorkspaceState>("Workspace");
        auto& file_explorer_state = registry_.get_state<FileExplorerState>("FileExplorer");

        // Ensure mount directories exist (~/misty/mnt and ~/misty/mnt/OneDrive)
        workspace_state.ensure_directories();

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
                    std::string current_path = state.current_path;
                    bool no_history = state.back_history.empty() && state.forward_history.empty();
                    bool is_at_initial = current_path.empty() || current_path == initial_start_path_;
                    if (no_history && is_at_initial && state.pending_navigation_path.empty()) {
                        state.pending_navigation_path = workspace_path;
                    }
                    workspace_mount_applied_ = true;
                } else {
                    workspace_mount_applied_ = true;
                }
            }
        }

        // Check for pending navigation from external code (e.g., sidebar)
        if (!state.pending_navigation_path.empty()) {
            std::string path = state.pending_navigation_path;
            state.pending_navigation_path.clear();
            navigate_to_path(path);
        }

        ImGuiWindowFlags file_explorer_flags = ImGuiWindowFlags_NoTitleBar |
            ImGuiWindowFlags_NoMove |
            ImGuiWindowFlags_NoCollapse |
            ImGuiWindowFlags_NoResize;

        ImGui::PushStyleColor(ImGuiCol_WindowBg, ImVec4(0.18f, 0.18f, 0.18f, 1.0f));

        if (ImGui::Begin("File Explorer", nullptr, file_explorer_flags)) {
            std::unique_lock<std::mutex> lock(state.mu, std::try_to_lock);

            if (lock.owns_lock()) {
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
            else {
                ImGui::Text("Syncing...");
            }
        }
        ImGui::End();
        ImGui::PopStyleColor();
    }

    void FileExplorerPanel::navigate_to_path(const std::string& path, bool update_history, bool create_if_missing) {
        auto& state = registry_.get_state<FileExplorerState>("FileExplorer");

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


        float available_width = ImGui::GetContentRegionAvail().x;
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
        ImGui::PopStyleVar(2);
    }

    void FileExplorerPanel::show_directory_contents(FileExplorerState& state) {
        static ImGuiTableFlags flags = ImGuiTableFlags_Reorderable | ImGuiTableFlags_Sortable |
            ImGuiTableFlags_Hideable | ImGuiTableFlags_RowBg |
            ImGuiTableFlags_ScrollY | ImGuiTableFlags_Resizable;

        if (state.is_loading) {
            ImGui::Text("Loading...");
            return;
        }

        if (ImGui::BeginTable("FileTable", 4, flags)) {
            ImGui::TableSetupColumn("Name", ImGuiTableColumnFlags_WidthStretch);
            ImGui::TableSetupColumn("Size", ImGuiTableColumnFlags_WidthFixed, 80.0f);
            ImGui::TableSetupColumn("Type", ImGuiTableColumnFlags_WidthFixed, 80.0f);
            ImGui::TableSetupColumn("Last Modified", ImGuiTableColumnFlags_WidthFixed, 150.0f);
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

            ImGui::EndTable();
        }
    }

    void FileExplorerPanel::show_file_item(FileExplorerState& state, int i) {
        ImGuiIO& io = ImGui::GetIO();
        const UnifiedFileItem& file = state.files[i];

        bool is_currently_selected = state.selected_files.count(file.path) > 0;

        ImGui::TableNextRow();
        ImGui::TableNextColumn();

        // Check if file is currently downloading
        bool is_downloading = state.is_downloading(file.path);

        std::string label;
        if (is_downloading) {
            label = "[DOWNLOADING] " + file.name;
        } else {
            label = (file.is_dir ? "[DIR] " : "[FILE] ") + file.name;
        }

        if (ImGui::Selectable(label.c_str(), is_currently_selected, ImGuiSelectableFlags_SpanAllColumns | ImGuiSelectableFlags_AllowDoubleClick)) {

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

            if (ImGui::IsItemHovered() && ImGui::IsMouseDoubleClicked(0)) {
                if (file.is_dir) {
                    navigate_to_path(file.path);
                }
                else {
                    // Open file
                    if (file.source == FileSource::LOCAL) {
                        open_file(file.path);
                    } else if (file.source == FileSource::ONEDRIVE) {
                        // OneDrive file - check if it exists locally first
                        if (fs::exists(file.path)) {
                            open_file(file.path);
                        } else if (!state.is_downloading(file.path)) {
                            download_and_open_file(file);
                        }
                    } else if (file.source == FileSource::GDRIVE) {
                        // Google Workspace files (Docs, Sheets, etc.) - open in browser
                        if (file.gd_mime_type.rfind("application/vnd.google-apps.", 0) == 0
                            && file.gd_mime_type != "application/vnd.google-apps.folder") {
                            if (!file.gd_web_url.empty()) {
                                open_file(file.gd_web_url);
                            }
                        } else if (fs::exists(file.path)) {
                            open_file(file.path);
                        } else if (!state.is_downloading(file.path)) {
                            download_and_open_gd_file(file);
                        }
                    }
                }
            }
        }

        // Size column
        ImGui::TableNextColumn();
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
        }

        // Type column
        ImGui::TableNextColumn();
        ImGui::Text("%s", file.is_dir ? "Folder" : "File");

        // Modified column
        ImGui::TableNextColumn();
        if (!file.last_modified.empty()) {
            ImGui::Text("%s", file.last_modified.c_str());
        }
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
