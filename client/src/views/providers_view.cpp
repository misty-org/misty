#include "providers_view.h"
#include "imgui.h"
#include "panels/providers/state/providers_state.h"

namespace misty::view {
    ProvidersView::ProvidersView(UIRegistry& ui_registry, core::WorkerPool& worker_pool)
        : ui_registry_(ui_registry),
          worker_pool_(worker_pool) {
        init_panels();
    }

    void ProvidersView::init_panels() {
        ui_registry_.get_state<panel::ProvidersState>("Providers").init(worker_pool_);
        navbar_panel_ = std::make_shared<panel::NavbarPanel>(ui_registry_);
        providers_panel_ = std::make_shared<panel::ProvidersPanel>(ui_registry_);
        notification_panel_ = std::make_shared<panel::NotificationPanel>(ui_registry_);
        context_menu_panel_ = std::make_shared<panel::ContextMenuPanel>(ui_registry_);
    }

    ViewID ProvidersView::get_view_id() {
        return ViewID::Providers;
    }

    void ProvidersView::render() {
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
        providers_panel_->render();

        // Render notifications on top
        context_menu_panel_->render();
        notification_panel_->render();
    }
}
