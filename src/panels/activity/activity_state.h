#pragma once

#include "core/ui/state_registry.h"
#include "imgui.h"

namespace misty::panel {

class ActivityState : public core::StateEntry {
public:
    bool is_open = false;
    ImVec2 button_min{0.0f, 0.0f};
    ImVec2 button_max{0.0f, 0.0f};
    bool has_button_rect = false;
};

}  // namespace misty::panel
