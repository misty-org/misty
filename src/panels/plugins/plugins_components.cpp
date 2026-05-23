#include "panels/plugins/plugins_components.h"

#include <algorithm>
#include <cctype>
#include <string>

#include "core/manager/asset_manager.h"
#include "core/ui/ui_layout.h"
#include "core/ui/ui_style.h"
#include "imgui.h"
#include "panels/settings/settings_components.h"

namespace misty::panel {

namespace {

constexpr float kPluginCardHeight = 128.0f;
constexpr float kPluginCardIconSize = 56.0f;
constexpr ImVec4 kPluginCardBg = ImVec4(0.075f, 0.088f, 0.105f, 1.0f);
constexpr ImVec4 kPluginCardSelectedBg = ImVec4(0.078f, 0.145f, 0.240f, 0.72f);
constexpr ImVec4 kPluginCardHoverBg = ImVec4(0.095f, 0.112f, 0.135f, 1.0f);
constexpr ImVec4 kPluginCardActiveBg = ImVec4(0.060f, 0.072f, 0.090f, 1.0f);
constexpr ImVec4 kPluginCardBorder = ImVec4(0.180f, 0.205f, 0.235f, 0.90f);
constexpr ImVec4 kPluginCardSelectedBorder = ImVec4(0.280f, 0.560f, 0.920f, 1.0f);
constexpr ImVec4 kPluginAccent = ImVec4(0.42f, 0.58f, 0.96f, 1.0f);
constexpr float kVerifiedIconSize = 13.0f;
constexpr float kVerifiedIconGap = 4.0f;

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

std::string ellipsize_to_width(const char* text, float max_width) {
    if (text == nullptr || text[0] == '\0' || max_width <= 0.0f) {
        return {};
    }

    const std::string value(text);
    if (ImGui::CalcTextSize(value.c_str()).x <= max_width) {
        return value;
    }

    constexpr const char* kEllipsis = "...";
    const float ellipsis_width = ImGui::CalcTextSize(kEllipsis).x;
    if (ellipsis_width > max_width) {
        return {};
    }

    std::size_t keep = value.size();
    while (keep > 0) {
        std::string candidate = value.substr(0, keep) + kEllipsis;
        if (ImGui::CalcTextSize(candidate.c_str()).x <= max_width) {
            return candidate;
        }
        --keep;
    }
    return kEllipsis;
}

void plugin_author_line(const char* id, const char* author, bool verified) {
    const float line_height = ImGui::GetTextLineHeight();
    UI::div(id, {
        .mode = UI::Mode::LayoutOnly,
        .width = UI::Size::fill(),
        .height = UI::Size::px(line_height),
    }, [&]() {
        const float line_width = UI::available_size().x;
        UI::raw([&]() {
            const ImVec2 origin = ImGui::GetCursorScreenPos();
            const float reserved_width = verified ? (kVerifiedIconSize + kVerifiedIconGap) : 0.0f;
            const std::string display_author =
                ellipsize_to_width(author, std::max(1.0f, line_width - reserved_width));
            const ImVec2 text_size = ImGui::CalcTextSize(display_author.c_str());
            ImDrawList* draw_list = ImGui::GetWindowDrawList();
            draw_list->AddText(
                origin,
                ImGui::ColorConvertFloat4ToU32(kSettingsMutedTextColor),
                display_author.c_str()
            );

            if (verified && !display_author.empty()) {
                auto& verified_icon = core::AssetManager::get().get_svg_texture_path(
                    "assets/icons/verified-24.svg",
                    static_cast<int>(kVerifiedIconSize * 2.0f),
                    false
                );
                if (verified_icon.id) {
                    const float icon_x = std::min(
                        origin.x + line_width - kVerifiedIconSize,
                        origin.x + text_size.x + kVerifiedIconGap
                    );
                    const float icon_y = origin.y + (line_height - kVerifiedIconSize) * 0.5f;
                    draw_list->AddImage(
                        verified_icon.id,
                        ImVec2(icon_x, icon_y),
                        ImVec2(icon_x + kVerifiedIconSize, icon_y + kVerifiedIconSize),
                        ImVec2(0.0f, 0.0f),
                        ImVec2(1.0f, 1.0f),
                        IM_COL32_WHITE
                    );
                }
            }
        });
    });
}

bool installed_status(const char* status) {
    if (!status) {
        return false;
    }

    std::string normalized(status);
    std::transform(normalized.begin(), normalized.end(), normalized.begin(), [](unsigned char ch) {
        return static_cast<char>(std::tolower(ch));
    });
    return normalized == "installed" || normalized == "enabled" || normalized == "active";
}

void status_badge(const char* id, const char* status) {
    if (!status || status[0] == '\0') {
        return;
    }

    const bool installed = installed_status(status);
    plugins_pill({
        .id = id,
        .label = status,
        .bg_color = installed ? ImVec4(0.09f, 0.22f, 0.14f, 1.0f) : ImVec4(0.10f, 0.19f, 0.34f, 1.0f),
        .text_color = installed ? ImVec4(0.54f, 0.86f, 0.55f, 1.0f) : ImVec4(0.55f, 0.74f, 1.0f, 1.0f),
    });
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
            if (props.title && props.title[0] != '\0') {
                UI::text({
                    .text = props.title,
                    .width = UI::Size::fill(),
                    .color = kSettingsHeaderTextColor,
                    .font = UI::TextFont::BoldXLarge,
                });
            }
            if (content) {
                content();
            }
        });
    });
}

void plugins_icon(const char* id, const PluginsIconProps& props) {
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
        .width = UI::Size::px(props.size),
        .align = UI::Align::Center,
        .justify = UI::Justify::Center,
        .font = UI::TextFont::BoldLarge,
        .color = kSettingsHeaderTextColor,
    });
}

bool plugins_section_header(const PluginsSectionHeaderProps& props) {
    const ImVec2 cursor = ImGui::GetCursorScreenPos();
    const float height = ImGui::GetTextLineHeight() + 8.0f;

    const bool clicked = ImGui::InvisibleButton(props.id, ImVec2(props.width, height));
    const bool hovered = ImGui::IsItemHovered();

    ImDrawList* draw_list = ImGui::GetWindowDrawList();
    if (hovered) {
        draw_list->AddRectFilled(
            cursor,
            ImVec2(cursor.x + props.width, cursor.y + height),
            IM_COL32(255, 255, 255, 12),
            6.0f
        );
    }
    draw_list->AddText(
        ImVec2(cursor.x + 8.0f, cursor.y + 4.0f),
        IM_COL32(188, 192, 204, 255),
        props.label
    );

    const float text_width = ImGui::CalcTextSize(props.label).x;
    draw_section_triangle(ImVec2(cursor.x + 4.0f, cursor.y + 2.0f), height, text_width, props.collapsed);

    return clicked;
}

void plugins_pill(const PluginsPillProps& props) {
    if (!props.label || props.label[0] == '\0') {
        return;
    }

    const ImVec2 text_size = ImGui::CalcTextSize(props.label);
    const ImVec2 size(text_size.x + 18.0f, 24.0f);
    UI::div(props.id, {
        .mode = UI::Mode::LayoutOnly,
        .width = UI::Size::px(size.x),
        .height = UI::Size::px(size.y),
    }, [&]() {
        UI::raw([&]() {
            const ImVec2 origin = ImGui::GetCursorScreenPos();
            ImDrawList* draw_list = ImGui::GetWindowDrawList();
            draw_list->AddRectFilled(
                origin,
                ImVec2(origin.x + size.x, origin.y + size.y),
                ImGui::ColorConvertFloat4ToU32(props.bg_color),
                12.0f
            );
            draw_list->AddText(
                ImVec2(origin.x + 9.0f, origin.y + (size.y - text_size.y) * 0.5f),
                ImGui::ColorConvertFloat4ToU32(props.text_color),
                props.label
            );
        });
    });
}

bool plugins_card(const PluginsCardProps& props) {
    bool clicked = false;
    const float card_width = UI::available_size().x;

    UI::div((std::string(props.id) + "_shell").c_str(), {
        .mode = UI::Mode::LayoutOnly,
        .width = UI::Size::fill(),
        .height = UI::Size::px(kPluginCardHeight),
    }, [&]() {
        UI::raw([&]() {
            const ImVec2 origin = ImGui::GetCursorScreenPos();
            const ImVec2 size(card_width, kPluginCardHeight);
            clicked = ImGui::InvisibleButton(props.id, size);

            ImVec4 bg_color = props.selected ? kPluginCardSelectedBg : kPluginCardBg;
            ImVec4 border_color = props.selected ? kPluginCardSelectedBorder : kPluginCardBorder;
            if (ImGui::IsItemActive()) {
                bg_color = kPluginCardActiveBg;
            } else if (ImGui::IsItemHovered()) {
                bg_color = kPluginCardHoverBg;
                border_color = props.selected ? kPluginCardSelectedBorder : ImVec4(0.36f, 0.38f, 0.45f, 0.65f);
            }

            ImDrawList* draw_list = ImGui::GetWindowDrawList();
            draw_list->AddRectFilled(
                origin,
                ImVec2(origin.x + size.x, origin.y + size.y),
                ImGui::ColorConvertFloat4ToU32(bg_color),
                8.0f
            );
            draw_list->AddRect(
                origin,
                ImVec2(origin.x + size.x, origin.y + size.y),
                ImGui::ColorConvertFloat4ToU32(border_color),
                8.0f
            );
            if (props.selected) {
                draw_list->AddRectFilled(
                    ImVec2(origin.x, origin.y + 12.0f),
                    ImVec2(origin.x + 3.0f, origin.y + size.y - 12.0f),
                    ImGui::ColorConvertFloat4ToU32(kPluginAccent),
                    2.0f
                );
            }
            ImGui::SetCursorScreenPos(origin);
        });

        UI::div((std::string(props.id) + "_content").c_str(), {
            .mode = UI::Mode::LayoutOnly,
            .width = UI::Size::fill(),
            .height = UI::Size::fill(),
            .padding = UI::Spacing::sides(14.0f, 14.0f, 16.0f, 14.0f),
        }, [&]() {
            UI::row((std::string(props.id) + "_row").c_str(), {
                .width = UI::Size::fill(),
                .height = UI::Size::auto_size(),
                .gap = UI::Spacing::xy(13.0f, 0.0f),
                .align = UI::Align::Start,
                .justify = UI::Justify::Start,
            }, [&]() {
                if (props.icon_path && props.icon_path[0] != '\0') {
                    UI::div((std::string(props.id) + "_icon").c_str(), {
                        .width = UI::Size::px(kPluginCardIconSize),
                        .height = UI::Size::px(kPluginCardIconSize),
                        .align = UI::Align::Center,
                        .justify = UI::Justify::Start,
                    }, [&]() {
                        PluginsIconProps icon_props;
                        icon_props.icon_path = props.icon_path;
                        icon_props.apply_theme = false;
                        icon_props.size = 48.0f;
                        plugins_icon((std::string(props.id) + "_icon_svg").c_str(), icon_props);
                    });
                } else {
                    UI::div((std::string(props.id) + "_icon").c_str(), {
                        .width = UI::Size::px(kPluginCardIconSize),
                        .height = UI::Size::px(kPluginCardIconSize),
                        .bg_color = ImVec4(0.20f, 0.20f, 0.22f, 1.0f),
                        .rounding = 8.0f,
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
                    .gap = UI::Spacing::xy(0.0f, 5.0f),
                    .align = UI::Align::Start,
                    .justify = UI::Justify::Start,
                }, [&]() {
                    UI::text({
                        .text = props.title,
                        .width = UI::Size::fill(),
                        .font = UI::TextFont::Bold,
                        .overflow = UI::TextOverflow::Ellipsis,
                        .color = kSettingsHeaderTextColor,
                    });
                    plugin_author_line((std::string(props.id) + "_author").c_str(), props.author, props.verified);
                    UI::text({
                        .text = props.description,
                        .width = UI::Size::fill(),
                        .overflow = UI::TextOverflow::Ellipsis,
                        .color = kSettingsMutedTextColor,
                    });
                });
            });

            UI::row((std::string(props.id) + "_footer").c_str(), {
                .width = UI::Size::fill(),
                .height = UI::Size::auto_size(),
                .margin = UI::Spacing::sides(0.0f, 0.0f, 10.0f, 0.0f),
                .justify = UI::Justify::End,
            }, [&]() {
                status_badge((std::string(props.id) + "_status").c_str(), props.status);
            });
        });
    });

    return clicked;
}

} // namespace misty::panel
