#include "panels/settings/shortcuts.h"

#include "core/ui/ui_layout.h"
#include "imgui.h"

namespace misty::panel {

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
    (void)state;

    UI::div("shortcuts_content", {
        .mode = UI::Mode::LayoutOnly,
        .width = UI::Size::fill(),
        .height = UI::Size::auto_size(),
        .padding = UI::Spacing::xy(28.0f, 20.0f),
    }, [&]() {
        UI::column("##shortcuts_body", {
            .width = UI::Size::fill(),
            .height = UI::Size::auto_size(),
            .gap = UI::Spacing::xy(0.0f, 20.0f),
        }, [&]() {
            UI::text({
                .text = "Shortcuts",
                .width = UI::Size::fill(),
                .color = ImVec4(0.96f, 0.96f, 0.98f, 1.0f),
                .font = UI::TextFont::BoldXLarge,
            });
            UI::text({
                .text = "Shortcuts settings content",
                .width = UI::Size::fill(),
                .color = ImVec4(0.76f, 0.78f, 0.82f, 1.0f),
            });
        });
    });
}

} //namespace misty::panel
