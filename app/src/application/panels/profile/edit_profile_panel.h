#pragma once

#include "core/ui/ui_registry.h"

namespace misty::panel {

    class EditProfilePanel {
    public:
        explicit EditProfilePanel(core::UIRegistry& registry);
        ~EditProfilePanel() = default;

        void render();

    private:
        core::UIRegistry& registry_;

        // Editable buffers (copied from ProfileState on entry)
        char edit_name_[128] = {};
        char edit_email_[256] = {};
        bool buffers_initialized_ = false;
    };

} // namespace misty::panel
