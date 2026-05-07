#include "panels/settings/settings_sync.h"

#include "core/ui/ui_layout.h"
#include "imgui.h"
#include "panels/settings/settings_components.h"

namespace misty::panel {
namespace {

constexpr const char* kConflictOptions[] = {"Keep Newest", "Ask Me", "Keep Both"};

void status_section(SettingsState& state) {
    settings_section("##sync_status", "Status", {}, [&]() {
        settings_row("##sync_status_auto", {
            .start_width_pct = 0.52f,
            .divider_color = kSettingsDividerColor,
        }, [&]() {
            settings_row_text("Auto-sync", "Keep Misty in sync without requiring manual refreshes.");
        }, [&]() {
            if (settings_toggle_switch("##sync_status_auto_toggle", &state.auto_sync_enabled)) {
                state.save_app_settings();
            }
        });

        settings_row("##sync_status_history", {
            .start_width_pct = 0.52f,
            .show_divider = false,
            .divider_color = kSettingsDividerColor,
        }, [&]() {
            settings_row_text("Version history", "Keep enough state around to recover from accidental overwrites.");
        }, [&]() {
            if (settings_toggle_switch("##sync_status_history_toggle", &state.version_history_enabled)) {
                state.save_app_settings();
            }
        });
    });
}

void rules_section(SettingsState& state) {
    settings_section("##sync_rules", "Rules", {}, [&]() {
        settings_row("##sync_rules_launch", {
            .start_width_pct = 0.52f,
            .divider_color = kSettingsDividerColor,
        }, [&]() {
            settings_row_text("Sync on launch", "Check for sync activity automatically when Misty starts.");
        }, [&]() {
            if (settings_toggle_switch("##sync_rules_launch_toggle", &state.sync_on_launch_enabled)) {
                state.save_app_settings();
            }
        });

        settings_row("##sync_rules_quit", {
            .start_width_pct = 0.52f,
            .divider_color = kSettingsDividerColor,
        }, [&]() {
            settings_row_text("Sync on quit", "Attempt a final sync pass before Misty closes.");
        }, [&]() {
            if (settings_toggle_switch("##sync_rules_quit_toggle", &state.sync_on_quit_enabled)) {
                state.save_app_settings();
            }
        });

        settings_row("##sync_rules_metered", {
            .start_width_pct = 0.52f,
            .show_divider = false,
            .divider_color = kSettingsDividerColor,
        }, [&]() {
            settings_row_text("Allow metered sync", "Continue syncing when the network may have bandwidth limits.");
        }, [&]() {
            if (settings_toggle_switch("##sync_rules_metered_toggle", &state.allow_metered_sync)) {
                state.save_app_settings();
            }
        });
    });
}

void conflict_section(SettingsState& state) {
    settings_section("##sync_conflict", "Conflict Resolution", {}, [&]() {
        settings_row("##sync_conflict_strategy", {
            .start_width_pct = 0.52f,
            .show_divider = false,
            .divider_color = kSettingsDividerColor,
        }, [&]() {
            settings_row_text("Default strategy", "Choose how Misty should behave when the same file changes in two places.");
        }, [&]() {
            if (settings_select_control(
                "##sync_conflict_strategy_select",
                &state.conflict_resolution_index,
                kConflictOptions,
                3
            )) {
                state.save_app_settings();
            }
        });
    });
}

} // namespace

bool sync_tab(SettingsState& state) {
    const bool clicked = UI::button("##settings_sync", {
        .width = UI::Size::fill(),
        .height = UI::Size::px(32.0f),
        .variant = UI::ButtonVariant::Nav,
        .hover_color = ImVec4(0.2f, 0.2f, 0.2f, 1.0f),
        .selected = state.active_section == SettingsSection::Sync,
        .padding = UI::Spacing::xy(8.0f, 8.0f),
        .rounding = 8.0f,
    }, [&]() {
        UI::text({
            .text = "Sync",
            .width = UI::Size::fill(),
            .align = UI::Align::Start,
            .justify = UI::Justify::Center,
        });
    });

    if (clicked) {
        state.active_section = SettingsSection::Sync;
    }

    return clicked;
}

void sync_content(SettingsState& state) {
    UI::div("sync_content", {
        .mode = UI::Mode::LayoutOnly,
        .width = UI::Size::fill(),
        .height = UI::Size::auto_size(),
        .padding = UI::Spacing::xy(28.0f, 20.0f),
    }, [&]() {
        UI::column("##sync_body", {
            .width = UI::Size::fill(),
            .height = UI::Size::auto_size(),
            .gap = UI::Spacing::xy(0.0f, 18.0f),
        }, [&]() {
            settings_page_title("Sync");
            status_section(state);
            rules_section(state);
            conflict_section(state);
        });
    });
}

} // namespace misty::panel
