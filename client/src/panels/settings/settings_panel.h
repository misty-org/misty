#pragma once

#include <cstddef>

#include "core/ui/ui_registry.h"
#include "panels/settings/settings_state.h"
#include "core/ui/imgui_utils.h"

namespace misty::panel {

    class SettingsPanel {
    public:
        explicit SettingsPanel(core::UIRegistry& registry);
        ~SettingsPanel() = default;

        void render();

    private:
        void divider(float height);
        void sidebar(SettingsState& state, float width);
        void section_button(SettingsSection section,
                            SettingsState& state,
                            const core::ButtonFields& fields);
        void account(SettingsState& state);
        void general();
        void content_header(const char* title);
        void group_header(const char* title);
        void settings_row(const char* label,
                          const char* value,
                          bool enabled = true,
                          bool muted_value = false);
        void profile_header(const char* display_name, const char* email, const char* note);
        bool text_input_row(const char* label,
                            char* buffer,
                            std::size_t buffer_size,
                            const char* action_label = nullptr);
        void readonly_input_row(const char* label, const char* value, const char* helper = nullptr);
        bool action_row(const char* label,
                        const char* subtitle,
                        const char* action_label,
                        bool enabled = true);

        core::UIRegistry& registry_;
    };

}
