#pragma once

#include "panels/panel.h"
#include "core/ui_registry.h"
#include "ts_panel_state.h"

using namespace misty::core;

namespace misty::panel {
    struct TSPanelSnapshot;
    class TSPanel : public panel::Panel {
    public:
        TSPanel(UIRegistry& registry);
        ~TSPanel() override = default;
        void render() override;

        // Render without creating a window (for use in modals)
        void render_content(TSPanelState& state, const TSPanelSnapshot& snapshot);
        
    private:
        void show_header();
        void show_status_message(const TSPanelSnapshot& snapshot);
        void show_login_url(const TSPanelSnapshot& snapshot);
        void show_fetch_button(TSPanelState& state, const TSPanelSnapshot& snapshot);
        void show_open_browser_button(const TSPanelSnapshot& snapshot);
        void show_device_info_inputs(TSPanelState& state);
        void show_register_button(TSPanelState& state, const TSPanelSnapshot& snapshot);
    private:
        UIRegistry& registry_;
    };
}
