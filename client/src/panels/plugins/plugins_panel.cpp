#include "panels/plugins/plugins_panel.h"

#include <algorithm>
#include <sstream>

#include "core/plugins/plugin_host.h"
#include "core/manager/asset_manager.h"
#include "core/manager/font_manager.h"
#include "core/ui/ui_style.h"
#include "imgui.h"
#include "panels/activity/activity_state.h"
#include "panels/notification/notification_state.h"

namespace misty::panel {

namespace {
struct ButtonStyle {
    ImVec4 button;
    ImVec4 hovered;
    ImVec4 active;
    ImVec4 text;
    float rounding;
};

ButtonStyle primary_button_style() {
    return {
        ImVec4(0.957f, 0.957f, 0.961f, 1.0f),
        ImVec4(0.898f, 0.906f, 0.922f, 1.0f),
        ImVec4(0.820f, 0.835f, 0.859f, 1.0f),
        ImVec4(0.07f, 0.07f, 0.07f, 1.0f),
        8.0f,
    };
}

bool styled_button(const char* label, const ImVec2& size, const ButtonStyle& style) {
    bool pressed = false;
    misty::UI::WithStyle([&](misty::UI::StyleScope& scoped) {
        scoped.var(ImGuiStyleVar_FrameRounding, style.rounding);
        scoped.color(ImGuiCol_Button, style.button);
        scoped.color(ImGuiCol_ButtonHovered, style.hovered);
        scoped.color(ImGuiCol_ButtonActive, style.active);
        scoped.color(ImGuiCol_Text, style.text);
        pressed = ImGui::Button(label, size);
    });
    return pressed;
}

ImVec4 badge_color(bool accent) {
    return accent ? ImVec4(0.24f, 0.52f, 0.35f, 1.0f) : ImVec4(0.22f, 0.22f, 0.24f, 1.0f);
}

void render_badge(const std::string& text, const ImVec4& color) {
    ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 999.0f);
    ImGui::PushStyleVar(ImGuiStyleVar_FramePadding, ImVec2(10.0f, 5.0f));
    ImGui::PushStyleColor(ImGuiCol_Button, color);
    ImGui::PushStyleColor(ImGuiCol_ButtonHovered, color);
    ImGui::PushStyleColor(ImGuiCol_ButtonActive, color);
    ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.94f, 0.94f, 0.96f, 1.0f));
    ImGui::Button(text.c_str());
    ImGui::PopStyleColor(4);
    ImGui::PopStyleVar(2);
}

} // namespace

PluginsPanel::PluginsPanel(core::UIRegistry& ui_registry)
    : ui_registry_(ui_registry) {
}

void PluginsPanel::render() {
    auto& plugin_host = core::PluginHost::get();
    const auto plugins = plugin_host.loaded_plugins();
    const auto plugin_roots = plugin_host.discovery_roots();

    ImGuiWindowFlags flags = ImGuiWindowFlags_NoTitleBar |
                             ImGuiWindowFlags_NoMove |
                             ImGuiWindowFlags_NoCollapse |
                             ImGuiWindowFlags_NoResize;

    ImGui::PushStyleColor(ImGuiCol_WindowBg, ImVec4(0.12f, 0.12f, 0.12f, 1.0f));
    ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(24.0f, 24.0f));

    if (ImGui::Begin("Plugins", nullptr, flags)) {
        render_header(plugins.size());
        ImGui::Spacing();
        render_plugin_roots(plugin_roots);
        ImGui::Spacing();
        if (ImGui::BeginChild("PluginsList", ImVec2(0, 0), false)) {
            if (!plugins.empty()) {
                {
                    misty::UI::WithFont(core::FontManager::get().get_font(core::FontID::ROBOTO_BOLD), [&]() {
                        ImGui::Text("Plugins");
                    });
                }
                ImGui::Spacing();
                for (const auto& plugin : plugins) {
                    render_plugin_card(plugin);
                    ImGui::Spacing();
                }
            }

            if (plugins.empty()) {
                render_empty_state(plugin_roots);
            }
            ImGui::EndChild();
        }
    }

    ImGui::End();
    ImGui::PopStyleVar();
    ImGui::PopStyleColor();
}

void PluginsPanel::render_header(std::size_t plugin_count) {
    if (ImGui::BeginTable("PluginsHeader", 2, ImGuiTableFlags_SizingStretchProp)) {
        ImGui::TableSetupColumn("Title", ImGuiTableColumnFlags_WidthStretch, 1.0f);
        ImGui::TableSetupColumn("Action", ImGuiTableColumnFlags_WidthFixed, 96.0f);
        ImGui::TableNextRow();

        ImGui::TableSetColumnIndex(0);
        {
            misty::UI::WithFont(core::FontManager::get().get_font(core::FontID::ROBOTO_BOLD_LARGE), [&]() {
                ImGui::Text("Plugins");
            });
        }
        ImGui::TextDisabled("%zu plugin", plugin_count);

        ImGui::TableSetColumnIndex(1);
        ImGui::SetCursorPosX(std::max(0.0f, ImGui::GetContentRegionAvail().x - 96.0f));
        if (styled_button("Reload", ImVec2(96.0f, 0.0f), primary_button_style())) {
            core::PluginHost::get().reload();
        }

        ImGui::EndTable();
    }
}

void PluginsPanel::render_plugin_roots(const std::vector<std::string>& roots) {
    ImGui::TextDisabled("Plugin roots");
    for (const auto& root : roots) {
        ImGui::BulletText("%s", root.c_str());
    }
}

void PluginsPanel::render_empty_state(const std::vector<std::string>& roots) {
    ImGui::PushStyleVar(ImGuiStyleVar_ChildRounding, 12.0f);
    ImGui::PushStyleColor(ImGuiCol_ChildBg, ImVec4(0.16f, 0.16f, 0.18f, 1.0f));

    if (ImGui::BeginChild("PluginsEmpty", ImVec2(0, 180.0f), true)) {
        misty::UI::WithFont(core::FontManager::get().get_font(core::FontID::ROBOTO_BOLD), [&]() {
            ImGui::Text("No plugins discovered");
        });
        ImGui::Spacing();
        ImGui::TextWrapped("Drop a plugin folder with a manifest into one of the discovery roots to make it available here.");
        if (!roots.empty()) {
            ImGui::Spacing();
            ImGui::TextDisabled("Suggested location");
            ImGui::TextWrapped("%s", roots.back().c_str());
        }
    }
    ImGui::EndChild();

    ImGui::PopStyleColor();
    ImGui::PopStyleVar();
}

void PluginsPanel::render_plugin_card(const core::PluginInfo& plugin) {
    const float base_height = 180.0f + (plugin.commands.empty() ? 0.0f : 24.0f * plugin.commands.size()) +
        (plugin.panels.empty() ? 0.0f : 24.0f * plugin.panels.size()) +
        (plugin.diagnostics.empty() ? 0.0f : 20.0f * plugin.diagnostics.size());
    const std::string card_id = "plugin_card_" + plugin.id;

    ImGui::PushStyleVar(ImGuiStyleVar_ChildRounding, 12.0f);
    ImGui::PushStyleColor(ImGuiCol_ChildBg, ImVec4(0.14f, 0.16f, 0.19f, 1.0f));

    if (ImGui::BeginChild(card_id.c_str(), ImVec2(0, base_height), true)) {
        {
            misty::UI::WithFont(core::FontManager::get().get_font(core::FontID::ROBOTO_BOLD), [&]() {
                ImGui::Text("%s", plugin.name.c_str());
            });
        }
        ImGui::SameLine();
        ImGui::TextDisabled("v%s", plugin.version.c_str());
        render_badge(plugin.bundled ? "Bundled" : "User", badge_color(plugin.bundled));
        ImGui::SameLine();
        if (plugin.verified) {
            render_badge("Verified", ImVec4(0.18f, 0.42f, 0.28f, 1.0f));
            ImGui::SameLine();
        } else if (plugin.loaded) {
            render_badge("Unsigned", ImVec4(0.28f, 0.28f, 0.18f, 1.0f));
            ImGui::SameLine();
        }
        if (plugin.faulted) {
            render_badge("Faulted", ImVec4(0.54f, 0.22f, 0.18f, 1.0f));
        } else {
            render_badge(plugin.loaded ? "Loaded" : "Rejected", badge_color(plugin.loaded));
        }

        if (!plugin.author.empty()) {
            ImGui::TextDisabled("By %s", plugin.author.c_str());
        } else {
            ImGui::TextDisabled("%s", plugin.id.c_str());
        }
        if (!plugin.signer.empty()) {
            ImGui::SameLine();
            ImGui::TextDisabled("Signer: %s", plugin.signer.c_str());
        }

        if (!plugin.description.empty()) {
            ImGui::Spacing();
            ImGui::TextWrapped("%s", plugin.description.c_str());
        }

        ImGui::Spacing();
        if (styled_button(("Sandbox##" + plugin.id).c_str(), ImVec2(130.0f, 0.0f), primary_button_style())) {
            std::string error;
            if (!core::PluginHost::get().open_plugin_sandbox(plugin.plugin_dir, &error)) {
                auto& activity = ui_registry_.get_state<ActivityState>("Activity");
                activity.add_entry("System",
                    error.empty() ? "Could not open plugin sandbox." : error,
                    ActivityEntryType::ERROR);
            }
        }

        ImGui::Spacing();
        ImGui::Separator();
        ImGui::Spacing();

        ImGui::TextDisabled("Commands");
        if (plugin.commands.empty()) {
            ImGui::TextWrapped("No commands registered.");
        } else {
            for (const auto& command : plugin.commands) {
                if (ImGui::Button((command.title + "##invoke_" + command.id).c_str())) {
                    core::PluginHost::get().invoke_command(command.id);
                }
                ImGui::SameLine();
                ImGui::TextDisabled("%s", command.default_shortcut.empty() ? command.id.c_str() : command.default_shortcut.c_str());
            }
        }

        ImGui::Spacing();
        ImGui::TextDisabled("Panels");
        if (plugin.panels.empty()) {
            ImGui::TextWrapped("No panels registered.");
        } else {
            for (const auto& panel : plugin.panels) {
                const std::string label = std::string(panel.is_open ? "Focus " : "Open ") +
                    panel.title + "##panel_" + panel.id;
                if (ImGui::Button(label.c_str())) {
                    core::PluginHost::get().open_panel(panel.id);
                }
            }
        }

        if (!plugin.diagnostics.empty()) {
            ImGui::Spacing();
            ImGui::TextDisabled("Diagnostics");
            for (const auto& diagnostic : plugin.diagnostics) {
                ImGui::BulletText("%s", diagnostic.c_str());
            }
        }

        ImGui::Spacing();
        ImGui::TextDisabled("Library");
        ImGui::TextWrapped("%s", plugin.library_path.empty() ? "(not loaded)" : plugin.library_path.c_str());
    }
    ImGui::EndChild();

    ImGui::PopStyleColor();
    ImGui::PopStyleVar();
}

std::string PluginsPanel::join_strings(const std::vector<std::string>& values) {
    std::ostringstream joined;
    for (std::size_t i = 0; i < values.size(); ++i) {
        if (i > 0) {
            joined << ", ";
        }
        joined << values[i];
    }
    return joined.str();
}

} // namespace misty::panel
