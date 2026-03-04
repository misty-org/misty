#pragma once

#include <cstdint>

#include "core/ui/ui_registry.h"
#include "panels/context_menu/context_menu_state.h"
#include "panels/panel/panel.h"

namespace misty::panel {

class ContextMenuPanel : public Panel {
public:
    explicit ContextMenuPanel(core::UIRegistry& registry);
    ~ContextMenuPanel() override = default;

    void render() override;

private:
    void render_menu_contents(ContextMenuState& state, bool& close_requested, std::uint64_t render_serial);
    void render_entry(const ContextMenuEntry& entry, bool& close_requested, std::uint64_t render_serial);

    core::UIRegistry& registry_;
};

} // namespace misty::panel
