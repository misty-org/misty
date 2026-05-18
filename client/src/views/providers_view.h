#pragma once

#include <memory>

#include "views/app_view.h"
#include "core/threading/worker_pool.h"
#include "panels/context_menu/context_menu_panel.h"
#include "panels/providers/providers_panel.h"
#include "panels/navbar/navbar_panel.h"
#include "panels/notification/notification_panel.h"
#include "core/ui/ui_registry.h"

namespace misty::view {
    class ProvidersView : public AppView {
    public:
        ProvidersView(UIRegistry& ui_registry, core::WorkerPool& worker_pool);
        ~ProvidersView() override = default;

        void render() override;
        ViewID get_view_id() override;

    private:
        void init_panels();

    private:
        UIRegistry& ui_registry_;
        core::WorkerPool& worker_pool_;
        std::shared_ptr<panel::NavbarPanel> navbar_panel_;
        std::shared_ptr<panel::ProvidersPanel> providers_panel_;
        std::shared_ptr<panel::NotificationPanel> notification_panel_;
        std::shared_ptr<panel::ContextMenuPanel> context_menu_panel_;
    };
}
