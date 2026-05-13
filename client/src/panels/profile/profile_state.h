#pragma once

#include <string>
#include "imgui.h"
#include "core/ui/ui_registry.h"

namespace misty::panel {

    struct ProfileState : public core::UIState {
        bool is_open = false;
        ImVec2 button_min{0.0f, 0.0f};
        ImVec2 button_max{0.0f, 0.0f};
        bool has_button_rect = false;
        std::string display_name = "User";
        std::string email;
    };

} // namespace misty::panel
