#include "panels/settings/settings_components.h"

#include <string>

#include "core/manager/asset_manager.h"
#include "core/ui/ui_layout.h"
#include "imgui.h"

namespace misty::panel {
namespace {

void control_slot(const char* id, float height, const std::function<void()>& content) {
    UI::div(id, {
        .width = UI::Size::px(kSettingsControlWidth),
        .height = UI::Size::px(height),
        .align = UI::Align::End,
        .justify = UI::Justify::Start,
    }, [&]() {
        if (content) {
            content();
        }
    });
}

} // namespace

void settings_page_title(const char* text) {
    UI::text({
        .text = text,
        .width = UI::Size::fill(),
        .color = kSettingsHeaderTextColor,
        .font = UI::TextFont::BoldXLarge,
    });
}

void settings_page(
    const char* id,
    const char* title,
    const std::function<void()>& content,
    UI::Spacing gap) {
    UI::div(id, {
        .mode = UI::Mode::LayoutOnly,
        .width = UI::Size::fill(),
        .height = UI::Size::auto_size(),
        .padding = kSettingsPagePadding,
    }, [&]() {
        UI::column((std::string(id) + "_body").c_str(), {
            .width = UI::Size::fill(),
            .height = UI::Size::auto_size(),
            .gap = gap,
        }, [&]() {
            settings_page_title(title);
            if (content) {
                content();
            }
        });
    });
}

void settings_row_text(const char* label, const char* description) {
    UI::column((std::string(label) + "_text").c_str(), {
        .width = UI::Size::fill(),
        .height = UI::Size::auto_size(),
        .gap = UI::Spacing::xy(0.0f, 4.0f),
    }, [&]() {
        UI::text({
            .text = label,
            .width = UI::Size::fill(),
            .color = kSettingsHeaderTextColor,
        });
        UI::text({
            .text = description,
            .width = UI::Size::fill(),
            .overflow = UI::TextOverflow::Wrap,
            .color = kSettingsMutedTextColor,
        });
    });
}

void settings_value_text(const char* value, bool muted) {
    UI::text({
        .text = value,
        .width = UI::Size::auto_size(),
        .align = UI::Align::End,
        .color = muted ? kSettingsMutedTextColor : kSettingsHeaderTextColor,
    });
}

bool settings_toggle_switch(const char* id, bool* value) {
    if (!value) {
        return false;
    }

    auto& icon = misty::core::AssetManager::get().get_svg_texture(
        *value ? "toggle-on-24" : "toggle-off-24",
        52,
        30
    );

    const bool pressed = UI::image_button(id, {
        .texture_id = icon.id,
        .width = UI::Size::px(52.0f),
        .height = UI::Size::px(30.0f),
        .align = UI::Align::End,
        .button_color = ImVec4(0, 0, 0, 0),
        .hover_color = ImVec4(0, 0, 0, 0),
        .active_color = ImVec4(0, 0, 0, 0),
        .tint_color = ImVec4(1, 1, 1, 1),
        .border_color = ImVec4(0, 0, 0, 0),
    });
    if (pressed) {
        *value = !*value;
    }
    return pressed;
}

bool settings_select_control(const char* id, int* index, const char* const* options, int count) {
    bool changed = false;
    control_slot((std::string(id) + "_slot").c_str(), kSettingsSelectControlHeight, [&]() {
        changed = UI::select({
            .label = id,
            .selected_index = index,
            .options = options,
            .option_count = count,
            .width = UI::Size::fill(),
            .height = UI::Size::px(kSettingsSelectControlHeight),
            .padding = UI::Spacing::xy(10.0f, 6.0f),
            .rounding = 6.0f,
            .bg_color = kSettingsControlBgColor,
            .border_color = kSettingsControlBorderColor,
            .text_color = kSettingsControlTextColor,
        });
    });
    return changed;
}

bool settings_input_control(const char* id, char* buffer, size_t buffer_size, bool read_only) {
    bool changed = false;
    control_slot((std::string(id) + "_slot").c_str(), kSettingsControlHeight, [&]() {
        changed = UI::input_text({
            .label = id,
            .buffer = buffer,
            .buffer_size = buffer_size,
            .width = UI::Size::fill(),
            .height = UI::Size::px(kSettingsControlHeight),
            .padding = UI::Spacing::xy(10.0f, 8.0f),
            .rounding = 6.0f,
            .bg_color = kSettingsControlBgColor,
            .border_color = kSettingsControlBorderColor,
            .text_color = kSettingsControlTextColor,
            .flags = read_only ? ImGuiInputTextFlags_ReadOnly : ImGuiInputTextFlags_None,
        });
    });
    return changed;
}

bool settings_nav_item(const char* id, const char* label, const char* icon_name, bool selected) {
    constexpr float kSettingsNavItemHeight = 36.0f;
    constexpr float kSettingsNavIconSize = 18.0f;
    constexpr float kSettingsNavIconGap = 12.0f;
    const ImVec4 tint = selected
        ? ImVec4(1.0f, 1.0f, 1.0f, 1.0f)
        : ImVec4(0.68f, 0.68f, 0.68f, 1.0f);
    auto& icon = misty::core::AssetManager::get().get_svg_texture(icon_name, 36);

    return UI::button(id, {
        .width = UI::Size::fill(),
        .height = UI::Size::px(kSettingsNavItemHeight),
        .variant = UI::ButtonVariant::Nav,
        .hover_color = ImVec4(0.2f, 0.2f, 0.2f, 1.0f),
        .selected = selected,
        .padding = UI::Spacing::xy(8.0f, 6.0f),
        .rounding = 8.0f,
    }, [&]() {
        UI::row((std::string(id) + "_content").c_str(), {
            .width = UI::Size::fill(),
            .height = UI::Size::fill(),
            .gap = UI::Spacing::xy(kSettingsNavIconGap, 0.0f),
            .align = UI::Align::Center,
        }, [&]() {
            UI::image({
                .texture_id = icon.id,
                .width = UI::Size::px(kSettingsNavIconSize),
                .height = UI::Size::px(kSettingsNavIconSize),
                .justify = UI::Justify::Center,
                .tint_color = tint,
            });
            UI::text({
                .text = label,
                .width = UI::Size::fill(),
                .align = UI::Align::Start,
                .justify = UI::Justify::Center,
                .color = tint,
            });
        });
    });
}

void settings_status_text(const std::string& message, bool is_error) {
    if (message.empty()) {
        return;
    }

    UI::text({
        .text = message.c_str(),
        .width = UI::Size::fill(),
        .overflow = UI::TextOverflow::Wrap,
        .color = is_error ? ImVec4(0.88f, 0.44f, 0.44f, 1.0f) : kSettingsSuccessTextColor,
    });
}

void settings_row(
    const char* id,
    const SettingsRowProps& props,
    const std::function<void()>& start_content,
    const std::function<void()>& end_content) {
    UI::column(id, {
        .width = UI::Size::fill(),
        .height = UI::Size::auto_size(),
        .gap = UI::Spacing::xy(0.0f, 8.0f),
    }, [&]() {
        const std::string label_id = std::string(id) + "_label";
        const std::string value_id = std::string(id) + "_value";
        UI::row(id, {
            .width = UI::Size::fill(),
            .height = UI::Size::auto_size(),
            .align = UI::Align::Center,
        }, [&]() {
            UI::div(label_id.c_str(), {
                .width = UI::Size::pct(props.start_width_pct),
                .height = UI::Size::auto_size(),
            }, [&]() {
                if (start_content) {
                    start_content();
                }
            });

            UI::div(value_id.c_str(), {
                .width = props.end_width,
                .height = UI::Size::auto_size(),
                .align = UI::Align::Start,
                .justify = UI::Justify::End,
            }, [&]() {
                if (end_content) {
                    end_content();
                }
            });
        });

        if (props.show_divider) {
            UI::divider({
                .color = props.divider_color,
            });
        }
    });
}

void settings_section(
    const char* id,
    const char* title,
    const SettingsSectionProps& props,
    const std::function<void()>& content) {
    UI::column(id, {
        .width = UI::Size::fill(),
        .height = UI::Size::auto_size(),
        .gap = props.gap,
    }, [&]() {
        UI::text({
            .text = title,
            .width = UI::Size::fill(),
            .font = props.title_font,
            .color = props.title_color,
        });
        UI::divider({
            .color = props.divider_color,
        });
        if (content) {
            content();
        }
    });
}

} // namespace misty::panel
