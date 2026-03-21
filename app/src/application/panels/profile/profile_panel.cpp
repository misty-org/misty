#include "panels/profile/profile_panel.h"
#include "panels/profile/profile_state.h"
#include "panels/settings/settings_state.h"
#include "core/manager/asset_manager.h"
#include "core/manager/session_manager.h"
#include "views/app_view.h"
#include "imgui.h"

namespace misty::panel {

    ProfilePanel::ProfilePanel(core::UIRegistry& registry)
        : registry_(registry) {}

    void ProfilePanel::render() {
        auto& state = registry_.get_state<ProfileState>("Profile");
        if (!state.is_open) return;

        auto& settings = registry_.get_state<SettingsState>("Settings");

        ImGuiViewport* viewport = ImGui::GetMainViewport();
        float navbar_width = 77.0f;
        float popup_w = 280.0f;
        float popup_h = 340.0f;

        // Position: anchored to bottom-left, just right of the navbar
        float px = viewport->WorkPos.x + navbar_width + 6.0f;
        float py = viewport->WorkPos.y + viewport->WorkSize.y - popup_h - 12.0f;

        ImGui::SetNextWindowPos(ImVec2(px, py), ImGuiCond_Always);
        ImGui::SetNextWindowSize(ImVec2(popup_w, popup_h), ImGuiCond_Always);

        ImGuiWindowFlags flags =
            ImGuiWindowFlags_NoTitleBar |
            ImGuiWindowFlags_NoResize |
            ImGuiWindowFlags_NoMove |
            ImGuiWindowFlags_NoScrollbar |
            ImGuiWindowFlags_NoCollapse |
            ImGuiWindowFlags_NoSavedSettings;

        ImGui::PushStyleColor(ImGuiCol_WindowBg, ImVec4(0.15f, 0.15f, 0.15f, 0.98f));
        ImGui::PushStyleVar(ImGuiStyleVar_WindowRounding, 12.0f);
        ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(20.0f, 20.0f));
        ImGui::PushStyleVar(ImGuiStyleVar_WindowBorderSize, 1.0f);
        ImGui::PushStyleColor(ImGuiCol_Border, ImVec4(0.25f, 0.25f, 0.25f, 1.0f));

        if (ImGui::Begin("##ProfilePopup", nullptr, flags)) {

            // --- Close if user clicks outside ---
            // Exclude clicks within the navbar region (x < 77px) since the Profile
            // toggle button lives there. IsMouseClicked fires on mouse-down while
            // ImageButton fires on mouse-up, so without this guard the popup would
            // close and immediately reopen.
            if (!ImGui::IsWindowHovered(ImGuiHoveredFlags_AllowWhenBlockedByActiveItem) &&
                ImGui::IsMouseClicked(ImGuiMouseButton_Left)) {
                ImVec2 mouse = ImGui::GetMousePos();
                ImGuiViewport* vp = ImGui::GetMainViewport();
                float navbar_right = vp->WorkPos.x + 77.0f;
                if (mouse.x > navbar_right) {
                    state.is_open = false;
                }
            }

            // =============================================
            // Header: avatar + name + email
            // =============================================
            float avatar_size = 52.0f;
            ImVec2 cursor = ImGui::GetCursorScreenPos();
            ImVec2 center(cursor.x + avatar_size * 0.5f, cursor.y + avatar_size * 0.5f);

            ImGui::GetWindowDrawList()->AddCircleFilled(
                center, avatar_size * 0.5f,
                IM_COL32(60, 60, 75, 255), 48);

            auto& icon = core::AssetManager::get().get_svg_texture("person-24", 48);
            float icon_sz = 28.0f;
            ImVec2 icon_pos(center.x - icon_sz * 0.5f, center.y - icon_sz * 0.5f);
            ImGui::GetWindowDrawList()->AddImage(
                icon.id,
                icon_pos,
                ImVec2(icon_pos.x + icon_sz, icon_pos.y + icon_sz),
                ImVec2(0, 0), ImVec2(1, 1),
                IM_COL32(180, 180, 195, 255));

            // Name
            float text_x = cursor.x + avatar_size + 14.0f;
            ImGui::SetCursorScreenPos(ImVec2(text_x, cursor.y + 8.0f));
            ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(1.0f, 1.0f, 1.0f, 1.0f));
            ImGui::SetWindowFontScale(1.15f);
            ImGui::Text("%s", state.display_name.c_str());
            ImGui::SetWindowFontScale(1.0f);
            ImGui::PopStyleColor();

            // Email
            ImGui::SetCursorScreenPos(ImVec2(text_x, cursor.y + 32.0f));
            ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.5f, 0.5f, 0.5f, 1.0f));
            ImGui::Text("%s", state.email.empty() ? "No email set" : state.email.c_str());
            ImGui::PopStyleColor();

            // Advance past avatar
            ImGui::SetCursorPosY(ImGui::GetCursorPosY() + avatar_size + 4.0f);

            ImGui::Spacing();

            // =============================================
            // Separator
            // =============================================
            ImGui::PushStyleColor(ImGuiCol_Separator, ImVec4(0.25f, 0.25f, 0.25f, 1.0f));
            ImGui::Separator();
            ImGui::PopStyleColor();
            ImGui::Spacing();

            // =============================================
            // Status section
            // =============================================
            {
                // Server connection
                ImVec2 dot_cursor = ImGui::GetCursorScreenPos();
                float dot_radius = 4.0f;
                ImU32 dot_color = settings.server_connected
                    ? IM_COL32(80, 220, 100, 255)
                    : IM_COL32(220, 100, 80, 255);

                ImGui::GetWindowDrawList()->AddCircleFilled(
                    ImVec2(dot_cursor.x + dot_radius + 2.0f, dot_cursor.y + ImGui::GetTextLineHeight() * 0.5f),
                    dot_radius, dot_color, 16);

                ImGui::SetCursorPosX(ImGui::GetCursorPosX() + dot_radius * 2.0f + 10.0f);
                ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.75f, 0.75f, 0.75f, 1.0f));
                ImGui::Text("Server: %s", settings.server_connected ? "Connected" : "Disconnected");
                ImGui::PopStyleColor();
            }

            ImGui::Spacing();

            {
                // Sync status
                ImVec2 dot_cursor = ImGui::GetCursorScreenPos();
                float dot_radius = 4.0f;
                ImU32 dot_color = settings.auto_sync_enabled
                    ? IM_COL32(80, 180, 220, 255)
                    : IM_COL32(120, 120, 120, 255);

                ImGui::GetWindowDrawList()->AddCircleFilled(
                    ImVec2(dot_cursor.x + dot_radius + 2.0f, dot_cursor.y + ImGui::GetTextLineHeight() * 0.5f),
                    dot_radius, dot_color, 16);

                ImGui::SetCursorPosX(ImGui::GetCursorPosX() + dot_radius * 2.0f + 10.0f);
                ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.75f, 0.75f, 0.75f, 1.0f));
                ImGui::Text("Sync: %s", settings.auto_sync_enabled ? "Active" : "Paused");
                ImGui::PopStyleColor();
            }

            ImGui::Spacing();

            bool session_expired = core::SessionManager::get().is_session_expired();
            {
                // Session status
                ImVec2 dot_cursor = ImGui::GetCursorScreenPos();
                float dot_radius = 4.0f;
                ImU32 dot_color = session_expired
                    ? IM_COL32(220, 160, 40, 255)
                    : IM_COL32(80, 220, 100, 255);

                ImGui::GetWindowDrawList()->AddCircleFilled(
                    ImVec2(dot_cursor.x + dot_radius + 2.0f, dot_cursor.y + ImGui::GetTextLineHeight() * 0.5f),
                    dot_radius, dot_color, 16);

                ImGui::SetCursorPosX(ImGui::GetCursorPosX() + dot_radius * 2.0f + 10.0f);
                ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.75f, 0.75f, 0.75f, 1.0f));
                ImGui::Text("Session: %s", session_expired ? "Disconnected" : "Connected");
                ImGui::PopStyleColor();
            }

            ImGui::Spacing();
            ImGui::PushStyleColor(ImGuiCol_Separator, ImVec4(0.25f, 0.25f, 0.25f, 1.0f));
            ImGui::Separator();
            ImGui::PopStyleColor();
            ImGui::Spacing();

            // =============================================
            // Action buttons
            // =============================================
            float btn_w = popup_w - 40.0f; // full width minus padding

            ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 6.0f);
            ImGui::PushStyleVar(ImGuiStyleVar_FramePadding, ImVec2(12.0f, 8.0f));
            ImGui::PushStyleVar(ImGuiStyleVar_ButtonTextAlign, ImVec2(0.0f, 0.5f));

            // Edit Profile button
            ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.2f, 0.2f, 0.2f, 1.0f));
            ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.28f, 0.28f, 0.28f, 1.0f));
            ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.9f, 0.9f, 0.9f, 1.0f));
            if (ImGui::Button("Edit Profile", ImVec2(btn_w, 0))) {
                state.is_open = false;
                view::switch_view(view::ViewID::EditProfile);
            }
            ImGui::PopStyleColor(3);

            ImGui::Spacing();

            if (session_expired) {
                // Reconnect button (session expired)
                ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.15f, 0.35f, 0.55f, 1.0f));
                ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.2f, 0.45f, 0.65f, 1.0f));
                ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(1.0f, 1.0f, 1.0f, 1.0f));
                if (ImGui::Button("Reconnect", ImVec2(btn_w, 0))) {
                    state.is_open = false;
                    core::SessionManager::get().clear_token();
                    core::SessionManager::get().clear_session_expired();
                    view::switch_view(view::ViewID::Login);
                }
                ImGui::PopStyleColor(3);
            } else {
                // Sign Out button
                ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.5f, 0.15f, 0.15f, 1.0f));
                ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.65f, 0.2f, 0.2f, 1.0f));
                ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(1.0f, 0.9f, 0.9f, 1.0f));
                if (ImGui::Button("Sign Out", ImVec2(btn_w, 0))) {
                    state.is_open = false;
                    core::SessionManager::get().clear_token();
                    view::switch_view(view::ViewID::Login);
                }
                ImGui::PopStyleColor(3);
            }

            ImGui::PopStyleVar(3);
        }
        ImGui::End();

        ImGui::PopStyleVar(3);
        ImGui::PopStyleColor(2);
    }

} // namespace misty::panel
