#pragma once

#include <cstdint>

#include "core/ui/state_registry.h"
#include "panels/context_menu/context_menu_state.h"
#include "panels/panel/panel.h"

namespace misty::panel {

class ContextMenuPanel : public Panel {
public:
    explicit ContextMenuPanel(core::StateRegistry& registry);
    ~ContextMenuPanel() override = default;

    void render() override;

private:
    void render_menu_contents(ContextMenuState& state, bool& close_requested, std::uint64_t render_serial);
    void render_entry(const ContextMenuEntry& entry, bool& close_requested, std::uint64_t render_serial);

    core::StateRegistry& registry_;
};

} // namespace misty::panel
