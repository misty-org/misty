#pragma once

#include "panels/panel.h"
#include "core/ui_registry.h"
#include "services_state.h"
#include "panels/setup/ts_panel.h"

using namespace minidfs::core;

namespace minidfs::panel {
    class ServicesPanel : public Panel {
    public:
        ServicesPanel(UIRegistry& registry);
        ~ServicesPanel() override = default;
        void render() override;

    private:
        void show_header();
        void show_cloud_section(ServicesState& state);
        void show_ms_login_modal(ServicesState& state);
        void initiate_ms_login(ServicesState& state);
        void show_filters(ServicesState& state);
        void show_devices_list(ServicesState& state);
        void show_device_item(DeviceInfo& device);
        void show_add_device_modal(ServicesState& state);
        void show_edit_device_modal(ServicesState& state);
        void show_delete_confirm_modal(ServicesState& state);

    private:
        UIRegistry& registry_;
        std::shared_ptr<TSPanel> ts_panel_;
    };
}
