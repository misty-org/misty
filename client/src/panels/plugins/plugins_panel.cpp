#include "panels/plugins/plugins_panel.h"

#include <algorithm>
#include <filesystem>
#include <fstream>
#include <optional>
#include <string>
#include <string_view>
#include <utility>

#include <nlohmann/json.hpp>

#include "core/manager/plugin_manager.h"
#include "core/ui/ui_layout.h"
#include "core/ui/ui_style.h"
#include "imgui.h"
#include "panels/plugins/plugins_components.h"
#include "panels/settings/settings_components.h"

namespace misty::panel {

namespace {

constexpr float kSidebarMinWidth = 220.0f;
constexpr float kSidebarMaxWidth = 360.0f;
constexpr float kContentMinWidth = 320.0f;
constexpr float kDividerWidth = 1.0f;
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
    return fs::path(home) / "misty" / "public" / "plugins";
}

std::string plugin_logo_path(const std::string& plugin_id) {
    const auto root = public_plugins_root();
    if (!root) {
        return {};
    }
    return (*root / plugin_id / "assets" / "logo.svg").string();
}

std::optional<PluginsDetailProps> resolve_plugin_detail(const std::string& plugin_id) {
    const auto root = public_plugins_root();
    if (root) {
        if (auto detail = load_plugin_detail(*root / plugin_id / "plugin.json")) {
            return detail;
        }
        if (auto detail = load_plugin_detail(*root / plugin_id / "detail.json")) {
            return detail;
        }
    }

    return std::nullopt;
}

PluginsDetailProps sample_plugin_detail(const std::string& plugin_id) {
    if (plugin_id == "git") {
        return {
            .id = "git",
            .name = "Git Integration",
            .version = "1.2.0",
            .author = "OpenSource",
            .status = "available",
            .overview = "Seamlessly integrate Git version control into Misty so users can inspect repo state and work with changes in context.",
            .capabilities = {
                "Direct commit and push functionality",
                "Branch management and merging",
                "Visual file diff viewer",
                "Repository status indicators",
            },
            .where_it_appears = {
                "Files panel",
                "Repository actions",
                "Source control workflows",
            },
            .permissions = {
                "Read access to workspace repositories",
                "Write access to git metadata and tracked files",
                "Shell access for git operations",
            },
            .getting_started = {
                "Install the Git Integration plugin.",
                "Open a git repository in Misty.",
                "Use repository actions to inspect changes and commit work.",
            },
            .changelog = {
                "v1.2.0 - Added SSH key support and improved diff performance.",
                "v1.1.0 - Initial release.",
            },
            .links = {
                { .label = "Documentation", .url = "https://misty.local/plugins/git_integration/docs" },
            },
            .actions = {
                { .label = "Install", .kind = "primary" },
            },
        };
    }

    return {
        .id = "preview_manager",
        .name = "Preview Manager",
        .version = "1.0.0",
        .author = "Misty",
        .status = "available",
        .overview = "Preview Manager lets users inspect screenshots, illustrations, and other image assets directly inside Misty while keeping the current workspace context intact.",
        .capabilities = {
            "Inline image preview for common asset formats",
            "Fast inspection flow for screenshots and design files",
            "Stays inside the current browser context while previewing",
        },
        .where_it_appears = {
            "Files panel",
            "Preview workflow",
            "Selected file actions",
        },
        .permissions = {
            "Read access to workspace files",
            "Read access to mounted files",
            "No network access required",
        },
        .getting_started = {
            "Install or enable Preview Manager.",
            "Select an image file in Files.",
            "Open the preview action to inspect the selected asset.",
        },
        .changelog = {
            "v1.0.0 - Added image preview support for local and mounted files.",
            "v0.9.0 - Initial internal prototype.",
        },
        .links = {
            { .label = "Documentation", .url = "https://misty.local/plugins/preview_manager/docs" },
        },
        .actions = {
            { .label = "Open", .kind = "primary" },
        },
    };
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

void PluginsPanel::shell() {
    const float sidebar_width = sidebar_max_width(ImGui::GetContentRegionAvail().x);

    UI::row("##plugins_shell", {
        .mode = UI::Mode::LayoutOnly,
        .width = UI::Size::fill(),
        .height = UI::Size::fill(),
    }, [&]() {
        sidebar(sidebar_width);
        splitter();
        content();
    });
}

void PluginsPanel::sidebar(float sidebar_width) {
    UI::div("##plugins_sidebar", {
        .mode = UI::Mode::ChildWindow,
        .width = UI::Size::px(sidebar_width),
        .height = UI::Size::fill(),
        .padding = kSettingsSidebarPadding,
        .gap = UI::Spacing::xy(0.0f, 12.0f),
    }, [&]() {
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
                .width = ImGui::GetContentRegionAvail().x,
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
        .padding = UI::Spacing::xy(4.0f, 6.0f),
        .gap = UI::Spacing::xy(0.0f, 10.0f),
    }, [&]() {
        if (std::string_view(props.id) == "marketplace_hdr") {
            const std::string preview_logo = plugin_logo_path("preview_manager");
            if (plugins_card({
                .id = "preview_manager_card",
                .icon_path = preview_logo.c_str(),
                .monogram = "PM",
                .title = "Preview Manager",
                .author = "Misty",
                .description = "Preview images and screenshots.",
                .selected = selected_plugin_id_ == "preview_manager",
            })) {
                selected_plugin_id_ = "preview_manager";
            }

            const std::string git_logo = plugin_logo_path("git");
            if (plugins_card({
                .id = "git_integration_card",
                .icon_path = git_logo.c_str(),
                .monogram = "GI",
                .title = "Git Integration",
                .author = "OpenSource",
                .description = "Track changes and commit quickly.",
                .selected = selected_plugin_id_ == "git",
            })) {
                selected_plugin_id_ = "git";
            }
            return;
        }

        const std::string preview_logo = plugin_logo_path("preview_manager");
        if (plugins_card({
            .id = "installed_preview_card",
            .icon_path = preview_logo.c_str(),
            .monogram = "PM",
            .title = "Preview Manager",
            .author = "Misty",
            .description = "Preview images and screenshots.",
            .selected = selected_plugin_id_ == "preview_manager",
        })) {
            selected_plugin_id_ = "preview_manager";
        }
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
    const PluginsDetailProps detail = resolve_plugin_detail(selected_plugin_id_).value_or(
        sample_plugin_detail(selected_plugin_id_)
    );

    UI::WithStyle([&](UI::StyleScope& style) {
        style.var(ImGuiStyleVar_ScrollbarSize, 8.0f);

        UI::div("##plugins_content", {
            .mode = UI::Mode::ChildWindow,
            .width = UI::Size::fill(),
            .height = UI::Size::fill(),
            .window_flags = ImGuiWindowFlags_AlwaysVerticalScrollbar,
            .padding = kSettingsShellPadding,
        }, [&]() {
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
        ImGuiWindowFlags_NoCollapse;

    UI::WithWindowStyle({
        .bg_color = ImVec4(0.12f, 0.12f, 0.12f, 1.0f),
    }, [&]() {
        if (ImGui::Begin("Plugins", nullptr, flags)) {
            shell();
        }
        ImGui::End();
    });
}

} // namespace misty::panel
