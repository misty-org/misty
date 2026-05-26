#pragma once

#include "core/ui/state_registry.h"
#include "panels/panel/panel.h"

namespace misty::panel {

class TransfersPanel : public Panel {
public:
    explicit TransfersPanel(core::StateRegistry& registry);
    ~TransfersPanel() override = default;

    void render() override;

private:
    core::StateRegistry& registry_;
};

}  // namespace misty::panel
