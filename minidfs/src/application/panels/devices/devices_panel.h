#pragma once

#include "panels/panel.h"
#include "core/ui_registry.h"
#include "devices_state.h"
#include "panels/setup/ts_panel.h"

using namespace minidfs::core;

namespace minidfs::panel {
    class DevicesPanel : public Panel {
    public:
        DevicesPanel(UIRegistry& registry);
        ~DevicesPanel() override = default;
        void render() override;

    private:
        void show_header();
        void show_filters(DevicesState& state);
        void show_devices_list(DevicesState& state);
        void show_device_item(DeviceInfo& device);
        void show_add_device_modal(DevicesState& state);
        void show_edit_device_modal(DevicesState& state);
        void show_delete_confirm_modal(DevicesState& state);
        
    private:
        UIRegistry& registry_;
        std::shared_ptr<TSPanel> ts_panel_;
    };
}
