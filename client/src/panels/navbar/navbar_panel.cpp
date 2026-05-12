#include "panels/navbar/navbar_panel.h"
#include "panels/profile/profile_state.h"
#include "panels/activity/activity_state.h"
#include "core/manager/asset_manager.h"

#include <cmath>

using namespace misty::view;

namespace misty::panel {
    namespace {
        float content_width() {
            const float content_min_x = ImGui::GetWindowContentRegionMin().x;
            const float content_max_x = ImGui::GetWindowContentRegionMax().x;
            return std::max(0.0f, content_max_x - content_min_x);
        }

        float centered_cursor_x(float item_width) {
            const float content_min_x = ImGui::GetWindowContentRegionMin().x;
            return std::floor(content_min_x + std::max(0.0f, (content_width() - item_width) * 0.5f));
        }

        float image_button_outer_width(float image_width, float frame_padding_x) {
            return image_width + frame_padding_x * 2.0f + ImGui::GetStyle().FrameBorderSize * 2.0f;
        }
    }

    NavbarPanel::NavbarPanel(UIRegistry& ui_registry) : ui_registry_(ui_registry),
        profile_panel_(ui_registry),
        activity_panel_(ui_registry) {
    }

    void NavbarPanel::render() {
        auto& state = ui_registry_.get_state<NavbarState>("Navbar");

        ImGuiWindowFlags navbar_flags = ImGuiWindowFlags_NoTitleBar |
            ImGuiWindowFlags_NoMove |
            ImGuiWindowFlags_NoCollapse |
            ImGuiWindowFlags_NoResize |
            ImGuiWindowFlags_NoScrollbar |
            ImGuiWindowFlags_NoScrollWithMouse;

        ImGui::PushStyleColor(ImGuiCol_WindowBg, ImVec4(0.10f, 0.10f, 0.12f, 1.0f)); // dark charcoal
        ImGui::PushStyleVar(ImGuiStyleVar_WindowBorderSize, 0.0f);
        ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(6.0f, 12.0f));

        if (ImGui::Begin("Navbar", nullptr, navbar_flags)) {
            show_logo_icon();

            ImGui::Dummy(ImVec2(0, 5));

            show_nav_item("file-directory-24", "Files", 24, ViewID::Files, state);
            show_nav_item("devices-24", "Services", 24, view::ViewID::Services, state);
            show_nav_item("apps-16", "Plugins", 24, view::ViewID::Extensions, state);
            show_nav_item("shield-lock-24", "Vault", 24, view::ViewID::Vault, state);
            show_activity_button();

            // Calculate nav item height: icon size + button padding + text height + spacing
            float icon_size = 24.0f;
            float button_padding_y = 8.0f;
            float text_height = ImGui::CalcTextSize("Settings").y;
            float item_spacing = ImGui::GetStyle().ItemSpacing.y;
            float nav_item_height = icon_size + (button_padding_y * 2.0f) + text_height + item_spacing;
            
            float footer_y = ImGui::GetWindowHeight() - 80.0f;
            ImGui::SetCursorPosY(footer_y - nav_item_height);
            show_nav_item("gear-24", "Settings", 24, ViewID::Settings, state);
            ImGui::SetCursorPosY(footer_y);
            show_profile_button();
        }
        ImGui::End();

        ImGui::PopStyleVar(); 
        ImGui::PopStyleVar();
        ImGui::PopStyleColor(); 

        // Render popups on top (outside navbar window)
        profile_panel_.render();
        activity_panel_.render();
    }

    void NavbarPanel::show_logo_icon() {
        const char* path = "assets/logos/misty.png";
        const char* label = "mist_v1";

        auto& logo_image = core::AssetManager::get().get_image_texture(path);

        const ImVec2 padding(2.0f, 2.0f);
        const float max_logo_size = 62.0f;
        const float min_logo_size = 48.0f;
        const float available_width = content_width();
        const float logo_size = std::clamp(
            available_width - padding.x * 2.0f - ImGui::GetStyle().FrameBorderSize * 2.0f,
            min_logo_size,
            max_logo_size);
        const float button_size = image_button_outer_width(logo_size, padding.x);

        ImGui::SetCursorPosX(centered_cursor_x(button_size));

        ImGui::PushID("nav_logo");
        ImGui::PushStyleVar(ImGuiStyleVar_FramePadding, padding);   
        ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 16.0f);
        ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0, 0, 0, 0));
        ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.18f, 0.18f, 0.18f, 1));
        ImGui::PushStyleColor(ImGuiCol_ButtonActive, ImVec4(0, 0, 0, 0));

        if (ImGui::ImageButton(label, (void*)(intptr_t)logo_image.id, ImVec2(logo_size, logo_size))) {
            auto& state = ui_registry_.get_state<NavbarState>("Navbar");
            state.handle_logo_click();
        }

        ImGui::PopStyleColor(3);
        ImGui::PopStyleVar(2);
        ImGui::PopID();
    }

    void NavbarPanel::show_nav_item(const char* icon_name, const char* label, int size, view::ViewID view_id, NavbarState& state) {
        bool is_selected = (state.selected_item == view_id);
        auto& icon = core::AssetManager::get().get_svg_texture(icon_name, size * 2);

        const float padding_x = 6.0f;
        const float button_total_width = image_button_outer_width(static_cast<float>(size), padding_x);

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

        ImGui::SetCursorPosX(centered_cursor_x(button_total_width));

        ImGuiID id = ImGui::GetID(label);
        if (ImGui::ImageButton(label, icon.id, ImVec2((float)size, (float)size))) {
            state.selected_item = view_id;
            state.handle_nav_item(view_id);
        }

        ImGui::PopStyleColor(3);
        ImGui::PopStyleVar(2);

        ImGui::SetCursorPosX(centered_cursor_x(ImGui::CalcTextSize(label).x));

        ImVec4 textColor = is_selected ? ImVec4(1, 1, 1, 1) : ImVec4(0.6f, 0.6f, 0.6f, 1.0f);
        ImGui::PushStyleColor(ImGuiCol_Text, textColor);
        ImGui::Text("%s", label);
        ImGui::PopStyleColor();

        ImGui::Spacing();
    }

    void NavbarPanel::show_profile_button() {
        auto& profile_state = ui_registry_.get_state<ProfileState>("Profile");
        auto& activity_state = ui_registry_.get_state<ActivityState>("Activity");
        auto& icon = core::AssetManager::get().get_svg_texture("person-24", 48);

        int size = 24;
        const float padding_x = 6.0f;
        const float button_total_width = image_button_outer_width(static_cast<float>(size), padding_x);

        ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 8.0f);
        ImGui::PushStyleVar(ImGuiStyleVar_FramePadding, ImVec2(padding_x, 8.0f));

        ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.11f, 0.11f, 0.11f, 0.0f));
        ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.6f, 0.6f, 0.6f, 1.0f));
        ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.18f, 0.18f, 0.18f, 1.0f));

        ImGui::SetCursorPosX(centered_cursor_x(button_total_width));

        if (ImGui::ImageButton("Profile", icon.id, ImVec2((float)size, (float)size))) {
            if (profile_state.is_open) {
                profile_state.is_open = false;
            } else {
                profile_state.is_open = true;
                activity_state.is_open = false;
            }
        }
        profile_state.button_min = ImGui::GetItemRectMin();
        profile_state.button_max = ImGui::GetItemRectMax();
        profile_state.has_button_rect = true;

        ImGui::PopStyleColor(3);
        ImGui::PopStyleVar(2);

        ImGui::SetCursorPosX(centered_cursor_x(ImGui::CalcTextSize("Profile").x));

        ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.6f, 0.6f, 0.6f, 1.0f));
        ImGui::Text("Profile");
        ImGui::PopStyleColor();

        ImGui::Spacing();
    }

    void NavbarPanel::show_activity_button() {
        auto& activity_state = ui_registry_.get_state<ActivityState>("Activity");
        auto& icon = core::AssetManager::get().get_svg_texture("bell-24", 48);
        const size_t unread_count = activity_state.unread_count();

        int size = 24;
        const float padding_x = 6.0f;
        const float button_total_width = image_button_outer_width(static_cast<float>(size), padding_x);

        ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 8.0f);
        ImGui::PushStyleVar(ImGuiStyleVar_FramePadding, ImVec2(padding_x, 8.0f));

        ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.11f, 0.11f, 0.11f, 0.0f));
        ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.6f, 0.6f, 0.6f, 1.0f));
        ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.18f, 0.18f, 0.18f, 1.0f));

        ImGui::SetCursorPosX(centered_cursor_x(button_total_width));

        if (ImGui::ImageButton("Activity", icon.id, ImVec2((float)size, (float)size))) {
            auto& profile_state = ui_registry_.get_state<ProfileState>("Profile");
            if (activity_state.is_open) {
                activity_state.is_open = false;
            } else {
                activity_state.is_open = true;
                profile_state.is_open = false;
            }
        }
        activity_state.button_min = ImGui::GetItemRectMin();
        activity_state.button_max = ImGui::GetItemRectMax();
        activity_state.has_button_rect = true;

        if (unread_count > 0) {
            const std::string badge_text = unread_count > 99 ? "99+" : std::to_string(unread_count);
            const ImVec2 badge_text_size = ImGui::CalcTextSize(badge_text.c_str());
            const float badge_pad_x = 5.0f;
            const float badge_pad_y = 2.0f;
            const ImVec2 badge_size(
                badge_text_size.x + badge_pad_x * 2.0f,
                badge_text_size.y + badge_pad_y * 2.0f
            );

            ImDrawList* draw_list = ImGui::GetWindowDrawList();
            const ImVec2 button_min = ImGui::GetItemRectMin();
            const ImVec2 button_max = ImGui::GetItemRectMax();
            const ImVec2 badge_min(
                button_max.x - badge_size.x * 0.55f,
                button_min.y - 2.0f
            );
            const ImVec2 badge_max(
                badge_min.x + badge_size.x,
                badge_min.y + badge_size.y
            );

            draw_list->AddRectFilled(
                badge_min,
                badge_max,
                IM_COL32(216, 62, 62, 255),
                badge_size.y * 0.5f
            );
            draw_list->AddText(
                ImVec2(badge_min.x + badge_pad_x, badge_min.y + badge_pad_y - 1.0f),
                IM_COL32(255, 255, 255, 255),
                badge_text.c_str()
            );
        }

        ImGui::PopStyleColor(3);
        ImGui::PopStyleVar(2);

        ImGui::SetCursorPosX(centered_cursor_x(ImGui::CalcTextSize("Activity").x));
        ImVec4 text_color = activity_state.is_open ? ImVec4(1, 1, 1, 1) : ImVec4(0.6f, 0.6f, 0.6f, 1.0f);
        ImGui::PushStyleColor(ImGuiCol_Text, text_color);
        ImGui::Text("Activity");
        ImGui::PopStyleColor();

        ImGui::Spacing();
    }
}
