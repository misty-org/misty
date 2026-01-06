#include "tool_menu_panel.h"

namespace minidfs {
    ToolMenuPanel::ToolMenuPanel(UIRegistry& registry, WorkerPool& worker_pool, std::shared_ptr<MiniDFSClient> client)
		: registry_(registry), worker_pool_(worker_pool), client_(client) {
	
    }
    
    void ToolMenuPanel::render() {
        auto& state = registry_.get_state<ToolMenuState>("ToolMenu");
        
        ImGuiWindowFlags flags = ImGuiWindowFlags_NoTitleBar;
        
        // Dark theme for side menu
        ImGui::PushStyleColor(ImGuiCol_WindowBg, ImVec4(0.15f, 0.15f, 0.15f, 1.0f));
        
        if (ImGui::Begin("SideMenu", nullptr, flags)) {
            ImGui::SetWindowSize(ImVec2(280, ImGui::GetIO().DisplaySize.y));
            ImGui::SetWindowPos(ImVec2(77, 0)); // Position next to navbar
            
            // Title
            ImGui::SetCursorPos(ImVec2(20, 20));
            ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(1.0f, 1.0f, 1.0f, 1.0f));
            ImGui::Text("Home");
            ImGui::PopStyleColor();
            
            ImGui::Spacing();
            ImGui::Spacing();
            
            show_main_navigation(state);
            ImGui::Spacing();
            ImGui::Separator();
            ImGui::Spacing();
            show_quick_access();
            show_modals(state);
        }
        ImGui::End();
        
        ImGui::PopStyleColor();
    }

    void ToolMenuPanel::show_main_navigation(ToolMenuState& state) {
        // Style for navigation buttons
        ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 8.0f);
        ImGui::PushStyleVar(ImGuiStyleVar_FramePadding, ImVec2(15, 12));
        ImGui::PushStyleVar(ImGuiStyleVar_ItemSpacing, ImVec2(10, 8));
        
        // Dark theme colors
        ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.25f, 0.25f, 0.25f, 0.6f));
        ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.3f, 0.3f, 0.3f, 0.8f));
        ImGui::PushStyleColor(ImGuiCol_ButtonActive, ImVec4(0.35f, 0.35f, 0.35f, 1.0f));
        ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.9f, 0.9f, 0.9f, 1.0f));
        
        float button_width = 240;
        
        ImGui::SetCursorPosX(20);
        if (ImGui::Button("  All files", ImVec2(button_width, 0))) {
            // Handle all files navigation
        }
        
        ImGui::SetCursorPosX(20);
        if (ImGui::Button("  Photos", ImVec2(button_width, 0))) {
            // Handle photos navigation
        }
        
        ImGui::SetCursorPosX(20);
        if (ImGui::Button("  Shared", ImVec2(button_width, 0))) {
            // Handle shared navigation
        }
        
        ImGui::SetCursorPosX(20);
        if (ImGui::Button("  File requests", ImVec2(button_width, 0))) {
            // Handle file requests navigation
        }
        
        ImGui::SetCursorPosX(20);
        if (ImGui::Button("  Deleted files", ImVec2(button_width, 0))) {
            // Handle deleted files navigation
        }
        
        ImGui::PopStyleColor(4);
        ImGui::PopStyleVar(3);
        
        ImGui::Spacing();
    }

    void ToolMenuPanel::show_quick_access() {
        ImGui::SetCursorPosX(20);
        ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.7f, 0.7f, 0.7f, 1.0f));
        ImGui::Text("Quick access");
        ImGui::SameLine();
        if (ImGui::SmallButton("+")) {
            // Add new quick access item
        }
        ImGui::PopStyleColor();
        
        ImGui::Spacing();
        
        // Collapsible sections
        ImGui::PushStyleColor(ImGuiCol_Header, ImVec4(0.2f, 0.2f, 0.2f, 0.5f));
        ImGui::PushStyleColor(ImGuiCol_HeaderHovered, ImVec4(0.25f, 0.25f, 0.25f, 0.8f));
        ImGui::PushStyleColor(ImGuiCol_HeaderActive, ImVec4(0.3f, 0.3f, 0.3f, 1.0f));
        ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.9f, 0.9f, 0.9f, 1.0f));
        
        ImGui::SetCursorPosX(20);
        if (ImGui::CollapsingHeader("Starred", ImGuiTreeNodeFlags_DefaultOpen)) {
            ImGui::SetCursorPosX(30);
            ImGui::TextColored(ImVec4(0.6f, 0.6f, 0.6f, 1.0f), "(empty)");
        }
        
        ImGui::SetCursorPosX(20);
        if (ImGui::CollapsingHeader("Untitled", ImGuiTreeNodeFlags_DefaultOpen)) {
            ImGui::SetCursorPosX(30);
            ImGui::TextColored(ImVec4(0.6f, 0.6f, 0.6f, 1.0f), "Drag important items");
            ImGui::SetCursorPosX(30);
            ImGui::TextColored(ImVec4(0.6f, 0.6f, 0.6f, 1.0f), "here.");
        }
        
        ImGui::PopStyleColor(4);
        
        // Storage info at bottom
        ImGui::SetCursorPosY(ImGui::GetWindowHeight() - 120);
        ImGui::SetCursorPosX(20);
        
        ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 12.0f);
        ImGui::PushStyleVar(ImGuiStyleVar_FramePadding, ImVec2(15, 15));
        ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.5f, 0.25f, 0.2f, 1.0f));
        ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.55f, 0.3f, 0.25f, 1.0f));
        ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(1.0f, 1.0f, 1.0f, 1.0f));
        
        if (ImGui::Button("Upload anything\n2.36 GB of 2 GB\n\nUpgrade for more", ImVec2(240, 0))) {
            // Handle upgrade
        }
        
        ImGui::PopStyleColor(3);
        ImGui::PopStyleVar(2);
    }

    void ToolMenuPanel::show_modals(ToolMenuState& state) {
        if (state.show_new_file_modal) {
            ImGui::OpenPopup("Create New File");
            if (ImGui::BeginPopupModal("Create New File", &state.show_new_file_modal, ImGuiWindowFlags_AlwaysAutoResize)) {
                ImGui::Text("Enter name for the new file:");

                // Bigger input field
                ImGui::PushItemWidth(300);
                ImGui::InputText("##filename", state.name_buffer, IM_ARRAYSIZE(state.name_buffer));
                ImGui::PopItemWidth();

                ImGui::Spacing();

                // Bigger buttons with padding
                ImGui::PushStyleVar(ImGuiStyleVar_FramePadding, ImVec2(20, 10));

                if (ImGui::Button("Cancel", ImVec2(120, 0))) {
                    state.show_new_file_modal = false;
                }
                ImGui::SameLine();
                if (ImGui::Button("Create", ImVec2(120, 0))) {
                    // this->dispatch_create_file(state.name_buffer);
                    state.show_new_file_modal = false;
                }

                ImGui::PopStyleVar();
                ImGui::EndPopup();
            }
        }

        if (state.show_new_folder_modal) {
            ImGui::OpenPopup("Create New Folder");
            if (ImGui::BeginPopupModal("Create New Folder", &state.show_new_folder_modal, ImGuiWindowFlags_AlwaysAutoResize)) {
                ImGui::Text("Enter name for the new folder:");

                // Bigger input field
                ImGui::PushItemWidth(300);
                ImGui::InputText("##foldername", state.name_buffer, IM_ARRAYSIZE(state.name_buffer));
                ImGui::PopItemWidth();

                ImGui::Spacing();

                // Bigger buttons with padding
                ImGui::PushStyleVar(ImGuiStyleVar_FramePadding, ImVec2(20, 10));

                if (ImGui::Button("Cancel", ImVec2(120, 0))) {
                    state.show_new_folder_modal = false;
                }
                ImGui::SameLine();
                if (ImGui::Button("Create", ImVec2(120, 0))) {
                    // this->dispatch_create_folder(state.name_buffer);
                    state.show_new_folder_modal = false;
                }

                ImGui::PopStyleVar();
                ImGui::EndPopup();
            }
        }
    }
}