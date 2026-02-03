#pragma once

#include "core/ui_registry.h"

namespace misty::panel {

    class ProfilePanel {
    public:
        explicit ProfilePanel(core::UIRegistry& registry);
        ~ProfilePanel() = default;

        void render();

    private:
        core::UIRegistry& registry_;
    };

} // namespace misty::panel
