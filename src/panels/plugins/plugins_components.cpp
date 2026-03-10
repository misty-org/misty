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

constexpr float kPluginCardHeight = 124.0f;
constexpr float kPluginCardIconSize = 58.0f;
constexpr ImVec4 kPluginCardBg = ImVec4(0.065f, 0.078f, 0.094f, 1.0f);
constexpr ImVec4 kPluginCardSelectedBg = ImVec4(0.055f, 0.128f, 0.225f, 0.88f);
constexpr ImVec4 kPluginCardHoverBg = ImVec4(0.095f, 0.112f, 0.135f, 1.0f);
constexpr ImVec4 kPluginCardActiveBg = ImVec4(0.060f, 0.072f, 0.090f, 1.0f);
constexpr ImVec4 kPluginCardBorder = ImVec4(0.180f, 0.205f, 0.235f, 0.90f);
constexpr ImVec4 kPluginCardSelectedBorder = ImVec4(0.280f, 0.560f, 0.920f, 1.0f);
constexpr ImVec4 kPluginAccent = ImVec4(0.42f, 0.58f, 0.96f, 1.0f);
constexpr float kVerifiedIconSize = 13.0f;
constexpr float kVerifiedIconGap = 4.0f;
constexpr float kPluginCardPadX = 16.0f;
constexpr float kPluginCardPadY = 14.0f;

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

void draw_status_pill(const ImVec2& origin, const char* status) {
    if (!status || status[0] == '\0') {
        return;
    }

    const bool installed = installed_status(status);
    const ImVec4 bg = installed ? ImVec4(0.09f, 0.22f, 0.14f, 1.0f) : ImVec4(0.10f, 0.19f, 0.34f, 1.0f);
    const ImVec4 fg = installed ? ImVec4(0.54f, 0.86f, 0.55f, 1.0f) : ImVec4(0.55f, 0.74f, 1.0f, 1.0f);
    const ImVec2 text_size = ImGui::CalcTextSize(status);
    const ImVec2 size(text_size.x + 18.0f, 24.0f);
    ImDrawList* draw_list = ImGui::GetWindowDrawList();
    draw_list->AddRectFilled(origin, ImVec2(origin.x + size.x, origin.y + size.y),
                             ImGui::ColorConvertFloat4ToU32(bg), 12.0f);
    draw_list->AddText(ImVec2(origin.x + 9.0f, origin.y + (size.y - text_size.y) * 0.5f),
                       ImGui::ColorConvertFloat4ToU32(fg), status);
}

void draw_card_icon(const ImVec2& origin, const PluginsCardProps& props) {
    ImDrawList* draw_list = ImGui::GetWindowDrawList();
    if (props.icon_path && props.icon_path[0] != '\0') {
        auto& icon = core::AssetManager::get().get_svg_texture_path(
            props.icon_path,
            96,
            false
        );
        if (icon.id) {
            const float icon_size = 48.0f;
            const ImVec2 icon_pos(
                origin.x + (kPluginCardIconSize - icon_size) * 0.5f,
                origin.y + (kPluginCardIconSize - icon_size) * 0.5f
            );
            draw_list->AddImage(icon.id, icon_pos, ImVec2(icon_pos.x + icon_size, icon_pos.y + icon_size));
            return;
        }
    }

    draw_list->AddRectFilled(origin,
                             ImVec2(origin.x + kPluginCardIconSize, origin.y + kPluginCardIconSize),
                             IM_COL32(52, 52, 58, 255), 8.0f);
    const char* monogram = props.monogram && props.monogram[0] != '\0' ? props.monogram : "?";
    const ImVec2 text_size = ImGui::CalcTextSize(monogram);
    draw_list->AddText(ImVec2(origin.x + (kPluginCardIconSize - text_size.x) * 0.5f,
                              origin.y + (kPluginCardIconSize - text_size.y) * 0.5f),
                       ImGui::ColorConvertFloat4ToU32(kSettingsHeaderTextColor), monogram);
}

void draw_verified_icon(const ImVec2& origin) {
    auto& verified_icon = core::AssetManager::get().get_svg_texture_path(
        "assets/icons/verified-24.svg",
        static_cast<int>(kVerifiedIconSize * 2.0f),
        false
    );
    if (verified_icon.id) {
        ImGui::GetWindowDrawList()->AddImage(
            verified_icon.id,
            origin,
            ImVec2(origin.x + kVerifiedIconSize, origin.y + kVerifiedIconSize)
        );
    }
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
            ImGui::SetCursorScreenPos(origin);
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

            const ImVec2 icon_origin(origin.x + kPluginCardPadX, origin.y + kPluginCardPadY + 2.0f);
            draw_card_icon(icon_origin, props);

            const float text_x = icon_origin.x + kPluginCardIconSize + 12.0f;
            const float text_right = origin.x + size.x - 14.0f;
            const float text_width = std::max(1.0f, text_right - text_x);
            const float status_y = origin.y + kPluginCardHeight - 36.0f;
            const float description_width = std::max(1.0f, text_width - 6.0f);

            const std::string title = ellipsize_to_width(props.title, text_width);
            draw_list->AddText(ImVec2(text_x, origin.y + 17.0f),
                               ImGui::ColorConvertFloat4ToU32(kSettingsHeaderTextColor), title.c_str());

            const float author_reserved = props.verified ? (kVerifiedIconSize + kVerifiedIconGap) : 0.0f;
            const std::string author = ellipsize_to_width(props.author, text_width - author_reserved);
            const float author_y = origin.y + 40.0f;
            draw_list->AddText(ImVec2(text_x, author_y),
                               ImGui::ColorConvertFloat4ToU32(kSettingsMutedTextColor), author.c_str());
            if (props.verified && !author.empty()) {
                const ImVec2 author_size = ImGui::CalcTextSize(author.c_str());
                draw_verified_icon(ImVec2(text_x + author_size.x + kVerifiedIconGap,
                                          author_y + (ImGui::GetTextLineHeight() - kVerifiedIconSize) * 0.5f));
            }

            const std::string description = ellipsize_to_width(props.description, description_width);
            draw_list->AddText(ImVec2(text_x, origin.y + 62.0f),
                               ImGui::ColorConvertFloat4ToU32(kSettingsMutedTextColor), description.c_str());

            const ImVec2 status_text_size = ImGui::CalcTextSize(props.status ? props.status : "");
            const float status_width = status_text_size.x + 18.0f;
            draw_status_pill(ImVec2(origin.x + size.x - status_width - 14.0f,
                                    status_y),
                             props.status);
        });
    });

    return clicked;
}

} // namespace misty::panel
