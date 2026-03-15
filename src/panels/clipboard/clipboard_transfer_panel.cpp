#include "panels/clipboard/clipboard_transfer_panel.h"

#include <algorithm>

#include "imgui.h"
#include "panels/clipboard/clipboard_transfer_state.h"

namespace misty::panel {
namespace {

const char* status_label(ClipboardTransferStatus status) {
    switch (status) {
        case ClipboardTransferStatus::Running:
            return "Preparing";
        case ClipboardTransferStatus::Succeeded:
            return "Ready";
        case ClipboardTransferStatus::Failed:
            return "Failed";
        case ClipboardTransferStatus::Idle:
        default:
            return "Clipboard";
    }
}

ImVec4 status_color(ClipboardTransferStatus status) {
    switch (status) {
        case ClipboardTransferStatus::Succeeded:
            return ImVec4(0.34f, 0.78f, 0.45f, 1.0f);
        case ClipboardTransferStatus::Failed:
            return ImVec4(0.93f, 0.35f, 0.35f, 1.0f);
        case ClipboardTransferStatus::Running:
        case ClipboardTransferStatus::Idle:
        default:
            return ImVec4(0.45f, 0.68f, 0.95f, 1.0f);
    }
}

ImVec2 detached_window_pos() {
    const ImGuiViewport* viewport = ImGui::GetMainViewport();
    constexpr float width = 340.0f;
    constexpr float margin = 24.0f;
    const float x = viewport->WorkPos.x + viewport->WorkSize.x - width - margin;
    const float y = viewport->WorkPos.y + 72.0f;
    return ImVec2(std::max(viewport->WorkPos.x + margin, x), y);
}

}  // namespace

ClipboardTransferPanel::ClipboardTransferPanel(core::StateRegistry& registry)
    : registry_(registry) {}

void ClipboardTransferPanel::render() {
    auto& state = registry_.get_state<ClipboardTransferState>(kClipboardTransferStateKey);
    state.tick();

    const ClipboardTransferSnapshot snapshot = state.snapshot();
    if (!snapshot.visible) {
        return;
    }

    ImGuiWindowClass window_class;
    window_class.ViewportFlagsOverrideSet =
        ImGuiViewportFlags_NoAutoMerge |
        ImGuiViewportFlags_NoTaskBarIcon |
        ImGuiViewportFlags_TopMost;
    window_class.ViewportFlagsOverrideClear = ImGuiViewportFlags_NoDecoration;
    ImGui::SetNextWindowClass(&window_class);
    ImGui::SetNextWindowSize(ImVec2(340.0f, 0.0f), ImGuiCond_Always);
    ImGui::SetNextWindowPos(detached_window_pos(), ImGuiCond_Appearing);

    bool open = true;
    const ImGuiWindowFlags flags =
        ImGuiWindowFlags_NoDocking |
        ImGuiWindowFlags_NoTitleBar |
        ImGuiWindowFlags_NoCollapse |
        ImGuiWindowFlags_NoSavedSettings |
        ImGuiWindowFlags_AlwaysAutoResize;
    if (!ImGui::Begin("Clipboard Transfer", &open, flags)) {
        ImGui::End();
        return;
    }

    if (!open) {
        state.dismiss();
        ImGui::End();
        return;
    }

    ImGui::TextUnformatted(snapshot.title.empty() ? "Preparing clipboard" : snapshot.title.c_str());
    ImGui::SameLine();
    ImGui::TextColored(status_color(snapshot.status), "%s", status_label(snapshot.status));

    if (!snapshot.detail.empty()) {
        ImGui::Spacing();
        ImGui::TextWrapped("%s", snapshot.detail.c_str());
    }

    if (!snapshot.current_item.empty()) {
        ImGui::TextDisabled("%s", snapshot.current_item.c_str());
    }

    const bool determinate = snapshot.total_items > 0;
    const float progress = snapshot.status == ClipboardTransferStatus::Running
        ? (determinate ? snapshot.progress : -1.0f)
        : (snapshot.status == ClipboardTransferStatus::Succeeded ? 1.0f : snapshot.progress);
    ImGui::Spacing();
    if (determinate) {
        const std::string overlay =
            std::to_string(snapshot.completed_items) + " / " + std::to_string(snapshot.total_items);
        ImGui::ProgressBar(std::clamp(progress, 0.0f, 1.0f), ImVec2(-1.0f, 0.0f), overlay.c_str());
    } else {
        ImGui::ProgressBar(progress, ImVec2(-1.0f, 0.0f), "");
    }

    if (snapshot.status != ClipboardTransferStatus::Running) {
        ImGui::Spacing();
        if (ImGui::Button("Close")) {
            state.dismiss();
        }
    }

    ImGui::End();
}

}  // namespace misty::panel
