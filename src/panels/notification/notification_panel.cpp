#include "notification_panel.h"
#include "imgui.h"
#include <algorithm>

namespace misty::panel {

    NotificationPanel::NotificationPanel(core::UIRegistry& registry)
        : registry_(registry) {
    }

    void NotificationPanel::render() {
        auto& state = registry_.get_state<NotificationState>("Notifications");
        state.update();

        auto notifications = state.get_notifications();
        if (notifications.empty()) return;

        ImGuiViewport* viewport = ImGui::GetMainViewport();
        float center_x = viewport->WorkPos.x + viewport->WorkSize.x * 0.5f;
        float base_y = viewport->WorkPos.y + viewport->WorkSize.y - CAPSULE_MARGIN_BOTTOM;

        float y_offset = 0.0f;
        for (int i = (int)notifications.size() - 1; i >= 0; --i) {
            render_capsule(notifications[i]);
            y_offset += CAPSULE_HEIGHT + CAPSULE_SPACING;
        }
        (void)center_x;
        (void)base_y;
        (void)y_offset;
    }

    void NotificationPanel::render_capsule(const Notification& notif) {
        ImGuiViewport* viewport = ImGui::GetMainViewport();

        // Calculate width from text content
        float text_w = ImGui::CalcTextSize(notif.message.c_str()).x;
        float capsule_w = std::min(text_w + CAPSULE_PAD_X * 2.0f, CAPSULE_MAX_WIDTH);
        capsule_w = std::max(capsule_w, 80.0f);

        float center_x = viewport->WorkPos.x + viewport->WorkSize.x * 0.5f;
        float x = center_x - capsule_w * 0.5f;
        float y = viewport->WorkPos.y + viewport->WorkSize.y - CAPSULE_HEIGHT - CAPSULE_MARGIN_BOTTOM;

        ImGui::SetNextWindowPos(ImVec2(x, y), ImGuiCond_Always);
        ImGui::SetNextWindowSize(ImVec2(capsule_w, CAPSULE_HEIGHT), ImGuiCond_Always);
        ImGui::SetNextWindowBgAlpha(0.88f);

        ImGuiWindowFlags flags =
            ImGuiWindowFlags_NoTitleBar |
            ImGuiWindowFlags_NoResize |
            ImGuiWindowFlags_NoMove |
            ImGuiWindowFlags_NoScrollbar |
            ImGuiWindowFlags_NoCollapse |
            ImGuiWindowFlags_NoFocusOnAppearing |
            ImGuiWindowFlags_NoNav |
            ImGuiWindowFlags_NoSavedSettings |
            ImGuiWindowFlags_NoInputs;

        ImGui::PushStyleColor(ImGuiCol_WindowBg, ImVec4(0.18f, 0.18f, 0.20f, 0.88f));
        ImGui::PushStyleVar(ImGuiStyleVar_WindowRounding, CAPSULE_HEIGHT * 0.5f);
        ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(CAPSULE_PAD_X, CAPSULE_PAD_Y));
        ImGui::PushStyleVar(ImGuiStyleVar_WindowBorderSize, 0.0f);

        std::string window_name = "Capsule_" + std::to_string(notif.id);
        if (ImGui::Begin(window_name.c_str(), nullptr, flags)) {
            ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.92f, 0.92f, 0.92f, 1.0f));
            // Truncate message to fit capsule width
            float avail = ImGui::GetContentRegionAvail().x;
            const char* msg = notif.message.c_str();
            ImVec2 text_sz = ImGui::CalcTextSize(msg);
            if (text_sz.x > avail) {
                // Render clipped
                ImGui::PushClipRect(
                    ImGui::GetCursorScreenPos(),
                    ImVec2(ImGui::GetCursorScreenPos().x + avail, ImGui::GetCursorScreenPos().y + text_sz.y),
                    true
                );
                ImGui::Text("%s", msg);
                ImGui::PopClipRect();
            } else {
                ImGui::Text("%s", msg);
            }
            ImGui::PopStyleColor();
        }
        ImGui::End();

        ImGui::PopStyleVar(3);
        ImGui::PopStyleColor();
    }

}
