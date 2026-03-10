#pragma once

#include "views/app_view.h"
#include "core/ui/state_registry.h"

namespace misty::view {
    // ActivityView is retained as a stub. Activity is now a modal panel
    // accessible from the navbar bell button, not a dedicated view.
    class ActivityView : public AppView {
    public:
        ActivityView(core::StateRegistry& state_registry) { (void)state_registry; }
        ~ActivityView() override = default;

        void render() override {}
        ViewID get_view_id() override { return ViewID::Activity; }
    };
}
