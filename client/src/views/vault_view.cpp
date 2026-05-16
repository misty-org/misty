#include "vault_view.h"
#include "panels/vault/vault_state.h"
#include "imgui.h"

namespace misty::view {
    VaultView::VaultView(core::UIRegistry& ui_registry, core::WorkerPool& worker_pool)
        : ui_registry_(ui_registry), worker_pool_(worker_pool) {
        init_panels();
    }

    void VaultView::init_panels() {
        navbar_panel_       = std::make_shared<panel::NavbarPanel>(ui_registry_);
        vault_panel_        = std::make_shared<panel::VaultPanel>(ui_registry_);
        notification_panel_ = std::make_shared<panel::NotificationPanel>(ui_registry_);
        context_menu_panel_ = std::make_shared<panel::ContextMenuPanel>(ui_registry_);

        // Wire the worker pool into the vault state on first construction so
        // refreshes / SSE consumers have a thread to run on. Subsequent calls
        // are idempotent (init() short-circuits if a pool is already set).
        ui_registry_.get_state<panel::VaultState>("Vault").init(worker_pool_);
    }

    ViewID VaultView::get_view_id() {
        return ViewID::Vault;
    }

    void VaultView::render() {
        ImGuiViewport* viewport = ImGui::GetMainViewport();
        float navbar_width = 77.0f;

        ImGui::SetNextWindowPos(viewport->WorkPos, ImGuiCond_Always);
        ImGui::SetNextWindowSize(ImVec2(navbar_width, viewport->WorkSize.y), ImGuiCond_Always);
        navbar_panel_->render();

        float sx = viewport->WorkPos.x + navbar_width;
        float sy = viewport->WorkPos.y;
        float sw = viewport->WorkSize.x - navbar_width;
        float sh = viewport->WorkSize.y;
        ImGui::SetNextWindowPos(ImVec2(sx, sy), ImGuiCond_Always);
        ImGui::SetNextWindowSize(ImVec2(sw, sh), ImGuiCond_Always);
        vault_panel_->render();

        context_menu_panel_->render();
        notification_panel_->render();
    }
}
