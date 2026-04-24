#pragma once

namespace misty::panel {

// Global overlay panel for cross-view error states.
// Call render() once per frame from the main loop, after render_current_view().
class ErrorsPanel {
public:
    void render();

private:
    void render_session_expired();
};

} // namespace misty::panel
