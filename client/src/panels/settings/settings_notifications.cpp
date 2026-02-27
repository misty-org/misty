#include "panels/settings/settings_notifications.h"

#include "core/ui/ui_layout.h"
#include "imgui.h"
#include "panels/settings/settings_components.h"

namespace misty::panel {
namespace {

void activity_section(SettingsState& state) {
    settings_section("##notifications_activity", "Activity Alerts", {}, [&]() {
        settings_row("##notifications_desktop", {
            .start_width_pct = 0.52f,
            .divider_color = kSettingsDividerColor,
        }, [&]() {
            settings_row_text("Desktop notifications", "Show system-level notifications for important events.");
        }, [&]() {
            if (settings_toggle_switch("##notifications_desktop_toggle", &state.desktop_notifications_enabled)) {
                state.save_app_settings();
            }
        });

        settings_row("##notifications_inapp", {
            .start_width_pct = 0.52f,
            .divider_color = kSettingsDividerColor,
        }, [&]() {
            settings_row_text("In-app toasts", "Show transient notifications inside Misty.");
        }, [&]() {
            if (settings_toggle_switch("##notifications_inapp_toggle", &state.in_app_notifications_enabled)) {
                state.save_app_settings();
            }
        });

        settings_row("##notifications_sound", {
            .start_width_pct = 0.52f,
            .show_divider = false,
            .divider_color = kSettingsDividerColor,
        }, [&]() {
            settings_row_text("Play sounds", "Use sound for completion and error alerts.");
        }, [&]() {
            if (settings_toggle_switch("##notifications_sound_toggle", &state.sound_notifications_enabled)) {
                state.save_app_settings();
            }
        });
    });
}

void system_section(SettingsState& state) {
    settings_section("##notifications_system", "System Notifications", {}, [&]() {
        settings_row("##notifications_badge", {
            .start_width_pct = 0.52f,
            .show_divider = false,
            .divider_color = kSettingsDividerColor,
        }, [&]() {
            settings_row_text("Badge count", "Show pending activity counts where the platform supports it.");
        }, [&]() {
            if (settings_toggle_switch("##notifications_badge_toggle", &state.badge_count_enabled)) {
                state.save_app_settings();
            }
        });
    });
}

void quiet_hours_section(SettingsState& state) {
    settings_section("##notifications_quiet", "Digest & Quiet Hours", {}, [&]() {
        settings_row("##notifications_quiet_hours", {
            .start_width_pct = 0.52f,
            .divider_color = kSettingsDividerColor,
        }, [&]() {
            settings_row_text("Quiet hours", "Suppress non-critical notifications during focus time.");
        }, [&]() {
            if (settings_toggle_switch("##notifications_quiet_hours_toggle", &state.quiet_hours_enabled)) {
                state.save_app_settings();
            }
        });

        settings_row("##notifications_digest", {
            .start_width_pct = 0.52f,
            .show_divider = false,
            .divider_color = kSettingsDividerColor,
        }, [&]() {
            settings_row_text("Notification digest", "Bundle lower-priority updates into a lighter summary.");
        }, [&]() {
            if (settings_toggle_switch("##notifications_digest_toggle", &state.digest_notifications_enabled)) {
                state.save_app_settings();
            }
        });
    });
}

} // namespace

bool notifications_tab(SettingsState& state) {
    const bool clicked = UI::button("##settings_notifications", {
        .width = UI::Size::fill(),
        .height = UI::Size::px(32.0f),
        .variant = UI::ButtonVariant::Nav,
        .hover_color = ImVec4(0.2f, 0.2f, 0.2f, 1.0f),
        .selected = state.active_section == SettingsSection::Notifications,
        .padding = UI::Spacing::xy(8.0f, 8.0f),
        .rounding = 8.0f,
    }, [&]() {
        UI::text({
            .text = "Notifications",
            .width = UI::Size::fill(),
            .align = UI::Align::Start,
            .justify = UI::Justify::Center,
        });
    });

    if (clicked) {
        state.active_section = SettingsSection::Notifications;
    }

    return clicked;
}

void notifications_content(SettingsState& state) {
    UI::div("notifications_content", {
        .mode = UI::Mode::LayoutOnly,
        .width = UI::Size::fill(),
        .height = UI::Size::auto_size(),
        .padding = UI::Spacing::xy(28.0f, 20.0f),
    }, [&]() {
        UI::column("##notifications_body", {
            .width = UI::Size::fill(),
            .height = UI::Size::auto_size(),
            .gap = UI::Spacing::xy(0.0f, 18.0f),
        }, [&]() {
            settings_page_title("Notifications");
            activity_section(state);
            system_section(state);
            quiet_hours_section(state);
        });
    });
}

} // namespace misty::panel
