#include "auth_register_panel.h"
#include "imgui.h"
#include "core/util.h"
#include "core/asset_manager.h"
#include "core/app_view_registry.h"
#include <cstring>
#include <iostream>
#include "panels/panel_ui.h"

namespace minidfs::panel {
    AuthRegisterPanel::AuthRegisterPanel(UIRegistry& registry)
        : registry_(registry) {
    }

    void AuthRegisterPanel::render() {
        auto& state = registry_.get_state<AuthRegisterState>("AuthRegister");

        ImGuiWindowFlags flags =
            ImGuiWindowFlags_NoTitleBar |
            ImGuiWindowFlags_NoResize |
            ImGuiWindowFlags_NoMove |
            ImGuiWindowFlags_NoCollapse |
            ImGuiWindowFlags_NoScrollbar |
            ImGuiWindowFlags_NoDocking;

        // Dark background
        ImGui::PushStyleColor(ImGuiCol_WindowBg, ImVec4(0.1f, 0.1f, 0.1f, 1.0f));
        ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(32.0f, 40.0f));
        ImGui::PushStyleVar(ImGuiStyleVar_ItemSpacing, ImVec2(0.0f, 10.0f));
        ImGui::PushStyleVar(ImGuiStyleVar_FramePadding, ImVec2(12.0f, 8.0f));

        if (ImGui::Begin("AuthRegister", nullptr, flags)) {

            float window_width = ImGui::GetWindowWidth();
            float content_width = window_width - 64.0f; // Account for padding
            ImGui::SetNextItemWidth(content_width);

            show_header();
            show_form_fields(state);
            show_terms_checkbox(state);
            show_register_button(state);
            show_login_button();
        }

        ImGui::End();
        ImGui::PopStyleVar(3);
        ImGui::PopStyleColor();
    }

    void AuthRegisterPanel::show_header() {
        const char* text = "Welcome to Misty";
        
        // Scale font to 1.5x
        float original_scale = ImGui::GetFontSize();
        ImGui::SetWindowFontScale(1.5f);
        
        // Calculate text width and center it
        ImVec2 text_size = ImGui::CalcTextSize(text);
        float window_width = ImGui::GetWindowWidth();
        float center_x = (window_width - text_size.x) * 0.5f;
        ImGui::SetCursorPosX(center_x);
        
        ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(1.0f, 1.0f, 1.0f, 1.0f));
        ImGui::Text("%s", text);
        ImGui::PopStyleColor();
        
        // Restore original font scale
        ImGui::SetWindowFontScale(1.0f);
        
        ImGui::Spacing();
    }

    void AuthRegisterPanel::show_form_fields(AuthRegisterState& state) {
        float width = ImGui::GetContentRegionAvail().x;

        // Username
        ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.8f, 0.8f, 0.8f, 1.0f));
        auto& person_icon = core::AssetManager::get().get_svg_texture("person-16", 24);
        IconText(person_icon, 16.0f, "Username", 1.0f, -2.0f);
        ImGui::PopStyleColor();
        ImGui::SetNextItemWidth(width);
        ImGui::InputTextWithHint("##username", "", state.full_name, sizeof(state.full_name));

        // Email
        ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.8f, 0.8f, 0.8f, 1.0f));
        auto& mail_icon = core::AssetManager::get().get_svg_texture("mail-16", 24);
        IconText(mail_icon, 16.0f, "Email", 2.0f, -2.0f);
        ImGui::PopStyleColor();
        ImGui::SetNextItemWidth(width);
        ImGui::InputTextWithHint("##email", "", state.email, sizeof(state.email));

        // Password
        ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.8f, 0.8f, 0.8f, 1.0f));
        auto& lock_icon = core::AssetManager::get().get_svg_texture("lock-16", 24);
        IconText(lock_icon, 16.0f, "Password", 1.0f, -2.0f);
        ImGui::PopStyleColor();
        ImGui::SetNextItemWidth(width);
        ImGui::InputTextWithHint("##password", "", state.password, sizeof(state.password), ImGuiInputTextFlags_Password);

        // Confirm password
        ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.8f, 0.8f, 0.8f, 1.0f));
        auto& lock_icon2 = core::AssetManager::get().get_svg_texture("lock-16", 24);
        IconText(lock_icon2, 16.0f, "Confirm password", 1.0f, -2.0f);
        ImGui::PopStyleColor();
        ImGui::SetNextItemWidth(width);
        ImGui::InputTextWithHint("##confirm_password", "", state.confirm_password, sizeof(state.confirm_password), ImGuiInputTextFlags_Password);
    }

    void AuthRegisterPanel::show_terms_checkbox(AuthRegisterState& state) {

        // Checkbox styling
        ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.8f, 0.8f, 0.8f, 1.0f));
        ImGui::Checkbox("I agree to the ", &state.agree_to_terms);
        ImGui::SameLine();
        
        // Underlined links - using Selectable to make them properly clickable
        ImVec4 link_color = ImVec4(0.4f, 0.7f, 1.0f, 1.0f);
        ImGui::PushStyleColor(ImGuiCol_Text, link_color);
        ImGui::PushStyleColor(ImGuiCol_Header, ImVec4(0, 0, 0, 0)); // Transparent background
        ImGui::PushStyleColor(ImGuiCol_HeaderHovered, ImVec4(0, 0, 0, 0)); // Transparent hover
        
        if (ImGui::Selectable("Terms of Service", false, ImGuiSelectableFlags_None)) {
            show_terms_in_browser();
        }
        if (ImGui::IsItemHovered(ImGuiHoveredFlags_DelayNone)) {
            ImGui::SetMouseCursor(ImGuiMouseCursor_Hand);
        }
        
        ImGui::SameLine();
        ImGui::Text(" and ");
        ImGui::SameLine();
        
        if (ImGui::Selectable("Privacy Policy", false, ImGuiSelectableFlags_None)) {
            // Handle Privacy Policy click
        }
        if (ImGui::IsItemHovered(ImGuiHoveredFlags_DelayNone)) {
            ImGui::SetMouseCursor(ImGuiMouseCursor_Hand);
        }
        
        ImGui::PopStyleColor(4); // Pop: checkbox text, link text, header bg, header hover
    }

    void AuthRegisterPanel::show_register_button(AuthRegisterState& state) {
        float width = ImGui::GetContentRegionAvail().x;
        
        ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 6.0f);
        ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.2f, 0.5f, 0.9f, 1.0f)); // Blue button
        ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.3f, 0.6f, 1.0f, 1.0f));
        ImGui::PushStyleColor(ImGuiCol_ButtonActive, ImVec4(0.15f, 0.4f, 0.8f, 1.0f));
        ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(1.0f, 1.0f, 1.0f, 1.0f));

        if (ImGui::Button("Create account", ImVec2(width, 40))) {
            state.handle_create_account();
        }

        ImGui::PopStyleColor(4);
        ImGui::PopStyleVar();
    }

    void AuthRegisterPanel::show_login_button() {
        ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.7f, 0.7f, 0.7f, 1.0f));
        ImGui::Text("Already have an account? ");
        ImGui::SameLine();
        
        ImVec4 link_color = ImVec4(0.4f, 0.7f, 1.0f, 1.0f);
        ImGui::PushStyleColor(ImGuiCol_Text, link_color);
        ImGui::Text("Log in");
        if (ImGui::IsItemHovered()) {
            ImGui::SetMouseCursor(ImGuiMouseCursor_Hand);
            if (ImGui::IsItemClicked()) {
                core::AppViewRegistryController::switch_view(view::ViewID::Login);
            }
        }
        ImGui::PopStyleColor(2);
    }

    void AuthRegisterPanel::show_terms_in_browser() {
        auto& state = registry_.get_state<AuthRegisterState>("AuthRegister");
        std::string html_path = state.terms_of_service_path;
        if (html_path.empty()) {
            std::cerr << "Warning: Could not find terms_of_service.html" << std::endl;
            return;
        }

        core::open_file_in_browser(html_path);
    }
}
