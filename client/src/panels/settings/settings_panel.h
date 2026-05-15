#pragma once

#include "core/ui/ui_registry.h"
#include "panels/panel/multi_panel.h"
#include "panels/settings/settings_state.h"


namespace misty::panel {
    struct SettingsPanelProps {
        std::string state_key = "Settings";
        std::string panel_id = "settings_primary";
    };

    class SettingsPanel : public MultiPanel {
    public:
        explicit SettingsPanel(core::UIRegistry& registry,
                               SettingsPanelProps props = {});
        ~SettingsPanel() = default;

        TabController::Tab create_default_tab(std::int16_t tab_idx) const override;

    private:
        void render_panel_contents() override;
        void settings_content(SettingsState& state);

        void sidebar(SettingsState& state);
        void sidebar_tabs(SettingsState& state);
        void sidebar_header(SettingsState& state);

        core::UIRegistry& registry_;
        std::string state_key_;
    };

}
