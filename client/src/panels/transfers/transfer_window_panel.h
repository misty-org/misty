#pragma once

#include <string>

#include "panels/panel/panel.h"

namespace misty::core {
class UIRegistry;
}

namespace misty::panel {

class TransferWindowPanel : public Panel {
public:
    explicit TransferWindowPanel(core::UIRegistry& registry);
    ~TransferWindowPanel() override = default;

    void render() override;

private:
    core::UIRegistry& registry_;
};

}  // namespace misty::panel
