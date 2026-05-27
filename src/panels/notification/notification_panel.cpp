#include "notification_panel.h"

namespace misty::panel {

NotificationPanel::NotificationPanel(core::StateRegistry& registry)
    : registry_(registry) {}

void NotificationPanel::render() {
    (void)registry_;
}

}  // namespace misty::panel
