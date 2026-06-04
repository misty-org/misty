#pragma once

#include "core/ui/state_registry.h"
#include "panels/panel/panel.h"
#include "notification_state.h"

namespace misty::panel {

    class NotificationPanel : public Panel {
    public:
        NotificationPanel(core::StateRegistry& registry);
        ~NotificationPanel() override = default;

        void render() override;

    private:
        core::StateRegistry& registry_;
    };

}
