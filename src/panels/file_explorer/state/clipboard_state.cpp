#include "panels/file_explorer/state/clipboard_state.h"

namespace misty::panel {

bool ClipboardState::has_content() const {
    return op != ClipboardOp::NONE && !items.empty();
}

void ClipboardState::clear() {
    op = ClipboardOp::NONE;
    paths.clear();
    items.clear();
    source_state_key.clear();
    source_path.clear();
    source_listing_revision = 0;
}

}  // namespace misty::panel
