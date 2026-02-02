#pragma once

#include "core/ui/ui_registry.h"
#include "panels/settings/settings_state.h"

namespace misty::panel {

    class SettingsPanel {
    public:
        explicit SettingsPanel(core::UIRegistry& registry);
        ~SettingsPanel() = default;

        void render();

    private:
        void render_sidebar(SettingsState& state, float width);
        void render_content(SettingsState& state);

        void render_general(SettingsState& state);
        void render_storage(SettingsState& state);
        void render_services(SettingsState& state);
        void render_server(SettingsState& state);
        void render_about(SettingsState& state);

        // Helpers
        void render_section_button(const char* label, SettingsSection section, SettingsState& state, float width);
        void render_status_bar(SettingsState& state);

        core::UIRegistry& registry_;
    };

} // namespace misty::panel
