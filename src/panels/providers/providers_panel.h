#pragma once

#include <string>

#include "core/ui/ui_registry.h"
#include "panels/panel/panel.h"
#include "panels/providers/state/providers_state.h"

using namespace misty::core;

namespace misty::panel {
    class ProvidersPanel : public Panel {
    public:
        explicit ProvidersPanel(UIRegistry& registry);
        ~ProvidersPanel() override = default;
        void render() override;

    private:
        static constexpr float kCardSpacing = 18.0f;
        static constexpr float kMinCardWidth = 280.0f;

        void sync_search_buffer(ProvidersState& state);
        void show_top_bar(ProvidersState& state, float content_width);
        void show_status_messages(ProvidersState& state);
        void show_health_card(const ProvidersHealthCard& health);
        void show_connected_providers(ProvidersState& state);
        void show_provider_card(ProvidersState& state, const ProviderCard& card, float card_width);
        void show_empty_state(bool filtered, bool loading);
        void show_provider_dialogs(ProvidersState& state);

        UIRegistry& registry_;
        char search_buf_[128] = {0};
    };
}
