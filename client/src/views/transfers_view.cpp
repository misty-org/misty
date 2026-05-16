#include "transfers_view.h"

#include "imgui.h"

namespace misty::view {

TransfersView::TransfersView(core::UIRegistry& ui_registry)
    : ui_registry_(ui_registry) {
    init_panels();
}

void TransfersView::init_panels() {
    navbar_panel_ = std::make_shared<panel::NavbarPanel>(ui_registry_);
    notification_panel_ = std::make_shared<panel::NotificationPanel>(ui_registry_);
    context_menu_panel_ = std::make_shared<panel::ContextMenuPanel>(ui_registry_);
    transfers_panel_ = std::make_shared<panel::TransfersPanel>(ui_registry_);
}

ViewID TransfersView::get_view_id() {
    return ViewID::Transfers;
}

void TransfersView::render() {
    ImGuiViewport* viewport = ImGui::GetMainViewport();
    const float navbar_width = 77.0f;

    ImGui::SetNextWindowPos(viewport->WorkPos, ImGuiCond_Always);
    ImGui::SetNextWindowSize(ImVec2(navbar_width, viewport->WorkSize.y), ImGuiCond_Always);
    navbar_panel_->render();

    const float sx = viewport->WorkPos.x + navbar_width;
    const float sy = viewport->WorkPos.y;
    const float sw = viewport->WorkSize.x - navbar_width;
    const float sh = viewport->WorkSize.y;
    ImGui::SetNextWindowPos(ImVec2(sx, sy), ImGuiCond_Always);
    ImGui::SetNextWindowSize(ImVec2(sw, sh), ImGuiCond_Always);
    ImGui::SetNextWindowViewport(viewport->ID);
    transfers_panel_->render();
    context_menu_panel_->render();
    notification_panel_->render();
}

} // namespace misty::view
