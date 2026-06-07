#pragma once

#include "core/threading/worker_pool.h"
#include "core/ui/state_registry.h"
#include "panels/panel/panel.h"

namespace misty::panel {

class TransfersPanel : public Panel {
public:
    TransfersPanel(core::StateRegistry& registry, core::WorkerPool& worker_pool);
    ~TransfersPanel() override = default;

    void render() override;

private:
    core::StateRegistry& registry_;
    core::WorkerPool& worker_pool_;
};

}  // namespace misty::panel
