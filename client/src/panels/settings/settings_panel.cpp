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

void SettingsPanel::render() {
    constexpr ImGuiWindowFlags flags =
        ImGuiWindowFlags_NoTitleBar |
        ImGuiWindowFlags_NoResize |
        ImGuiWindowFlags_NoMove |
        ImGuiWindowFlags_NoCollapse;

    auto& state = registry_.get_state<SettingsState>("Settings");
    state.ensure_app_settings_loaded();
    misty::UI::WithWindowStyle({
        .bg_color = ImVec4(0.12f, 0.12f, 0.12f, 1.0f),
    }, [&]() {
        if (ImGui::Begin("SettingsPanel", nullptr, flags)) {
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
        }
        ImGui::End();
    });
}

void SettingsPanel::settings_content(SettingsState& state) {
    UI::WithStyle([&](UI::StyleScope& style) {
        style.var(ImGuiStyleVar_ScrollbarSize, 8.0f);

        UI::div("##settings_content", {
            .mode = UI::Mode::ChildWindow,
            .width = UI::Size::fill(),
            .height = UI::Size::fill(),
            .window_flags = ImGuiWindowFlags_AlwaysVerticalScrollbar | ImGuiWindowFlags_NoScrollWithMouse,
            .padding = kSettingsShellPadding,
        }, [&]() {
            ImGuiIO& io = ImGui::GetIO();
            if (ImGui::IsWindowHovered(ImGuiHoveredFlags_AllowWhenBlockedByPopup) && io.MouseWheel != 0.0f) {
                constexpr float kSettingsWheelStep = 8.0f;
                ImGui::SetScrollY(ImGui::GetScrollY() - io.MouseWheel * kSettingsWheelStep);
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
