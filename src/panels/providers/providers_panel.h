#pragma once

#include <string>

#include "core/ui/state_registry.h"
#include "panels/panel/multi_panel.h"
#include "panels/providers/state/providers_state.h"

using namespace misty::core;

namespace misty::panel {
    struct ProvidersPanelProps {
        std::string state_key = "ProvidersWorkspace";
        std::string panel_id = "providers_primary";
        bool owns_state_cleanup = false;
    };

    class ProvidersPanel : public MultiPanel {
    public:
        explicit ProvidersPanel(StateRegistry& registry,
                                core::WorkerPool& worker_pool,
                                ProvidersPanelProps props = {});
        ~ProvidersPanel() override = default;
        std::string tab_title() const override { return "Providers"; }
        std::string save_restore_state() const override;
        void load_restore_state(const std::string& state) override;
        void release_state() override;
        std::string close_warning() const override;
        TabController::Tab create_default_tab(std::int16_t tab_idx) const override;

    private:
        bool shows_tab_bar(const Pane& pane) const override;
        void render_panel_contents() override;
        void sync_search_buffer(ProvidersState& state);
        void show_top_bar(ProvidersState& state, float content_width);
        void show_status_messages(ProvidersState& state);
        void show_provider_dialogs(ProvidersState& state);

        StateRegistry& registry_;
        core::WorkerPool& worker_pool_;
        std::string state_key_;
        bool owns_state_cleanup_ = false;
        std::string pending_restore_remote_;
        char search_buf_[128] = {0};
    };
}
