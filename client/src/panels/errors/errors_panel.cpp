#include "panels/errors/errors_panel.h"

#include "core/manager/session_manager.h"
#include "views/app_view.h"

namespace misty::panel {

void ErrorsPanel::render() {
    session_expired();
}

void ErrorsPanel::session_expired() {
    if (!core::SessionManager::get().is_session_expired()) {
        return;
    }

    show_error_modal({
        .is_open = true,
        .modal_id = "SessionExpiredError",
        .title = "Session Expired",
        .message = "Your session has expired and could not be renewed. Please log in again to continue.",
        .confirm_label = "Log In Again",
        .icon_name = "lock-24",
        .icon_size = 32.0f,
        .dismissible = false,
        .on_confirm = []() {
            core::SessionManager::get().clear_token();
            core::SessionManager::get().clear_session_expired();
            view::switch_view(view::ViewID::Login);
        },
    });
}

} // namespace misty::panel
