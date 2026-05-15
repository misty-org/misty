#include "panels/claude/claude_panel.h"

namespace misty::panel {

ClaudePanel::ClaudePanel(core::UIRegistry& registry, core::WorkerPool& worker_pool)
    : registry_(registry), worker_pool_(worker_pool) {
    (void)registry_;
    (void)worker_pool_;
}

void ClaudePanel::render() {
    if (!is_open_) {
        return;
    }

    ImGui::SetCursorPos(ImVec2(16.0f, 16.0f));
    ImGui::TextUnformatted("Claude");
    ImGui::Spacing();
    ImGui::TextDisabled("Claude tools are not available in this build.");
    if (!working_dir_.empty()) {
        ImGui::Spacing();
        ImGui::TextWrapped("Working directory: %s", working_dir_.c_str());
    }
}

void ClaudePanel::toggle() {
    is_open_ = !is_open_;
}

bool ClaudePanel::is_open() const {
    return is_open_;
}

void ClaudePanel::set_working_dir(const std::string& working_dir) {
    working_dir_ = working_dir;
}

}  // namespace misty::panel
