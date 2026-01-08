#include "navbar_panel.h"

namespace minidfs {
    NavbarPanel::NavbarPanel(UIRegistry& registry) : registry_(registry) {
    }

    void NavbarPanel::render() {
        auto& state = registry_.get_state<NavbarState>("Navbar");
        
        ImGuiWindowFlags flags = ImGuiWindowFlags_NoTitleBar;
        
        // Dark background style
        ImGui::PushStyleColor(ImGuiCol_WindowBg, ImVec4(0.11f, 0.11f, 0.11f, 1.0f));
        
        if (ImGui::Begin("Navbar", nullptr, flags)) {
            ImGui::SetWindowSize(ImVec2(77, ImGui::GetIO().DisplaySize.y));
            
            // Logo at the top
            ImGui::SetCursorPos(ImVec2(20, 20));
            ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.3f, 0.6f, 1.0f, 1.0f));
            ImGui::Text("DFS");
            ImGui::PopStyleColor();
            
            ImGui::Spacing();
            ImGui::Spacing();
            ImGui::Spacing();
            
            // Navigation items
            render_nav_item("H", "Home", 0, state);
            render_nav_item("F", "Folders", 1, state);
            render_nav_item("A", "Activity", 2, state);
            
            // Push "More" to the bottom
            ImGui::SetCursorPosY(ImGui::GetWindowHeight() - 80);
            render_nav_item("M", "More", 3, state);
        }
        ImGui::End();
        
        ImGui::PopStyleColor();
    }

    void NavbarPanel::render_nav_item(const char* icon, const char* label, int index, NavbarState& state) {
        bool is_selected = (state.selected_item == index);
        
        ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 8.0f);
        ImGui::PushStyleVar(ImGuiStyleVar_FramePadding, ImVec2(8, 8));
        
        if (is_selected) {
            ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.2f, 0.2f, 0.2f, 1.0f));
            ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(1.0f, 1.0f, 1.0f, 1.0f));
        } else {
            ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.11f, 0.11f, 0.11f, 0.0f));
            ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.6f, 0.6f, 0.6f, 1.0f));
        }
        ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.18f, 0.18f, 0.18f, 1.0f));
        
        ImGui::SetCursorPosX(8);
        if (ImGui::Button(icon, ImVec2(60, 50))) {
            state.selected_item = index;
        }
        
        ImGui::PopStyleColor(3);
        ImGui::PopStyleVar(2);
        
        // Label below button
        ImGui::SetCursorPosX(8);
        ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.6f, 0.6f, 0.6f, 1.0f));
        ImGui::Text("%s", label);
        ImGui::PopStyleColor();
        
        ImGui::Spacing();
    }
}