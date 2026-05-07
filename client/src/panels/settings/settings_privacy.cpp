#include "panels/settings/settings_privacy.h"

#include "core/ui/ui_layout.h"
#include "imgui.h"
#include "panels/settings/settings_components.h"

namespace misty::panel {
namespace {

void data_handling_section(SettingsState& state) {
    settings_section("##privacy_handling", "Data Handling", {}, [&]() {
        settings_row("##privacy_local_processing", {
            .start_width_pct = 0.52f,
            .divider_color = kSettingsDividerColor,
        }, [&]() {
            settings_row_text("Process data locally", "Keep file handling and provider orchestration local whenever possible.");
        }, [&]() {
            if (settings_toggle_switch("##privacy_local_processing_toggle", &state.local_processing_only)) {
                state.save_app_settings();
            }
        });

        settings_row("##privacy_diagnostics", {
            .start_width_pct = 0.52f,
            .show_divider = false,
            .divider_color = kSettingsDividerColor,
        }, [&]() {
            settings_row_text("Share diagnostics", "Allow Misty to include low-level runtime details when exporting diagnostics.");
        }, [&]() {
            if (settings_toggle_switch("##privacy_diagnostics_toggle", &state.diagnostics_sharing_enabled)) {
                state.save_app_settings();
            }
        });
    });
}

void export_section(SettingsState& state) {
    settings_section("##privacy_export", "Exports & Deletion", {}, [&]() {
        settings_row("##privacy_export_data", {
            .start_width_pct = 0.52f,
            .show_divider = false,
            .divider_color = kSettingsDividerColor,
        }, [&]() {
            settings_row_text("Allow data export", "Keep account export actions available in privacy and support workflows.");
        }, [&]() {
            if (settings_toggle_switch("##privacy_export_data_toggle", &state.export_data_enabled)) {
                state.save_app_settings();
            }
        });
    });
}

void legal_section() {
    settings_section("##privacy_legal", "Legal", {}, [&]() {
        settings_row("##privacy_policy_row", {
            .start_width_pct = 0.52f,
            .divider_color = kSettingsDividerColor,
        }, [&]() {
            settings_row_text("Privacy Policy", "Review how Misty handles account and runtime data.");
        }, [&]() {
            settings_value_text("Available soon", true);
        });

        settings_row("##privacy_terms_row", {
            .start_width_pct = 0.52f,
            .show_divider = false,
            .divider_color = kSettingsDividerColor,
        }, [&]() {
            settings_row_text("Terms of Service", "Review product terms before release packaging.");
        }, [&]() {
            settings_value_text("Available soon", true);
        });
    });
}

} // namespace

bool privacy_tab(SettingsState& state) {
    const bool clicked = UI::button("##settings_privacy", {
        .width = UI::Size::fill(),
        .height = UI::Size::px(32.0f),
        .variant = UI::ButtonVariant::Nav,
        .hover_color = ImVec4(0.2f, 0.2f, 0.2f, 1.0f),
        .selected = state.active_section == SettingsSection::Privacy,
        .padding = UI::Spacing::xy(8.0f, 8.0f),
        .rounding = 8.0f,
    }, [&]() {
        UI::text({
            .text = "Privacy",
            .width = UI::Size::fill(),
            .align = UI::Align::Start,
            .justify = UI::Justify::Center,
        });
    });

    if (clicked) {
        state.active_section = SettingsSection::Privacy;
    }

    return clicked;
}

void privacy_content(SettingsState& state) {
    UI::div("privacy_content", {
        .mode = UI::Mode::LayoutOnly,
        .width = UI::Size::fill(),
        .height = UI::Size::auto_size(),
        .padding = UI::Spacing::xy(28.0f, 20.0f),
    }, [&]() {
        UI::column("##privacy_body", {
            .width = UI::Size::fill(),
            .height = UI::Size::auto_size(),
            .gap = UI::Spacing::xy(0.0f, 18.0f),
        }, [&]() {
            settings_page_title("Privacy");
            data_handling_section(state);
            export_section(state);
            legal_section();
        });
    });
}

} // namespace misty::panel
