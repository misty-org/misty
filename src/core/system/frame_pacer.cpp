#include "core/system/frame_pacer.h"

#include "imgui.h"

namespace misty::core {

void FramePacer::note_focus() {
    mark_active();
}

void FramePacer::note_cursor_move() {
    mark_active();
}

void FramePacer::note_scroll() {
    mark_active();
}

void FramePacer::note_pointer_press() {
    mark_active();
}

void FramePacer::note_key_press() {
    mark_active();
}

void FramePacer::note_text_input() {
    mark_active();
}

void FramePacer::note_continuous_activity(bool pointer_button_down, bool item_active) {
    if (pointer_button_down || item_active) {
        mark_active();
    }
}

FramePacer::WaitDecision FramePacer::next_wait_decision() {
    WaitDecision decision;
    decision.mode = current_mode();
    if (decision.mode == FramePacingMode::IDLE) {
        decision.should_wait = true;
        decision.timeout_seconds = kIdleTimeoutSeconds;
    }
    return decision;
}

FramePacingMode FramePacer::current_mode() const {
    const auto now = clock::now();
    if (now < forced_active_until_) {
        return FramePacingMode::ACTIVE;
    }
    if (now - last_activity_at_ < kActiveWindow) {
        return FramePacingMode::ACTIVE;
    }
    return FramePacingMode::IDLE;
}

void FramePacer::render_debug_overlay() const {
    const FramePacingMode mode = current_mode();
    ImGuiViewport* viewport = ImGui::GetMainViewport();
    if (!viewport) {
        return;
    }

    const float pad = 16.0f;
    const ImVec2 pos(viewport->WorkPos.x + viewport->WorkSize.x - pad,
                     viewport->WorkPos.y + pad);
    const ImVec2 pivot(1.0f, 0.0f);

    ImGui::SetNextWindowPos(pos, ImGuiCond_Always, pivot);
    ImGui::SetNextWindowBgAlpha(0.82f);

    ImGuiWindowFlags flags =
        ImGuiWindowFlags_NoDecoration |
        ImGuiWindowFlags_AlwaysAutoResize |
        ImGuiWindowFlags_NoSavedSettings |
        ImGuiWindowFlags_NoFocusOnAppearing |
        ImGuiWindowFlags_NoNav |
        ImGuiWindowFlags_NoMove;

    if (ImGui::Begin("##frame_pacer_debug", nullptr, flags)) {
        ImGui::Text("Frame pacing");
        ImGui::Separator();
        ImGui::Text("Mode: %s", mode_label(mode));
        if (mode == FramePacingMode::IDLE) {
            ImGui::Text("Target: %.0f FPS", 1.0 / kIdleTimeoutSeconds);
            ImGui::Text("Wait: %.1f ms", kIdleTimeoutSeconds * 1000.0);
        } else {
            ImGui::TextUnformatted("Target: uncapped");
            ImGui::TextUnformatted("Wait: 0.0 ms");
        }
    }
    ImGui::End();
}

const char* FramePacer::mode_label(FramePacingMode mode) {
    switch (mode) {
        case FramePacingMode::IDLE:
            return "idle";
        case FramePacingMode::ACTIVE:
            return "active";
    }
    return "unknown";
}

}  // namespace misty::core
