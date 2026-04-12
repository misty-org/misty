#pragma once

#include <memory>

#include "views/app_view.h"
#include "panels/profile/edit_profile_panel.h"
#include "panels/navbar/navbar_panel.h"
#include "panels/notification/notification_panel.h"
#include "core/ui/ui_registry.h"

namespace misty::view {
    class EditProfileView : public AppView {
    public:
        EditProfileView(core::UIRegistry& ui_registry);
        ~EditProfileView() override = default;

        void render() override;
        ViewID get_view_id() override;

    private:
        void init_panels();

    private:
        core::UIRegistry& ui_registry_;
        std::shared_ptr<panel::NavbarPanel> navbar_panel_;
        std::shared_ptr<panel::EditProfilePanel> edit_profile_panel_;
        std::shared_ptr<panel::NotificationPanel> notification_panel_;
    };
}
