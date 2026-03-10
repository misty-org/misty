#include "panels/plugins/plugins_panel.h"

#include <algorithm>
#include <cctype>
#include <filesystem>
#include <fstream>
#include <optional>
#include <string>
#include <string_view>
#include <unordered_set>
#include <utility>

#include <nlohmann/json.hpp>

#include "core/manager/font_manager.h"
#include "core/manager/asset_manager.h"
#include "core/manager/plugin_manager.h"
#include "core/commands/command_manager.h"
#include "core/ui/ui_layout.h"
#include "core/ui/ui_style.h"
#include "imgui.h"
#include "panels/plugins/plugins_components.h"
#include "panels/settings/settings_components.h"
#include "views/app_view.h"

namespace misty::panel {

namespace {

constexpr float kSidebarMinWidth = 305.0f;
constexpr float kSidebarMaxWidth = 330.0f;
constexpr float kContentMinWidth = 320.0f;
constexpr float kDividerWidth = 1.0f;
constexpr float kPluginsSidebarScrollbarSize = 4.0f;
constexpr UI::Spacing kPluginsSidebarPadding = UI::Spacing::sides(16.0f, 14.0f, 16.0f, 12.0f);
constexpr UI::Spacing kPluginsSectionBodyPadding = UI::Spacing::sides(0.0f, 0.0f, 8.0f, 0.0f);
constexpr ImVec4 kPluginsPanelBg = ImVec4(0.030f, 0.045f, 0.055f, 1.0f);
constexpr ImVec4 kPluginsSurfaceBg = ImVec4(0.050f, 0.068f, 0.082f, 1.0f);
constexpr ImVec4 kPluginsSurfaceAltBg = ImVec4(0.070f, 0.088f, 0.108f, 1.0f);
constexpr ImVec4 kPluginsDetailBg = ImVec4(0.045f, 0.062f, 0.075f, 1.0f);
constexpr ImVec4 kPluginsBorderColor = ImVec4(0.175f, 0.210f, 0.245f, 0.95f);
constexpr ImVec4 kPluginsSoftBorderColor = ImVec4(0.145f, 0.175f, 0.205f, 0.75f);
constexpr ImVec4 kPluginsAccentColor = ImVec4(0.250f, 0.520f, 0.920f, 1.0f);
constexpr ImVec4 kPluginsGreenColor = ImVec4(0.38f, 0.80f, 0.42f, 1.0f);
namespace fs = std::filesystem;

enum class DetailListMarker {
    Check,
    Dot,
    Number,
};

std::string trim_copy(std::string value) {
    auto not_space = [](unsigned char ch) { return !std::isspace(ch); };
    value.erase(value.begin(), std::find_if(value.begin(), value.end(), not_space));
    value.erase(std::find_if(value.rbegin(), value.rend(), not_space).base(), value.end());
    return value;
}

std::vector<std::string> json_string_array(const nlohmann::json& value) {
    std::vector<std::string> out;
    if (!value.is_array()) {
        return out;
    }

    out.reserve(value.size());
    for (const auto& entry : value) {
        if (entry.is_string()) {
            out.push_back(trim_copy(entry.get<std::string>()));
        }
    }
    return out;
}

PluginsDetailProps detail_from_json(const nlohmann::json& json) {
    PluginsDetailProps detail;
    detail.id = trim_copy(json.value("id", std::string()));
    detail.name = trim_copy(json.value("name", std::string()));
    detail.version = trim_copy(json.value("version", std::string()));
    detail.author = trim_copy(json.value("author", std::string()));
    detail.verified = json.value("verified", json.value("plugin", nlohmann::json::object()).value("verified", false));
    detail.status = trim_copy(json.value("status", std::string()));
    detail.overview = trim_copy(json.value("overview", std::string()));
    detail.capabilities = json_string_array(json.value("capabilities", nlohmann::json::array()));
    detail.where_it_appears = json_string_array(json.value("where_it_appears", nlohmann::json::array()));
    detail.permissions = json_string_array(json.value("permissions", nlohmann::json::array()));
    detail.getting_started = json_string_array(json.value("getting_started", nlohmann::json::array()));
    detail.changelog = json_string_array(json.value("changelog", nlohmann::json::array()));

    const auto links_json = json.value("links", nlohmann::json::array());
    if (links_json.is_array()) {
        detail.links.reserve(links_json.size());
        for (const auto& entry : links_json) {
            if (!entry.is_object()) {
                continue;
            }
            detail.links.push_back({
                .label = trim_copy(entry.value("label", std::string())),
                .url = trim_copy(entry.value("url", std::string())),
            });
        }
    }

    const auto actions_json = json.value("actions", nlohmann::json::array());
    if (actions_json.is_array()) {
        detail.actions.reserve(actions_json.size());
        for (const auto& entry : actions_json) {
            if (!entry.is_object()) {
                continue;
            }
            detail.actions.push_back({
                .label = trim_copy(entry.value("label", std::string())),
                .kind = trim_copy(entry.value("kind", std::string())),
            });
        }
    }

    return detail;
}

std::optional<PluginsDetailProps> load_plugin_detail(const fs::path& path) {
    std::error_code ec;
    if (!fs::exists(path, ec) || ec) {
        return std::nullopt;
    }

    try {
        std::ifstream file(path);
        nlohmann::json json;
        file >> json;
        return detail_from_json(json);
    } catch (...) {
        return std::nullopt;
    }
}

std::optional<fs::path> public_plugins_root() {
    const char* home = std::getenv("HOME");
    if (!home || !*home) {
        return std::nullopt;
    }
    return fs::path(home) / ".misty" / "plugins" / "public";
}

std::optional<fs::path> private_plugins_root() {
    const char* home = std::getenv("HOME");
    if (!home || !*home) {
        return std::nullopt;
    }
    return fs::path(home) / ".misty" / "plugins" / "private";
}

std::vector<fs::path> plugin_roots() {
    std::vector<fs::path> roots;
    if (const auto root = private_plugins_root()) {
        roots.push_back(*root);
    }
    if (const auto root = public_plugins_root()) {
        roots.push_back(*root);
    }
    return roots;
}

std::string lowercase_copy(std::string value) {
    std::transform(value.begin(), value.end(), value.begin(), [](unsigned char ch) {
        return static_cast<char>(std::tolower(ch));
    });
    return value;
}

bool matches_query(const PluginsDetailProps& detail, const std::string& query) {
    if (query.empty()) {
        return true;
    }

    const std::string haystack = lowercase_copy(
        detail.name + "\n" + detail.author + "\n" + detail.overview + "\n" + detail.id
    );
    return haystack.find(query) != std::string::npos;
}

bool is_installed_status(const std::string& status) {
    const std::string normalized = lowercase_copy(status);
    return normalized == "installed" || normalized == "enabled" || normalized == "active";
}

std::string plugin_monogram(const PluginsDetailProps& detail) {
    std::string monogram;
    bool take_next = true;

    for (char ch : detail.name) {
        if (std::isspace(static_cast<unsigned char>(ch)) || ch == '_' || ch == '-') {
            take_next = true;
            continue;
        }

        if (take_next) {
            monogram.push_back(static_cast<char>(std::toupper(static_cast<unsigned char>(ch))));
            if (monogram.size() == 2) {
                return monogram;
            }
            take_next = false;
        }
    }

    if (monogram.empty()) {
        for (char ch : detail.id) {
            if (std::isalnum(static_cast<unsigned char>(ch))) {
                monogram.push_back(static_cast<char>(std::toupper(static_cast<unsigned char>(ch))));
                if (monogram.size() == 2) {
                    break;
                }
            }
        }
    }

    return monogram.empty() ? "?" : monogram;
}

std::string plugin_card_description(const PluginsDetailProps& detail) {
    if (!detail.capabilities.empty()) {
        return detail.capabilities.front();
    }
    return detail.overview;
}

std::string plugin_status_label(const PluginsDetailProps& detail) {
    if (detail.status.empty()) {
        return "Available";
    }

    std::string label = lowercase_copy(detail.status);
    if (!label.empty()) {
        label[0] = static_cast<char>(std::toupper(static_cast<unsigned char>(label[0])));
    }
    return label;
}

std::string plugin_action_label(const PluginsDetailProps& detail) {
    if (is_installed_status(detail.status)) {
        return "Open";
    }
    return "Install";
}

std::string plugin_category(const PluginsDetailProps& detail) {
    const std::string haystack = lowercase_copy(detail.id + "\n" + detail.name + "\n" + detail.overview);
    if (haystack.find("theme") != std::string::npos) {
        return "Appearance";
    }
    if (haystack.find("youtube") != std::string::npos ||
        haystack.find("video") != std::string::npos ||
        haystack.find("convert") != std::string::npos) {
        return "Media";
    }
    if (haystack.find("git") != std::string::npos) {
        return "Developer Tools";
    }
    return "Productivity";
}

std::string plugin_access_level(const PluginsDetailProps& detail) {
    const std::string permissions = lowercase_copy([&]() {
        std::string joined;
        for (const auto& permission : detail.permissions) {
            joined += permission;
            joined += "\n";
        }
        return joined;
    }());
    if (permissions.find("write") != std::string::npos || permissions.find("shell") != std::string::npos) {
        return "Elevated";
    }
    return "Read-only";
}

ImFont* plugins_font(core::FontID id) {
    return core::FontManager::get().get_font(id);
}

ImVec2 plugins_calc_text(const char* text, ImFont* font = nullptr, float wrap_width = 0.0f) {
    if (font) {
        ImGui::PushFont(font);
    }
    const ImVec2 size = ImGui::CalcTextSize(text ? text : "", nullptr, false, wrap_width);
    if (font) {
        ImGui::PopFont();
    }
    return size;
}

void plugins_draw_text(ImDrawList* draw_list,
                       const ImVec2& pos,
                       const ImVec4& color,
                       const char* text,
                       ImFont* font = nullptr,
                       float wrap_width = 0.0f) {
    if (!text || text[0] == '\0') {
        return;
    }

    const ImU32 text_color = ImGui::ColorConvertFloat4ToU32(color);
    if (font) {
        draw_list->AddText(font, font->LegacySize, pos, text_color, text, nullptr, wrap_width);
    } else if (wrap_width > 0.0f) {
        draw_list->AddText(ImGui::GetFont(), ImGui::GetFontSize(), pos, text_color, text, nullptr, wrap_width);
    } else {
        draw_list->AddText(pos, text_color, text, nullptr);
    }
}

void plugins_draw_icon(ImDrawList* draw_list,
                       const char* icon_path,
                       const ImVec2& pos,
                       float size,
                       const ImVec4& tint = ImVec4(1.0f, 1.0f, 1.0f, 1.0f),
                       bool apply_theme = true) {
    auto& icon = core::AssetManager::get().get_svg_texture_path(
        icon_path,
        static_cast<int>(size * 2.0f),
        apply_theme
    );
    if (icon.id) {
        draw_list->AddImage(icon.id, pos, ImVec2(pos.x + size, pos.y + size),
                            ImVec2(0.0f, 0.0f), ImVec2(1.0f, 1.0f),
                            ImGui::ColorConvertFloat4ToU32(tint));
    }
}

void plugins_draw_pill(ImDrawList* draw_list,
                       const ImVec2& pos,
                       const char* label,
                       const ImVec4& bg = ImVec4(0.18f, 0.19f, 0.22f, 1.0f),
                       const ImVec4& fg = ImVec4(0.78f, 0.80f, 0.86f, 1.0f)) {
    if (!label || label[0] == '\0') {
        return;
    }

    const ImVec2 text_size = ImGui::CalcTextSize(label);
    const ImVec2 size(text_size.x + 18.0f, 24.0f);
    draw_list->AddRectFilled(pos, ImVec2(pos.x + size.x, pos.y + size.y),
                             ImGui::ColorConvertFloat4ToU32(bg), 12.0f);
    draw_list->AddText(ImVec2(pos.x + 9.0f, pos.y + (size.y - text_size.y) * 0.5f),
                       ImGui::ColorConvertFloat4ToU32(fg), label);
}

void plugins_draw_header_icon(const ImVec2& pos,
                              const std::string& logo_path,
                              const std::string& monogram) {
    ImDrawList* draw_list = ImGui::GetWindowDrawList();
    constexpr float kBoxSize = 104.0f;
    constexpr float kIconSize = 76.0f;
    draw_list->AddRectFilled(pos, ImVec2(pos.x + kBoxSize, pos.y + kBoxSize),
                             ImGui::ColorConvertFloat4ToU32(kPluginsSurfaceAltBg), 8.0f);
    draw_list->AddRect(pos, ImVec2(pos.x + kBoxSize, pos.y + kBoxSize),
                       ImGui::ColorConvertFloat4ToU32(kPluginsSoftBorderColor), 8.0f);

    if (!logo_path.empty()) {
        auto& icon = core::AssetManager::get().get_svg_texture_path(logo_path, 152, false);
        if (icon.id) {
            const ImVec2 icon_pos(pos.x + (kBoxSize - kIconSize) * 0.5f,
                                  pos.y + (kBoxSize - kIconSize) * 0.5f);
            draw_list->AddImage(icon.id, icon_pos, ImVec2(icon_pos.x + kIconSize, icon_pos.y + kIconSize));
            return;
        }
    }

    const char* label = monogram.empty() ? "?" : monogram.c_str();
    ImFont* font = plugins_font(core::FontID::ROBOTO_BOLD_XLARGE);
    const ImVec2 text_size = plugins_calc_text(label, font);
    plugins_draw_text(draw_list,
                      ImVec2(pos.x + (kBoxSize - text_size.x) * 0.5f,
                             pos.y + (kBoxSize - text_size.y) * 0.5f),
                      kSettingsHeaderTextColor,
                      label,
                      font);
}

void plugins_draw_meta_row(ImDrawList* draw_list,
                           float x,
                           float y,
                           float value_x,
                           float width,
                           const char* icon_path,
                           const char* label,
                           const char* value) {
    plugins_draw_icon(draw_list, icon_path, ImVec2(x, y + 1.0f), 16.0f, kSettingsMutedTextColor);
    plugins_draw_text(draw_list, ImVec2(x + 26.0f, y), kSettingsMutedTextColor, label);
    const std::string display = value ? value : "";
    const float max_width = std::max(1.0f, width - (value_x - x));
    std::string clipped = display;
    if (ImGui::CalcTextSize(clipped.c_str()).x > max_width) {
        constexpr const char* kEllipsis = "...";
        while (!clipped.empty() && ImGui::CalcTextSize((clipped + kEllipsis).c_str()).x > max_width) {
            clipped.pop_back();
        }
        clipped += kEllipsis;
    }
    plugins_draw_text(draw_list, ImVec2(value_x, y), kSettingsHeaderTextColor, clipped.c_str());
}

void detail_header_block(const char* id,
                         const PluginsDetailProps& detail,
                         const std::string& logo_path,
                         const std::string& monogram,
                         const std::string& status_label,
                         const std::string& action_label,
                         const std::string& category,
                         const std::string& access) {
    const float available_width = UI::available_size().x;
    const bool compact = available_width < 760.0f;
    const float summary_width_for_measure = compact
        ? std::max(220.0f, available_width - 136.0f)
        : std::max(240.0f, available_width - 104.0f - 24.0f - 318.0f - 46.0f);
    const float overview_height = detail.overview.empty()
        ? 0.0f
        : plugins_calc_text(detail.overview.c_str(), nullptr, summary_width_for_measure).y;
    const float summary_bottom = 91.0f + overview_height;
    const float header_height = compact
        ? std::max(244.0f, std::max(132.0f, summary_bottom + 18.0f) + 98.0f)
        : std::max(132.0f, summary_bottom + 6.0f);

    UI::div(id, {
        .mode = UI::Mode::LayoutOnly,
        .width = UI::Size::fill(),
        .height = UI::Size::px(header_height),
    }, [&]() {
        UI::raw([&]() {
            const ImVec2 origin = ImGui::GetCursorScreenPos();
            const float width = ImGui::GetContentRegionAvail().x;
            constexpr float icon_size = 104.0f;
            const bool compact_layout = width < 760.0f;
            const float meta_width = compact_layout ? width : 318.0f;
            const float meta_x = origin.x + width - meta_width;
            const float summary_x = origin.x + icon_size + 24.0f;
            const float summary_width = compact_layout
                ? std::max(220.0f, width - icon_size - 32.0f)
                : std::max(240.0f, meta_x - summary_x - 28.0f);
            ImDrawList* draw_list = ImGui::GetWindowDrawList();

            plugins_draw_header_icon(origin, logo_path, monogram);

            ImFont* title_font = plugins_font(core::FontID::ROBOTO_BOLD_XLARGE);
            ImFont* bold_font = plugins_font(core::FontID::ROBOTO_BOLD);
            plugins_draw_text(draw_list, ImVec2(summary_x, origin.y + 2.0f),
                              kSettingsHeaderTextColor, detail.name.c_str(), title_font);

            float pill_x = summary_x;
            if (!detail.version.empty()) {
                plugins_draw_pill(draw_list, ImVec2(pill_x, origin.y + 36.0f), detail.version.c_str());
                pill_x += ImGui::CalcTextSize(detail.version.c_str()).x + 26.0f;
            }
            if (!detail.author.empty()) {
                plugins_draw_pill(draw_list, ImVec2(pill_x, origin.y + 36.0f), detail.author.c_str());
                pill_x += ImGui::CalcTextSize(detail.author.c_str()).x + 26.0f;
            }
            if (detail.verified) {
                plugins_draw_icon(draw_list, "assets/icons/verified-24.svg",
                                  ImVec2(pill_x + 2.0f, origin.y + 41.0f), 13.0f,
                                  ImVec4(1.0f, 1.0f, 1.0f, 1.0f), false);
            }

            draw_list->AddCircleFilled(ImVec2(summary_x + 5.0f, origin.y + 75.0f), 5.0f,
                                       ImGui::ColorConvertFloat4ToU32(kPluginsGreenColor));
            plugins_draw_text(draw_list, ImVec2(summary_x + 16.0f, origin.y + 66.0f),
                              kPluginsGreenColor, status_label.c_str(), bold_font);
            if (!detail.overview.empty()) {
                plugins_draw_text(draw_list, ImVec2(summary_x, origin.y + 91.0f),
                                  kSettingsBodyTextColor, detail.overview.c_str(),
                                  nullptr, summary_width);
            }

            const float actions_x = compact_layout
                ? origin.x + width - 132.0f
                : meta_x + meta_width - 132.0f;
            ImGui::SetCursorScreenPos(ImVec2(actions_x, origin.y + 5.0f));
            ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 7.0f);
            ImGui::PushStyleColor(ImGuiCol_Button, kPluginsAccentColor);
            ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.32f, 0.62f, 1.00f, 1.0f));
            ImGui::PushStyleColor(ImGuiCol_ButtonActive, ImVec4(0.18f, 0.42f, 0.78f, 1.0f));
            ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.98f, 0.99f, 1.0f, 1.0f));
            ImGui::Button(action_label.c_str(), ImVec2(88.0f, 36.0f));
            ImGui::PopStyleColor(4);
            ImGui::SameLine(0.0f, 8.0f);
            ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.18f, 0.18f, 0.20f, 0.55f));
            ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.22f, 0.22f, 0.24f, 0.80f));
            ImGui::PushStyleColor(ImGuiCol_ButtonActive, ImVec4(0.16f, 0.16f, 0.18f, 1.0f));
            ImGui::Button("...", ImVec2(34.0f, 36.0f));
            ImGui::PopStyleColor(3);
            ImGui::PopStyleVar();

            if (compact_layout) {
                const float meta_y = origin.y + std::max(132.0f, summary_bottom + 18.0f);
                draw_list->AddLine(ImVec2(origin.x, meta_y - 12.0f),
                                   ImVec2(origin.x + width, meta_y - 12.0f),
                                   ImGui::ColorConvertFloat4ToU32(kPluginsSoftBorderColor));
                const float row_x = origin.x;
                const float value_x = origin.x + 118.0f;
                plugins_draw_meta_row(draw_list, row_x, meta_y, value_x, width,
                                      "assets/icons/sync-16.svg", "Version",
                                      detail.version.empty() ? "1.0.0" : detail.version.c_str());
                plugins_draw_meta_row(draw_list, row_x, meta_y + 24.0f, value_x, width,
                                      "assets/icons/person-16.svg", "Author",
                                      detail.author.empty() ? "Misty" : detail.author.c_str());
                plugins_draw_meta_row(draw_list, row_x, meta_y + 48.0f, value_x, width,
                                      "assets/icons/stack-16.svg", "Category", category.c_str());
                plugins_draw_meta_row(draw_list, row_x, meta_y + 72.0f, value_x, width,
                                      "assets/icons/lock-16.svg", "Permissions", access.c_str());
            } else {
                draw_list->AddLine(ImVec2(meta_x - 18.0f, origin.y),
                                   ImVec2(meta_x - 18.0f, origin.y + std::max(122.0f, header_height - 8.0f)),
                                   ImGui::ColorConvertFloat4ToU32(kPluginsSoftBorderColor));
                const float row_x = meta_x;
                const float value_x = meta_x + 118.0f;
                plugins_draw_meta_row(draw_list, row_x, origin.y + 54.0f, value_x, meta_width,
                                      "assets/icons/sync-16.svg", "Version",
                                      detail.version.empty() ? "1.0.0" : detail.version.c_str());
                plugins_draw_meta_row(draw_list, row_x, origin.y + 78.0f, value_x, meta_width,
                                      "assets/icons/person-16.svg", "Author",
                                      detail.author.empty() ? "Misty" : detail.author.c_str());
                plugins_draw_meta_row(draw_list, row_x, origin.y + 102.0f, value_x, meta_width,
                                      "assets/icons/stack-16.svg", "Category", category.c_str());
                plugins_draw_meta_row(draw_list, row_x + 174.0f, origin.y + 102.0f,
                                      value_x + 174.0f, meta_width - 174.0f,
                                      "assets/icons/lock-16.svg", "Permissions", access.c_str());
            }
        });
    });
}

float detail_list_card_height(const std::vector<std::string>& items, float width) {
    const float wrap_width_for_measure = std::max(1.0f, width - 56.0f);
    float measured_height = 53.0f;
    for (const auto& item : items) {
        measured_height += std::max(25.0f, plugins_calc_text(item.c_str(), nullptr, wrap_width_for_measure).y + 9.0f);
    }
    measured_height += 52.0f;
    return std::max(180.0f, measured_height);
}

void draw_detail_list_card(const ImVec2& origin,
                           float width,
                           float height,
                           const char* title,
                           const std::vector<std::string>& items,
                           DetailListMarker marker) {
    const ImVec2 size(width, height);
    ImDrawList* draw_list = ImGui::GetWindowDrawList();
    draw_list->AddRectFilled(origin, ImVec2(origin.x + size.x, origin.y + size.y),
                             IM_COL32(10, 17, 21, 170), 8.0f);
    draw_list->AddRect(origin, ImVec2(origin.x + size.x, origin.y + size.y),
                       ImGui::ColorConvertFloat4ToU32(kPluginsSoftBorderColor), 8.0f);

    ImFont* title_font = plugins_font(core::FontID::ROBOTO_BOLD_LARGE);
    plugins_draw_text(draw_list, ImVec2(origin.x + 16.0f, origin.y + 16.0f),
                      kSettingsHeaderTextColor, title, title_font);

    const float text_x = origin.x + 39.0f;
    const float marker_x = origin.x + 20.0f;
    const float wrap_width = std::max(1.0f, size.x - 56.0f);
    float y = origin.y + 53.0f;
    draw_list->PushClipRect(origin, ImVec2(origin.x + size.x, origin.y + size.y), true);
    for (size_t index = 0; index < items.size(); ++index) {
        if (y > origin.y + size.y - 28.0f) {
            break;
        }

        if (marker == DetailListMarker::Number) {
            draw_list->AddCircleFilled(ImVec2(marker_x + 7.0f, y + 8.0f), 10.0f,
                                       ImGui::ColorConvertFloat4ToU32(kPluginsAccentColor));
            const std::string number = std::to_string(index + 1);
            const ImVec2 number_size = ImGui::CalcTextSize(number.c_str());
            draw_list->AddText(ImVec2(marker_x + 7.0f - number_size.x * 0.5f,
                                      y + 8.0f - number_size.y * 0.5f),
                               IM_COL32(245, 248, 255, 255), number.c_str());
        } else {
            const ImVec4 color = marker == DetailListMarker::Check ? kPluginsGreenColor : kPluginsAccentColor;
            draw_list->AddCircleFilled(ImVec2(marker_x + 7.0f, y + 8.0f), 4.0f,
                                       ImGui::ColorConvertFloat4ToU32(color));
            if (marker == DetailListMarker::Check) {
                draw_list->AddLine(ImVec2(marker_x + 4.0f, y + 8.0f),
                                   ImVec2(marker_x + 6.5f, y + 10.5f),
                                   IM_COL32(8, 18, 12, 255), 1.4f);
                draw_list->AddLine(ImVec2(marker_x + 6.5f, y + 10.5f),
                                   ImVec2(marker_x + 11.0f, y + 5.5f),
                                   IM_COL32(8, 18, 12, 255), 1.4f);
            }
        }

        const char* text = items[index].c_str();
        plugins_draw_text(draw_list, ImVec2(text_x, y), kSettingsBodyTextColor, text, nullptr, wrap_width);
        y += std::max(25.0f, plugins_calc_text(text, nullptr, wrap_width).y + 9.0f);
    }
    draw_list->PopClipRect();
}

void detail_cards_block(const char* id, const PluginsDetailProps& detail) {
    const float width = UI::available_size().x;
    constexpr float gap = 14.0f;
    const bool one_column = width < 640.0f;
    const float card_width = one_column ? width : (width - gap) * 0.5f;
    const float h0 = detail_list_card_height(detail.capabilities, card_width);
    const float h1 = detail_list_card_height(detail.where_it_appears, card_width);
    const float h2 = detail_list_card_height(detail.permissions, card_width);
    const float h3 = detail_list_card_height(detail.getting_started, card_width);
    const float total_height = one_column
        ? h0 + h1 + h2 + h3 + gap * 3.0f + 32.0f
        : std::max(h0, h1) + std::max(h2, h3) + gap + 76.0f;

    UI::div(id, {
        .mode = UI::Mode::LayoutOnly,
        .width = UI::Size::fill(),
        .height = UI::Size::px(total_height),
    }, [&]() {
        UI::raw([&]() {
            const ImVec2 origin = ImGui::GetCursorScreenPos();
            if (one_column) {
                float y = origin.y;
                draw_detail_list_card(ImVec2(origin.x, y), width, h0, "Capabilities",
                                      detail.capabilities, DetailListMarker::Check);
                y += h0 + gap;
                draw_detail_list_card(ImVec2(origin.x, y), width, h1, "Where It Appears",
                                      detail.where_it_appears, DetailListMarker::Dot);
                y += h1 + gap;
                draw_detail_list_card(ImVec2(origin.x, y), width, h2, "Permissions",
                                      detail.permissions, DetailListMarker::Dot);
                y += h2 + gap;
                draw_detail_list_card(ImVec2(origin.x, y), width, h3, "Getting Started",
                                      detail.getting_started, DetailListMarker::Number);
                return;
            }

            const float second_x = origin.x + card_width + gap;
            const float second_row_y = origin.y + std::max(h0, h1) + gap;
            const float row1_height = std::max(h2, h3);
            draw_detail_list_card(origin, card_width, h0, "Capabilities",
                                  detail.capabilities, DetailListMarker::Check);
            draw_detail_list_card(ImVec2(second_x, origin.y), card_width, h1, "Where It Appears",
                                  detail.where_it_appears, DetailListMarker::Dot);
            draw_detail_list_card(ImVec2(origin.x, second_row_y), card_width, row1_height, "Permissions",
                                  detail.permissions, DetailListMarker::Dot);
            draw_detail_list_card(ImVec2(second_x, second_row_y), card_width, row1_height, "Getting Started",
                                  detail.getting_started, DetailListMarker::Number);
        });
    });
}

std::optional<PluginsDetailProps> resolve_plugin_detail(const std::string& plugin_id) {
    for (const auto& root : plugin_roots()) {
        if (auto detail = load_plugin_detail(root / plugin_id / "plugin.json")) {
            return detail;
        }
        if (auto detail = load_plugin_detail(root / plugin_id / "detail.json")) {
            return detail;
        }
    }

    return std::nullopt;
}

void action_list(const char* id, const std::vector<PluginsActionProps>& actions) {
    if (actions.empty()) {
        return;
    }

    UI::row(id, {
        .width = UI::Size::fill(),
        .height = UI::Size::auto_size(),
        .gap = UI::Spacing::xy(10.0f, 0.0f),
    }, [&]() {
        for (size_t index = 0; index < actions.size(); ++index) {
            const auto& action = actions[index];
            const bool primary = action.kind == "primary";
            UI::button(
                (std::string(id) + "_" + std::to_string(index)).c_str(),
                {
                    .label = action.label.c_str(),
                    .height = UI::Size::px(34.0f),
                    .padding = UI::Spacing::xy(14.0f, 8.0f),
                    .variant = primary ? UI::ButtonVariant::Primary : UI::ButtonVariant::Subtle,
                }
            );
        }
    });
}

void link_list(const char* id, const std::vector<PluginsLinkProps>& links) {
    if (links.empty()) {
        return;
    }

    UI::column(id, {
        .width = UI::Size::fill(),
        .height = UI::Size::auto_size(),
        .gap = UI::Spacing::xy(0.0f, 10.0f),
    }, [&]() {
        for (size_t index = 0; index < links.size(); ++index) {
            const auto& link = links[index];
            UI::column((std::string(id) + "_" + std::to_string(index)).c_str(), {
                .width = UI::Size::fill(),
                .height = UI::Size::auto_size(),
                .padding = UI::Spacing::uniform(12.0f),
                .gap = UI::Spacing::xy(0.0f, 4.0f),
                .bg_color = kPluginsSurfaceAltBg,
                .border_color = kPluginsBorderColor,
                .rounding = 8.0f,
            }, [&]() {
                if (!link.label.empty()) {
                    UI::text({
                        .text = link.label.c_str(),
                        .width = UI::Size::fill(),
                        .font = UI::TextFont::Bold,
                        .color = kSettingsHeaderTextColor,
                    });
                }
                if (!link.url.empty()) {
                    UI::text({
                        .text = link.url.c_str(),
                        .width = UI::Size::px(720.0f),
                        .overflow = UI::TextOverflow::Wrap,
                        .color = kSettingsMutedTextColor,
                    });
                }
            });
        }
    });
}

void detail_section(
    const char* id,
    const char* title,
    const std::function<void()>& content) {
    if (!content) {
        return;
    }

    UI::column(id, {
        .width = UI::Size::fill(),
        .height = UI::Size::auto_size(),
        .padding = UI::Spacing::uniform(16.0f),
        .gap = UI::Spacing::xy(0.0f, 12.0f),
        .bg_color = kPluginsSurfaceBg,
        .border_color = kPluginsBorderColor,
        .rounding = 8.0f,
    }, [&]() {
        UI::text({
            .text = title,
            .width = UI::Size::fill(),
            .font = UI::TextFont::BoldLarge,
            .color = kSettingsHeaderTextColor,
        });
        content();
    });
}

} // namespace

PluginsPanel::PluginsPanel(core::StateRegistry&) {
}

float PluginsPanel::sidebar_max_width(float shell_width) const {
    return std::max(
        kSidebarMinWidth,
        std::min(kSidebarMaxWidth, shell_width - kContentMinWidth - kDividerWidth)
    );
}

void PluginsPanel::refresh_plugins() {
    plugins_.clear();

    const auto root = public_plugins_root();
    std::unordered_set<std::string> seen_ids;
    std::error_code ec;

    for (const auto& root_path : plugin_roots()) {
        if (!fs::exists(root_path, ec) || ec) {
            ec.clear();
            continue;
        }

        for (const auto& entry : fs::directory_iterator(root_path, ec)) {
            if (ec || !entry.is_directory()) {
                continue;
            }

            const fs::path plugin_dir = entry.path();
            std::optional<PluginsDetailProps> detail = load_plugin_detail(plugin_dir / "plugin.json");
            if (!detail) {
                detail = load_plugin_detail(plugin_dir / "detail.json");
            }
            if (!detail) {
                continue;
            }

            if (detail->id.empty()) {
                detail->id = plugin_dir.filename().string();
            }
            if (detail->name.empty()) {
                detail->name = detail->id;
            }
            if (!seen_ids.insert(detail->id).second) {
                continue;
            }

            const fs::path logo_path = plugin_dir / "assets" / "logo.svg";
            const bool has_logo = fs::exists(logo_path, ec) && !ec;
            ec.clear();

            plugins_.push_back({
                .detail = std::move(*detail),
                .logo_path = has_logo ? logo_path.string() : std::string(),
            });
        }
        ec.clear();
    }

    std::sort(plugins_.begin(), plugins_.end(), [](const PluginListEntry& lhs, const PluginListEntry& rhs) {
        return lowercase_copy(lhs.detail.name) < lowercase_copy(rhs.detail.name);
    });
}

void PluginsPanel::ensure_selected_plugin() {
    if (plugins_.empty()) {
        selected_plugin_id_.clear();
        return;
    }

    const auto selected = std::find_if(plugins_.begin(), plugins_.end(), [&](const PluginListEntry& entry) {
        return entry.detail.id == selected_plugin_id_;
    });
    if (selected != plugins_.end()) {
        return;
    }

    selected_plugin_id_ = plugins_.front().detail.id;
}

void PluginsPanel::shell() {
    const float sidebar_width = sidebar_max_width(ImGui::GetContentRegionAvail().x);

    UI::row("##plugins_shell", {
        .mode = UI::Mode::LayoutOnly,
        .width = UI::Size::fill(),
        .height = UI::Size::fill(),
        .padding = UI::Spacing::sides(16.0f, 16.0f, 14.0f, 14.0f),
        .gap = UI::Spacing::xy(8.0f, 0.0f),
    }, [&]() {
        sidebar(sidebar_width);
        content();
    });
}

void PluginsPanel::segmented_filter() {
    UI::row("##plugins_filter_tabs", {
        .width = UI::Size::fill(),
        .height = UI::Size::px(34.0f),
        .padding = UI::Spacing::uniform(2.0f),
        .gap = UI::Spacing::xy(2.0f, 0.0f),
        .bg_color = ImVec4(0.040f, 0.054f, 0.066f, 1.0f),
        .border = true,
        .border_color = kPluginsSoftBorderColor,
        .rounding = 7.0f,
    }, [&]() {
        if (UI::button("##plugins_marketplace_tab", {
            .label = "Marketplace",
            .width = UI::Size::pct(0.5f),
            .height = UI::Size::fill(),
            .variant = UI::ButtonVariant::Nav,
            .selected = !installed_filter_,
            .rounding = 6.0f,
        })) {
            installed_filter_ = false;
        }
        if (UI::button("##plugins_installed_tab", {
            .label = "Installed",
            .width = UI::Size::fill(),
            .height = UI::Size::fill(),
            .variant = UI::ButtonVariant::Nav,
            .selected = installed_filter_,
            .rounding = 6.0f,
        })) {
            installed_filter_ = true;
        }
    });
}

void PluginsPanel::sidebar(float sidebar_width) {
    UI::StyleScope style;
    style.var(ImGuiStyleVar_ScrollbarSize, kPluginsSidebarScrollbarSize);

        UI::div("##plugins_sidebar", {
            .mode = UI::Mode::ChildWindow,
            .width = UI::Size::px(sidebar_width),
            .height = UI::Size::fill(),
            .window_flags = ImGuiWindowFlags_AlwaysVerticalScrollbar,
            .padding = kPluginsSidebarPadding,
            .gap = UI::Spacing::xy(0.0f, 12.0f),
        .bg_color = kPluginsSurfaceBg,
        .border = true,
        .border_color = kPluginsBorderColor,
        .rounding = 8.0f,
    }, [&]() {
        UI::column("##plugins_sidebar_header", {
            .width = UI::Size::fill(),
            .height = UI::Size::auto_size(),
            .gap = UI::Spacing::xy(0.0f, 8.0f),
        }, [&]() {
            UI::text({
                .text = "Plugins",
                .width = UI::Size::fill(),
                .font = UI::TextFont::BoldXLarge,
                .color = kSettingsHeaderTextColor,
            });
            UI::text({
                .text = "Extend Misty with powerful plugins.",
                .width = UI::Size::fill(),
                .overflow = UI::TextOverflow::Wrap,
                .color = kSettingsMutedTextColor,
            });
        });

        UI::row("##plugins_search_row", {
            .width = UI::Size::fill(),
            .height = UI::Size::px(kSettingsControlHeight),
            .gap = UI::Spacing::xy(8.0f, 0.0f),
        }, [&]() {
            UI::input_text({
                .label = "##plugins_search",
                .buffer = search_query_,
                .buffer_size = sizeof(search_query_),
                .hint = "Search plugins...",
                .width = UI::Size::px(std::max(120.0f, sidebar_width - 78.0f)),
                .height = UI::Size::fill(),
                .padding = UI::Spacing::xy(12.0f, 8.0f),
                .rounding = 7.0f,
                .bg_color = kPluginsPanelBg,
                .border_color = kPluginsSoftBorderColor,
                .text_color = kSettingsControlTextColor,
            });
            if (UI::button("##plugins_filter_button", {
                .label = "...",
                .width = UI::Size::px(36.0f),
                .height = UI::Size::fill(),
                .variant = UI::ButtonVariant::Subtle,
                .rounding = 7.0f,
            })) {
                core::PluginManager::get().open_launcher();
            }
        });

        segmented_filter();

        UI::column("##plugins_catalog_list", {
            .width = UI::Size::fill(),
            .height = UI::Size::auto_size(),
            .gap = UI::Spacing::xy(0.0f, 8.0f),
        }, [&]() {
            cards("plugins_catalog", installed_filter_);
        });
    });
}

void PluginsPanel::section(const PluginsSectionProps& props) {
    if (!props.collapsed) {
        return;
    }

    UI::div((std::string(props.id) + "_header").c_str(), {
            .mode = UI::Mode::LayoutOnly,
            .width = UI::Size::fill(),
            .height = UI::Size::px(ImGui::GetTextLineHeight() + 4.0f),
    }, [&]() {
        UI::raw([&]() {
            if (plugins_section_header({
                .id = props.id,
                .label = props.label,
                .collapsed = *props.collapsed,
                .width = UI::available_size().x,
            })) {
                *props.collapsed = !*props.collapsed;
            }
        });
    });

    if (*props.collapsed) {
        return;
    }

    UI::div((std::string(props.id) + "_body").c_str(), {
        .mode = UI::Mode::LayoutOnly,
        .width = UI::Size::fill(),
        .height = UI::Size::auto_size(),
        .padding = kPluginsSectionBodyPadding,
        .gap = UI::Spacing::xy(0.0f, 10.0f),
    }, [&]() {
        cards(props.id, std::string_view(props.id) != "marketplace_hdr");
    });
}

void PluginsPanel::cards(const char* id, bool installed_only) {
    const std::string query = lowercase_copy(trim_copy(search_query_));
    bool showed_any = false;

    for (const auto& plugin : plugins_) {
        if (installed_only && !is_installed_status(plugin.detail.status)) {
            continue;
        }
        if (!matches_query(plugin.detail, query)) {
            continue;
        }

        const std::string card_id = std::string(id) + "_" + plugin.detail.id + "_card";
        const std::string monogram = plugin_monogram(plugin.detail);
        const std::string description = plugin_card_description(plugin.detail);
        if (plugins_card({
            .id = card_id.c_str(),
            .icon_path = plugin.logo_path.c_str(),
            .monogram = monogram.c_str(),
            .title = plugin.detail.name.c_str(),
            .author = plugin.detail.author.c_str(),
            .description = description.c_str(),
            .status = plugin_status_label(plugin.detail).c_str(),
            .verified = plugin.detail.verified,
            .selected = selected_plugin_id_ == plugin.detail.id,
        })) {
            selected_plugin_id_ = plugin.detail.id;
        }
        showed_any = true;
    }

    if (showed_any) {
        return;
    }

    UI::text({
        .text = installed_only ? "No installed plugins yet." : "No plugins found.",
        .width = UI::Size::fill(),
        .overflow = UI::TextOverflow::Wrap,
        .color = kSettingsMutedTextColor,
    });
}

void PluginsPanel::splitter() {
    UI::div("##plugins_divider", {
        .mode = UI::Mode::LayoutOnly,
        .width = UI::Size::px(kDividerWidth),
        .height = UI::Size::fill(),
        .bg_color = ImVec4(0.22f, 0.22f, 0.24f, 1.0f),
        .margin = UI::Spacing::xy(12.0f, 0.0f),
    }, []() {});
}

void PluginsPanel::content() {
    const auto selected = std::find_if(plugins_.begin(), plugins_.end(), [&](const PluginListEntry& entry) {
        return entry.detail.id == selected_plugin_id_;
    });

    UI::WithStyle([&](UI::StyleScope& style) {
        style.var(ImGuiStyleVar_ScrollbarSize, 8.0f);

        const bool has_selection = selected != plugins_.end();
        constexpr float kStickyFooterHeight = 54.0f;
        const ImVec2 available = UI::available_size();
        const float scroll_height = std::max(
            120.0f,
            available.y - (has_selection ? kStickyFooterHeight : 0.0f));

        UI::column("##plugins_content_shell", {
            .mode = UI::Mode::LayoutOnly,
            .width = UI::Size::fill(),
            .height = UI::Size::fill(),
        }, [&]() {
            UI::div("##plugins_content_scroll", {
                .mode = UI::Mode::ChildWindow,
                .width = UI::Size::fill(),
                .height = UI::Size::px(scroll_height),
                .window_flags = ImGuiWindowFlags_AlwaysVerticalScrollbar,
                .padding = UI::Spacing::uniform(0.0f),
            }, [&]() {
                if (!has_selection) {
                    plugins_page({
                        .title = "Plugins",
                    }, [&]() {
                        UI::text({
                            .text = "No plugin metadata found in ~/.misty/plugins/public or ~/.misty/plugins/private yet.",
                            .width = UI::Size::px(720.0f),
                            .overflow = UI::TextOverflow::Wrap,
                            .color = kSettingsMutedTextColor,
                        });
                    });
                    return;
                }

                const PluginsDetailProps& detail = selected->detail;
                const std::string monogram = plugin_monogram(detail);
                const std::string status_label = plugin_status_label(detail);
                const std::string action_label = plugin_action_label(detail);
                const std::string category = plugin_category(detail);
                const std::string access = plugin_access_level(detail);

                UI::column("plugins_detail_surface", {
                    .mode = UI::Mode::LayoutOnly,
                    .width = UI::Size::fill(),
                    .height = UI::Size::auto_size(),
                    .padding = UI::Spacing::sides(22.0f, 22.0f, 20.0f, 12.0f),
                    .gap = UI::Spacing::xy(0.0f, 14.0f),
                }, [&]() {
                    detail_header_block("plugins_detail_header",
                                        detail,
                                        selected->logo_path,
                                        monogram,
                                        status_label,
                                        action_label,
                                        category,
                                        access);

                    UI::divider({
                        .color = kPluginsSoftBorderColor,
                    });

                    UI::row("plugins_detail_tabs", {
                        .width = UI::Size::fill(),
                        .height = UI::Size::px(36.0f),
                        .gap = UI::Spacing::xy(10.0f, 0.0f),
                        .align = UI::Align::Center,
                    }, [&]() {
                        UI::button("plugins_tab_overview", {
                            .label = "Overview",
                            .height = UI::Size::px(32.0f),
                            .padding = UI::Spacing::xy(12.0f, 6.0f),
                            .variant = UI::ButtonVariant::Nav,
                            .selected = true,
                            .rounding = 6.0f,
                        });
                        UI::button("plugins_tab_changelog", {
                            .label = "Changelog",
                            .height = UI::Size::px(32.0f),
                            .padding = UI::Spacing::xy(12.0f, 6.0f),
                            .variant = UI::ButtonVariant::Nav,
                            .rounding = 6.0f,
                        });
                        UI::button("plugins_tab_details", {
                            .label = "Details",
                            .height = UI::Size::px(32.0f),
                            .padding = UI::Spacing::xy(12.0f, 6.0f),
                            .variant = UI::ButtonVariant::Nav,
                            .rounding = 6.0f,
                        });
                    });

                    UI::divider({
                        .color = kPluginsSoftBorderColor,
                    });

                    UI::column("plugins_detail_overview_body", {
                        .width = UI::Size::fill(),
                        .height = UI::Size::auto_size(),
                        .gap = UI::Spacing::xy(0.0f, 16.0f),
                    }, [&]() {
                        UI::column("plugins_detail_overview_text", {
                            .width = UI::Size::fill(),
                            .height = UI::Size::auto_size(),
                            .gap = UI::Spacing::xy(0.0f, 8.0f),
                        }, [&]() {
                            UI::text({
                                .text = "Overview",
                                .width = UI::Size::fill(),
                                .font = UI::TextFont::BoldLarge,
                                .color = kSettingsHeaderTextColor,
                            });
                            UI::text({
                                .text = detail.overview.empty() ? "No overview provided." : detail.overview.c_str(),
                                .width = UI::Size::fill(),
                                .overflow = UI::TextOverflow::Wrap,
                                .color = kSettingsBodyTextColor,
                            });
                        });

                        detail_cards_block("plugins_detail_card_grid", detail);
                        UI::spacer(0.0f, 20.0f);
                    });
                });
            });

            if (!has_selection) {
                return;
            }

            UI::div("plugins_detail_sticky_footer", {
                .mode = UI::Mode::LayoutOnly,
                .width = UI::Size::fill(),
                .height = UI::Size::px(kStickyFooterHeight),
                .padding = UI::Spacing::sides(22.0f, 22.0f, 8.0f, 8.0f),
                .bg_color = kPluginsPanelBg,
            }, [&]() {
                UI::divider({
                    .color = kPluginsSoftBorderColor,
                });

                UI::row("plugins_detail_footer", {
                    .width = UI::Size::fill(),
                    .height = UI::Size::auto_size(),
                    .align = UI::Align::Center,
                }, [&]() {
                    UI::text({
                        .text = "By installing this plugin, you agree to the Misty Plugin Terms.",
                        .width = UI::Size::pct(0.72f),
                        .overflow = UI::TextOverflow::Wrap,
                        .color = kSettingsMutedTextColor,
                    });
                    UI::button("plugins_report_plugin", {
                        .label = "Report Plugin",
                        .height = UI::Size::px(32.0f),
                        .padding = UI::Spacing::xy(12.0f, 6.0f),
                        .variant = UI::ButtonVariant::Subtle,
                        .rounding = 7.0f,
                    });
                });
            });
        });
    });
}

void PluginsPanel::render() {
    constexpr ImGuiWindowFlags flags =
        ImGuiWindowFlags_NoTitleBar |
        ImGuiWindowFlags_NoResize |
        ImGuiWindowFlags_NoMove |
        ImGuiWindowFlags_NoCollapse |
        ImGuiWindowFlags_NoSavedSettings;

    if (ImGuiViewport* main_viewport = ImGui::GetMainViewport()) {
        ImGui::SetNextWindowViewport(main_viewport->ID);
    }

    UI::WithWindowStyle({
        .bg_color = kPluginsPanelBg,
    }, [&]() {
        if (ImGui::Begin("Plugins", nullptr, flags)) {
            refresh_plugins();
            ensure_selected_plugin();
            misty::view::debug_log_view_event(
                std::string("plugins_panel: count=") + std::to_string(plugins_.size()) +
                " selected=" + selected_plugin_id_);
            shell();
        }
        ImGui::End();
    });
}

} // namespace misty::panel
