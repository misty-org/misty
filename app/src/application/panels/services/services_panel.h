#pragma once

#include <string>
#include "panels/panel.h"
#include "core/ui/ui_registry.h"
#include "services_state.h"

using namespace misty::core;

namespace misty::panel {
    class ServicesPanel : public Panel {
    public:
        ServicesPanel(UIRegistry& registry);
        ~ServicesPanel() override = default;
        void render() override;

    private:
        void show_header(ServicesState& state);
        void show_cloud_section(ServicesState& state);
        void show_remote_cards(ServicesState& state);
        void show_add_account_section(ServicesState& state);
        void show_login_modal(ServicesState& state);
        void show_config_flow_modal(ServicesState& state);
        void show_remote_card(ServicesState& state, const RemoteConnection& conn, float card_width);
        void show_loading_overlay();
        void show_disconnect_confirm_modal(ServicesState& state);
        void show_rename_remote_modal(ServicesState& state);

        // Supported provider types for "Add Account" buttons
        struct ProviderInfo {
            std::string type;          // rclone type: "onedrive", "drive", "dropbox", etc.
            std::string display_name;  // UI label
        };
        static const std::vector<ProviderInfo>& supported_providers();

    private:
        static constexpr float kMinCardWidth = 230.0f;
        static constexpr float kCardSpacing = 14.0f;
        UIRegistry& registry_;
        char remote_search_buf_[128] = {0};
        char provider_search_buf_[128] = {0};
        char rename_remote_buf_[128] = {0};

        // Pending disconnect confirmation
        std::string pending_disconnect_remote_;
        std::string pending_rename_remote_;
    };
}
