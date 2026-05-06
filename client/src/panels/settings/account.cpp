#include "panels/settings/account.h"

#include "core/ui/ui_layout.h"
#include "imgui.h"

namespace UI = misty::UI;

namespace {

void avatar(const char* display_name) {
    const float size = 40.0f;
    const ImVec2 pos = ImGui::GetCursorScreenPos();
    const ImVec2 center(pos.x + size * 0.5f, pos.y + size * 0.5f);
    const char letter = display_name[0] == '\0' ? 'M' : static_cast<char>(std::toupper(display_name[0]));

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

void identity_block(misty::panel::SettingsState& state) {
    constexpr float kAvatarSize = 40.0f;
    constexpr float kGap = 16.0f;
    constexpr float kBlockHeight = 78.0f;

    const ImVec2 start = ImGui::GetCursorScreenPos();
    const float width = ImGui::GetContentRegionAvail().x;

    ImGui::Dummy(ImVec2(width, kBlockHeight));

    ImGui::SetCursorScreenPos(ImVec2(start.x, start.y + 2.0f));
    avatar(state.account_display_name);

    const float text_x = start.x + kAvatarSize + kGap;
    ImGui::SetCursorScreenPos(ImVec2(text_x, start.y));
    field_label("Display name");

    ImGui::SetCursorScreenPos(ImVec2(text_x, start.y + 18.0f));
    UI::text({
        .text = state.account_display_name,
        .width = UI::Size::fill(),
        .color = ImVec4(0.95f, 0.95f, 0.97f, 1.0f),
    });

    ImGui::SetCursorScreenPos(ImVec2(text_x, start.y + 40.0f));
    UI::text({
        .text = state.account_email,
        .width = UI::Size::fill(),
        .color = ImVec4(0.58f, 0.60f, 0.64f, 1.0f),
    });

    ImGui::SetCursorScreenPos(ImVec2(text_x, start.y + 60.0f));
    field_hint("Manage your account details.");

    ImGui::SetCursorScreenPos(ImVec2(start.x, start.y + kBlockHeight));
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

void title() {
    UI::text({
        .text = "Account",
        .width = UI::Size::fill(),
        .color = ImVec4(0.96f, 0.96f, 0.98f, 1.0f),
        .font = UI::TextFont::BoldLarge,
    });
}

void display_name_field(misty::panel::SettingsState& state) {
    UI::column("##display_name_field", {
        .width = UI::Size::fill(),
        .height = UI::Size::auto_size(),
        .gap = UI::Spacing::xy(0.0f, 8.0f),
    }, [&]() {
        field_label("Display name");
        UI::row("##display_name_row", {
            .width = UI::Size::fill(),
            .height = UI::Size::auto_size(),
            .gap = UI::Spacing::xy(10.0f, 0.0f),
            .justify = UI::Justify::Center,
        }, [&]() {
            UI::div("##display_name_input", {
                .width = UI::Size::fill(),
                .height = UI::Size::px(32.0f),
                .justify = UI::Justify::Center,
            }, [&]() {
                UI::input_text({
                    .label = "##account_display_name",
                    .buffer = state.account_display_name,
                    .buffer_size = sizeof(state.account_display_name),
                    .width = UI::Size::fill(),
                });
            });

            UI::div("##save_changes_wrap", {
                .width = UI::Size::px(110.0f),
                .height = UI::Size::px(32.0f),
            }, [&]() {
                UI::button({
                    .label = "Save changes",
                    .width = UI::Size::fill(),
                    .height = UI::Size::fill(),
                    .variant = UI::ButtonVariant::Primary,
                    .button_color = ImVec4(0.76f, 0.77f, 0.80f, 1.0f),
                    .hover_color = ImVec4(0.82f, 0.83f, 0.86f, 1.0f),
                    .active_color = ImVec4(0.69f, 0.70f, 0.73f, 1.0f),
                    .text_color = ImVec4(0.10f, 0.10f, 0.12f, 1.0f),
                    .rounding = 4.0f,
                });
            });
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
                UI::button({
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
                UI::button({
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
    bool clicked = UI::button("##settings_account", {
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
    UI::div("account_content", {
        .mode = UI::Mode::ChildWindow,
        .width = UI::Size::fill(),
        .height = UI::Size::fill(),
        .padding = UI::Spacing::xy(28.0f, 20.0f),
    }, [&]() {
        UI::column("##account_body", {
            .width = UI::Size::px(620.0f),
            .height = UI::Size::auto_size(),
            .gap = UI::Spacing::xy(0.0f, 22.0f),
        }, [&]() {
            title();

        });
    });
}

} //namespace misty::panel
