#pragma once

#include <memory>

#include "views/app_view.h"
#include "panels/activity/activity_panel.h"
#include "panels/navbar/navbar_panel.h"
#include "panels/notification/notification_panel.h"
#include "core/ui_registry.h"

namespace minidfs::view {
    class ActivityView : public AppView {
    public:
        ActivityView(core::UIRegistry& ui_registry);
        ~ActivityView() override = default;

        void render() override;
        ViewID get_view_id() override;

    private:
        void init_panels();

    private:
        core::UIRegistry& ui_registry_;
        std::shared_ptr<panel::NavbarPanel> navbar_panel_;
        std::shared_ptr<panel::ActivityPanel> activity_panel_;
        std::shared_ptr<panel::NotificationPanel> notification_panel_;
    };
}
