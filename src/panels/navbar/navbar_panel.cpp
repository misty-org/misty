#include "panels/navbar/navbar_panel.h"
#include "imgui.h"
#include "panels/activity/activity_state.h"
#include "core/manager/asset_manager.h"
#include "core/manager/font_manager.h"
#include "core/ui/ui_style.h"
#include <cmath>

using namespace misty::view;

namespace misty::panel {
    namespace {
        constexpr float kNavButtonPaddingX = 10.0f;
        constexpr float kNavButtonPaddingY = 10.0f;

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

        float nav_item_height(const char* label, int icon_size = 24) {
            ImFont* label_font = core::FontManager::get().get_font(core::FontID::ROBOTO_SMALL);
            float text_height = 0.0f;
            UI::WithFont(label_font, [&]() {
                text_height = ImGui::CalcTextSize(label).y;
            });
            const float item_spacing = ImGui::GetStyle().ItemSpacing.y;
            return static_cast<float>(icon_size) + (kNavButtonPaddingY * 2.0f) + text_height + item_spacing;
        }

        bool centered_icon_button(const char* id, const SVGTexture& icon, int size, bool is_selected) {
            const float button_total_width = image_button_outer_width(static_cast<float>(size), kNavButtonPaddingX);
            const ImVec4 button_color =
                is_selected ? ImVec4(0.12f, 0.18f, 0.30f, 1.0f) : ImVec4(0.07f, 0.08f, 0.10f, 0.0f);

            bool pressed = false;
            UI::WithStyle([&](UI::StyleScope& style) {
                style.var(ImGuiStyleVar_FrameRounding, 8.0f);
                style.var(ImGuiStyleVar_FramePadding, ImVec2(kNavButtonPaddingX, kNavButtonPaddingY));
                style.color(ImGuiCol_Button, button_color);
                style.color(ImGuiCol_ButtonHovered, ImVec4(0.13f, 0.16f, 0.22f, 1.0f));
                style.color(ImGuiCol_ButtonActive, ImVec4(0.10f, 0.24f, 0.48f, 1.0f));
                ImGui::SetCursorPosX(centered_cursor_x(button_total_width));
                pressed = ImGui::ImageButton(id, icon.id, ImVec2((float)size, (float)size));
            });
            return pressed;
        }

        void centered_label(const char* label, const ImVec4& color) {
            constexpr float kLabelGap = 1.0f;
            const float next_label_y =
                ImGui::GetItemRectMax().y - ImGui::GetWindowPos().y + kLabelGap;

            ImFont* label_font = core::FontManager::get().get_font(core::FontID::ROBOTO_SMALL);
            float label_width = 0.0f;
            UI::WithFont(label_font, [&]() {
                label_width = ImGui::CalcTextSize(label).x;
            });
            ImGui::SetCursorPosY(next_label_y);
            ImGui::SetCursorPosX(centered_cursor_x(label_width));
            UI::WithFont(label_font, [&]() {
                UI::WithTextColor(color, [&]() {
                    ImGui::Text("%s", label);
                });
            });
            ImGui::Spacing();
        }

        void activity_badge(size_t unread_count) {
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
            const ImVec2 badge_min(button_max.x - badge_size.x * 0.55f, button_min.y - 2.0f);
            const ImVec2 badge_max(badge_min.x + badge_size.x, badge_min.y + badge_size.y);

            draw_list->AddRectFilled(badge_min, badge_max, IM_COL32(216, 62, 62, 255), badge_size.y * 0.5f);
            draw_list->AddText(
                ImVec2(badge_min.x + badge_pad_x, badge_min.y + badge_pad_y - 1.0f),
                IM_COL32(255, 255, 255, 255),
                badge_text.c_str()
            );
        }
    }

    NavbarPanel::NavbarPanel(StateRegistry& state_registry) : state_registry_(state_registry),
        activity_panel_(state_registry) {
    }

    void NavbarPanel::render() {
        auto& state = state_registry_.get_state<NavbarState>("Navbar");
        const ImGuiWindowFlags navbar_flags = ImGuiWindowFlags_NoTitleBar |
            ImGuiWindowFlags_NoMove |
            ImGuiWindowFlags_NoCollapse |
            ImGuiWindowFlags_NoResize |
            ImGuiWindowFlags_NoScrollbar |
            ImGuiWindowFlags_NoScrollWithMouse |
            ImGuiWindowFlags_NoSavedSettings;

        if (ImGuiViewport* main_viewport = ImGui::GetMainViewport()) {
            ImGui::SetNextWindowViewport(main_viewport->ID);
        }

        UI::WithStyle([&](UI::StyleScope& style) {
            style.color(ImGuiCol_WindowBg, ImVec4(0.055f, 0.065f, 0.080f, 1.0f));
            style.var(ImGuiStyleVar_WindowBorderSize, 0.0f);
            style.var(ImGuiStyleVar_WindowPadding, ImVec2(4.0f, 8.0f));

            if (ImGui::Begin("Navbar", nullptr, navbar_flags)) {
                logo_icon();
                ImGui::Dummy(ImVec2(0.0f, 1.0f));
                content(state);
                footer(state);
            }
            ImGui::End();
        });

        // Render popups on top (outside navbar window)
        activity_panel_.render();
    }

    void NavbarPanel::content(NavbarState& state) {
        nav_item("file-directory-24", "Files", 24, ViewID::Files, state);
        nav_item("devices-24", "Providers", 24, ViewID::Providers, state);
        nav_item("apps-16", "Plugins", 24, ViewID::Extensions, state);
        nav_item("shield-lock-24", "Vault", 24, ViewID::Vault, state);
        nav_item("transfer-24", "Transfers", 24, ViewID::Transfers, state);
        activity_button();
    }

    void NavbarPanel::footer(NavbarState& state) {
        const float remaining_height = ImGui::GetContentRegionAvail().y;
        const float spacer_height = std::max(0.0f, remaining_height - nav_item_height("Settings"));
        ImGui::Dummy(ImVec2(0.0f, spacer_height));
        nav_item("gear-24", "Settings", 24, ViewID::Settings, state);
    }

    void NavbarPanel::logo_icon() {
        const char* path = "assets/logos/misty.png";
        const char* label = "mist_v1";
        auto& logo_image = core::AssetManager::get().get_image_texture(path);
        constexpr float logo_size = 52.0f;
        const ImVec2 padding(1.0f, 1.0f);
        const float button_width = image_button_outer_width(logo_size, padding.x);

        ImGui::SetCursorPosX(centered_cursor_x(button_width));
        UI::WithStyle([&](UI::StyleScope& style) {
            style.var(ImGuiStyleVar_FramePadding, padding);
            style.var(ImGuiStyleVar_FrameRounding, 8.0f);
            style.color(ImGuiCol_Button, ImVec4(0, 0, 0, 0));
            style.color(ImGuiCol_ButtonHovered, ImVec4(0.18f, 0.18f, 0.18f, 1.0f));

            if (ImGui::ImageButton(label,
                                   static_cast<ImTextureID>(logo_image.id),
                                   ImVec2(logo_size, logo_size))) {
                auto& state = state_registry_.get_state<NavbarState>("Navbar");
                state.handle_logo_click();
            }
        });
    }

    void NavbarPanel::nav_item(const char* icon_name, const char* label, int size, view::ViewID view_id, NavbarState& state) {
        const bool is_selected = (state.selected_item == view_id);
        auto& icon = core::AssetManager::get().get_svg_texture(icon_name, size * 2);
        const ImVec4 text_color = is_selected ? ImVec4(0.78f, 0.88f, 1.0f, 1.0f) : ImVec4(0.64f, 0.67f, 0.73f, 1.0f);

        if (centered_icon_button(label, icon, size, is_selected)) {
            state.selected_item = view_id;
            state.handle_nav_item(view_id);
        }
        centered_label(label, text_color);
    }

    void NavbarPanel::activity_button() {
        auto& activity_state = state_registry_.get_state<ActivityState>("Activity");
        auto& icon = core::AssetManager::get().get_svg_texture("bell-24", 48);
        const size_t unread_count = activity_state.unread_count();
        const ImVec4 text_color = activity_state.is_open ? ImVec4(1, 1, 1, 1) : ImVec4(0.6f, 0.6f, 0.6f, 1.0f);

        if (centered_icon_button("Activity", icon, 24, activity_state.is_open)) {
            activity_state.is_open = !activity_state.is_open;
        }
        activity_state.button_min = ImGui::GetItemRectMin();
        activity_state.button_max = ImGui::GetItemRectMax();
        activity_state.has_button_rect = true;

        if (unread_count > 0) {
            activity_badge(unread_count);
        }

        centered_label("Activity", text_color);
    }
}
