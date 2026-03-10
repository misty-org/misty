#include "settings_view.h"
#include "core/commands/command_manager.h"
#include "imgui.h"

namespace misty::view {
    SettingsView::SettingsView(core::StateRegistry& state_registry)
        : state_registry_(state_registry) {
        init_panels();
    }

    void SettingsView::init_panels() {
        navbar_panel_ = std::make_shared<panel::NavbarPanel>(state_registry_);
        settings_panel_ = std::make_shared<panel::SettingsPanel>(state_registry_);
        notification_panel_ = std::make_shared<panel::NotificationPanel>(state_registry_);
        context_menu_panel_ = std::make_shared<panel::ContextMenuPanel>(state_registry_);
    }

    ViewID SettingsView::get_view_id() {
        return ViewID::Settings;
    }

    ViewCapabilities SettingsView::capabilities() const {
        return {
            .tabs = true,
            .split = true,
        };
    }

    PluginOpenResult SettingsView::open_plugin_panel(const std::string& panel_id, PluginOpenMode mode) {
        if (mode == PluginOpenMode::Split) {
            return PluginOpenResult::Unsupported;
        }
        return core::PluginManager::get().open_panel(panel_id)
            ? PluginOpenResult::Opened
            : PluginOpenResult::Failed;
    }

    void SettingsView::render() {
        ImGuiViewport* viewport = ImGui::GetMainViewport();
        float navbar_width = 77.0f;

        // Navbar on the left
        ImVec2 navbar_pos = viewport->WorkPos;
        ImVec2 navbar_size = ImVec2(navbar_width, viewport->WorkSize.y);

        ImGui::SetNextWindowPos(navbar_pos, ImGuiCond_Always);
        ImGui::SetNextWindowSize(navbar_size, ImGuiCond_Always);
        navbar_panel_->render();

        // Settings panel takes the rest
        float sx = viewport->WorkPos.x + navbar_width;
        float sy = viewport->WorkPos.y;
        float sw = viewport->WorkSize.x - navbar_width;
        float sh = viewport->WorkSize.y;

        settings_panel_->handle_commands();

        ImGui::SetNextWindowPos(ImVec2(sx, sy), ImGuiCond_Always);
        ImGui::SetNextWindowSize(ImVec2(sw, sh), ImGuiCond_Always);
        settings_panel_->render();

        // Render notifications on top
        navbar_panel_->render_activity_popup();
        context_menu_panel_->render();
        notification_panel_->render();
    }
}
