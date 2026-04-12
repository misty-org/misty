#pragma once

#include <string>
#include "core/ui/ui_registry.h"

namespace misty::panel {

    struct ProfileState : public core::UIState {
        bool is_open = false;
        std::string display_name = "User";
        std::string email;
    };

} // namespace misty::panel
