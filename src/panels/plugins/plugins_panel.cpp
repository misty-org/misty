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

constexpr float kSidebarMinWidth = 310.0f;
constexpr float kSidebarMaxWidth = 340.0f;
constexpr float kContentMinWidth = 320.0f;
constexpr float kDividerWidth = 1.0f;
constexpr float kPluginsSidebarScrollbarSize = 4.0f;
constexpr UI::Spacing kPluginsSidebarPadding = UI::Spacing::sides(16.0f, 16.0f, 16.0f, 12.0f);
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

void icon_text_row(const char* id, const char* label, const char* value) {
    UI::row(id, {
        .width = UI::Size::fill(),
        .height = UI::Size::auto_size(),
        .gap = UI::Spacing::xy(12.0f, 0.0f),
        .align = UI::Align::Center,
    }, [&]() {
        UI::div((std::string(id) + "_glyph").c_str(), {
            .width = UI::Size::px(18.0f),
            .height = UI::Size::px(18.0f),
            .border = true,
            .border_color = kSettingsMutedTextColor,
            .rounding = 4.0f,
        }, []() {});
        UI::text({
            .text = label,
            .width = UI::Size::px(92.0f),
            .color = kSettingsMutedTextColor,
        });
        UI::text({
            .text = value,
            .width = UI::Size::fill(),
            .overflow = UI::TextOverflow::Ellipsis,
            .color = kSettingsHeaderTextColor,
        });
    });
}

void detail_card(const char* id, const char* title, const std::function<void()>& content) {
    UI::column(id, {
        .width = UI::Size::fill(),
        .height = UI::Size::px(156.0f),
        .padding = UI::Spacing::uniform(16.0f),
        .gap = UI::Spacing::xy(0.0f, 12.0f),
        .bg_color = ImVec4(0.040f, 0.054f, 0.066f, 1.0f),
        .border = true,
        .border_color = kPluginsSoftBorderColor,
        .rounding = 8.0f,
    }, [&]() {
        UI::text({
            .text = title,
            .width = UI::Size::fill(),
            .font = UI::TextFont::BoldLarge,
            .color = kSettingsHeaderTextColor,
        });
        if (content) {
            content();
        }
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

void bullet_list(const char* id, const std::vector<std::string>& items) {
    if (items.empty()) {
        return;
    }

    UI::column(id, {
        .width = UI::Size::fill(),
        .height = UI::Size::auto_size(),
        .gap = UI::Spacing::xy(0.0f, 8.0f),
    }, [&]() {
        for (size_t index = 0; index < items.size(); ++index) {
            const auto& item = items[index];
            UI::row((std::string(id) + "_item_" + std::to_string(index)).c_str(), {
                .width = UI::Size::fill(),
                .height = UI::Size::auto_size(),
                .gap = UI::Spacing::xy(10.0f, 0.0f),
                .align = UI::Align::Start,
            }, [&]() {
                UI::div((std::string(id) + "_dot_" + std::to_string(index)).c_str(), {
                    .width = UI::Size::px(6.0f),
                    .height = UI::Size::px(6.0f),
                    .margin = UI::Spacing::sides(0.0f, 0.0f, 6.0f, 0.0f),
                    .bg_color = kPluginsAccentColor,
                    .rounding = 3.0f,
                }, []() {});
                UI::text({
                    .text = item.c_str(),
                    .width = UI::Size::fill(),
                    .overflow = UI::TextOverflow::Wrap,
                    .color = kSettingsBodyTextColor,
                });
            });
        }
    });
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

PluginsPanel::PluginsPanel(core::UIRegistry&) {
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
        .padding = UI::Spacing::sides(16.0f, 18.0f, 18.0f, 18.0f),
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

        UI::row("##plugins_catalog_footer", {
            .width = UI::Size::fill(),
            .height = UI::Size::auto_size(),
            .padding = UI::Spacing::sides(2.0f, 2.0f, 4.0f, 0.0f),
            .align = UI::Align::Center,
        }, [&]() {
            const std::string count = std::to_string(plugins_.size()) + " plugins";
            UI::text({
                .text = count.c_str(),
                .width = UI::Size::px(150.0f),
                .color = kSettingsMutedTextColor,
            });
            const std::string launcher_shortcut =
                core::CommandManager::get().label("app.toggle_plugin_launcher");
            const std::string label = launcher_shortcut.empty() ? "Refresh" : launcher_shortcut;
            UI::button("##plugins_launcher_shortcut", {
                .label = label.c_str(),
                .height = UI::Size::px(28.0f),
                .padding = UI::Spacing::xy(10.0f, 5.0f),
                .variant = UI::ButtonVariant::Subtle,
                .rounding = 6.0f,
            });
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

        UI::div("##plugins_content", {
            .mode = UI::Mode::ChildWindow,
            .width = UI::Size::fill(),
            .height = UI::Size::fill(),
            .window_flags = ImGuiWindowFlags_AlwaysVerticalScrollbar,
            .padding = UI::Spacing::uniform(0.0f),
        }, [&]() {
            if (selected == plugins_.end()) {
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
                .width = UI::Size::fill(),
                .height = UI::Size::auto_size(),
                .padding = UI::Spacing::sides(22.0f, 22.0f, 18.0f, 14.0f),
                .gap = UI::Spacing::xy(0.0f, 18.0f),
                .bg_color = kPluginsDetailBg,
                .border = true,
                .border_color = kPluginsBorderColor,
                .rounding = 8.0f,
            }, [&]() {
                UI::row("plugins_detail_header", {
                    .width = UI::Size::fill(),
                    .height = UI::Size::auto_size(),
                    .gap = UI::Spacing::xy(20.0f, 0.0f),
                    .align = UI::Align::Start,
                }, [&]() {
                    UI::div("plugins_detail_icon", {
                        .width = UI::Size::px(104.0f),
                        .height = UI::Size::px(104.0f),
                        .padding = UI::Spacing::uniform(12.0f),
                        .bg_color = kPluginsSurfaceAltBg,
                        .border = true,
                        .border_color = kPluginsSoftBorderColor,
                        .rounding = 8.0f,
                        .align = UI::Align::Center,
                        .justify = UI::Justify::Start,
                    }, [&]() {
                        if (!selected->logo_path.empty()) {
                            PluginsIconProps icon_props;
                            icon_props.icon_path = selected->logo_path.c_str();
                            icon_props.apply_theme = false;
                            icon_props.size = 76.0f;
                            plugins_icon("plugins_detail_icon_svg", icon_props);
                        } else {
                            UI::text({
                                .text = monogram.c_str(),
                                .width = UI::Size::fill(),
                                .height = UI::Size::fill(),
                                .align = UI::Align::Center,
                                .justify = UI::Justify::Center,
                                .font = UI::TextFont::BoldXLarge,
                                .color = kSettingsHeaderTextColor,
                            });
                        }
                    });

                    UI::column("plugins_detail_summary", {
                        .width = UI::Size::px(360.0f),
                        .height = UI::Size::auto_size(),
                        .gap = UI::Spacing::xy(0.0f, 10.0f),
                    }, [&]() {
                        UI::text({
                            .text = detail.name.c_str(),
                            .width = UI::Size::fill(),
                            .font = UI::TextFont::BoldXLarge,
                            .color = kSettingsHeaderTextColor,
                        });
                        UI::row("plugins_detail_title_pills", {
                            .width = UI::Size::fill(),
                            .height = UI::Size::auto_size(),
                            .gap = UI::Spacing::xy(8.0f, 0.0f),
                        }, [&]() {
                            if (!detail.version.empty()) {
                                plugins_pill({
                                    .id = "plugins_detail_version",
                                    .label = detail.version.c_str(),
                                });
                            }
                            if (!detail.author.empty()) {
                                plugins_pill({
                                    .id = "plugins_detail_author",
                                    .label = detail.author.c_str(),
                                });
                            }
                        });
                        UI::row("plugins_detail_status", {
                            .width = UI::Size::fill(),
                            .height = UI::Size::auto_size(),
                            .gap = UI::Spacing::xy(8.0f, 0.0f),
                            .align = UI::Align::Center,
                        }, [&]() {
                            UI::div("plugins_detail_status_dot", {
                                .width = UI::Size::px(10.0f),
                                .height = UI::Size::px(10.0f),
                                .bg_color = is_installed_status(detail.status) ? kPluginsGreenColor : kPluginsGreenColor,
                                .rounding = 5.0f,
                            }, []() {});
                            UI::text({
                                .text = status_label.c_str(),
                                .width = UI::Size::fill(),
                                .font = UI::TextFont::Bold,
                                .color = kPluginsGreenColor,
                            });
                        });
                        if (!detail.overview.empty()) {
                            UI::text({
                                .text = detail.overview.c_str(),
                                .width = UI::Size::px(420.0f),
                                .overflow = UI::TextOverflow::Wrap,
                                .color = kSettingsBodyTextColor,
                            });
                        }
                    });

                    UI::column("plugins_detail_meta", {
                        .width = UI::Size::fill(),
                        .height = UI::Size::auto_size(),
                        .padding = UI::Spacing::sides(20.0f, 0.0f, 0.0f, 0.0f),
                        .gap = UI::Spacing::xy(0.0f, 12.0f),
                        .border_color = ImVec4(0.0f, 0.0f, 0.0f, 0.0f),
                    }, [&]() {
                        UI::row("plugins_detail_actions", {
                            .width = UI::Size::fill(),
                            .height = UI::Size::auto_size(),
                            .justify = UI::Justify::End,
                            .gap = UI::Spacing::xy(8.0f, 0.0f),
                        }, [&]() {
                            UI::button("plugins_detail_primary_action", {
                                .label = action_label.c_str(),
                                .width = UI::Size::px(96.0f),
                                .height = UI::Size::px(36.0f),
                                .padding = UI::Spacing::xy(22.0f, 8.0f),
                                .button_color = kPluginsAccentColor,
                                .hover_color = ImVec4(0.32f, 0.62f, 1.00f, 1.0f),
                                .active_color = ImVec4(0.18f, 0.42f, 0.78f, 1.0f),
                                .text_color = ImVec4(0.98f, 0.99f, 1.0f, 1.0f),
                                .rounding = 7.0f,
                            }, [&]() {
                                UI::text({
                                    .text = action_label.c_str(),
                                    .width = UI::Size::fill(),
                                    .height = UI::Size::fill(),
                                    .align = UI::Align::Center,
                                    .justify = UI::Justify::Center,
                                    .color = ImVec4(0.98f, 0.99f, 1.0f, 1.0f),
                                });
                            });
                            UI::button("plugins_detail_more", {
                                .label = "...",
                                .width = UI::Size::px(34.0f),
                                .height = UI::Size::px(36.0f),
                                .variant = UI::ButtonVariant::Subtle,
                                .rounding = 7.0f,
                            });
                        });

                        icon_text_row("plugins_meta_version", "Version", detail.version.empty() ? "1.0.0" : detail.version.c_str());
                        icon_text_row("plugins_meta_author", "Author", detail.author.empty() ? "Misty" : detail.author.c_str());
                        icon_text_row("plugins_meta_status", "Status", status_label.c_str());
                        icon_text_row("plugins_meta_category", "Category", category.c_str());
                        icon_text_row("plugins_meta_permissions", "Permissions", access.c_str());
                    });
                });

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

                    UI::grid("plugins_detail_card_grid", 2, {
                        .width = UI::Size::fill(),
                        .height = UI::Size::auto_size(),
                        .gap = UI::Spacing::xy(14.0f, 14.0f),
                    }, [&]() {
                        detail_card("plugins_capabilities", "Capabilities", [&]() {
                            bullet_list("plugins_capabilities_list", detail.capabilities);
                        });
                        detail_card("plugins_appears", "Where It Appears", [&]() {
                            bullet_list("plugins_appears_list", detail.where_it_appears);
                        });
                        detail_card("plugins_permissions", "Permissions", [&]() {
                            bullet_list("plugins_permissions_list", detail.permissions);
                        });
                        detail_card("plugins_getting_started", "Getting Started", [&]() {
                            bullet_list("plugins_getting_started_list", detail.getting_started);
                        });
                    });
                });

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
