#include "panels/settings/account.h"

#include <cstring>

#include "core/manager/session_manager.h"
#include "core/ui/ui_layout.h"
#include "imgui.h"

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
    if (email.empty()) {
        return;
    }

    std::strncpy(state.account_email, email.c_str(), sizeof(state.account_email) - 1);
    state.account_email[sizeof(state.account_email) - 1] = '\0';
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

void field_label(const char* label) {
    UI::text({
        .text = label,
        .width = UI::Size::fill(),
        .color = ImVec4(0.82f, 0.84f, 0.88f, 1.0f),
    });
}

void field_hint(const char* text) {
    UI::text({
        .text = text,
        .width = UI::Size::fill(),
        .color = ImVec4(0.52f, 0.54f, 0.58f, 1.0f),
    });
}

void title() {
    UI::text({
        .text = "Account",
        .width = UI::Size::fill(),
        .color = ImVec4(0.96f, 0.96f, 0.98f, 1.0f),
        .font = UI::TextFont::BoldXLarge,
    });
}

void identity_block(misty::panel::SettingsState& state) {
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
                .color = ImVec4(0.95f, 0.95f, 0.97f, 1.0f),
            });
            field_hint("Manage your account details.");
        });
    });
}

void email_field(misty::panel::SettingsState& state) {
    UI::column("##email_field", {
        .width = UI::Size::fill(),
        .height = UI::Size::auto_size(),
        .gap = UI::Spacing::xy(0.0f, 8.0f),
    }, [&]() {
        field_label("Email");
        UI::input_text({
            .label = "##account_email",
            .buffer = state.account_email,
            .buffer_size = sizeof(state.account_email),
            .width = UI::Size::fill(),
            .flags = ImGuiInputTextFlags_ReadOnly,
        });
        field_hint("Email cannot be changed.");
    });
}

void security_row(
    const char* id,
    const char* title,
    const char* description,
    const std::function<void()>& trailing) {
    UI::row(id, {
        .width = UI::Size::fill(),
        .height = UI::Size::auto_size(),
        .justify = UI::Justify::Center,
    }, [&]() {
        UI::column("##security_text", {
            .width = UI::Size::fill(),
            .height = UI::Size::auto_size(),
            .gap = UI::Spacing::xy(0.0f, 3.0f),
        }, [&]() {
            UI::text({
                .text = title,
                .width = UI::Size::fill(),
                .color = ImVec4(0.88f, 0.89f, 0.92f, 1.0f),
            });
            field_hint(description);
        });

        UI::div("##security_action", {
            .width = UI::Size::px(96.0f),
            .height = UI::Size::px(32.0f),
            .justify = UI::Justify::Center,
        }, trailing);
    });
}

void security_section() {
    UI::column("##security_section", {
        .width = UI::Size::fill(),
        .height = UI::Size::auto_size(),
        .gap = UI::Spacing::xy(0.0f, 14.0f),
    }, [&]() {
        UI::text({
            .text = "Security",
            .width = UI::Size::fill(),
            .color = ImVec4(0.94f, 0.95f, 0.97f, 1.0f),
            .font = UI::TextFont::Bold,
        });
        UI::div("##security_divider", {
            .width = UI::Size::fill(),
            .height = UI::Size::px(1.0f),
            .bg_color = ImVec4(0.16f, 0.18f, 0.22f, 1.0f),
        }, []() {});

        security_row(
            "##password_row",
            "Password",
            "Send a reset link to your account email.",
            [&]() {
                UI::button("##reset_password", {
                    .label = "Reset",
                    .width = UI::Size::fill(),
                    .height = UI::Size::fill(),
                    .variant = UI::ButtonVariant::Subtle,
                    .rounding = 4.0f,
                });
            }
        );

        security_row(
            "##session_row",
            "Session",
            "Sign out of this device.",
            [&]() {
                UI::button("##sign_out", {
                    .label = "Sign out",
                    .width = UI::Size::fill(),
                    .height = UI::Size::fill(),
                    .variant = UI::ButtonVariant::Subtle,
                    .rounding = 4.0f,
                });
            }
        );
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
            .gap = UI::Spacing::xy(0.0f, 22.0f),
        }, [&]() {
            title();
            identity_block(state);
            email_field(state);
            security_section();
        });
    });
}

} //namespace misty::panel
