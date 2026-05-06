#include "panels/settings/account.h"
#include "panels/settings/general.h"
#include "panels/settings/settings_panel.h"

#include "core/ui/ui_layout.h"
#include "core/ui/ui.h"
#include "imgui.h"

namespace UI = misty::UI;

namespace misty::panel {

void SettingsPanel::render() {
    constexpr ImGuiWindowFlags flags =
        ImGuiWindowFlags_NoTitleBar |
        ImGuiWindowFlags_NoResize |
        ImGuiWindowFlags_NoMove |
        ImGuiWindowFlags_NoCollapse;

    auto& state = registry_.get_state<SettingsState>("Settings");
    misty::UI::WithWindowStyle({
        .bg_color = ImVec4(0.12f, 0.12f, 0.12f, 1.0f),
        .padding = ImVec2(12.0f, 12.0f),
    }, [&]() {
        if (ImGui::Begin("SettingsPanel", nullptr, flags)) {
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
    UI::div("##settings_content", {
        .mode = UI::Mode::ChildWindow,
        .width = UI::Size::fill(),
        .height = UI::Size::fill(),
    }, [&]() {
        switch (state.active_section) {
            case SettingsSection::General:
                general_content(state);
                break;
            case SettingsSection::Account:
                account_content(state);
                break;
            default:
                general_content(state);
                break;
        }
    });
}

void SettingsPanel::sidebar(SettingsState& state) {
    UI::div("##sidebar", {
        .mode = UI::Mode::ChildWindow,
        .width = UI::Size::px(220.0f),
        .height = UI::Size::fill(),
        .padding = UI::Spacing::xy(12.0f, 12.0f),
        .gap = UI::Spacing::xy(0.0f, 8.0f),
    }, [&]() {
        sidebar_header(state);
        sidebar_tabs(state);
    });
}

void SettingsPanel::sidebar_header(SettingsState& state) {
    UI::div("##sidebar_header", {
        .mode = UI::Mode::LayoutOnly,
        .width = UI::Size::fill(),
        .height = UI::Size::px(36.0f),
        .padding = UI::Spacing::xy(8.0f, 8.0f),
        .rounding = 8.0f,
    }, [&]() {
        UI::text({
            .text = "Settings",
            .width = UI::Size::fill(),
        });
    });
}

void SettingsPanel::sidebar_tabs(SettingsState& state) {
    general_tab(state);
    account_tab(state);
}

} //namespace misty::panel
