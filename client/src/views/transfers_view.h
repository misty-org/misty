#pragma once

#include <memory>

#include "core/ui/ui_registry.h"
#include "panels/navbar/navbar_panel.h"
#include "panels/notification/notification_panel.h"
#include "panels/transfers/transfer_window_panel.h"
#include "views/app_view.h"

namespace misty::view {

class TransfersView : public AppView {
public:
    explicit TransfersView(core::UIRegistry& ui_registry);
    ~TransfersView() override = default;

    void render() override;
    ViewID get_view_id() override;

private:
    void init_panels();

    core::UIRegistry& ui_registry_;
    std::shared_ptr<panel::NavbarPanel> navbar_panel_;
    std::shared_ptr<panel::NotificationPanel> notification_panel_;
    std::shared_ptr<panel::TransferWindowPanel> transfer_window_panel_;
};

} // namespace misty::view
