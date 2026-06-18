#pragma once

#include "core/threading/worker_pool.h"
#include "core/ui/state_registry.h"
#include "panels/panel/multi_panel.h"

namespace misty::panel {

struct TransfersPanelProps {
    std::string state_key = "Transfers";
    std::string panel_id = "transfers_primary";
    bool owns_state_cleanup = false;
};

class TransfersPanel : public MultiPanel {
public:
    TransfersPanel(core::StateRegistry& registry,
                   core::WorkerPool& worker_pool,
                   TransfersPanelProps props = {});
    ~TransfersPanel() override = default;

    std::string tab_title() const override { return "Transfers"; }
    std::string save_restore_state() const override;
    void load_restore_state(const std::string& encoded_state) override;
    void release_state() override;
    TabController::Tab create_default_tab(std::int16_t tab_idx) const override;

private:
    bool shows_tab_bar(const Pane& pane) const override;
    void render_panel_contents() override;

    core::StateRegistry& registry_;
    core::WorkerPool& worker_pool_;
    std::string state_key_;
    bool owns_state_cleanup_ = false;
};

}  // namespace misty::panel
