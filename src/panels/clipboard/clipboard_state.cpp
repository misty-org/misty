#include "panels/clipboard/clipboard_state.h"

namespace misty::panel {

bool ClipboardContextState::shared_available() const {
    return !latest_shared.empty();
}

void ClipboardContextState::clear_shared() {
    latest_shared = {};
}

}  // namespace misty::panel
