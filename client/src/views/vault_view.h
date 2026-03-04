#pragma once

#include <memory>

#include "views/app_view.h"
#include "panels/context_menu/context_menu_panel.h"
#include "panels/vault/vault_panel.h"
#include "panels/navbar/navbar_panel.h"
#include "panels/notification/notification_panel.h"
#include "core/ui/ui_registry.h"
#include "core/threading/worker_pool.h"

namespace misty::view {
    // VaultView is the MVault top-level screen: navbar + vault panel + the
    // shared notification overlay. It mirrors ServicesView so the navbar
    // chrome is identical across the two side-by-side feature surfaces.
    class VaultView : public AppView {
    public:
        VaultView(core::UIRegistry& ui_registry, core::WorkerPool& worker_pool);
        ~VaultView() override = default;

        void render() override;
        ViewID get_view_id() override;

    private:
        void init_panels();

        core::UIRegistry& ui_registry_;
        core::WorkerPool& worker_pool_;
        std::shared_ptr<panel::NavbarPanel> navbar_panel_;
        std::shared_ptr<panel::VaultPanel> vault_panel_;
        std::shared_ptr<panel::NotificationPanel> notification_panel_;
        std::shared_ptr<panel::ContextMenuPanel> context_menu_panel_;
    };
}
