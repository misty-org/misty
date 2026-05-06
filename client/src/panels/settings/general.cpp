#include "panels/settings/general.h"

#include "core/ui/ui_layout.h"
#include "imgui.h"

namespace UI = misty::UI;

namespace misty::panel {

bool general_tab(SettingsState& state) {
    bool clicked = UI::button("##settings_general", {
        .width = UI::Size::fill(),
        .height = UI::Size::px(32.0f),
        .variant = UI::ButtonVariant::Nav,
        .hover_color = ImVec4(0.2f, 0.2f, 0.2f, 1.0f),
        .selected = state.active_section == SettingsSection::General,
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
        .mode = UI::Mode::ChildWindow,
        .width = UI::Size::fill(),
        .height = UI::Size::fill(),
    }, [&]() {
        UI::text({
            .text = "General settings content",
        });
    });
}

} //namespace misty::panel
