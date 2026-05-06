#include "panels/settings/general.h"

#include "core/ui/ui_layout.h"

namespace UI = misty::UI;

namespace {
    constexpr ImVec4 kHeaderTextColor = ImVec4(0.96f, 0.96f, 0.98f, 1.0f);
    constexpr ImVec4 kBodyTextColor = ImVec4(0.76f, 0.78f, 0.82f, 1.0f);
    constexpr ImVec4 kDividerColor = ImVec4(0.2f, 0.2f, 0.2f, 1.0f);
    constexpr float kSettingsValueWidth = 220.0f;

    void general_header() {
        UI::column("##general_header_block", {
            .width = UI::Size::fill(),
            .height = UI::Size::auto_size(),
        }, [&]() {
            UI::div("##general_header", {
                .mode = UI::Mode::LayoutOnly,
                .width = UI::Size::fill(),
                .height = UI::Size::auto_size(),
            }, [&]() {
                UI::text({
                    .text = "General",
                    .width = UI::Size::fill(),
                    .font = UI::TextFont::BoldXLarge,
                    .color = kHeaderTextColor,
                });
            });

            UI::divider({
                .margin = UI::Spacing::xy(0.0f, 8.0f),
                .color = kDividerColor,
            });
        });
    }

    void general_app() {
        UI::column("##general_app", {
            .width = UI::Size::fill(),
            .height = UI::Size::auto_size(),
            .gap = UI::Spacing::xy(0.0f, 8.0f),
        }, [&]() {
            UI::text({
                .text = "App",
                .width = UI::Size::fill(),
                .font = UI::TextFont::BoldLarge,
                .color = kHeaderTextColor,
            });

            UI::divider({
                .color = kDividerColor,
            });

            UI::row("##general_app_version_row", {
                .width = UI::Size::fill(),
                .height = UI::Size::auto_size(),
            }, [&]() {
                UI::div("##general_app_version_label", {
                    .width = UI::Size::pct(0.5f),
                    .height = UI::Size::auto_size(),
                }, [&]() {
                    UI::text({
                        .text = "Version",
                        .width = UI::Size::fill(),
                        .color = kHeaderTextColor,
                    });
                });

                UI::div("##general_app_version_value", {
                    .width = UI::Size::fill(),
                    .height = UI::Size::auto_size(),
                }, [&]() {
                    UI::text({
                        .text = "v0.1.0-beta",
                        .width = UI::Size::auto_size(),
                        .align = UI::Align::End,
                        .color = kHeaderTextColor,
                    });
                });
            });


            UI::divider({
                .color = kDividerColor,
            });

            UI::row("##general_app_release_row", {
                .width = UI::Size::fill(),
                .height = UI::Size::auto_size(),
                .justify = UI::Justify::Center,
            }, [&]() {
                UI::div("##general_app_release_label", {
                    .width = UI::Size::fill(),
                    .height = UI::Size::auto_size(),
                }, [&]() {
                    UI::text({
                        .text = "Release channel",
                        .width = UI::Size::fill(),
                        .color = kHeaderTextColor,
                    });
                });

                UI::div("##general_app_release_value", {
                    .width = UI::Size::px(kSettingsValueWidth),
                    .height = UI::Size::auto_size(),
                }, [&]() {
                    UI::text({
                        .text = "Stable",
                        .width = UI::Size::fill(),
                        .align = UI::Align::End,
                        .color = kHeaderTextColor,
                    });
                });
            });
        });
    }
} //namespace

namespace misty::panel {

bool general_tab(SettingsState& state) {
    bool clicked = UI::button("##settings_general", {
        .width = UI::Size::fill(),
        .height = UI::Size::px(32.0f),
        .variant = UI::ButtonVariant::Nav,
        .hover_color = ImVec4(0.2f, 0.2f, 0.2f, 1.0f),
        .selected = state.active_section == SettingsSection::General,
        .padding = UI::Spacing::xy(8.0f, 8.0f),
        .rounding = 8.0f,
    }, [&]() {
        UI::text({
            .text = "General",
            .width = UI::Size::fill(),
            .align = UI::Align::Start,
            .justify = UI::Justify::Center,
        });
    });

    if (clicked) {
        state.active_section = SettingsSection::General;
    }

    return clicked;
}

void general_content(SettingsState& state) {
    (void)state;

    UI::div("general_content", {
        .mode = UI::Mode::LayoutOnly,
        .width = UI::Size::pct(0.9f),
        .height = UI::Size::auto_size(),
    }, [&]() {
        UI::column("##general_body", {
            .width = UI::Size::fill(),
            .height = UI::Size::auto_size(),
            .gap = UI::Spacing::xy(0.0f, 12.0f),
        }, [&]() {
            general_header();
            general_app();
            UI::text({
                .text = "General settings will live here.",
                .width = UI::Size::px(420.0f),
                .overflow = UI::TextOverflow::Wrap,
                .color = kBodyTextColor,
            });
        });
    });
}

} //namespace misty::panel
