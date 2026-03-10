#include "auth_login_panel.h"
#include "imgui.h"
#include "core/commands/command_manager.h"
#include "core/net/http_client.h"
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

    AuthLoginPanel::AuthLoginPanel(StateRegistry& registry)
        : registry_(registry) {
    }

    void AuthLoginPanel::render() {
        auto& state = registry_.get_state<AuthLoginState>("AuthLogin");

        ImGuiWindowFlags flags =
            ImGuiWindowFlags_NoTitleBar |
            ImGuiWindowFlags_NoResize |
            ImGuiWindowFlags_NoMove |
            ImGuiWindowFlags_NoCollapse |
            ImGuiWindowFlags_NoScrollbar |
            ImGuiWindowFlags_NoDocking;

        // Dark background
        ImGui::PushStyleColor(ImGuiCol_WindowBg, ImVec4(0.067f, 0.067f, 0.075f, 1.0f)); // #111113
        ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(32.0f, 40.0f));
        ImGui::PushStyleVar(ImGuiStyleVar_ItemSpacing, ImVec2(0.0f, 10.0f));
        ImGui::PushStyleVar(ImGuiStyleVar_FramePadding, ImVec2(12.0f, 8.0f));

        if (ImGui::Begin("AuthLogin", nullptr, flags)) {

            float window_width = ImGui::GetWindowWidth();
            float content_width = window_width - 64.0f; // Account for padding
            ImGui::SetNextItemWidth(content_width);

            show_header();
            show_form_fields(state);
            show_login_button(state);
            show_signup_link();
            show_error_modal(state.error_msg, "AuthLoginError");
        }

        ImGui::End();
        ImGui::PopStyleVar(3);
        ImGui::PopStyleColor();
    }

    void AuthLoginPanel::show_header() {
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

    void AuthLoginPanel::show_form_fields(AuthLoginState& state) {
        float width = ImGui::GetContentRegionAvail().x;

        // Email
        ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.8f, 0.8f, 0.8f, 1.0f));
        auto& mail_icon = core::AssetManager::get().get_svg_texture("mail-16", 24);
        icon_label(mail_icon, 16.0f, "Email", 2.0f, -2.0f);
        ImGui::PopStyleColor();
        ImGui::SetNextItemWidth(width);
        ImGui::InputTextWithHint("##email", "", state.email, sizeof(state.email));

        ImGui::Spacing();

        // Password
        ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.8f, 0.8f, 0.8f, 1.0f));
        auto& lock_icon = core::AssetManager::get().get_svg_texture("lock-16", 24);
        icon_label(lock_icon, 16.0f, "Password", 1.0f, -2.0f);
        ImGui::PopStyleColor();
        ImGui::SetNextItemWidth(width);
        ImGui::InputTextWithHint("##password", "", state.password, sizeof(state.password), ImGuiInputTextFlags_Password);
    }

    void AuthLoginPanel::show_login_button(AuthLoginState& state) {
        float width = ImGui::GetContentRegionAvail().x;

        bool enter_pressed = core::CommandManager::get().matches("auth.submit");
        if (styled_button("Log in", ImVec2(width, 40), primary_button_style()) || enter_pressed) {
            state.handle_login();
        }
    }

    void AuthLoginPanel::show_signup_link() {
        ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.7f, 0.7f, 0.7f, 1.0f));
        ImGui::Text("Don't have an account? ");
        ImGui::SameLine();
        
        ImVec4 link_color = ImVec4(0.4f, 0.7f, 1.0f, 1.0f);
        ImGui::PushStyleColor(ImGuiCol_Text, link_color);
        ImGui::Text("Sign up");
        if (ImGui::IsItemHovered()) {
            ImGui::SetMouseCursor(ImGuiMouseCursor_Hand);
            if (ImGui::IsItemClicked()) {
                view::switch_view(view::ViewID::Auth);
            }
        }
        ImGui::PopStyleColor(2);
    }
}
