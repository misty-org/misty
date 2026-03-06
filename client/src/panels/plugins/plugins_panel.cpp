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

constexpr float kSidebarMinWidth = 220.0f;
constexpr float kSidebarMaxWidth = 360.0f;
constexpr float kContentMinWidth = 320.0f;
constexpr float kDividerWidth = 1.0f;
constexpr float kPluginsSidebarScrollbarSize = 4.0f;
constexpr UI::Spacing kPluginsSidebarPadding = UI::Spacing::sides(16.0f, 16.0f, 20.0f, 20.0f);
constexpr UI::Spacing kPluginsSectionBodyPadding = UI::Spacing::sides(0.0f, 0.0f, 6.0f, 0.0f);
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
    return fs::path(home) / "misty" / "plugins" / "public";
}

std::optional<fs::path> private_plugins_root() {
    const char* home = std::getenv("HOME");
    if (!home || !*home) {
        return std::nullopt;
    }
    return fs::path(home) / "misty" / "plugins" / "private";
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
        .gap = UI::Spacing::xy(0.0f, 6.0f),
    }, [&]() {
        for (const auto& item : items) {
            UI::text({
                .text = item.c_str(),
                .width = UI::Size::fill(),
                .overflow = UI::TextOverflow::Wrap,
                .color = kSettingsBodyTextColor,
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
        .gap = UI::Spacing::xy(0.0f, 8.0f),
    }, [&]() {
        for (size_t index = 0; index < links.size(); ++index) {
            const auto& link = links[index];
            UI::column((std::string(id) + "_" + std::to_string(index)).c_str(), {
                .width = UI::Size::fill(),
                .height = UI::Size::auto_size(),
                .gap = UI::Spacing::xy(0.0f, 2.0f),
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
        .gap = UI::Spacing::xy(0.0f, 10.0f),
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

            plugins_.push_back({
                .detail = std::move(*detail),
                .logo_path = (plugin_dir / "assets" / "logo.svg").string(),
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
    }, [&]() {
        sidebar(sidebar_width);
        content();
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
    }, [&]() {
        const std::string launcher_shortcut =
            core::CommandManager::get().label("app.toggle_plugin_launcher");
        const std::string launcher_label = launcher_shortcut.empty()
            ? "Open Plugin Launcher"
            : "Open Plugin Launcher (" + launcher_shortcut + ")";
        if (UI::button("##plugins_open_launcher", {
            .label = launcher_label.c_str(),
            .width = UI::Size::fill(),
            .height = UI::Size::px(kSettingsControlHeight),
            .padding = UI::Spacing::xy(12.0f, 8.0f),
            .rounding = 6.0f,
            .button_color = kSettingsControlBgColor,
            .hover_color = ImVec4(0.22f, 0.22f, 0.24f, 1.0f),
            .active_color = ImVec4(0.26f, 0.26f, 0.28f, 1.0f),
            .text_color = kSettingsControlTextColor,
        })) {
            core::PluginManager::get().open_launcher();
        }

        UI::input_text({
            .label = "##plugins_search",
            .buffer = search_query_,
            .buffer_size = sizeof(search_query_),
            .hint = "Search plugins...",
            .width = UI::Size::fill(),
            .height = UI::Size::px(kSettingsControlHeight),
            .padding = UI::Spacing::xy(10.0f, 8.0f),
            .rounding = 6.0f,
            .bg_color = kSettingsControlBgColor,
            .border_color = kSettingsControlBorderColor,
            .text_color = kSettingsControlTextColor,
        });
        section({
            .id = "marketplace_hdr",
            .label = "Marketplace",
            .collapsed = &marketplace_collapsed_,
        });

        UI::divider({
            .color = kSettingsDividerColor,
        });
        section({
            .id = "installed_hdr",
            .label = "Installed",
            .collapsed = &installed_collapsed_,
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
            .padding = kSettingsShellPadding,
        }, [&]() {
            if (selected == plugins_.end()) {
                plugins_page({
                    .title = "Plugins",
                }, [&]() {
                    UI::text({
                        .text = "No plugin metadata found in ~/misty/plugins/public or ~/misty/plugins/private yet.",
                        .width = UI::Size::px(720.0f),
                        .overflow = UI::TextOverflow::Wrap,
                        .color = kSettingsMutedTextColor,
                    });
                });
                return;
            }

            const PluginsDetailProps& detail = selected->detail;
            plugins_page({
                .title = detail.name.c_str(),
            }, [&]() {
                UI::column("plugins_detail_body", {
                    .width = UI::Size::fill(),
                    .height = UI::Size::auto_size(),
                    .gap = UI::Spacing::xy(0.0f, 20.0f),
                }, [&]() {
                    if (!detail.version.empty()) {
                        UI::text({
                            .text = detail.version.c_str(),
                            .width = UI::Size::fill(),
                            .color = kSettingsBodyTextColor,
                        });
                    }
                    if (!detail.author.empty()) {
                        UI::text({
                            .text = detail.author.c_str(),
                            .width = UI::Size::fill(),
                            .color = kSettingsMutedTextColor,
                        });
                    }
                    if (!detail.status.empty()) {
                        UI::text({
                            .text = detail.status.c_str(),
                            .width = UI::Size::fill(),
                            .color = kSettingsMutedTextColor,
                        });
                    }

                    if (!detail.overview.empty()) {
                        detail_section("plugins_overview", "Overview", [&]() {
                            UI::text({
                                .text = detail.overview.c_str(),
                                .width = UI::Size::px(720.0f),
                                .overflow = UI::TextOverflow::Wrap,
                                .color = kSettingsBodyTextColor,
                            });
                        });
                    }

                    if (!detail.capabilities.empty()) {
                        detail_section("plugins_capabilities", "Capabilities", [&]() {
                            bullet_list("plugins_capabilities_list", detail.capabilities);
                        });
                    }

                    if (!detail.where_it_appears.empty()) {
                        detail_section("plugins_appears", "Where It Appears", [&]() {
                            bullet_list("plugins_appears_list", detail.where_it_appears);
                        });
                    }

                    if (!detail.permissions.empty()) {
                        detail_section("plugins_permissions", "Permissions", [&]() {
                            bullet_list("plugins_permissions_list", detail.permissions);
                        });
                    }

                    if (!detail.getting_started.empty()) {
                        detail_section("plugins_getting_started", "Getting Started", [&]() {
                            bullet_list("plugins_getting_started_list", detail.getting_started);
                        });
                    }

                    if (!detail.changelog.empty()) {
                        detail_section("plugins_changelog", "Changelog", [&]() {
                            bullet_list("plugins_changelog_list", detail.changelog);
                        });
                    }

                    if (!detail.actions.empty()) {
                        detail_section("plugins_actions", "Actions", [&]() {
                            action_list("plugins_actions_list", detail.actions);
                        });
                    }

                    if (!detail.links.empty()) {
                        detail_section("plugins_links", "Links", [&]() {
                            link_list("plugins_links_list", detail.links);
                        });
                    }
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
        .bg_color = ImVec4(0.12f, 0.12f, 0.12f, 1.0f),
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
