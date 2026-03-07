#pragma once

#include "core/ui/ui_registry.h"
#include "panels/panel/panel.h"
#include "notification_state.h"

namespace misty::panel {

    class NotificationPanel : public Panel {
    public:
        NotificationPanel(core::UIRegistry& registry);
        ~NotificationPanel() override = default;

        void render() override;

    private:
        void render_capsule(const Notification& notif);

        core::UIRegistry& registry_;

        static constexpr float CAPSULE_HEIGHT = 32.0f;
        static constexpr float CAPSULE_MAX_WIDTH = 300.0f;
        static constexpr float CAPSULE_PAD_X = 16.0f;
        static constexpr float CAPSULE_PAD_Y = 7.0f;
        static constexpr float CAPSULE_MARGIN_BOTTOM = 20.0f;
        static constexpr float CAPSULE_SPACING = 6.0f;
    };

}
