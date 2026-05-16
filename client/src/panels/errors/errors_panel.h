#pragma once

#include "panels/panel/panel.h"

namespace misty::panel {

// Global overlay panel for cross-view error states.
// Call render() once per frame from the main loop, after render_current_view().
class ErrorsPanel : public Panel {
public:
    void render();

private:
    void session_expired();
};

} // namespace misty::panel
