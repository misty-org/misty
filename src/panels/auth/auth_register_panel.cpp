#include "auth_register_panel.h"
#include "imgui.h"
#include "core/commands/command_manager.h"
#include "core/system/util.h"
#include "core/manager/asset_manager.h"
#include "core/ui/ui_style.h"
#include "views/app_view.h"
#include <cstring>
#include <iostream>

namespace misty::panel {
    namespace {
        struct ButtonStyle {
            ImVec4 button;
            ImVec4 hovered;
            ImVec4 active;
            ImVec4 text;
            float rounding;
        };

        ButtonStyle primary_button_style() {
            return {
                ImVec4(0.957f, 0.957f, 0.961f, 1.0f),
                ImVec4(0.898f, 0.906f, 0.922f, 1.0f),
                ImVec4(0.820f, 0.835f, 0.859f, 1.0f),
                ImVec4(0.07f, 0.07f, 0.07f, 1.0f),
                8.0f,
            };
        }

        bool styled_button(const char* label, const ImVec2& size, const ButtonStyle& style) {
            bool pressed = false;
            misty::UI::WithStyle([&](misty::UI::StyleScope& scoped) {
                scoped.var(ImGuiStyleVar_FrameRounding, style.rounding);
                scoped.color(ImGuiCol_Button, style.button);
                scoped.color(ImGuiCol_ButtonHovered, style.hovered);
                scoped.color(ImGuiCol_ButtonActive, style.active);
                scoped.color(ImGuiCol_Text, style.text);
                pressed = ImGui::Button(label, size);
            });
            return pressed;
        }

        void icon_label(const core::SVGTexture& icon, float size, const char* text, float x_offset, float y_offset) {
            ImGui::Image(icon.id, ImVec2(size, size));
            ImGui::SameLine();
            ImGui::SetCursorPos(ImVec2(ImGui::GetCursorPosX() + x_offset, ImGui::GetCursorPosY() + y_offset));
            ImGui::TextUnformatted(text);
        }
    }

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
            show_error_modal(state.error_msg, "AuthRegisterError");
        }

        ImGui::End();
        ImGui::PopStyleVar(3);
        ImGui::PopStyleColor();
    }

    void AuthRegisterPanel::show_header() {
        const char* text = "Welcome to Misty";
        
        float original_scale = ImGui::GetFontSize();
        ImGui::SetWindowFontScale(1.5f);
        
        ImVec2 text_size = ImGui::CalcTextSize(text);
        float window_width = ImGui::GetWindowWidth();
        float center_x = (window_width - text_size.x) * 0.5f;
        ImGui::SetCursorPosX(center_x);
        
        ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(1.0f, 1.0f, 1.0f, 1.0f));
        ImGui::Text("%s", text);
        ImGui::PopStyleColor();
        
        ImGui::SetWindowFontScale(1.0f);
        
        ImGui::Spacing();
    }

    void AuthRegisterPanel::show_form_fields(AuthRegisterState& state) {
        float width = ImGui::GetContentRegionAvail().x;

        // Username
        ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.8f, 0.8f, 0.8f, 1.0f));
        auto& person_icon = core::AssetManager::get().get_svg_texture("person-16", 24);
        icon_label(person_icon, 16.0f, "Username", 1.0f, -2.0f);
        ImGui::PopStyleColor();
        ImGui::SetNextItemWidth(width);
        ImGui::InputTextWithHint("##username", "", state.full_name, sizeof(state.full_name));

        // Email
        ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.8f, 0.8f, 0.8f, 1.0f));
        auto& mail_icon = core::AssetManager::get().get_svg_texture("mail-16", 24);
        icon_label(mail_icon, 16.0f, "Email", 2.0f, -2.0f);
        ImGui::PopStyleColor();
        ImGui::SetNextItemWidth(width);
        ImGui::InputTextWithHint("##email", "", state.email, sizeof(state.email));

        // Password
        ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.8f, 0.8f, 0.8f, 1.0f));
        auto& lock_icon = core::AssetManager::get().get_svg_texture("lock-16", 24);
        icon_label(lock_icon, 16.0f, "Password", 1.0f, -2.0f);
        ImGui::PopStyleColor();
        ImGui::SetNextItemWidth(width);
        ImGui::InputTextWithHint("##password", "", state.password, sizeof(state.password), ImGuiInputTextFlags_Password);

        // Confirm password
        ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.8f, 0.8f, 0.8f, 1.0f));
        auto& lock_icon2 = core::AssetManager::get().get_svg_texture("lock-16", 24);
        icon_label(lock_icon2, 16.0f, "Confirm password", 1.0f, -2.0f);
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

        if (styled_button("Create account", ImVec2(width, 40), primary_button_style()) ||
            core::CommandManager::get().matches("auth.submit")) {
            state.handle_create_account();
        }
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
                view::switch_view(view::ViewID::Login);
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
