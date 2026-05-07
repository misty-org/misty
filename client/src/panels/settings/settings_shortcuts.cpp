#include "panels/settings/settings_shortcuts.h"

#include "core/ui/ui_layout.h"
#include "imgui.h"
#include "panels/settings/settings_components.h"

namespace misty::panel {
namespace {

constexpr const char* kKeymapOptions[] = {"System", "VS Code", "Finder"};

void navigation_section(SettingsState& state) {
    settings_section("##shortcuts_navigation", "Navigation", {}, [&]() {
        settings_row("##shortcuts_hints", {
            .start_width_pct = 0.52f,
            .show_divider = false,
            .divider_color = kSettingsDividerColor,
        }, [&]() {
            settings_row_text("Show shortcut hints", "Display shortcut hints in tooltips and menus where helpful.");
        }, [&]() {
            if (settings_toggle_switch("##shortcuts_hints_toggle", &state.shortcut_hints_enabled)) {
                state.save_app_settings();
            }
        });
    });
}

void customization_section(SettingsState& state) {
    settings_section("##shortcuts_customization", "Customization", {}, [&]() {
        settings_row("##shortcuts_keymap", {
            .start_width_pct = 0.52f,
            .divider_color = kSettingsDividerColor,
        }, [&]() {
            settings_row_text("Keymap preset", "Choose the shortcut style that feels most natural on this device.");
        }, [&]() {
            if (settings_select_control("##shortcuts_keymap_select", &state.keymap_index, kKeymapOptions, 3)) {
                state.save_app_settings();
            }
        });

        settings_row("##shortcuts_custom", {
            .start_width_pct = 0.52f,
            .show_divider = false,
            .divider_color = kSettingsDividerColor,
        }, [&]() {
            settings_row_text("Enable custom shortcuts", "Reserve room for per-command remapping as the shortcut editor lands.");
        }, [&]() {
            if (settings_toggle_switch("##shortcuts_custom_toggle", &state.custom_shortcuts_enabled)) {
                state.save_app_settings();
            }
        });
    });
}

} // namespace

bool shortcuts_tab(SettingsState& state) {
    const bool clicked = UI::button("##settings_shortcuts", {
        .width = UI::Size::fill(),
        .height = UI::Size::px(32.0f),
        .variant = UI::ButtonVariant::Nav,
        .hover_color = ImVec4(0.2f, 0.2f, 0.2f, 1.0f),
        .selected = state.active_section == SettingsSection::Shortcuts,
        .padding = UI::Spacing::xy(8.0f, 8.0f),
        .rounding = 8.0f,
    }, [&]() {
        UI::text({
            .text = "Shortcuts",
            .width = UI::Size::fill(),
            .align = UI::Align::Start,
            .justify = UI::Justify::Center,
        });
    });

    if (clicked) {
        state.active_section = SettingsSection::Shortcuts;
    }

    return clicked;
}

void shortcuts_content(SettingsState& state) {
    UI::div("shortcuts_content", {
        .mode = UI::Mode::LayoutOnly,
        .width = UI::Size::fill(),
        .height = UI::Size::auto_size(),
        .padding = UI::Spacing::xy(28.0f, 20.0f),
    }, [&]() {
        UI::column("##shortcuts_body", {
            .width = UI::Size::fill(),
            .height = UI::Size::auto_size(),
            .gap = UI::Spacing::xy(0.0f, 18.0f),
        }, [&]() {
            settings_page_title("Shortcuts");
            navigation_section(state);
            customization_section(state);
        });
    });
}

} // namespace misty::panel
