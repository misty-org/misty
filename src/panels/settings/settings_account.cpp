#include "panels/settings/settings_account.h"

#include <cstring>

#include "core/manager/session_manager.h"
#include "core/ui/ui_layout.h"
#include "imgui.h"
#include "panels/settings/settings_components.h"

namespace UI = misty::UI;

namespace {

void sync_session_identity(misty::panel::SettingsState& state) {
    const std::string email = misty::core::SessionManager::get().get_email();
    if (!email.empty()) {
        std::strncpy(state.account_email, email.c_str(), sizeof(state.account_email) - 1);
        state.account_email[sizeof(state.account_email) - 1] = '\0';
    }
}

void security_section() {
    misty::panel::settings_section("##account_security", "Security", {}, [&]() {
        misty::panel::settings_row("##account_password", {
            .start_width_pct = 0.52f,
            .divider_color = misty::panel::kSettingsDividerColor,
        }, [&]() {
            misty::panel::settings_row_text("Password", "Send a reset link to your account email.");
        }, [&]() {
            UI::button("##account_password_reset", {
                .label = "Reset",
                .width = UI::Size::px(110.0f),
                .height = UI::Size::px(misty::panel::kSettingsControlHeight),
                .variant = UI::ButtonVariant::Subtle,
                .rounding = 6.0f,
                .align = UI::Align::End,
            });
        });

        misty::panel::settings_row("##account_session", {
            .start_width_pct = 0.52f,
            .show_divider = false,
            .divider_color = misty::panel::kSettingsDividerColor,
        }, [&]() {
            misty::panel::settings_row_text("Session", "Sign out of this device when you are done.");
        }, [&]() {
            UI::button("##account_sign_out", {
                .label = "Sign out",
                .width = UI::Size::px(110.0f),
                .height = UI::Size::px(misty::panel::kSettingsControlHeight),
                .variant = UI::ButtonVariant::Subtle,
                .rounding = 6.0f,
                .align = UI::Align::End,
            });
        });
    });
}

void plan_section(misty::panel::SettingsState& state) {
    misty::panel::settings_section("##account_plan", "Plan & Billing", {}, [&]() {
        misty::panel::settings_row("##account_plan_label", {
            .start_width_pct = 0.52f,
            .divider_color = misty::panel::kSettingsDividerColor,
        }, [&]() {
            misty::panel::settings_row_text("Current plan", "The subscription tier associated with this account.");
        }, [&]() {
            misty::panel::settings_value_text(state.subscription_plan_label);
        });

        misty::panel::settings_row("##account_plan_manage", {
            .start_width_pct = 0.52f,
            .show_divider = false,
            .divider_color = misty::panel::kSettingsDividerColor,
        }, [&]() {
            misty::panel::settings_row_text("Manage billing", "Open billing and subscription controls when they are available.");
        }, [&]() {
            UI::button("##account_manage_billing", {
                .label = "Coming soon",
                .width = UI::Size::px(140.0f),
                .height = UI::Size::px(misty::panel::kSettingsControlHeight),
                .variant = UI::ButtonVariant::Subtle,
                .rounding = 6.0f,
                .align = UI::Align::End,
            });
        });
    });
}

void providers_section(misty::panel::SettingsState& state) {
    misty::panel::settings_section("##account_providers", "Connected Providers", {}, [&]() {
        misty::panel::settings_row("##account_provider_count", {
            .start_width_pct = 0.52f,
            .show_divider = false,
            .divider_color = misty::panel::kSettingsDividerColor,
        }, [&]() {
            misty::panel::settings_row_text("Connected providers", "Cloud providers currently linked through Misty.");
        }, [&]() {
            misty::panel::settings_value_text(std::to_string(state.connected_provider_count).c_str(), true);
        });
    });
}

} // namespace

namespace misty::panel {

bool account_tab(SettingsState& state) {
    const bool clicked = settings_nav_item(
        "##settings_account",
        "Account",
        "person-16",
        state.active_section == SettingsSection::Account
    );

    if (clicked) {
        state.active_section = SettingsSection::Account;
    }

    return clicked;
}

void account_content(SettingsState& state) {
    sync_session_identity(state);

    settings_page("account_content", "Account", [&]() {
        security_section();
        plan_section(state);
        providers_section(state);
    });
}

} //namespace misty::panel
