#pragma once

#include <memory>

#include "views/app_view.h"
#include "core/manager/plugin_manager.h"
#include "panels/settings/settings_panel.h"
#include "panels/context_menu/context_menu_panel.h"
#include "panels/navbar/navbar_panel.h"
#include "panels/notification/notification_panel.h"
#include "core/ui/ui_registry.h"

namespace misty::view {
    class SettingsView : public AppView {
    public:
        SettingsView(core::UIRegistry& ui_registry);
        ~SettingsView() override = default;

        void render() override;
        ViewID get_view_id() override;
        ViewCapabilities capabilities() const override;
        PluginOpenResult open_plugin_panel(const std::string& panel_id, PluginOpenMode mode) override;

    private:
        void init_panels();

    private:
        core::UIRegistry& ui_registry_;
        std::shared_ptr<panel::NavbarPanel> navbar_panel_;
        std::shared_ptr<panel::SettingsPanel> settings_panel_;
        std::shared_ptr<panel::NotificationPanel> notification_panel_;
        std::shared_ptr<panel::ContextMenuPanel> context_menu_panel_;
    };
}
