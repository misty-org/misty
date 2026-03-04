#pragma once

#include "core/ui/ui_registry.h"
#include "panels/panel/panel.h"

namespace misty::panel {

class TransfersPanel : public Panel {
public:
    explicit TransfersPanel(core::UIRegistry& registry);
    ~TransfersPanel() override = default;

    void render() override;

private:
    core::UIRegistry& registry_;
};

}  // namespace misty::panel
