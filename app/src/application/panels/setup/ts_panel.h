#pragma once

#include "panels/panel.h"
#include "core/ui_registry.h"
#include "ts_panel_state.h"
#include "core/svg_loader.h"

using namespace minidfs::core;

namespace minidfs::panel {
    class TSPanel : public panel::Panel {
    public:
        TSPanel(UIRegistry& registry);
        ~TSPanel() override = default;
        void render() override;

        // Render without creating a window (for use in modals)
        void render_content();
        
    private:
        void show_header();
        void show_status_message(TSPanelState& state);
        void show_login_url(TSPanelState& state);
        void show_fetch_button(TSPanelState& state);
        void show_open_browser_button(TSPanelState& state);
        void show_device_info_inputs(TSPanelState& state);
        void show_register_button(TSPanelState& state);
    private:
        UIRegistry& registry_;
    };
}
