#pragma once

#include <memory>

#include "core/manager/plugin_manager.h"
#include "core/ui/ui_registry.h"
#include "panels/context_menu/context_menu_panel.h"
#include "panels/plugins/plugins_panel.h"
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
    ViewCapabilities capabilities() const override;
    PluginOpenResult open_plugin_panel(const std::string& panel_id, PluginOpenMode mode) override;

private:
    void init_panels();

    core::UIRegistry& ui_registry_;
    std::shared_ptr<panel::NavbarPanel> navbar_panel_;
    std::shared_ptr<panel::PluginsPanel> plugins_panel_;
    std::shared_ptr<panel::NotificationPanel> notification_panel_;
    std::shared_ptr<panel::ContextMenuPanel> context_menu_panel_;
};

} // namespace misty::view
