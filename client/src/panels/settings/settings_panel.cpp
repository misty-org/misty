#include "panels/settings/settings_account.h"
#include "panels/settings/settings_advanced.h"
#include "panels/settings/settings_appearance.h"
#include "panels/settings/settings_general.h"
#include "panels/settings/settings_notifications.h"
#include "panels/settings/settings_privacy.h"
#include "panels/settings/settings_panel.h"
#include "panels/settings/settings_shortcuts.h"
#include "panels/settings/settings_sync.h"
#include "panels/settings/settings_components.h"

#include <cmath>
#include "core/ui/ui_layout.h"
#include "core/ui/ui_style.h"
#include "imgui.h"
#include "views/app_view.h"

namespace misty::panel {
SettingsPanel::SettingsPanel(core::UIRegistry& registry, SettingsPanelProps props)
    : MultiPanel(std::move(props.panel_id)),
      registry_(registry),
      state_key_(std::move(props.state_key)) {}

TabController::Tab SettingsPanel::create_default_tab(std::int16_t tab_idx) const {
    SettingsPanelProps props;
    props.panel_id = panel_id() + "_tab_" + std::to_string(tab_idx);
    props.state_key = state_key_ + "_tab_" + std::to_string(tab_idx);

    auto panel = std::make_shared<SettingsPanel>(registry_, std::move(props));

    TabController::Tab tab;
    tab.context_key = panel->state_key_;
    tab.state_key = panel->state_key_;
    tab.title = "Settings";
    tab.idx = tab_idx;
    tab.panel = std::move(panel);
    return tab;
}

void SettingsPanel::render_panel_contents() {
    auto& state = registry_.get_state<SettingsState>(state_key_);
    state.ensure_app_settings_loaded();
    misty::UI::WithWindowStyle({
        .bg_color = ImVec4(0.12f, 0.12f, 0.12f, 1.0f),
    }, [&]() {
        misty::view::debug_log_view_event(
            std::string("settings_panel: section=") + std::to_string(static_cast<int>(state.active_section)));
        UI::row("##settings_shell", {
            .mode = UI::Mode::LayoutOnly,
            .width = UI::Size::fill(),
            .height = UI::Size::fill(),
        }, [&]() {
            sidebar(state);
            UI::div("##settings_divider", {
                .mode = UI::Mode::LayoutOnly,
                .width = UI::Size::px(1.0f),
                .height = UI::Size::fill(),
                .bg_color = ImVec4(0.22f, 0.22f, 0.24f, 1.0f),
                .margin = UI::Spacing::xy(12.0f, 0.0f),
            }, []() {});
            settings_content(state);
        });
    });
}

void SettingsPanel::settings_content(SettingsState& state) {
    UI::WithStyle([&](UI::StyleScope& style) {
        style.var(ImGuiStyleVar_ScrollbarSize, 8.0f);

        const float available_width = UI::available_size().x;
        const float reserved_vertical_scrollbar_width = ImGui::GetStyle().ScrollbarSize;
        const float padded_available_width =
            available_width > (kSettingsShellPadding.left + kSettingsShellPadding.right)
                ? available_width - kSettingsShellPadding.left - kSettingsShellPadding.right
                : 0.0f;
        const float stable_inner_width = std::max(
            0.0f,
            padded_available_width - reserved_vertical_scrollbar_width
        );
        const bool needs_horizontal_scroll = stable_inner_width + 0.5f < kSettingsContentWidth;

        ImGui::SetNextWindowContentSize(ImVec2(
            needs_horizontal_scroll ? kSettingsContentWidth : 0.0f,
            0.0f
        ));

        ImGuiWindowFlags scroll_flags =
            ImGuiWindowFlags_AlwaysVerticalScrollbar |
            ImGuiWindowFlags_NoScrollWithMouse;
        if (needs_horizontal_scroll) {
            // Reserve the bottom gutter up front so horizontal scrolling cannot
            // change the vertical scrollbar geometry in narrow split panes.
            scroll_flags |= ImGuiWindowFlags_HorizontalScrollbar |
                            ImGuiWindowFlags_AlwaysHorizontalScrollbar;
        }

        UI::div("##settings_content", {
            .mode = UI::Mode::ChildWindow,
            .width = UI::Size::fill(),
            .height = UI::Size::fill(),
            .child_flags = ImGuiChildFlags_AlwaysUseWindowPadding,
            .window_flags = scroll_flags,
            .padding = kSettingsShellPadding,
        }, [&]() {
            ImGuiIO& io = ImGui::GetIO();
            const float scroll_x_before_input = ImGui::GetScrollX();
            if (ImGui::IsWindowHovered(ImGuiHoveredFlags_AllowWhenBlockedByPopup)) {
                constexpr float kSettingsWheelStep = 4.0f;
                constexpr float kSettingsWheelHStep = 24.0f;

                const bool can_scroll_x = ImGui::GetScrollMaxX() > 0.0f;
                const bool can_scroll_y = ImGui::GetScrollMaxY() > 0.0f;
                const bool horizontal_dominates =
                    can_scroll_x && io.MouseWheelH != 0.0f &&
                    (!can_scroll_y || std::abs(io.MouseWheelH) >= std::abs(io.MouseWheel));

                if (horizontal_dominates) {
                    ImGui::SetScrollX(ImGui::GetScrollX() - io.MouseWheelH * kSettingsWheelHStep);
                } else if (can_scroll_y && io.MouseWheel != 0.0f) {
                    ImGui::SetScrollY(ImGui::GetScrollY() - io.MouseWheel * kSettingsWheelStep);
                }
            }

            const bool horizontal_scroll_changed =
                has_scroll_snapshot_ &&
                std::abs(scroll_x_before_input - last_scroll_x_) > 0.01f;
            const bool horizontal_wheel_dominates =
                std::abs(io.MouseWheelH) > 0.0f &&
                std::abs(io.MouseWheelH) >= std::abs(io.MouseWheel);
            if (horizontal_scroll_changed && (io.MouseDown[ImGuiMouseButton_Left] || horizontal_wheel_dominates)) {
                ImGui::SetScrollY(last_scroll_y_);
            }

            UI::div("##settings_scroll_surface", {
                .mode = UI::Mode::LayoutOnly,
                .width = needs_horizontal_scroll
                    ? UI::Size::px(kSettingsContentWidth)
                    : UI::Size::fill(),
                .height = UI::Size::auto_size(),
            }, [&]() {
                switch (state.active_section) {
                    case SettingsSection::General:
                        general_content(state);
                        break;
                    case SettingsSection::Appearance:
                        appearance_content(state);
                        break;
                    case SettingsSection::Account:
                        account_content(state);
                        break;
                    case SettingsSection::Privacy:
                        privacy_content(state);
                        break;
                    case SettingsSection::Sync:
                        sync_content(state);
                        break;
                    case SettingsSection::Notifications:
                        notifications_content(state);
                        break;
                    case SettingsSection::Shortcuts:
                        shortcuts_content(state);
                        break;
                    case SettingsSection::Advanced:
                        advanced_content(state);
                        break;
                    default:
                        general_content(state);
                        break;
                }
            });

            last_scroll_x_ = ImGui::GetScrollX();
            last_scroll_y_ = ImGui::GetScrollY();
            has_scroll_snapshot_ = true;
        });
    });
}

void SettingsPanel::sidebar(SettingsState& state) {
    UI::div("##sidebar", {
        .mode = UI::Mode::ChildWindow,
        .width = UI::Size::px(180.0f),
        .height = UI::Size::fill(),
        .padding = kSettingsSidebarPadding,
        .gap = UI::Spacing::xy(0.0f, 5.0f),
    }, [&]() {
        sidebar_tabs(state);
    });
}

void SettingsPanel::sidebar_header(SettingsState& state) {
    UI::div("##sidebar_header", {
        .mode = UI::Mode::LayoutOnly,
        .width = UI::Size::fill(),
        .height = UI::Size::auto_size(),
        .margin = UI::Spacing::sides(0.0f, 0.0f, 0.0f, 20.0f),
    }, [&]() {
        UI::text({
            .text = "Settings",
            .width = UI::Size::fill(),
            .font = UI::TextFont::BoldXLarge,
            .color = ImVec4(0.96f, 0.96f, 0.98f, 1.0f),
            .align = UI::Align::Start,
        });
    });
}


void SettingsPanel::sidebar_tabs(SettingsState& state) {
    general_tab(state);
    appearance_tab(state);
    account_tab(state);
    privacy_tab(state);
    sync_tab(state);
    notifications_tab(state);
    shortcuts_tab(state);
    advanced_tab(state);

    //will get back to this
}

} //namespace misty::panel
