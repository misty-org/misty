#include "panels/home/file_sidebar_panel.h"
#include "file_explorer_state.h"
#include "workspace_state.h"
#include "panels/services/services_state.h"
#include "panels/panel_ui.h"
#include "core/asset_manager.h"
#include "core/http_client.h"
#include "core/file_picker.h"
#include <nlohmann/json.hpp>
#include <filesystem>


namespace minidfs::panel {
    FileSidebarPanel::FileSidebarPanel(core::UIRegistry& registry, core::WorkerPool& worker_pool, std::shared_ptr<MiniDFSClient> client)
        : registry_(registry), worker_pool_(worker_pool), client_(client) {


    }

    void FileSidebarPanel::render() {
        auto& state = registry_.get_state<FileSidebarState>("FileSidebar");
        auto& workspace_state = registry_.get_state<WorkspaceState>("Workspace");
        auto& services_state = registry_.get_state<ServicesState>("Services");

        if (!workspace_state.has_fetched && !workspace_state.is_fetching) {
            workspace_state.fetch_workspaces();
        }

        services_state.current_workspace_id = workspace_state.get_current_workspace_id();
        services_state.fetch_devices();

        ImGuiWindowFlags flags =
            ImGuiWindowFlags_NoTitleBar |
            ImGuiWindowFlags_NoResize |
            ImGuiWindowFlags_NoMove |
            ImGuiWindowFlags_NoCollapse |
            ImGuiWindowFlags_NoScrollbar;

        ImGui::PushStyleColor(ImGuiCol_WindowBg, ImVec4(0.15f, 0.15f, 0.15f, 1.0f));
        ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(16.0f, 16.0f));
        ImGui::PushStyleVar(ImGuiStyleVar_ItemSpacing, ImVec2(0.0f, 12.0f));

        if (ImGui::Begin("FileSidebar", nullptr, flags)) {
            float width = ImGui::GetWindowWidth();
            float padding = width * 0.08f;

        
            show_workspace_dropdown(workspace_state, width, padding);
            ImGui::Separator();
                
            show_create_new(state, width, padding);
            ImGui::Separator();
            
            show_home_section(workspace_state, services_state, width, padding);
            show_services_section(services_state, width, padding);
            ImGui::Separator();

            show_quick_access(width, padding);
            show_storage_info(width, padding);

            show_chooser_modal(state);
            show_create_entry_modal(state);
            show_uploader_modal(state);
            show_upload_progress_modal(state);
        }

        ImGui::End();
        ImGui::PopStyleVar(2);
        ImGui::PopStyleColor();
    }

    void FileSidebarPanel::show_workspace_dropdown(WorkspaceState& workspace_state, float width, float padding) {
        float dropdown_width = width - (padding * 2);
        ImGui::SetCursorPosX(padding);

        ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 8.0f);
        ImGui::PushStyleVar(ImGuiStyleVar_FramePadding, ImVec2(12.0f, 8.0f));
        ImGui::PushStyleColor(ImGuiCol_FrameBg, ImVec4(0.2f, 0.2f, 0.2f, 1.0f));
        ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.2f, 0.2f, 0.2f, 1.0f));
        ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.3f, 0.3f, 0.3f, 1.0f));

        ImGui::SetNextItemWidth(dropdown_width);

        // Build combo label with current workspace name
        std::string preview = workspace_state.get_current_workspace_name();

        if (ImGui::BeginCombo("##workspace_select", preview.c_str(), ImGuiComboFlags_None)) {
            for (size_t i = 0; i < workspace_state.workspaces.size(); ++i) {
                bool is_selected = (workspace_state.selected_workspace_index == (int)i);
                if (ImGui::Selectable(workspace_state.workspaces[i].workspace_name.c_str(), is_selected)) {
                    if (workspace_state.select_workspace((int)i)) {
                        // Workspace changed - navigate file explorer to new mount path
                        auto& file_explorer_state = registry_.get_state<FileExplorerState>("FileExplorer");
                        std::string mount_path = workspace_state.get_current_mount_path();
                        if (!mount_path.empty()) {
                            // Create directory if it doesn't exist
                            std::error_code ec;
                            fs::create_directories(mount_path, ec);
                            get_files(file_explorer_state, mount_path);
                        }
                    }
                }
                if (is_selected) {
                    ImGui::SetItemDefaultFocus();
                }
            }
            ImGui::EndCombo();
        }

        ImGui::PopStyleColor(3);
        ImGui::PopStyleVar(2);
    }

    void FileSidebarPanel::show_home_section(WorkspaceState& workspace_state, ServicesState& services_state, float width, float padding) {
        float content_width = width - (padding * 2);
        ImGui::SetCursorPosX(padding);

        ImGui::BeginGroup();

        // Home label
        ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.7f, 0.7f, 0.7f, 1.0f));
        ImGui::Text("Home");
        ImGui::PopStyleColor();

        ImGui::PushStyleVar(ImGuiStyleVar_FramePadding, ImVec2(8.0f, 8.0f));
        ImGui::PushStyleVar(ImGuiStyleVar_ItemSpacing, ImVec2(0.0f, 4.0f));
        ImGui::PushStyleVar(ImGuiStyleVar_ButtonTextAlign, ImVec2(0.0f, 0.5f));

        ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.25f, 0.25f, 0.25f, 1.0f));
        ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.35f, 0.35f, 0.35f, 1.0f));
        ImGui::PushStyleColor(ImGuiCol_ButtonActive, ImVec4(0.2f, 0.2f, 0.2f, 1.0f));

        // Home button - navigates to workspace mount_path
        std::string home_label = "Workspace Root";
        if (ImGui::Button(home_label.c_str(), ImVec2(content_width, 32))) {
            std::string mount_path = workspace_state.get_current_mount_path();
            if (!mount_path.empty()) {
                auto& file_explorer_state = registry_.get_state<FileExplorerState>("FileExplorer");
                std::error_code ec;
                fs::create_directories(mount_path, ec);
                get_files(file_explorer_state, mount_path);
            }
        }

        ImGui::PopStyleColor(3);
        ImGui::PopStyleVar(3);
        ImGui::EndGroup();
        
        // Small spacing before devices section (no separator - reduced spacing)
        ImGui::Dummy(ImVec2(0.0f, 4.0f));
    }
    
    void FileSidebarPanel::show_services_section(ServicesState& services_state, float width, float padding) {
        float content_width = width - (padding * 2);
        ImGui::SetCursorPosX(padding);

        ImGui::BeginGroup();

        // Count services to show
        bool has_cloud_services = services_state.has_ms_token();
        bool has_devices = !services_state.devices.empty();
        bool has_services = has_cloud_services || has_devices;

        if (has_services) {
            ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.7f, 0.7f, 0.7f, 1.0f));
            ImGui::Text("Services");
            ImGui::PopStyleColor();

            // Calculate height: cloud services + devices
            int item_count = 0;
            if (has_cloud_services) item_count++;
            item_count += services_state.devices.size();

            float max_height = 200.0f;
            float item_height = 28.0f;
            float actual_height = std::min(max_height, item_height * item_count + 8.0f);

            ImGui::PushStyleColor(ImGuiCol_ChildBg, ImVec4(0.18f, 0.18f, 0.18f, 1.0f));
            ImGui::PushStyleVar(ImGuiStyleVar_ChildRounding, 6.0f);
            ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(8.0f, 8.0f));

            if (ImGui::BeginChild("##services_list", ImVec2(content_width, actual_height), true)) {
                ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.22f, 0.22f, 0.22f, 1.0f));
                ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.32f, 0.32f, 0.32f, 1.0f));
                ImGui::PushStyleColor(ImGuiCol_ButtonActive, ImVec4(0.18f, 0.18f, 0.18f, 1.0f));

                // Show cloud services (OneDrive)
                if (has_cloud_services) {
                    ImVec4 status_color = ImVec4(0.2f, 0.6f, 0.9f, 1.0f); // Blue for cloud
                    std::string onedrive_label = "● OneDrive";
                    float button_width = ImGui::GetContentRegionAvail().x;
                    if (ImGui::Button(onedrive_label.c_str(), ImVec2(button_width, 24))) {
                        // Could navigate to OneDrive root or show options
                        // For now, just show it's connected
                    }
                    ImGui::Spacing();
                }

                // Show devices (Tailscale devices)
                for (const auto& device : services_state.devices) {
                    ImVec4 status_color = device.is_online
                        ? ImVec4(0.3f, 0.8f, 0.4f, 1.0f)
                        : ImVec4(0.5f, 0.5f, 0.5f, 1.0f);

                    std::string device_label = std::string(device.is_online ? "● " : "○ ") + device.name;

                    float button_width = ImGui::GetContentRegionAvail().x;
                    if (ImGui::Button(device_label.c_str(), ImVec2(button_width, 24))) {
                        if (!device.mount_path.empty()) {
                            auto& file_explorer_state = registry_.get_state<FileExplorerState>("FileExplorer");
                            std::error_code ec;
                            fs::create_directories(device.mount_path, ec);
                            get_files(file_explorer_state, device.mount_path);
                        }
                    }
                }

                ImGui::PopStyleColor(3);
            }
            ImGui::EndChild();

            ImGui::PopStyleVar(2);
            ImGui::PopStyleColor();
        }

        ImGui::EndGroup();
        
        ImGui::Spacing();
    }

    void FileSidebarPanel::show_create_new(FileSidebarState& state, float width, float padding) {
        ImGui::SetCursorPosX(padding);
        
        ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 8.0f);
        ImGui::PushStyleVar(ImGuiStyleVar_FramePadding, ImVec2(12.0f, 8.0f));

        ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.2f, 0.2f, 0.2f, 1.0f));
        ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.5f, 0.5f, 0.5f, 0.3f));

        float b_width = width - (padding * 2);
        core::SVGTexture& plus_icon = core::AssetManager::get().get_svg_texture("plus-24", 24);

        if (IconButton("##add_file", plus_icon, "New", ImVec2(b_width, 48.0f), nullptr, 18.0f)) {
            state.show_chooser_modal = true;
        }

        ImGui::PopStyleColor(2);
        ImGui::PopStyleVar(2);
    }

    void FileSidebarPanel::show_chooser_modal(FileSidebarState& state)
    {
        if (state.show_chooser_modal)
            ImGui::OpenPopup("New");

        ImGuiViewport* vp = ImGui::GetMainViewport();
        ImGui::SetNextWindowPos(
            ImVec2(vp->WorkPos.x + 16, vp->WorkPos.y + 16),
            ImGuiCond_Appearing);

        ImGui::SetNextWindowSize(ImVec2(320, 360), ImGuiCond_Appearing);

        ImGui::PushStyleVar(ImGuiStyleVar_WindowRounding, 8.0f);
        ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(24, 24));
        ImGui::PushStyleVar(ImGuiStyleVar_ItemSpacing, ImVec2(12, 16));

        if (ImGui::BeginPopupModal("New", &state.show_chooser_modal,
            ImGuiWindowFlags_NoResize | ImGuiWindowFlags_NoMove))
        {
            float w = ImGui::GetContentRegionAvail().x;

            ImGui::TextDisabled("Upload");
            ImGui::Separator();

            if (ImGui::Button("Upload Files", ImVec2(w, 40))) {
                state.show_uploader_modal = true;
                state.show_chooser_modal = false;
            }

            ImGui::TextDisabled("Create");
            ImGui::Separator();

            if (ImGui::Button("Create File", ImVec2(w, 40))) {
                state.create_is_dir = false;
                state.show_create_entry_modal = true;
                state.show_chooser_modal = false;
            }

            if (ImGui::Button("Create Folder", ImVec2(w, 40))) {
                state.create_is_dir = true;
                state.show_create_entry_modal = true;
                state.show_chooser_modal = false;
            }

            ImGui::EndPopup();
        }

        ImGui::PopStyleVar(3);
    }


    void FileSidebarPanel::show_create_entry_modal(FileSidebarState& state) {
        const char* title = state.create_is_dir ? "Create Folder" : "Create File";

        if (state.show_create_entry_modal) {
            ImGui::OpenPopup(title); // Match the title exactly
            state.show_create_entry_modal = false;
        }

        // Centering and Styling
        ImGui::SetNextWindowPos(ImGui::GetMainViewport()->GetCenter(), ImGuiCond_Appearing, { 0.5f, 0.5f });
        ImGui::SetNextWindowSize({ 420, 190 }, ImGuiCond_Appearing);

        ImGui::PushStyleVar(ImGuiStyleVar_WindowRounding, 8.0f);
        ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, { 24, 24 });
        ImGui::PushStyleVar(ImGuiStyleVar_ItemSpacing, { 12, 16 });
        ImGui::PushStyleVar(ImGuiStyleVar_FramePadding, { 12, 10 });

        if (ImGui::BeginPopupModal(title, nullptr, ImGuiWindowFlags_NoResize | ImGuiWindowFlags_NoMove)) {

            ImGui::Text("%s Name", state.create_is_dir ? "Folder" : "File");
            ImGui::SetNextItemWidth(-1);
            ImGui::InputTextWithHint("##name", "Enter name...", state.name_buffer, IM_ARRAYSIZE(state.name_buffer));

            ImGui::Separator();

            float w = (ImGui::GetContentRegionAvail().x - ImGui::GetStyle().ItemSpacing.x) * 0.5f;

            if (ImGui::Button("Create", { w, 36 }) && state.name_buffer[0]) {
                // Use the pointer we stored in the state to avoid registry deadlocks!
				auto& file_explorer_state = registry_.get_state<FileExplorerState>("FileExplorer");
                fs::path p = fs::path(file_explorer_state.current_path) / state.name_buffer;
                create_file(p.generic_string());

                state.name_buffer[0] = '\0';
                ImGui::CloseCurrentPopup();
            }

            ImGui::SameLine();

            if (ImGui::Button("Cancel", { w, 36 })) {
                state.name_buffer[0] = '\0';
                ImGui::CloseCurrentPopup();
            }

            ImGui::EndPopup();
        }
        ImGui::PopStyleVar(4);
    }

    void FileSidebarPanel::show_quick_access(float width, float padding) {
        float content_width = width - (padding * 2);
        ImGui::SetCursorPosX(padding);

        ImGui::BeginGroup();

        ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.7f, 0.7f, 0.7f, 1.0f));
        ImGui::Text("Quick access");
        ImGui::PopStyleColor();

        ImGui::PushStyleVar(ImGuiStyleVar_FramePadding, ImVec2(8.0f, 8.0f));
        ImGui::PushStyleVar(ImGuiStyleVar_ItemSpacing, ImVec2(0.0f, 8.0f));
        ImGui::PushStyleVar(ImGuiStyleVar_ButtonTextAlign, ImVec2(0.0f, 0.5f));

        ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.3f, 0.3f, 0.3f, 0.3f));
        ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.5f, 0.5f, 0.5f, 0.5f));
        ImGui::PushStyleColor(ImGuiCol_ButtonActive, ImVec4(0.3f, 0.3f, 0.3f, 0.5f));

        ImGui::Button("Recent", ImVec2(content_width, 0));
        ImGui::Button("Starred", ImVec2(content_width, 0));
        ImGui::Button("Trash", ImVec2(content_width, 0));

        ImGui::PopStyleColor(3);
        ImGui::PopStyleVar(3);
        ImGui::EndGroup();
        
        // Add bottom padding for consistent spacing
        ImGui::Spacing();
    }

    void FileSidebarPanel::show_storage_info(float width, float padding) {
        ImGui::SetCursorPosY(ImGui::GetWindowContentRegionMax().y - 100.0f);
        ImGui::SetCursorPosX(padding);

        float b_width = width - (padding * 2);

        ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 10.0f);
        ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.4f, 0.2f, 0.15f, 1.0f));

        ImGui::Button("Upload anything\n2.36 GB / 2 GB\nUpgrade", ImVec2(b_width, 80));

        ImGui::PopStyleColor();
        ImGui::PopStyleVar();
    }

    void FileSidebarPanel::show_uploader_modal(FileSidebarState& state) {
        if (!state.show_uploader_modal) return;

        auto& services_state = registry_.get_state<ServicesState>("Services");
        if (!services_state.has_ms_token()) {
            state.show_uploader_modal = false;
            state.status_message = "Sign in to OneDrive via Services first.";
            return;
        }

        // Open file picker (this blocks until user selects files or cancels)
        core::FilePickerOptions options;
        options.title = "Select Files to Upload";
        core::FilePickerResult result = core::FilePicker::show_dialog(options);

        state.show_uploader_modal = false;

        if (result.has_selection()) {
            start_file_upload(state, result.paths);
        }
    }

    void FileSidebarPanel::show_upload_progress_modal(FileSidebarState& state) {
        // Show upload progress modal if uploading
        if (state.is_uploading) {
            ImGui::OpenPopup("Uploading...");
        }

        ImGui::SetNextWindowPos(ImGui::GetMainViewport()->GetCenter(), ImGuiCond_Appearing, {0.5f, 0.5f});
        ImGui::SetNextWindowSize({400, 220}, ImGuiCond_Appearing);

        ImGui::PushStyleVar(ImGuiStyleVar_WindowRounding, 8.0f);
        ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, {24, 24});

        if (ImGui::BeginPopupModal("Uploading...", nullptr, ImGuiWindowFlags_NoResize | ImGuiWindowFlags_NoMove)) {
            auto current = state.get_current_upload();

            if (!current.file_name.empty()) {
                ImGui::Text("Uploading: %s", current.file_name.c_str());
                ImGui::Spacing();

                // Progress bar
                float progress = 0.0f;
                if (current.file_size > 0) {
                    progress = static_cast<float>(current.bytes_uploaded) / static_cast<float>(current.file_size);
                }
                ImGui::ProgressBar(progress, ImVec2(-1, 20));

                // Progress text
                float mb_uploaded = static_cast<float>(current.bytes_uploaded) / (1024.0f * 1024.0f);
                float mb_total = static_cast<float>(current.file_size) / (1024.0f * 1024.0f);
                ImGui::Text("%.2f MB / %.2f MB", mb_uploaded, mb_total);

                // File count
                {
                    std::lock_guard<std::mutex> lock(state.upload_mutex);
                    ImGui::Text("File %zu of %zu", state.current_upload_index + 1, state.upload_queue.size());
                }

                if (current.has_error) {
                    ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(1.0f, 0.3f, 0.3f, 1.0f));
                    ImGui::TextWrapped("Error: %s", current.error_message.c_str());
                    ImGui::PopStyleColor();
                }

                if (current.is_complete) {
                    ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.3f, 1.0f, 0.3f, 1.0f));
                    ImGui::Text("Upload complete!");
                    ImGui::PopStyleColor();
                }
            }

            ImGui::Spacing();
            ImGui::Separator();
            ImGui::Spacing();

            float button_width = (ImGui::GetContentRegionAvail().x - ImGui::GetStyle().ItemSpacing.x) * 0.5f;

            if (state.is_uploading) {
                if (ImGui::Button("Cancel", ImVec2(button_width, 36))) {
                    state.cancel_upload.store(true);
                }
                ImGui::SameLine();
                ImGui::BeginDisabled();
                ImGui::Button("Close", ImVec2(button_width, 36));
                ImGui::EndDisabled();
            } else {
                ImGui::BeginDisabled();
                ImGui::Button("Cancel", ImVec2(button_width, 36));
                ImGui::EndDisabled();
                ImGui::SameLine();
                if (ImGui::Button("Close", ImVec2(button_width, 36))) {
                    state.reset_upload();
                    ImGui::CloseCurrentPopup();
                }
            }

            ImGui::EndPopup();
        }

        ImGui::PopStyleVar(2);
    }

    void FileSidebarPanel::start_file_upload(FileSidebarState& state, const std::vector<std::string>& file_paths) {
        if (file_paths.empty()) return;

        auto& services_state = registry_.get_state<ServicesState>("Services");
        if (!services_state.has_ms_token()) {
            state.status_message = "Not authenticated with Microsoft. Sign in via Services first.";
            return;
        }
        std::string ms_token = services_state.ms_access_token;

        // Initialize upload queue
        {
            std::lock_guard<std::mutex> lock(state.upload_mutex);
            state.upload_queue.clear();
            state.current_upload_index = 0;

            for (const auto& path : file_paths) {
                FileUploadProgress progress;
                progress.file_path = path;
                progress.file_name = fs::path(path).filename().string();

                std::error_code ec;
                progress.file_size = fs::file_size(path, ec);
                if (ec) {
                    progress.has_error = true;
                    progress.error_message = "Cannot access file";
                }

                state.upload_queue.push_back(progress);
            }
        }

        state.is_uploading = true;
        state.cancel_upload.store(false);

        // Get destination path from file explorer
        auto& file_explorer_state = registry_.get_state<FileExplorerState>("FileExplorer");
        std::string dest_path = file_explorer_state.current_path;

        worker_pool_.add(
            [this, &state, dest_path, ms_token]() {
                while (true) {
                    std::string file_path;
                    {
                        std::lock_guard<std::mutex> lock(state.upload_mutex);
                        if (state.current_upload_index >= state.upload_queue.size()) {
                            break;
                        }
                        file_path = state.upload_queue[state.current_upload_index].file_path;
                    }

                    if (state.cancel_upload.load()) {
                        break;
                    }

                    create_upload_session_and_upload(state, file_path, dest_path, ms_token);

                    {
                        std::lock_guard<std::mutex> lock(state.upload_mutex);
                        state.current_upload_index++;
                    }
                }
            },
            [&state]() {
                // On finish
                state.is_uploading = false;
            },
            [&state](const std::string& error) {
                // On error
                std::lock_guard<std::mutex> lock(state.upload_mutex);
                if (state.current_upload_index < state.upload_queue.size()) {
                    state.upload_queue[state.current_upload_index].has_error = true;
                    state.upload_queue[state.current_upload_index].error_message = error;
                }
                state.is_uploading = false;
            }
        );
    }

    void FileSidebarPanel::create_upload_session_and_upload(FileSidebarState& state, const std::string& file_path, const std::string& dest_path, const std::string& ms_token) {
        std::string file_name = fs::path(file_path).filename().string();

        nlohmann::json session_request;
        session_request["path"] = "";
        session_request["fileName"] = file_name;

        std::map<std::string, std::string> headers;
        headers["Content-Type"] = "application/json";
        headers["Authorization"] = "Bearer " + ms_token;

        // Call proxy to create upload session
        auto& http = core::HttpClient::get();
        auto response = http.post(
            "http://localhost:3000/api/ms/upload/session",
            session_request.dump(),
            headers
        );

        if (response.status_code != 200) {
            std::lock_guard<std::mutex> lock(state.upload_mutex);
            if (state.current_upload_index < state.upload_queue.size()) {
                state.upload_queue[state.current_upload_index].has_error = true;
                state.upload_queue[state.current_upload_index].error_message =
                    "Failed to create upload session: " + response.body;
            }
            return;
        }

        // Parse upload URL from response
        std::string upload_url;
        try {
            auto json_response = nlohmann::json::parse(response.body);
            upload_url = json_response["uploadUrl"].get<std::string>();
        } catch (const std::exception& e) {
            std::lock_guard<std::mutex> lock(state.upload_mutex);
            if (state.current_upload_index < state.upload_queue.size()) {
                state.upload_queue[state.current_upload_index].has_error = true;
                state.upload_queue[state.current_upload_index].error_message =
                    "Failed to parse upload session response";
            }
            return;
        }

        // Step 2: Stream file chunks to uploadUrl
        auto result = http.chunked_upload(
            upload_url,
            file_path,
            10 * 1024 * 1024,  // 10MB chunks
            [&state](size_t bytes_uploaded, size_t total_bytes) -> bool {
                state.update_upload_progress(bytes_uploaded);
                return !state.cancel_upload.load();
            },
            &state.cancel_upload
        );

        // Update status
        {
            std::lock_guard<std::mutex> lock(state.upload_mutex);
            if (state.current_upload_index < state.upload_queue.size()) {
                if (result.success) {
                    state.upload_queue[state.current_upload_index].is_complete = true;
                    state.upload_queue[state.current_upload_index].bytes_uploaded =
                        state.upload_queue[state.current_upload_index].file_size;
                } else {
                    state.upload_queue[state.current_upload_index].has_error = true;
                    state.upload_queue[state.current_upload_index].error_message = result.error_message;
                }
            }
        }
    }
}