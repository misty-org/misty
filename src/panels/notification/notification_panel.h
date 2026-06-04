#pragma once

#include "core/ui/state_registry.h"
#include "panels/panel/panel.h"
#include "notification_state.h"

struct ImVec2;

namespace misty::panel {

    class NotificationPanel : public Panel {
    public:
        NotificationPanel(core::StateRegistry& registry);
        ~NotificationPanel() override = default;

        void render() override;
        void render_at(const ImVec2& anchor_min, const ImVec2& anchor_max);

    private:
        core::StateRegistry& registry_;
    };

}
