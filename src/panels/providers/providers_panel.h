#pragma once

#include <string>

#include "core/ui/state_registry.h"
#include "panels/panel/panel.h"
#include "panels/providers/state/providers_state.h"

using namespace misty::core;

namespace misty::panel {
    class ProvidersPanel : public Panel {
    public:
        explicit ProvidersPanel(StateRegistry& registry);
        ~ProvidersPanel() override = default;
        void render() override;

    private:
        void sync_search_buffer(ProvidersState& state);
        void show_top_bar(ProvidersState& state, float content_width);
        void show_status_messages(ProvidersState& state);
        void show_provider_dialogs(ProvidersState& state);

        StateRegistry& registry_;
        char search_buf_[128] = {0};
    };
}
