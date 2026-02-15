#pragma once

#include <memory>

#include "core/ui/ui_registry.h"
#include "panels/extensions/extensions_panel.h"
#include "panels/navbar/navbar_panel.h"
#include "panels/notification/notification_panel.h"
#include "views/app_view.h"

namespace misty::view {

class ExtensionsView : public AppView {
public:
    explicit ExtensionsView(core::UIRegistry& ui_registry);
    ~ExtensionsView() override = default;

    void render() override;
    ViewID get_view_id() override;

private:
    void init_panels();

    core::UIRegistry& ui_registry_;
    std::shared_ptr<panel::NavbarPanel> navbar_panel_;
    std::shared_ptr<panel::ExtensionsPanel> extensions_panel_;
    std::shared_ptr<panel::NotificationPanel> notification_panel_;
};

} // namespace misty::view
