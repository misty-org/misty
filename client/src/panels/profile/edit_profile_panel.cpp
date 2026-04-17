#include "panels/profile/edit_profile_panel.h"
#include "panels/profile/profile_state.h"
#include "core/manager/asset_manager.h"
#include "core/manager/session_manager.h"
#include "views/app_view.h"
#include "imgui.h"

#include <cstring>

namespace misty::panel {

    EditProfilePanel::EditProfilePanel(core::UIRegistry& registry)
        : registry_(registry) {}

    void EditProfilePanel::render() {
        auto& state = registry_.get_state<ProfileState>("Profile");

        // Initialize buffers from state when first entering the view
        auto current_view = view::get_current_view_id();
        if (current_view == view::ViewID::EditProfile) {
            if (!buffers_initialized_) {
                strncpy(edit_name_, state.display_name.c_str(), sizeof(edit_name_) - 1);
                strncpy(edit_email_, state.email.c_str(), sizeof(edit_email_) - 1);
                buffers_initialized_ = true;
            }
        } else {
            buffers_initialized_ = false;
            return;
        }

        ImGuiWindowFlags flags =
            ImGuiWindowFlags_NoTitleBar |
            ImGuiWindowFlags_NoResize |
            ImGuiWindowFlags_NoMove |
            ImGuiWindowFlags_NoCollapse;

        ImGui::PushStyleColor(ImGuiCol_WindowBg, ImVec4(0.11f, 0.11f, 0.11f, 1.0f));
        ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(40.0f, 32.0f));

        if (ImGui::Begin("EditProfilePanel", nullptr, flags)) {

            // =============================================
            // Header
            // =============================================
            ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(1.0f, 1.0f, 1.0f, 1.0f));
            ImGui::SetWindowFontScale(1.2f);
            ImGui::Text("Edit Profile");
            ImGui::SetWindowFontScale(1.0f);
            ImGui::PopStyleColor();

            ImGui::Spacing();

            ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.6f, 0.6f, 0.6f, 1.0f));
            ImGui::TextWrapped("Update your display name and email address.");
            ImGui::PopStyleColor();

            ImGui::Spacing();
            ImGui::Separator();
            ImGui::Spacing();
            ImGui::Spacing();

            // =============================================
            // Avatar preview
            // =============================================
            float avatar_size = 72.0f;
            ImVec2 cursor = ImGui::GetCursorScreenPos();
            ImVec2 center(cursor.x + avatar_size * 0.5f, cursor.y + avatar_size * 0.5f);

            ImGui::GetWindowDrawList()->AddCircleFilled(
                center, avatar_size * 0.5f,
                IM_COL32(60, 60, 75, 255), 48);

            auto& icon = core::AssetManager::get().get_svg_texture("person-24", 48);
            float icon_sz = 36.0f;
            ImVec2 icon_pos(center.x - icon_sz * 0.5f, center.y - icon_sz * 0.5f);
            ImGui::GetWindowDrawList()->AddImage(
                icon.id,
                icon_pos,
                ImVec2(icon_pos.x + icon_sz, icon_pos.y + icon_sz),
                ImVec2(0, 0), ImVec2(1, 1),
                IM_COL32(180, 180, 195, 255));

            ImGui::SetCursorPosY(ImGui::GetCursorPosY() + avatar_size + 12.0f);

            ImGui::Spacing();
            ImGui::Spacing();

            // =============================================
            // Form fields
            // =============================================
            float field_width = 320.0f;

            ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 6.0f);
            ImGui::PushStyleVar(ImGuiStyleVar_FramePadding, ImVec2(10.0f, 8.0f));
            ImGui::PushStyleColor(ImGuiCol_FrameBg, ImVec4(0.18f, 0.18f, 0.18f, 1.0f));

            // Display Name
            ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.85f, 0.85f, 0.85f, 1.0f));
            ImGui::Text("Display Name");
            ImGui::PopStyleColor();
            ImGui::Spacing();
            ImGui::SetNextItemWidth(field_width);
            ImGui::InputText("##edit_display_name", edit_name_, sizeof(edit_name_));

            ImGui::Spacing();
            ImGui::Spacing();

            // Email
            ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.85f, 0.85f, 0.85f, 1.0f));
            ImGui::Text("Email");
            ImGui::PopStyleColor();
            ImGui::Spacing();
            ImGui::SetNextItemWidth(field_width);
            ImGui::InputText("##edit_email", edit_email_, sizeof(edit_email_));

            ImGui::PopStyleColor(); // FrameBg
            ImGui::PopStyleVar(2);  // FrameRounding, FramePadding

            ImGui::Spacing();
            ImGui::Spacing();
            ImGui::Spacing();

            // =============================================
            // Action buttons
            // =============================================
            ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 6.0f);
            ImGui::PushStyleVar(ImGuiStyleVar_FramePadding, ImVec2(16.0f, 8.0f));

            // Save button
            ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.2f, 0.45f, 0.8f, 1.0f));
            ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.3f, 0.55f, 0.9f, 1.0f));
            ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(1.0f, 1.0f, 1.0f, 1.0f));
            if (ImGui::Button("Save Changes", ImVec2(160, 0))) {
                // Apply changes to profile state
                state.display_name = edit_name_;
                state.email = edit_email_;
                core::SessionManager::get().set_email(edit_email_);
                buffers_initialized_ = false;

                // Navigate back to previous view
                view::switch_view(view::ViewID::Files);
            }
            ImGui::PopStyleColor(3);

            ImGui::SameLine();

            // Cancel button
            ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.2f, 0.2f, 0.2f, 1.0f));
            ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.3f, 0.3f, 0.3f, 1.0f));
            ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.8f, 0.8f, 0.8f, 1.0f));
            if (ImGui::Button("Cancel", ImVec2(100, 0))) {
                buffers_initialized_ = false;
                view::switch_view(view::ViewID::Files);
            }
            ImGui::PopStyleColor(3);

            ImGui::PopStyleVar(2);
        }
        ImGui::End();

        ImGui::PopStyleVar();
        ImGui::PopStyleColor();
    }

} // namespace misty::panel
