#include "panels/dock/dock_panel.h"

#include <algorithm>

#include "core/manager/plugin_manager.h"
#include "imgui.h"

namespace misty::panel {
namespace {
bool includes_dock_view(const core::PluginInfo& plugin) {
    return std::find(plugin.launcher_views.begin(), plugin.launcher_views.end(), "Dock") != plugin.launcher_views.end();
}

class DockLauncherPanel : public Panel {
public:
    explicit DockLauncherPanel(DockPanel& owner)
        : owner_(owner) {}

    void render() override {
        owner_.render_launcher();
    }

    std::string tab_title() const override {
        return "Plugins";
    }

private:
    DockPanel& owner_;
};

class DockPluginHostPanel : public Panel {
public:
    DockPluginHostPanel(std::string panel_id, std::string title)
        : panel_id_(std::move(panel_id)),
          title_(std::move(title)) {}

    void render() override {
        if (!core::PluginManager::get().render_panel_content(panel_id_)) {
            ImGui::TextWrapped("Plugin panel unavailable.");
        }
    }

    std::string tab_title() const override {
        return title_;
    }

private:
    std::string panel_id_;
    std::string title_;
};
} // namespace

DockPanel::DockPanel()
    : MultiPanel("dock") {}

bool DockPanel::open_plugin_panel(const std::string& panel_id) {
    if (panel_id.empty()) {
        return false;
    }

    if (activate_tab_in_active_pane(panel_id)) {
        return true;
    }

    TabController::Tab tab;
    tab.context_key = panel_id;
    tab.state_key = panel_id;
    tab.title = title_for_panel(panel_id);
    tab.idx = allocate_tab_idx();
    tab.panel = std::make_shared<DockPluginHostPanel>(panel_id, tab.title);
    return add_tab_to_active_pane(tab);
}

TabController::Tab DockPanel::create_default_tab(std::int16_t tab_idx) const {
    TabController::Tab tab;
    tab.context_key = "dock.launcher";
    tab.state_key = "dock.launcher";
    tab.title = "Plugins";
    tab.idx = tab_idx;
    tab.panel = std::make_shared<DockLauncherPanel>(const_cast<DockPanel&>(*this));
    return tab;
}

void DockPanel::render_panel_contents() {
    if (Panel* panel = active_panel()) {
        panel->render();
        return;
    }
    render_launcher();
}

bool DockPanel::shows_tab_bar(const Pane& pane) const {
    (void)pane;
    return true;
}

void DockPanel::render_launcher() {
    const auto plugins = core::PluginManager::get().loaded_plugins();
    bool found = false;

    ImGui::SetCursorPos(ImVec2(24.0f, 24.0f));
    if (ImGui::BeginChild("##dock_launcher", ImVec2(0.0f, 0.0f), false)) {
        ImGui::TextUnformatted("Plugins");
        ImGui::Spacing();

        for (const auto& plugin : plugins) {
            if (!plugin.loaded || !includes_dock_view(plugin)) {
                continue;
            }

            for (const auto& panel : plugin.panels) {
                found = true;
                const std::string label = panel.title.empty() ? plugin.name : panel.title;
                if (ImGui::Button(label.c_str(), ImVec2(220.0f, 36.0f))) {
                    open_plugin_panel(panel.id);
                }
            }
        }

        if (!found) {
            ImGui::TextWrapped("No installed plugins are loaded.");
        }
    }
    ImGui::EndChild();
}

std::string DockPanel::title_for_panel(const std::string& panel_id) const {
    const auto plugins = core::PluginManager::get().loaded_plugins();
    for (const auto& plugin : plugins) {
        for (const auto& panel : plugin.panels) {
            if (panel.id == panel_id) {
                return panel.title.empty() ? plugin.name : panel.title;
            }
        }
    }
    return panel_id;
}

} // namespace misty::panel
