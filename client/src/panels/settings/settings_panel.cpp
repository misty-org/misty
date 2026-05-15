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
        ImGui::SetNextWindowContentSize(ImVec2(720.0f, 0.0f));

        UI::div("##settings_content", {
            .mode = UI::Mode::ChildWindow,
            .width = UI::Size::fill(),
            .height = UI::Size::fill(),
            .window_flags = ImGuiWindowFlags_AlwaysVerticalScrollbar |
                            ImGuiWindowFlags_HorizontalScrollbar |
                            ImGuiWindowFlags_NoScrollWithMouse,
            .padding = kSettingsShellPadding,
        }, [&]() {
            ImGuiIO& io = ImGui::GetIO();
            if (ImGui::IsWindowHovered(ImGuiHoveredFlags_AllowWhenBlockedByPopup)) {
                constexpr float kSettingsWheelStep = 4.0f;
                constexpr float kSettingsWheelHStep = 12.0f;

                if (io.MouseWheelH != 0.0f) {
                    ImGui::SetScrollX(ImGui::GetScrollX() - io.MouseWheelH * kSettingsWheelHStep);
                }

                if (io.MouseWheel != 0.0f) {
                    ImGui::SetScrollY(ImGui::GetScrollY() - io.MouseWheel * kSettingsWheelStep);
                }
            }

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
