#include "panels/plugins/plugins_components.h"

#include <string>

#include "core/manager/asset_manager.h"
#include "core/ui/ui_layout.h"
#include "core/ui/ui_style.h"
#include "imgui.h"
#include "panels/settings/settings_components.h"

namespace misty::panel {

namespace {

constexpr float kPluginCardHeight = 84.0f;
constexpr float kPluginCardIconSize = 52.0f;
constexpr ImVec4 kPluginCardBg = ImVec4(0.18f, 0.18f, 0.20f, 1.0f);
constexpr ImVec4 kPluginCardSelectedBg = ImVec4(0.26f, 0.26f, 0.30f, 1.0f);
constexpr ImVec4 kPluginCardHoverBg = ImVec4(0.22f, 0.22f, 0.24f, 1.0f);
constexpr ImVec4 kPluginCardActiveBg = ImVec4(0.16f, 0.16f, 0.18f, 1.0f);

void draw_section_triangle(const ImVec2& cursor, float height, float text_width, bool collapsed) {
    const float triangle_x = cursor.x + 4.0f + text_width + 6.0f;
    const float mid_y = cursor.y + height * 0.5f;
    const ImU32 triangle_color = IM_COL32(160, 160, 160, 220);
    ImDrawList* draw_list = ImGui::GetWindowDrawList();

    if (collapsed) {
        draw_list->AddTriangleFilled(
            ImVec2(triangle_x, mid_y - 4.0f),
            ImVec2(triangle_x, mid_y + 4.0f),
            ImVec2(triangle_x + 7.0f, mid_y),
            triangle_color
        );
        return;
    }

    draw_list->AddTriangleFilled(
        ImVec2(triangle_x - 4.0f, mid_y - 2.0f),
        ImVec2(triangle_x + 4.0f, mid_y - 2.0f),
        ImVec2(triangle_x, mid_y + 4.0f),
        triangle_color
    );
}

} // namespace

void plugins_page(const PluginsContentProps& props, const std::function<void()>& content) {
    UI::div("plugins_content_page", {
        .mode = UI::Mode::LayoutOnly,
        .width = UI::Size::fill(),
        .height = UI::Size::auto_size(),
    }, [&]() {
        UI::column("plugins_content_page_body", {
            .width = UI::Size::fill(),
            .height = UI::Size::auto_size(),
            .gap = kSettingsPageGap,
        }, [&]() {
            UI::text({
                .text = props.title,
                .width = UI::Size::fill(),
                .color = kSettingsHeaderTextColor,
                .font = UI::TextFont::BoldXLarge,
            });
            if (content) {
                content();
            }
        });
    });
}

void plugins_icon(const char* id, const PluginsIconProps& props) {
    UI::div(id, {
        .width = UI::Size::px(props.tile_size),
        .height = UI::Size::px(props.tile_size),
        .bg_color = props.tile_color,
        .rounding = 10.0f,
        .align = UI::Align::Center,
        .justify = UI::Justify::Start,
    }, [&]() {
        if (props.icon_path && props.icon_path[0] != '\0') {
            auto& icon = core::AssetManager::get().get_svg_texture_path(
                props.icon_path,
                static_cast<int>(props.size * 2.0f),
                props.apply_theme
            );
            if (icon.id) {
                UI::image({
                    .texture_id = icon.id,
                    .width = UI::Size::px(props.size),
                    .height = UI::Size::px(props.size),
                    .align = UI::Align::Center,
                    .justify = UI::Justify::Center,
                    .tint_color = props.tint_color,
                });
                return;
            }
        }

        UI::text({
            .text = "?",
            .width = UI::Size::fill(),
            .align = UI::Align::Center,
            .justify = UI::Justify::Center,
            .font = UI::TextFont::BoldLarge,
            .color = kSettingsHeaderTextColor,
        });
    });
}

bool plugins_section_header(const PluginsSectionHeaderProps& props) {
    const ImVec2 cursor = ImGui::GetCursorScreenPos();
    const float height = ImGui::GetTextLineHeight() + 4.0f;

    const bool clicked = ImGui::InvisibleButton(props.id, ImVec2(props.width, height));
    const bool hovered = ImGui::IsItemHovered();

    ImDrawList* draw_list = ImGui::GetWindowDrawList();
    draw_list->AddText(
        ImVec2(cursor.x + 4.0f, cursor.y + 2.0f),
        IM_COL32(178, 178, 178, 255),
        props.label
    );

    if (hovered) {
        const float text_width = ImGui::CalcTextSize(props.label).x;
        draw_section_triangle(cursor, height, text_width, props.collapsed);
    }

    return clicked;
}

bool plugins_card(const PluginsCardProps& props) {
    bool clicked = false;

    UI::div((std::string(props.id) + "_shell").c_str(), {
        .mode = UI::Mode::LayoutOnly,
        .width = UI::Size::fill(),
        .height = UI::Size::px(kPluginCardHeight),
    }, [&]() {
        UI::raw([&]() {
            const ImVec2 origin = ImGui::GetCursorScreenPos();
            const ImVec2 size(ImGui::GetContentRegionAvail().x, kPluginCardHeight);
            clicked = ImGui::InvisibleButton(props.id, size);

            ImVec4 bg_color = props.selected ? kPluginCardSelectedBg : kPluginCardBg;
            if (ImGui::IsItemActive()) {
                bg_color = kPluginCardActiveBg;
            } else if (ImGui::IsItemHovered()) {
                bg_color = kPluginCardHoverBg;
            }

            ImGui::GetWindowDrawList()->AddRectFilled(
                origin,
                ImVec2(origin.x + size.x, origin.y + size.y),
                ImGui::ColorConvertFloat4ToU32(bg_color),
                10.0f
            );
            ImGui::SetCursorScreenPos(origin);
        });

        UI::div((std::string(props.id) + "_content").c_str(), {
            .mode = UI::Mode::LayoutOnly,
            .width = UI::Size::fill(),
            .height = UI::Size::fill(),
            .padding = UI::Spacing::xy(12.0f, 10.0f),
        }, [&]() {
            UI::row((std::string(props.id) + "_row").c_str(), {
                .width = UI::Size::fill(),
                .height = UI::Size::fill(),
                .gap = UI::Spacing::xy(12.0f, 0.0f),
                .align = UI::Align::Center,
                .justify = UI::Justify::Start,
            }, [&]() {
                if (props.icon_path && props.icon_path[0] != '\0') {
                    PluginsIconProps icon_props;
                    icon_props.icon_path = props.icon_path;
                    icon_props.apply_theme = false;
                    icon_props.size = 28.0f;
                    icon_props.tile_size = kPluginCardIconSize;
                    plugins_icon((std::string(props.id) + "_icon").c_str(), icon_props);
                } else {
                    UI::div((std::string(props.id) + "_icon").c_str(), {
                        .width = UI::Size::px(kPluginCardIconSize),
                        .height = UI::Size::px(kPluginCardIconSize),
                        .bg_color = ImVec4(0.20f, 0.20f, 0.22f, 1.0f),
                        .rounding = 10.0f,
                        .align = UI::Align::Center,
                        .justify = UI::Justify::Start,
                    }, [&]() {
                        UI::text({
                            .text = props.monogram,
                            .width = UI::Size::fill(),
                            .align = UI::Align::Center,
                            .justify = UI::Justify::Center,
                            .font = UI::TextFont::BoldLarge,
                            .color = kSettingsHeaderTextColor,
                        });
                    });
                }

                UI::column((std::string(props.id) + "_meta").c_str(), {
                    .width = UI::Size::fill(),
                    .height = UI::Size::auto_size(),
                    .gap = UI::Spacing::xy(0.0f, 2.0f),
                    .align = UI::Align::Center,
                    .justify = UI::Justify::Start,
                }, [&]() {
                    UI::text({
                        .text = props.title,
                        .width = UI::Size::fill(),
                        .font = UI::TextFont::Bold,
                        .overflow = UI::TextOverflow::Clip,
                        .color = kSettingsHeaderTextColor,
                    });
                    UI::text({
                        .text = props.author,
                        .width = UI::Size::fill(),
                        .overflow = UI::TextOverflow::Clip,
                        .color = kSettingsMutedTextColor,
                    });
                    UI::text({
                        .text = props.description,
                        .width = UI::Size::fill(),
                        .overflow = UI::TextOverflow::Clip,
                        .color = kSettingsMutedTextColor,
                    });
                });
            });
        });
    });

    return clicked;
}

} // namespace misty::panel
