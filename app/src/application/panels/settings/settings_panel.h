#pragma once

#include <string>

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

        void render_account(SettingsState& state);
        void render_general(SettingsState& state);
        void render_sync(SettingsState& state);
        void render_vault(SettingsState& state);
        void render_storage(SettingsState& state);
        void render_connection(SettingsState& state);
        void render_shortcuts(SettingsState& state);
        void render_about(SettingsState& state);

        // Helpers
        void render_section_button(const char* label, SettingsSection section, SettingsState& state, float width);
        void render_section_header(const char* title);
        void render_section_subtitle(const char* subtitle);
        void render_section_intro(const char* title, const char* subtitle);
        void render_subsection_header(const char* title);
        void render_value_row(const char* label, const std::string& value);
        void render_toggle_row(const char* label, const char* subtitle, bool& value);
        bool render_action_row(const char* label, const char* subtitle, const char* action_label,
                               float action_width = 132.0f, bool primary = false, bool danger = false);
        void render_status_bar(SettingsState& state);
        void sync_account_buffers(SettingsState& state);
        void ensure_connection_config_loaded(SettingsState& state);
        void set_status(SettingsState& state, std::string message, float seconds = 3.0f, bool is_error = false);

        core::UIRegistry& registry_;
    };

} // namespace misty::panel
