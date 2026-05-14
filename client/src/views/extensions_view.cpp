#include "views/extensions_view.h"

#include "imgui.h"

namespace misty::view {

ExtensionsView::ExtensionsView(core::UIRegistry& ui_registry)
    : ui_registry_(ui_registry) {
    init_panels();
}

void ExtensionsView::init_panels() {
    navbar_panel_ = std::make_shared<panel::NavbarPanel>(ui_registry_);
    plugins_panel_ = std::make_shared<panel::PluginsPanel>(ui_registry_);
    notification_panel_ = std::make_shared<panel::NotificationPanel>(ui_registry_);
}

ViewID ExtensionsView::get_view_id() {
    return ViewID::Extensions;
}

ViewCapabilities ExtensionsView::capabilities() const {
    return {
        .tabs = true,
        .split = false,
    };
}

PluginOpenResult ExtensionsView::open_plugin_panel(const std::string& panel_id, PluginOpenMode mode) {
    if (mode == PluginOpenMode::Split) {
        return PluginOpenResult::Unsupported;
    }
    return core::PluginManager::get().open_panel(panel_id)
        ? PluginOpenResult::Opened
        : PluginOpenResult::Failed;
}

void ExtensionsView::render() {
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

    notification_panel_->render();
}

} // namespace misty::view
