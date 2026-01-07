#include "navbar_panel.h"
#include "asset_manager.h"

namespace minidfs {
    NavbarPanel::NavbarPanel(UIRegistry& ui_registry) : ui_registry_(ui_registry) {

    }

    void NavbarPanel::render() {
        auto& state = ui_registry_.get_state<NavbarState>("Navbar");

        ImGuiViewport* viewport = ImGui::GetMainViewport();
        ImGui::SetNextWindowViewport(viewport->ID);
        ImGui::SetNextWindowPos(viewport->WorkPos);

        float nav_width = 77.0f;
        ImGui::SetNextWindowSize(ImVec2(nav_width, viewport->WorkSize.y));

        ImGuiWindowFlags navbar_flags = ImGuiWindowFlags_NoTitleBar |
            ImGuiWindowFlags_NoMove |
            ImGuiWindowFlags_NoCollapse |
            ImGuiWindowFlags_NoResize |
            ImGuiWindowFlags_NoScrollbar;

        ImGui::PushStyleColor(ImGuiCol_WindowBg, ImVec4(0.133f, 0.133f, 0.133f, 1.0f));
        ImGui::PushStyleVar(ImGuiStyleVar_WindowBorderSize, 0.0f);

        if (ImGui::Begin("Navbar", nullptr, navbar_flags)) {
            // Center the Logo
            float logo_width = ImGui::CalcTextSize("DFS").x;
            ImGui::SetCursorPos(ImVec2((nav_width - logo_width) * 0.5f, 20.0f));

            ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.3f, 0.6f, 1.0f, 1.0f));
            ImGui::Text("DFS");
            ImGui::PopStyleColor();

            ImGui::Dummy(ImVec2(0, 20)); // Spacing

            // Navigation items
            render_nav_item("home-24", "Home", 24, 0, state);
            render_nav_item("file-directory-24", "Folders", 24, 1, state);
            render_nav_item("bell-24", "Activity", 24, 2, state);

            // More button at the bottom
            float footer_y = ImGui::GetWindowHeight() - 80.0f;
            ImGui::SetCursorPosY(footer_y);
            render_nav_item("kebab-horizontal-24", "More", 24, 3, state);
        }
        ImGui::End();

        ImGui::PopStyleVar(); // WindowBorderSize
        ImGui::PopStyleColor(); // WindowBg
    }

    void NavbarPanel::render_nav_item(const char* icon_name, const char* label, int size, int index, NavbarState& state) {
        bool is_selected = (state.selected_item == index);

        // Oversample: render at 2x size, display at 1x size for crispness
        auto& icon = AssetManager::get().get_icon(icon_name, size * 2);

        float navbar_width = ImGui::GetWindowWidth();

        // Button centering math
        // ImageButton size + padding on both sides
        float padding_x = 8.0f;
        float button_total_width = (float)size + (padding_x * 2.0f);
        float centered_x = (navbar_width - button_total_width) * 0.5f;

        ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 8.0f);
        ImGui::PushStyleVar(ImGuiStyleVar_FramePadding, ImVec2(padding_x, 8.0f));

        if (is_selected) {
            ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.2f, 0.2f, 0.2f, 1.0f));
            ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(1.0f, 1.0f, 1.0f, 1.0f));
        }
        else {
            ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.11f, 0.11f, 0.11f, 0.0f));
            ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.6f, 0.6f, 0.6f, 1.0f));
        }
        ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.18f, 0.18f, 0.18f, 1.0f));

        ImGui::SetCursorPosX(std::floor(centered_x));

        ImGuiID id = ImGui::GetID(label);
        if (ImGui::ImageButton(
            label,
            icon.id,
            ImVec2((float)size, (float)size),
            ImVec2(0, 0), ImVec2(1, 1),
            ImVec4(0, 0, 0, 0),
            ImVec4(1, 1, 1, 1) // Icon color is controlled by SVG CSS
        )) {
            state.selected_item = index;
        }

        ImGui::PopStyleColor(3);
        ImGui::PopStyleVar(2);

        // Label centering math
        float text_width = ImGui::CalcTextSize(label).x;
        float text_centered_x = (navbar_width - text_width) * 0.5f;

        ImGui::SetCursorPosX(std::floor(text_centered_x));

        ImVec4 textColor = is_selected ? ImVec4(1, 1, 1, 1) : ImVec4(0.6f, 0.6f, 0.6f, 1.0f);
        ImGui::PushStyleColor(ImGuiCol_Text, textColor);
        ImGui::Text("%s", label);
        ImGui::PopStyleColor();

        ImGui::Spacing();
    }
}