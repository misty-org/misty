#include "panels/file_explorer/state/clipboard_state.h"

namespace misty::panel {

bool ClipboardState::has_content() const {
    return op != ClipboardOp::NONE && !items.empty();
}

void ClipboardState::clear() {
    op = ClipboardOp::NONE;
    paths.clear();
    items.clear();
}

}  // namespace misty::panel
