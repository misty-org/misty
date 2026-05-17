#pragma once

#include <string>

#include "core/ui/ui_registry.h"
#include "panels/panel/panel.h"
#include "panels/services/state/services_state.h"

using namespace misty::core;

namespace misty::panel {
    class ServicesPanel : public Panel {
    public:
        explicit ServicesPanel(UIRegistry& registry);
        ~ServicesPanel() override = default;
        void render() override;

    private:
        static constexpr float kCardSpacing = 18.0f;
        static constexpr float kMinCardWidth = 280.0f;

        void sync_search_buffer(ServicesState& state);
        void show_top_bar(ServicesState& state, float content_width);
        void show_health_card(const ServicesHealthCard& health);
        void show_connected_services(ServicesState& state);
        void show_service_card(ServicesState& state, const ServiceCard& card, float card_width);
        void show_empty_state(bool filtered);
        void show_placeholder_dialogs(ServicesState& state);

        UIRegistry& registry_;
        char search_buf_[128] = {0};
    };
}
