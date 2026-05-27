#pragma once

#include "core/ui/state_registry.h"
#include "panels/panel/multi_panel.h"
#include "panels/settings/settings_state.h"


namespace misty::panel {
    struct SettingsPanelProps {
        std::string state_key = "Settings";
        std::string panel_id = "settings_primary";
        bool owns_state_cleanup = false;
    };

    class SettingsPanel : public MultiPanel {
    public:
        explicit SettingsPanel(core::StateRegistry& registry,
                               SettingsPanelProps props = {});
        ~SettingsPanel() override = default;

        std::string save_restore_state() const override;
        void load_restore_state(const std::string& state) override;
        void release_state() override;

        TabController::Tab create_default_tab(std::int16_t tab_idx) const override;

    private:
        bool shows_tab_bar(const Pane& pane) const override;
        void render_panel_contents() override;
        void settings_content(SettingsState& state);

        void sidebar(SettingsState& state);
        void sidebar_tabs(SettingsState& state);
        void sidebar_header(SettingsState& state);

        core::StateRegistry& registry_;
        std::string state_key_;
        bool owns_state_cleanup_ = false;
        float last_scroll_x_ = 0.0f;
        float last_scroll_y_ = 0.0f;
        bool has_scroll_snapshot_ = false;
    };

}
