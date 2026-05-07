#include "panels/settings/settings_account.h"

#include <cstring>

#include "core/manager/session_manager.h"
#include "core/ui/ui_layout.h"
#include "imgui.h"
#include "panels/settings/settings_components.h"

namespace UI = misty::UI;

namespace {

const char* identity_email(const misty::panel::SettingsState& state) {
    if (state.account_email[0] != '\0') {
        return state.account_email;
    }
    return "No email available";
}

void sync_session_identity(misty::panel::SettingsState& state) {
    const std::string email = misty::core::SessionManager::get().get_email();
    if (!email.empty()) {
        std::strncpy(state.account_email, email.c_str(), sizeof(state.account_email) - 1);
        state.account_email[sizeof(state.account_email) - 1] = '\0';
    }

    if (state.account_display_name[0] == '\0' && state.account_email[0] != '\0') {
        std::string fallback = state.account_email;
        const std::size_t at = fallback.find('@');
        if (at != std::string::npos) {
            fallback = fallback.substr(0, at);
        }
        std::snprintf(state.account_display_name, sizeof(state.account_display_name), "%s", fallback.c_str());
    }
}

void avatar(const char* email) {
    const float size = 40.0f;
    const ImVec2 pos = ImGui::GetCursorScreenPos();
    const ImVec2 center(pos.x + size * 0.5f, pos.y + size * 0.5f);
    const char letter = email[0] == '\0' ? 'U' : static_cast<char>(std::toupper(email[0]));

    ImDrawList* draw_list = ImGui::GetWindowDrawList();
    draw_list->AddCircleFilled(center, size * 0.5f, IM_COL32(34, 48, 74, 255), 24);
    draw_list->AddCircle(center, size * 0.5f, IM_COL32(58, 74, 104, 255), 24, 1.0f);

    char text[2] = {letter, '\0'};
    const ImVec2 text_size = ImGui::CalcTextSize(text);
    draw_list->AddText(
        ImVec2(center.x - text_size.x * 0.5f, center.y - text_size.y * 0.5f),
        IM_COL32(236, 239, 244, 255),
        text
    );

    ImGui::Dummy(ImVec2(size, size));
}

void profile_section(misty::panel::SettingsState& state) {
    misty::panel::settings_section("##account_profile", "Profile", {}, [&]() {
        UI::row("##account_identity", {
            .width = UI::Size::fill(),
            .height = UI::Size::auto_size(),
            .gap = UI::Spacing::xy(16.0f, 0.0f),
            .justify = UI::Justify::Center,
        }, [&]() {
            UI::div("##account_avatar", {
                .width = UI::Size::px(40.0f),
                .height = UI::Size::px(40.0f),
            }, [&]() {
                avatar(identity_email(state));
            });

            UI::column("##account_identity_text", {
                .width = UI::Size::fill(),
                .height = UI::Size::auto_size(),
                .gap = UI::Spacing::xy(0.0f, 4.0f),
            }, [&]() {
                UI::text({
                    .text = identity_email(state),
                    .width = UI::Size::fill(),
                    .color = misty::panel::kSettingsHeaderTextColor,
                });
                UI::text({
                    .text = "Manage your account profile and subscription info.",
                    .width = UI::Size::fill(),
                    .color = misty::panel::kSettingsMutedTextColor,
                });
            });
        });

        misty::panel::settings_row("##account_display_name", {
            .start_width_pct = 0.52f,
            .divider_color = misty::panel::kSettingsDividerColor,
        }, [&]() {
            misty::panel::settings_row_text("Display name", "Shown anywhere Misty personalizes account details.");
        }, [&]() {
            if (misty::panel::settings_input_control(
                "##account_display_name_input",
                state.account_display_name,
                sizeof(state.account_display_name)
            )) {
                state.save_app_settings();
            }
        });

        misty::panel::settings_row("##account_email", {
            .start_width_pct = 0.52f,
            .show_divider = false,
            .divider_color = misty::panel::kSettingsDividerColor,
        }, [&]() {
            misty::panel::settings_row_text("Email", "Used for authentication and security notifications.");
        }, [&]() {
            misty::panel::settings_input_control(
                "##account_email_input",
                state.account_email,
                sizeof(state.account_email),
                true
            );
        });
    });
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
            misty::panel::settings_row_text("Connected services", "Cloud providers currently linked through Misty.");
        }, [&]() {
            misty::panel::settings_value_text(std::to_string(state.connected_provider_count).c_str(), true);
        });
    });
}

} // namespace

namespace misty::panel {

bool account_tab(SettingsState& state) {
    const bool clicked = UI::button("##settings_account", {
        .width = UI::Size::fill(),
        .height = UI::Size::px(32.0f),
        .variant = UI::ButtonVariant::Nav,
        .hover_color = ImVec4(0.2f, 0.2f, 0.2f, 1.0f),
        .selected = state.active_section == SettingsSection::Account,
        .padding = UI::Spacing::xy(8.0f, 8.0f),
        .rounding = 8.0f,
    }, [&]() {
        UI::text({
            .text = "Account",
            .width = UI::Size::fill(),
            .align = UI::Align::Start,
            .justify = UI::Justify::Center,
        });
    });

    if (clicked) {
        state.active_section = SettingsSection::Account;
    }

    return clicked;
}

void account_content(SettingsState& state) {
    sync_session_identity(state);

    UI::div("account_content", {
        .mode = UI::Mode::LayoutOnly,
        .width = UI::Size::fill(),
        .height = UI::Size::auto_size(),
        .padding = UI::Spacing::xy(28.0f, 20.0f),
    }, [&]() {
        UI::column("##account_body", {
            .width = UI::Size::fill(),
            .height = UI::Size::auto_size(),
            .gap = UI::Spacing::xy(0.0f, 18.0f),
        }, [&]() {
            settings_page_title("Account");
            profile_section(state);
            security_section();
            plan_section(state);
            providers_section(state);
        });
    });
}

} //namespace misty::panel
