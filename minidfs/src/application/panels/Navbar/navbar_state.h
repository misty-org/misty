#pragma once

#include "core/ui_registry.h"
#include "views/app_view.h"

using namespace minidfs::core;

namespace minidfs::panel {
    struct NavbarState : public UIState {
        view::ViewID selected_item = view::ViewID::FileExplorer;

        void handle_logo_click() {
            // Switch back to Auth view
            view::switch_view(view::ViewID::Auth);
        }

        void handle_nav_item(view::ViewID view_id) {
            selected_item = view_id;
            view::switch_view(view_id);
        }
    };
}
