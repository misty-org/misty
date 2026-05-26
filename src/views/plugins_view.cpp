#include "views/plugins_view.h"

#include "imgui.h"

namespace misty::view {

PluginsView::PluginsView(core::StateRegistry& state_registry)
    : state_registry_(state_registry) {
    init_panels();
}

void PluginsView::init_panels() {
    navbar_panel_ = std::make_shared<panel::NavbarPanel>(state_registry_);
    plugins_panel_ = std::make_shared<panel::PluginsPanel>(state_registry_);
    notification_panel_ = std::make_shared<panel::NotificationPanel>(state_registry_);
    context_menu_panel_ = std::make_shared<panel::ContextMenuPanel>(state_registry_);
}

ViewID PluginsView::get_view_id() {
    return ViewID::Plugins;
}

ViewCapabilities PluginsView::capabilities() const {
    return {
        .tabs = true,
        .split = false,
    };
}

PluginOpenResult PluginsView::open_plugin_panel(const std::string& panel_id, PluginOpenMode mode) {
    if (mode == PluginOpenMode::Split) {
        return PluginOpenResult::Unsupported;
    }
    return core::PluginManager::get().open_panel(panel_id)
        ? PluginOpenResult::Opened
        : PluginOpenResult::Failed;
}

void PluginsView::render() {
    ImGuiViewport* viewport = ImGui::GetMainViewport();
    float navbar_width = 77.0f;
    ImVec2 navbar_pos = viewport->WorkPos;
    ImVec2 navbar_size = ImVec2(navbar_width, viewport->WorkSize.y);

    ImGui::SetNextWindowPos(navbar_pos, ImGuiCond_Always);
    ImGui::SetNextWindowSize(navbar_size, ImGuiCond_Always);
    navbar_panel_->render();

    float sx = viewport->WorkPos.x + navbar_width;
    float sy = viewport->WorkPos.y;
    float sw = viewport->WorkSize.x - navbar_width;
    float sh = viewport->WorkSize.y;

    ImGui::SetNextWindowPos(ImVec2(sx, sy), ImGuiCond_Always);
    ImGui::SetNextWindowSize(ImVec2(sw, sh), ImGuiCond_Always);
    plugins_panel_->render();

    navbar_panel_->render_activity_popup();
    context_menu_panel_->render();
    notification_panel_->render();
}

} // namespace misty::view
