#pragma once

#include "core/file_master/file_master_transfers.h"
#include "core/ui/ui_registry.h"
#include "panels/panel/panel.h"

namespace misty::panel {

class ExplorerTransferPanel : public Panel {
public:
    explicit ExplorerTransferPanel(core::UIRegistry& registry);
    ~ExplorerTransferPanel() override = default;

    void render() override;

private:
    core::UIRegistry& registry_;
};

}  // namespace misty::panel
