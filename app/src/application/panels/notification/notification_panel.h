#pragma once

#include "core/ui_registry.h"
#include "panels/panel.h"
#include "notification_state.h"

namespace minidfs::panel {

    class NotificationPanel : public Panel {
    public:
        NotificationPanel(core::UIRegistry& registry);
        ~NotificationPanel() override = default;

        void render() override;

    private:
        void render_notification(const Notification& notif, float y_offset);
        ImVec4 get_notification_color(NotificationType type);
        const char* get_notification_icon(NotificationType type);

        core::UIRegistry& registry_;

        static constexpr float NOTIFICATION_WIDTH = 320.0f;
        static constexpr float NOTIFICATION_HEIGHT = 70.0f;
        static constexpr float NOTIFICATION_PADDING = 8.0f;
        static constexpr float NOTIFICATION_MARGIN = 16.0f;
    };

}
