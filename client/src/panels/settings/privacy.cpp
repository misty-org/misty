#include "panels/settings/privacy.h"

#include "core/ui/ui_layout.h"
#include "imgui.h"

namespace UI = misty::UI;

namespace {

void section_label(const char* text) {
    UI::text({
        .text = text,
        .width = UI::Size::fill(),
        .color = ImVec4(0.82f, 0.84f, 0.88f, 1.0f),
        .font = UI::TextFont::Small,
    });
}

void divider(const char* id) {
    UI::div(id, {
        .width = UI::Size::fill(),
        .height = UI::Size::px(0.5f),
        .bg_color = ImVec4(0.14f, 0.16f, 0.20f, 1.0f),
    }, []() {});
}

void title() {
    UI::text({
        .text = "Privacy",
        .width = UI::Size::fill(),
        .color = ImVec4(0.96f, 0.96f, 0.98f, 1.0f),
        .font = UI::TextFont::BoldXLarge,
    });
}

void docs_link() {
    UI::button("##privacy_docs", {
        .label = "",
        .width = UI::Size::auto_size(),
        .height = UI::Size::px(24.0f),
        .variant = UI::ButtonVariant::Subtle,
        .button_color = ImVec4(0.0f, 0.0f, 0.0f, 0.0f),
        .hover_color = ImVec4(0.0f, 0.0f, 0.0f, 0.0f),
        .active_color = ImVec4(0.0f, 0.0f, 0.0f, 0.0f),
        .text_color = ImVec4(0.78f, 0.81f, 0.87f, 1.0f),
        .rounding = 0.0f,
    }, [&]() {
        UI::text({
            .text = "Read the architecture docs ->",
            .width = UI::Size::auto_size(),
            .color = ImVec4(0.78f, 0.81f, 0.87f, 1.0f),
        });
    });
}

void privacy_section() {
    UI::column("##privacy_section", {
        .width = UI::Size::px(520.0f),
        .height = UI::Size::auto_size(),
        .gap = UI::Spacing::xy(0.0f, 18.0f),
    }, [&]() {
        section_label("Privacy");
        divider("##privacy_divider");
        UI::text({
            .text = "Your data stays on your device.",
            .width = UI::Size::fill(),
            .color = ImVec4(0.93f, 0.94f, 0.97f, 1.0f),
            .font = UI::TextFont::BoldLarge,
        });

        UI::text({
            .text = "Misty never transmits your files or cloud credentials to any external server. All provider communication runs through a local proxy on your machine. We only store your account info (name, email, hashed password) and subscription status.",
            .width = UI::Size::fill(),
            .overflow = UI::TextOverflow::Wrap,
            .color = ImVec4(0.76f, 0.78f, 0.82f, 1.0f),
        });

        docs_link();
        divider("##privacy_section_divider");
    });
}

void legal_row(const char* id, const char* label) {
    UI::column(id, {
        .width = UI::Size::fill(),
        .height = UI::Size::auto_size(),
        .gap = UI::Spacing::xy(0.0f, 14.0f),
    }, [&]() {
        UI::row("##privacy_legal_row", {
            .width = UI::Size::fill(),
            .height = UI::Size::auto_size(),
        }, [&]() {
            UI::text({
                .text = label,
                .width = UI::Size::fill(),
                .color = ImVec4(0.48f, 0.50f, 0.54f, 1.0f),
            });

            UI::text({
                .text = "Coming soon",
                .width = UI::Size::auto_size(),
                .color = ImVec4(0.40f, 0.42f, 0.46f, 1.0f),
                .align = UI::Align::End,
            });
        });

        divider("##privacy_legal_divider");
    });
}

void legal_section() {
    UI::column("##privacy_legal", {
        .width = UI::Size::fill(),
        .height = UI::Size::auto_size(),
        .gap = UI::Spacing::xy(0.0f, 20.0f),
    }, [&]() {
        section_label("Legal");
        divider("##privacy_legal_header_divider");
        legal_row("##privacy_policy", "Privacy Policy");
        legal_row("##privacy_tos", "Terms of Service");
        legal_row("##privacy_license", "License Agreement");
    });
}

void data_row() {
    UI::column("##privacy_data_row", {
        .width = UI::Size::fill(),
        .height = UI::Size::auto_size(),
        .gap = UI::Spacing::xy(0.0f, 14.0f),
    }, [&]() {
        UI::row("##privacy_data_content", {
            .width = UI::Size::fill(),
            .height = UI::Size::auto_size(),
            .justify = UI::Justify::Center,
        }, [&]() {
            UI::column("##privacy_data_text", {
                .width = UI::Size::fill(),
                .height = UI::Size::auto_size(),
                .gap = UI::Spacing::xy(0.0f, 4.0f),
            }, [&]() {
                UI::text({
                    .text = "Export your data",
                    .width = UI::Size::fill(),
                    .color = ImVec4(0.72f, 0.74f, 0.78f, 1.0f),
                });
                UI::text({
                    .text = "Download a copy of your account data.",
                    .width = UI::Size::fill(),
                    .color = ImVec4(0.48f, 0.50f, 0.54f, 1.0f),
                });
            });

            UI::button("##privacy_export", {
                .label = "Export",
                .width = UI::Size::px(96.0f),
                .height = UI::Size::px(32.0f),
                .variant = UI::ButtonVariant::Subtle,
                .rounding = 4.0f,
            });
        });

        divider("##privacy_data_divider");
    });
}

void data_section() {
    UI::column("##privacy_data", {
        .width = UI::Size::fill(),
        .height = UI::Size::auto_size(),
        .gap = UI::Spacing::xy(0.0f, 20.0f),
    }, [&]() {
        section_label("Data");
        divider("##privacy_data_header_divider");
        data_row();
    });
}

} // namespace

namespace misty::panel {

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
    (void)state;

    UI::div("privacy_content", {
        .mode = UI::Mode::LayoutOnly,
        .width = UI::Size::fill(),
        .height = UI::Size::auto_size(),
        .padding = UI::Spacing::xy(12.0f, 12.0f),
        .bg_color = ImVec4(1.0f, 0.0f, 0.0f, 1.0f),
    }, [&]() {
        UI::column("##privacy_body", {
            .width = UI::Size::fill(),
            .height = UI::Size::auto_size(),
            .gap = UI::Spacing::xy(0.0f, 24.0f),
        }, [&]() {
            title();
            privacy_section();
            legal_section();
            data_section();
        });
    });
}

} //namespace misty::panel
