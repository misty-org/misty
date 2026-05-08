#pragma once

#include "core/ui/ui_registry.h"
#include "panels/settings/settings_state.h"


namespace misty::panel {

    class SettingsPanel {
    public:
        explicit SettingsPanel(core::UIRegistry& registry)
            : registry_(registry) {}
        ~SettingsPanel() = default;

        void render();



    private:
        void settings_content(SettingsState& state);

        void sidebar(SettingsState& state);
        void sidebar_tabs(SettingsState& state);
        void sidebar_header(SettingsState& state);

        core::UIRegistry& registry_;
    };

}
