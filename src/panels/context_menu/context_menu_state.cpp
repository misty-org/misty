#include "panels/context_menu/context_menu_state.h"

#include <utility>

namespace misty::panel {

ContextMenuEntry ContextMenuEntry::separator() {
    ContextMenuEntry entry;
    entry.kind = Kind::Separator;
    entry.id = "separator";
    return entry;
}

void ContextMenuState::open(ContextMenuRequest request) {
    is_open = !request.entries.empty();
    anchor_pos = request.anchor_pos;
    viewport_id = request.viewport_id;
    source_key = std::move(request.source_key);
    entries = std::move(request.entries);
    opened_frame = ImGui::GetFrameCount();
    ++request_serial;
}

void ContextMenuState::close() {
    is_open = false;
    source_key.clear();
    entries.clear();
}

} // namespace misty::panel
