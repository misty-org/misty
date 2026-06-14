#pragma once

#include "core/ui/state_registry.h"
#include "panels/panel/panel.h"

namespace misty::panel {

class ClipboardTransferPanel : public Panel {
public:
    explicit ClipboardTransferPanel(core::StateRegistry& registry);
    void render() override;

private:
    core::StateRegistry& registry_;
};

}  // namespace misty::panel
