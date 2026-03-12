#pragma once

#include "core/ui/state_registry.h"
#include "views/app_view.h"

using namespace misty::core;

namespace misty::panel {
    struct NavbarState : public StateEntry {
        view::ViewID selected_item = view::ViewID::Files;

        void handle_logo_click() {
            selected_item = view::ViewID::Files;
            view::switch_view(view::ViewID::Files);
        }

        void handle_nav_item(view::ViewID view_id) {
            selected_item = view_id;
            view::switch_view(view_id);
        }
    };
}
