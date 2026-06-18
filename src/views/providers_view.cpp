#include "providers_view.h"
#include "imgui.h"
#include "panels/providers/state/providers_state.h"

namespace misty::view {
    ProvidersView::ProvidersView(StateRegistry& state_registry, core::WorkerPool& worker_pool)
        : state_registry_(state_registry),
          worker_pool_(worker_pool) {
        init_panels();
    }

    void ProvidersView::init_panels() {
        state_registry_.get_state<panel::ProvidersState>("Providers").init(worker_pool_);
        navbar_panel_ = std::make_shared<panel::NavbarPanel>(state_registry_);
        providers_panel_ = std::make_shared<panel::ProvidersPanel>(state_registry_, worker_pool_);
        notification_panel_ = std::make_shared<panel::NotificationPanel>(state_registry_);
        context_menu_panel_ = std::make_shared<panel::ContextMenuPanel>(state_registry_);
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
        providers_panel_->handle_commands();
        providers_panel_->render();

        // Render notifications on top
        navbar_panel_->render_activity_popup();
        context_menu_panel_->render();
        notification_panel_->render();
    }
}
