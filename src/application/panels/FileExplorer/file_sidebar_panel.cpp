#include "file_sidebar_panel.h"
#include "panel_ui.h"
#include "asset_manager.h"

namespace minidfs::FileExplorer {
    FileSidebarPanel::FileSidebarPanel(UIRegistry& registry, WorkerPool& worker_pool, std::shared_ptr<MiniDFSClient> client)
        : registry_(registry), worker_pool_(worker_pool), client_(client) {


    }

    void FileSidebarPanel::render() {
        auto& state = registry_.get_state<FileSidebarState>("FileSidebar");

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

            show_create_new(state, width, padding);

            ImGui::Separator();

            show_quick_access(width, padding);
            show_storage_info(width, padding);

            show_chooser_modal(state);
            show_create_entry_modal(state);
        }

        ImGui::End();
        ImGui::PopStyleVar(2);
        ImGui::PopStyleColor();
    }

    void FileSidebarPanel::show_create_new(FileSidebarState& state, float width, float padding) {
        ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 8.0f);
        ImGui::PushStyleVar(ImGuiStyleVar_FramePadding, ImVec2(padding, 8));

        ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.2f, 0.2f, 0.2f, 1.0f));
        ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.5f, 0.5f, 0.5f, 0.3f));

        float b_width = width - (padding * 2);
        SVGTexture& plus_icon = AssetManager::get().get_svg_texture("plus-24", 24);

        if (IconButton("##add_file", plus_icon.id, "New", ImVec2(b_width, 48.0f), nullptr, 18.0f)) {
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

    void FileSidebarPanel::show_upload_modal(FileSidebarState& state) {
    const char* title = "Upload Files";

    if (state.show_upload_modal) {
        ImGui::OpenPopup(title);
        state.show_upload_modal = false;
        state.upload_files.clear();
        state.is_dragging = false;
    }

    // Centering and Styling
    ImGui::SetNextWindowPos(ImGui::GetMainViewport()->GetCenter(), ImGuiCond_Appearing, { 0.5f, 0.5f });
    ImGui::SetNextWindowSize({ 520, 380 }, ImGuiCond_Appearing);

    ImGui::PushStyleVar(ImGuiStyleVar_WindowRounding, 8.0f);
    ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, { 24, 24 });
    ImGui::PushStyleVar(ImGuiStyleVar_ItemSpacing, { 12, 16 });
    ImGui::PushStyleVar(ImGuiStyleVar_FramePadding, { 12, 10 });

    if (ImGui::BeginPopupModal(title, nullptr, ImGuiWindowFlags_NoResize | ImGuiWindowFlags_NoMove)) {
        
        // Drop Zone
        ImVec2 drop_zone_size = { ImGui::GetContentRegionAvail().x, 180 };
        ImVec2 cursor_pos = ImGui::GetCursorScreenPos();
        ImDrawList* draw_list = ImGui::GetWindowDrawList();

        // Check for drag-and-drop
        if (ImGui::BeginDragDropTarget()) {
            if (const ImGuiPayload* payload = ImGui::AcceptDragDropPayload("FILES")) {
                // Handle dropped files - you'll need to implement this based on your system
                // This is a placeholder for the drag-drop handling
                state.is_dragging = false;
            }
            ImGui::EndDragDropTarget();
            state.is_dragging = true;
        } else {
            state.is_dragging = false;
        }

        // Draw drop zone background
        ImU32 bg_color = state.is_dragging 
            ? IM_COL32(60, 120, 180, 100) 
            : IM_COL32(50, 50, 55, 255);
        ImU32 border_color = state.is_dragging 
            ? IM_COL32(80, 150, 220, 255) 
            : IM_COL32(80, 80, 85, 255);

        draw_list->AddRectFilled(cursor_pos, 
            ImVec2(cursor_pos.x + drop_zone_size.x, cursor_pos.y + drop_zone_size.y), 
            bg_color, 6.0f);
        draw_list->AddRect(cursor_pos, 
            ImVec2(cursor_pos.x + drop_zone_size.x, cursor_pos.y + drop_zone_size.y), 
            border_color, 6.0f, 0, 2.0f);

        // Invisible button for click interaction
        ImGui::InvisibleButton("##dropzone", drop_zone_size);
        bool clicked = ImGui::IsItemClicked();

        // Center text in drop zone
        const char* drop_text = state.is_dragging 
            ? "Drop files here..." 
            : "Drag & Drop files or click to browse";
        const char* subtext = state.is_dragging 
            ? "" 
            : "Supports multiple files and folders";
        
        ImVec2 text_size = ImGui::CalcTextSize(drop_text);
        ImVec2 subtext_size = ImGui::CalcTextSize(subtext);
        
        ImVec2 text_pos = ImVec2(
            cursor_pos.x + (drop_zone_size.x - text_size.x) * 0.5f,
            cursor_pos.y + (drop_zone_size.y - text_size.y) * 0.5f - 15
        );
        ImVec2 subtext_pos = ImVec2(
            cursor_pos.x + (drop_zone_size.x - subtext_size.x) * 0.5f,
            text_pos.y + text_size.y + 8
        );

        draw_list->AddText(text_pos, IM_COL32(200, 200, 200, 255), drop_text);
        if (!state.is_dragging) {
            draw_list->AddText(subtext_pos, IM_COL32(150, 150, 150, 200), subtext);
        }

        // Open file dialog on click
        if (clicked) {
            open_file_picker(state);
        }

        ImGui::Dummy(drop_zone_size);

        // File list display
        if (!state.upload_files.empty()) {
            ImGui::Separator();
            ImGui::Text("Selected Files (%zu):", state.upload_files.size());
            
            ImGui::BeginChild("##filelist", ImVec2(0, 80), true);
            for (size_t i = 0; i < state.upload_files.size(); ++i) {
                ImGui::PushID(i);
                ImGui::TextWrapped("%s", state.upload_files[i].c_str());
                ImGui::SameLine(ImGui::GetContentRegionAvail().x - 20);
                if (ImGui::SmallButton("X")) {
                    state.upload_files.erase(state.upload_files.begin() + i);
                    --i;
                }
                ImGui::PopID();
            }
            ImGui::EndChild();
        }

        ImGui::Separator();

        // Action buttons
        float w = (ImGui::GetContentRegionAvail().x - ImGui::GetStyle().ItemSpacing.x) * 0.5f;

        ImGui::BeginDisabled(state.upload_files.empty());
        if (ImGui::Button("Upload", { w, 36 })) {
            auto& file_explorer_state = registry_.get_state<FileExplorerState>("FileExplorer");
            
            for (const auto& file_path : state.upload_files) {
                fs::path src(file_path);
                fs::path dest = fs::path(file_explorer_state.current_path) / src.filename();
                
                try {
                    if (fs::is_directory(src)) {
                        fs::copy(src, dest, fs::copy_options::recursive);
                    } else {
                        fs::copy_file(src, dest, fs::copy_options::overwrite_existing);
                    }
                } catch (const std::exception& e) {
                    // Handle error - you might want to show an error message
                    printf("Upload failed: %s\n", e.what());
                }
            }
            
            state.upload_files.clear();
            ImGui::CloseCurrentPopup();
        }
        ImGui::EndDisabled();

        ImGui::SameLine();

        if (ImGui::Button("Cancel", { w, 36 })) {
            state.upload_files.clear();
            ImGui::CloseCurrentPopup();
        }

        ImGui::EndPopup();
    }
    ImGui::PopStyleVar(4);
}

// Helper function to open native file picker
void FileSidebarPanel::open_file_picker(FileSidebarState& state) {
    // This is platform-specific. Here are examples for different platforms:
    
#ifdef _WIN32
    // Windows implementation using native dialog
    OPENFILENAME ofn;
    char szFile[4096] = { 0 };
    
    ZeroMemory(&ofn, sizeof(ofn));
    ofn.lStructSize = sizeof(ofn);
    ofn.hwndOwner = NULL;
    ofn.lpstrFile = szFile;
    ofn.nMaxFile = sizeof(szFile);
    ofn.lpstrFilter = "All Files (*.*)\0*.*\0";
    ofn.nFilterIndex = 1;
    ofn.lpstrFileTitle = NULL;
    ofn.nMaxFileTitle = 0;
    ofn.lpstrInitialDir = NULL;
    ofn.Flags = OFN_PATHMUSTEXIST | OFN_FILEMUSTEXIST | OFN_ALLOWMULTISELECT | OFN_EXPLORER;
    
    if (GetOpenFileName(&ofn)) {
        // Parse multiple files
        char* ptr = szFile;
        std::string directory = ptr;
        ptr += strlen(ptr) + 1;
        
        if (*ptr == 0) {
            // Single file selected
            state.upload_files.push_back(directory);
        } else {
            // Multiple files selected
            while (*ptr) {
                std::string filename = ptr;
                state.upload_files.push_back(directory + "\\" + filename);
                ptr += strlen(ptr) + 1;
            }
        }
    }
#elif __linux__
    // Linux implementation using zenity or similar
    FILE* f = popen("zenity --file-selection --multiple --separator='|'", "r");
    if (f) {
        char buffer[4096];
        if (fgets(buffer, sizeof(buffer), f)) {
            std::string result = buffer;
            result.erase(result.find_last_not_of("\n\r") + 1);
            
            size_t pos = 0;
            while ((pos = result.find('|')) != std::string::npos) {
                state.upload_files.push_back(result.substr(0, pos));
                result.erase(0, pos + 1);
            }
            if (!result.empty()) {
                state.upload_files.push_back(result);
            }
        }
        pclose(f);
    }
#elif __APPLE__
    // macOS implementation would go here
    // You could use NFD (Native File Dialog) library for cross-platform support
#endif
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
}