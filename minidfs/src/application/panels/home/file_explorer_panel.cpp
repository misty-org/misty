#include "file_explorer_panel.h"
#include "workspace_state.h"
#include "panels/services/services_state.h"
#include "core/util.h"
#include "imgui.h"
#include <nlohmann/json.hpp>


namespace fs = std::filesystem;

using namespace minidfs::core;

namespace minidfs::panel {

    FileExplorerPanel::FileExplorerPanel(UIRegistry& registry, WorkerPool& worker_pool, std::shared_ptr<MiniDFSClient> client)
        : registry_(registry), worker_pool_(worker_pool), client_(std::move(client)) {

        auto& state = registry_.get_state<FileExplorerState>("FileExplorer");
        auto& workspace_state = registry_.get_state<WorkspaceState>("Workspace");

        // Fetch workspaces first
        if (!workspace_state.has_fetched) {
            workspace_state.fetch_workspaces();
        }

        // Use workspace mount path if available, otherwise fall back to client mount path
        std::string start_path = workspace_state.get_current_mount_path();
        if (start_path.empty()) {
            start_path = client_->GetClientMountPath();
        }

        // Create directory if it doesn't exist
        if (!start_path.empty()) {
            std::error_code ec;
            fs::create_directories(start_path, ec);
        }

        get_files(state, start_path);
    }

    void FileExplorerPanel::render() {
        auto& state = registry_.get_state<FileExplorerState>("FileExplorer");

        ImGuiWindowFlags file_explorer_flags = ImGuiWindowFlags_NoTitleBar |
            ImGuiWindowFlags_NoMove |
            ImGuiWindowFlags_NoCollapse |
            ImGuiWindowFlags_NoResize;

        ImGui::PushStyleColor(ImGuiCol_WindowBg, ImVec4(0.18f, 0.18f, 0.18f, 1.0f));

        if (ImGui::Begin("File Explorer", nullptr, file_explorer_flags)) {
            std::unique_lock<std::mutex> lock(state.mu, std::try_to_lock);

            if (lock.owns_lock()) {
                if (state.mode == ExplorerMode::LOCAL) {
                    // Local file system mode
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
                } else {
                    // OneDrive mode
                    auto& onedrive_state = registry_.get_state<OneDriveState>("OneDrive");
                    render_onedrive_mode(state, onedrive_state);
                }
            }
            else {
                ImGui::Text("Syncing...");
            }
        }
        ImGui::End();
        ImGui::PopStyleColor();
    }

    void FileExplorerPanel::show_nav_history(FileExplorerState& state, float button_width, float spacing) {
        ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 4.0f);
        ImGui::PushStyleVar(ImGuiStyleVar_FramePadding, ImVec2(6.0f, 6.0f));

        bool can_go_back = !state.back_history.empty();
        if (!can_go_back) ImGui::BeginDisabled();
        if (ImGui::Button("<", ImVec2(button_width, 0))) {
            go_back(state);
        }
        if (!can_go_back) ImGui::EndDisabled();

        ImGui::SameLine(0, spacing);

        bool can_go_forward = !state.forward_history.empty();
        if (!can_go_forward) ImGui::BeginDisabled();
        if (ImGui::Button(">", ImVec2(button_width, 0))) {
            go_forward(state);
        }
        if (!can_go_forward) ImGui::EndDisabled();

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
            get_files(state, state.search_path);
        }

        ImGui::PopStyleColor();
        ImGui::PopStyleVar(2);
    }

    void FileExplorerPanel::show_directory_contents(FileExplorerState& state) {
        static ImGuiTableFlags flags = ImGuiTableFlags_Reorderable | ImGuiTableFlags_Sortable |
            ImGuiTableFlags_Hideable | ImGuiTableFlags_RowBg |
            ImGuiTableFlags_ScrollY | ImGuiTableFlags_Resizable;

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
        minidfs::FileInfo file = state.files[i];
        std::string display_name = fs::path(file.file_path()).filename().generic_string();

        bool is_currently_selected = state.selected_files.count(file.file_path()) > 0;

        ImGui::TableNextRow();
        ImGui::TableNextColumn();

        std::string label = (file.is_dir() ? "[DIR] " : "[FILE] ") + display_name;

        if (ImGui::Selectable(label.c_str(), is_currently_selected, ImGuiSelectableFlags_SpanAllColumns | ImGuiSelectableFlags_AllowDoubleClick)) {

            if (io.KeyCtrl) {
                if (is_currently_selected) state.selected_files.erase(file.file_path());
                else state.selected_files.insert(file.file_path());
            }
            else if (io.KeyShift && state.last_selected_index != -1) {
                state.selected_files.clear();
                int start = std::min(state.last_selected_index, i);
                int end = std::max(state.last_selected_index, i);
                for (int j = start; j <= end; j++) state.selected_files.insert(state.files[j].file_path());
            }
            else {
                state.selected_files.clear();
                state.selected_files.insert(file.file_path());
            }
            state.last_selected_index = i;

            if (ImGui::IsItemHovered() && ImGui::IsMouseDoubleClicked(0)) {
                if (file.is_dir()) {
                    get_files(state, file.file_path()); // Direct path
                }
                else {
                    open_file(file.file_path()); // Direct path
                }
            }
        }
    }

    void FileExplorerPanel::render_onedrive_mode(FileExplorerState& state, OneDriveState& onedrive_state) {
        std::lock_guard<std::mutex> lock(onedrive_state.mu);

        // Top bar with back button
        if (ImGui::BeginChild("OneDriveTopBar", ImVec2(0, 50), false, ImGuiWindowFlags_NoScrollbar)) {
            ImGui::SetCursorPosY(8.0f);

            ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 4.0f);
            ImGui::PushStyleVar(ImGuiStyleVar_FramePadding, ImVec2(8.0f, 6.0f));

            if (ImGui::Button("< Local", ImVec2(70, 0))) {
                state.mode = ExplorerMode::LOCAL;
            }

            ImGui::SameLine(0, 16.0f);

            if (onedrive_state.view_mode == OneDriveViewMode::FOLDER_VIEW) {
                if (ImGui::Button("<", ImVec2(30, 0))) {
                    // Go back to accounts view
                    onedrive_state.view_mode = OneDriveViewMode::ACCOUNTS_VIEW;
                    onedrive_state.current_items.clear();
                    onedrive_state.selected_items.clear();
                }
                ImGui::SameLine(0, 8.0f);
                ImGui::Text("OneDrive / %s", onedrive_state.current_folder_name.c_str());
            } else {
                ImGui::Text("OneDrive");
            }

            ImGui::PopStyleVar(2);
        }
        ImGui::EndChild();

        ImGui::Separator();

        if (onedrive_state.view_mode == OneDriveViewMode::ACCOUNTS_VIEW) {
            show_onedrive_roots(onedrive_state);
        } else {
            if (onedrive_state.is_loading_folder) {
                ImGui::Text("Loading...");
            } else if (!onedrive_state.error_msg.empty()) {
                ImGui::TextColored(ImVec4(1, 0.3f, 0.3f, 1), "Error: %s", onedrive_state.error_msg.c_str());
            } else {
                show_onedrive_items_table(onedrive_state, onedrive_state.current_items);
            }
        }
    }

    void FileExplorerPanel::show_onedrive_roots(OneDriveState& onedrive_state) {
        if (onedrive_state.account_roots.empty()) {
            ImGui::TextDisabled("No OneDrive accounts connected");
            return;
        }

        // Show accounts as folder entries in a table
        static ImGuiTableFlags flags = ImGuiTableFlags_RowBg |
                                        ImGuiTableFlags_ScrollY |
                                        ImGuiTableFlags_Resizable;

        if (ImGui::BeginTable("AccountsTable", 3, flags)) {
            ImGui::TableSetupColumn("Name", ImGuiTableColumnFlags_WidthStretch);
            ImGui::TableSetupColumn("Type", ImGuiTableColumnFlags_WidthFixed, 100.0f);
            ImGui::TableSetupColumn("Account", ImGuiTableColumnFlags_WidthFixed, 200.0f);
            ImGui::TableHeadersRow();

            for (size_t i = 0; i < onedrive_state.account_roots.size(); i++) {
                auto& account = onedrive_state.account_roots[i];
                bool is_selected = onedrive_state.selected_items.count(account.ms_user_id) > 0;

                std::string folder_name = account.display_name.empty()
                    ? (account.email.empty() ? "OneDrive" : account.email)
                    : account.display_name;

                ImGui::TableNextRow();
                ImGui::TableNextColumn();

                std::string label = "[DIR] " + folder_name;

                if (ImGui::Selectable(label.c_str(), is_selected,
                                      ImGuiSelectableFlags_SpanAllColumns |
                                      ImGuiSelectableFlags_AllowDoubleClick)) {
                    onedrive_state.selected_items.clear();
                    onedrive_state.selected_items.insert(account.ms_user_id);
                    onedrive_state.last_selected_index = static_cast<int>(i);

                    if (ImGui::IsItemHovered() && ImGui::IsMouseDoubleClicked(0)) {
                        // Navigate into this account's root
                        navigate_to_account_root(onedrive_state, account);
                    }
                }

                ImGui::TableNextColumn();
                ImGui::Text("OneDrive");

                ImGui::TableNextColumn();
                ImGui::Text("%s", account.email.c_str());
            }

            ImGui::EndTable();
        }
    }

    void FileExplorerPanel::show_onedrive_items_table(OneDriveState& onedrive_state,
                                                       const std::vector<OneDriveItem>& items) {
        static ImGuiTableFlags flags = ImGuiTableFlags_RowBg |
                                        ImGuiTableFlags_ScrollY |
                                        ImGuiTableFlags_Resizable;

        if (ImGui::BeginTable("OneDriveTable", 4, flags)) {
            ImGui::TableSetupColumn("Name", ImGuiTableColumnFlags_WidthStretch);
            ImGui::TableSetupColumn("Size", ImGuiTableColumnFlags_WidthFixed, 80.0f);
            ImGui::TableSetupColumn("Type", ImGuiTableColumnFlags_WidthFixed, 80.0f);
            ImGui::TableSetupColumn("Modified", ImGuiTableColumnFlags_WidthFixed, 150.0f);
            ImGui::TableHeadersRow();

            for (size_t i = 0; i < items.size(); i++) {
                const auto& item = items[i];
                bool is_selected = onedrive_state.selected_items.count(item.id) > 0;

                ImGui::TableNextRow();
                ImGui::TableNextColumn();

                std::string label = (item.is_folder ? "[DIR] " : "[FILE] ") + item.name;

                if (ImGui::Selectable(label.c_str(), is_selected,
                                      ImGuiSelectableFlags_SpanAllColumns |
                                      ImGuiSelectableFlags_AllowDoubleClick)) {
                    onedrive_state.selected_items.clear();
                    onedrive_state.selected_items.insert(item.id);
                    onedrive_state.last_selected_index = static_cast<int>(i);

                    if (ImGui::IsItemHovered() && ImGui::IsMouseDoubleClicked(0)) {
                        if (item.is_folder) {
                            navigate_to_onedrive_folder(onedrive_state, item);
                        } else {
                            // Open file in browser
                            if (!item.web_url.empty()) {
                                core::open_file_in_browser(item.web_url);
                            }
                        }
                    }
                }

                ImGui::TableNextColumn();
                if (!item.is_folder) {
                    // Format file size
                    if (item.size < 1024) {
                        ImGui::Text("%lld B", item.size);
                    } else if (item.size < 1024 * 1024) {
                        ImGui::Text("%.1f KB", item.size / 1024.0);
                    } else if (item.size < 1024 * 1024 * 1024) {
                        ImGui::Text("%.1f MB", item.size / (1024.0 * 1024.0));
                    } else {
                        ImGui::Text("%.1f GB", item.size / (1024.0 * 1024.0 * 1024.0));
                    }
                }

                ImGui::TableNextColumn();
                ImGui::Text("%s", item.is_folder ? "Folder" : "File");

                ImGui::TableNextColumn();
                // Just show the date part
                if (item.last_modified_date_time.length() >= 10) {
                    ImGui::Text("%s", item.last_modified_date_time.substr(0, 10).c_str());
                }
            }

            ImGui::EndTable();
        }
    }

    void FileExplorerPanel::navigate_to_account_root(OneDriveState& onedrive_state,
                                                        AccountRootContent& account) {
        std::string ms_user_id = account.ms_user_id;
        std::string display_name = account.display_name;
        std::string email = account.email;

        onedrive_state.view_mode = OneDriveViewMode::FOLDER_VIEW;
        onedrive_state.current_ms_user_id = ms_user_id;
        onedrive_state.current_folder_id = "root";
        onedrive_state.current_folder_name = display_name.empty() ? email : display_name;
        onedrive_state.current_items.clear();
        onedrive_state.selected_items.clear();
        onedrive_state.error_msg.clear();

        // Try to load from cache first
        std::vector<OneDriveItem> cached_items;
        if (load_items_from_cache(ms_user_id, "root", cached_items)) {
            onedrive_state.current_items = cached_items;
            if (!cached_items.empty()) {
                onedrive_state.current_drive_id = cached_items[0].drive_id;
            }
            onedrive_state.is_loading_folder = false;
        } else {
            onedrive_state.is_loading_folder = true;
        }

        // Fetch in background and update cache
        auto& svc = registry_.get_state<ServicesState>("Services");

        // First get drive_id if we don't have it
        if (account.drive_id.empty()) {
            svc.fetch_drive(ms_user_id,
                [this, ms_user_id, display_name, email](const std::string& user_id,
                                           const std::string& drive_id,
                                           bool success,
                                           const std::string& error) {
                    if (!success) {
                        auto& od_state = registry_.get_state<OneDriveState>("OneDrive");
                        std::lock_guard<std::mutex> lock(od_state.mu);
                        od_state.is_loading_folder = false;
                        if (od_state.current_items.empty()) {
                            od_state.error_msg = error;
                        }
                        return;
                    }

                    // Save drive info to cache
                    save_drive_info_to_cache(user_id, drive_id, display_name, email);

                    // Update account's drive_id
                    {
                        auto& od_state = registry_.get_state<OneDriveState>("OneDrive");
                        std::lock_guard<std::mutex> lock(od_state.mu);
                        for (auto& acc : od_state.account_roots) {
                            if (acc.ms_user_id == user_id) {
                                acc.drive_id = drive_id;
                                break;
                            }
                        }
                        od_state.current_drive_id = drive_id;
                    }

                    // Now fetch root files
                    auto& svc_state = registry_.get_state<ServicesState>("Services");
                    svc_state.fetch_onedrive_files(user_id, drive_id, "root",
                        [this, user_id, drive_id](bool success,
                                                  const std::string& body,
                                                  const std::string& error) {
                            auto& od_state = registry_.get_state<OneDriveState>("OneDrive");
                            std::lock_guard<std::mutex> lock(od_state.mu);
                            od_state.is_loading_folder = false;

                            if (success) {
                                std::vector<OneDriveItem> items;
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
                                        odi.ms_user_id = user_id;
                                        items.push_back(odi);
                                    }
                                    od_state.current_items = items;
                                    // Save to cache
                                    save_items_to_cache(user_id, "root", items);
                                } catch (const std::exception& e) {
                                    if (od_state.current_items.empty()) {
                                        od_state.error_msg = std::string("Parse error: ") + e.what();
                                    }
                                }
                            } else if (od_state.current_items.empty()) {
                                od_state.error_msg = error;
                            }
                        });
                });
        } else {
            // We already have drive_id, fetch files directly
            std::string drive_id = account.drive_id;
            onedrive_state.current_drive_id = drive_id;

            svc.fetch_onedrive_files(ms_user_id, drive_id, "root",
                [this, ms_user_id, drive_id](bool success,
                                              const std::string& body,
                                              const std::string& error) {
                    auto& od_state = registry_.get_state<OneDriveState>("OneDrive");
                    std::lock_guard<std::mutex> lock(od_state.mu);
                    od_state.is_loading_folder = false;

                    if (success) {
                        std::vector<OneDriveItem> items;
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
                                items.push_back(odi);
                            }
                            od_state.current_items = items;
                            // Save to cache
                            save_items_to_cache(ms_user_id, "root", items);
                        } catch (const std::exception& e) {
                            if (od_state.current_items.empty()) {
                                od_state.error_msg = std::string("Parse error: ") + e.what();
                            }
                        }
                    } else if (od_state.current_items.empty()) {
                        od_state.error_msg = error;
                    }
                });
        }
    }

    void FileExplorerPanel::navigate_to_onedrive_folder(OneDriveState& onedrive_state,
                                                         const OneDriveItem& folder) {
        std::string ms_user_id = folder.ms_user_id;
        std::string drive_id = folder.drive_id;
        std::string folder_id = folder.id;
        std::string folder_name = folder.name;

        onedrive_state.view_mode = OneDriveViewMode::FOLDER_VIEW;
        onedrive_state.current_ms_user_id = ms_user_id;
        onedrive_state.current_drive_id = drive_id;
        onedrive_state.current_folder_id = folder_id;
        onedrive_state.current_folder_name = folder_name;
        onedrive_state.current_items.clear();
        onedrive_state.selected_items.clear();
        onedrive_state.error_msg.clear();

        // Try to load from cache first
        std::vector<OneDriveItem> cached_items;
        if (load_items_from_cache(ms_user_id, folder_id, cached_items)) {
            onedrive_state.current_items = cached_items;
            onedrive_state.is_loading_folder = false;
        } else {
            onedrive_state.is_loading_folder = true;
        }

        // Fetch in background and update cache
        auto& svc = registry_.get_state<ServicesState>("Services");

        svc.fetch_onedrive_files(ms_user_id, drive_id, folder_id,
            [this, ms_user_id, drive_id, folder_id](bool success,
                                                     const std::string& body,
                                                     const std::string& error) {
                auto& od_state = registry_.get_state<OneDriveState>("OneDrive");
                std::lock_guard<std::mutex> lock(od_state.mu);
                od_state.is_loading_folder = false;

                if (success) {
                    std::vector<OneDriveItem> items;
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
                            items.push_back(odi);
                        }
                        od_state.current_items = items;
                        // Save to cache
                        save_items_to_cache(ms_user_id, folder_id, items);
                    } catch (const std::exception& e) {
                        if (od_state.current_items.empty()) {
                            od_state.error_msg = std::string("Parse error: ") + e.what();
                        }
                    }
                } else if (od_state.current_items.empty()) {
                    od_state.error_msg = error;
                }
            });
    }

}