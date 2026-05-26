#include "views/dock_view.h"

#include "core/ui/ui_style.h"
#include "imgui.h"

namespace misty::view {

namespace {
constexpr ImVec4 kDockPanelBg = ImVec4(0.030f, 0.045f, 0.055f, 1.0f);
}

DockView::DockView(core::StateRegistry& state_registry)
    : state_registry_(state_registry) {
    init_panels();
}

void DockView::init_panels() {
    navbar_panel_ = std::make_shared<panel::NavbarPanel>(state_registry_);
    notification_panel_ = std::make_shared<panel::NotificationPanel>(state_registry_);
    context_menu_panel_ = std::make_shared<panel::ContextMenuPanel>(state_registry_);
    dock_panel_ = std::make_shared<panel::DockPanel>();
}

ViewID DockView::get_view_id() {
    return ViewID::Dock;
}

ViewCapabilities DockView::capabilities() const {
    return {
        .tabs = true,
        .split = true,
    };
}

PluginOpenResult DockView::open_plugin_panel(const std::string& panel_id, PluginOpenMode mode) {
    (void)mode;
    return dock_panel_ && dock_panel_->open_plugin_panel(panel_id)
        ? PluginOpenResult::Opened
        : PluginOpenResult::Failed;
}

void DockView::render() {
    ImGuiViewport* viewport = ImGui::GetMainViewport();
    constexpr float navbar_width = 77.0f;
    ImVec2 navbar_pos = viewport->WorkPos;
    ImVec2 navbar_size = ImVec2(navbar_width, viewport->WorkSize.y);

    ImGui::SetNextWindowPos(navbar_pos, ImGuiCond_Always);
    ImGui::SetNextWindowSize(navbar_size, ImGuiCond_Always);
    navbar_panel_->render();

    const float sx = viewport->WorkPos.x + navbar_width;
    const float sy = viewport->WorkPos.y;
    const float sw = viewport->WorkSize.x - navbar_width;
    const float sh = viewport->WorkSize.y;

    if (ImGuiViewport* main_viewport = ImGui::GetMainViewport()) {
        ImGui::SetNextWindowViewport(main_viewport->ID);
    }

    ImGui::SetNextWindowPos(ImVec2(sx, sy), ImGuiCond_Always);
    ImGui::SetNextWindowSize(ImVec2(sw, sh), ImGuiCond_Always);
    UI::WithWindowStyle({
        .bg_color = kDockPanelBg,
    }, [&]() {
        if (dock_panel_) {
            dock_panel_->render();
        }
    });

    navbar_panel_->render_activity_popup();
    context_menu_panel_->render();
    notification_panel_->render();
}

} // namespace misty::view
