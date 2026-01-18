#pragma once

#include "core/ui_registry.h"
#include "core/app_view_registry.h"

using namespace minidfs::core;

namespace minidfs::panel {
    struct NavbarState : public UIState {
        int selected_item = 0; // 0=Home, 1=Folders, 2=Activity, 3=More

        void handle_logo_click() {
            // Switch back to Auth view
            core::AppViewRegistryController::switch_view(view::ViewID::Auth);
        }
    };
}
