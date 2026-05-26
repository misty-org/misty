#pragma once

#include <memory>

#include "core/ui/state_registry.h"
#include "panels/context_menu/context_menu_panel.h"
#include "panels/navbar/navbar_panel.h"
#include "panels/notification/notification_panel.h"
#include "panels/transfers/transfers_panel.h"
#include "views/app_view.h"

namespace misty::view {

class TransfersView : public AppView {
public:
    explicit TransfersView(core::StateRegistry& state_registry);
    ~TransfersView() override = default;

    void render() override;
    ViewID get_view_id() override;

private:
    void init_panels();

    core::StateRegistry& state_registry_;
    std::shared_ptr<panel::NavbarPanel> navbar_panel_;
    std::shared_ptr<panel::NotificationPanel> notification_panel_;
    std::shared_ptr<panel::ContextMenuPanel> context_menu_panel_;
    std::shared_ptr<panel::TransfersPanel> transfers_panel_;
};

} // namespace misty::view
