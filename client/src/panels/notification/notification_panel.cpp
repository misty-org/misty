#include "notification_panel.h"
#include "imgui.h"

namespace misty::panel {

    NotificationPanel::NotificationPanel(core::UIRegistry& registry)
        : registry_(registry) {
    }

    void NotificationPanel::render() {
        auto& state = registry_.get_state<NotificationState>("Notifications");

        // Update to remove expired notifications
        state.update();

        auto notifications = state.get_notifications();
        if (notifications.empty()) return;

        ImGuiViewport* viewport = ImGui::GetMainViewport();

        // Calculate starting position (bottom-right corner)
        float start_x = viewport->WorkPos.x + viewport->WorkSize.x - NOTIFICATION_WIDTH - NOTIFICATION_MARGIN;
        float start_y = viewport->WorkPos.y + viewport->WorkSize.y - NOTIFICATION_MARGIN;

        // Render notifications from bottom to top
        float y_offset = 0;
        for (int i = static_cast<int>(notifications.size()) - 1; i >= 0; --i) {
            const auto& notif = notifications[i];
            render_notification(notif, y_offset);
            y_offset += NOTIFICATION_HEIGHT + NOTIFICATION_PADDING;
        }
    }

    void NotificationPanel::render_notification(const Notification& notif, float y_offset) {
        auto& state = registry_.get_state<NotificationState>("Notifications");
        ImGuiViewport* viewport = ImGui::GetMainViewport();

        float x = viewport->WorkPos.x + viewport->WorkSize.x - NOTIFICATION_WIDTH - NOTIFICATION_MARGIN;
        float y = viewport->WorkPos.y + viewport->WorkSize.y - NOTIFICATION_HEIGHT - NOTIFICATION_MARGIN - y_offset;

        ImGui::SetNextWindowPos(ImVec2(x, y), ImGuiCond_Always);
        ImGui::SetNextWindowSize(ImVec2(NOTIFICATION_WIDTH, NOTIFICATION_HEIGHT), ImGuiCond_Always);
        ImGui::SetNextWindowBgAlpha(0.95f);

        ImGuiWindowFlags flags = ImGuiWindowFlags_NoTitleBar |
                                  ImGuiWindowFlags_NoResize |
                                  ImGuiWindowFlags_NoMove |
                                  ImGuiWindowFlags_NoScrollbar |
                                  ImGuiWindowFlags_NoCollapse |
                                  ImGuiWindowFlags_NoFocusOnAppearing |
                                  ImGuiWindowFlags_NoNav |
                                  ImGuiWindowFlags_NoSavedSettings;

        // Get color based on notification type
        ImVec4 bg_color = get_notification_color(notif.type);

        ImGui::PushStyleColor(ImGuiCol_WindowBg, bg_color);
        ImGui::PushStyleVar(ImGuiStyleVar_WindowRounding, 8.0f);
        ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(12.0f, 10.0f));

        std::string window_name = "Notification_" + std::to_string(notif.id);
        ImGui::Begin(window_name.c_str(), nullptr, flags);

        // Icon and title on same line
        const char* icon = get_notification_icon(notif.type);
        ImGui::Text("%s", icon);
        ImGui::SameLine();
        ImGui::Text("%s", notif.title.c_str());

        // Message
        ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.8f, 0.8f, 0.8f, 1.0f));
        ImGui::TextWrapped("%s", notif.message.c_str());
        ImGui::PopStyleColor();

        // Close button in top-right corner
        float close_btn_size = 20.0f;
        ImGui::SetCursorPos(ImVec2(NOTIFICATION_WIDTH - close_btn_size - 20.0f, 8.0f));
        ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0, 0, 0, 0));
        ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(1, 1, 1, 0.1f));
        if (ImGui::Button(("X##close_" + std::to_string(notif.id)).c_str(), ImVec2(close_btn_size, close_btn_size))) {
            state.dismiss(notif.id);
        }
        ImGui::PopStyleColor(2);

        // Progress bar for auto-dismiss
        if (notif.duration_seconds > 0) {
            float progress = notif.get_progress();
            ImVec2 window_size = ImGui::GetWindowSize();

            ImDrawList* draw_list = ImGui::GetWindowDrawList();
            ImVec2 window_pos = ImGui::GetWindowPos();
            float bar_width = window_size.x * (1.0f - progress);
            draw_list->AddRectFilled(
                ImVec2(window_pos.x, window_pos.y + window_size.y - 3.0f),
                ImVec2(window_pos.x + bar_width, window_pos.y + window_size.y),
                IM_COL32(255, 255, 255, 100),
                0.0f
            );
        }

        ImGui::End();
        ImGui::PopStyleVar(2);
        ImGui::PopStyleColor();
    }

    ImVec4 NotificationPanel::get_notification_color(NotificationType type) {
        switch (type) {
            case NotificationType::SUCCESS:
                return ImVec4(0.15f, 0.4f, 0.15f, 0.95f);
            case NotificationType::ERROR:
                return ImVec4(0.5f, 0.15f, 0.15f, 0.95f);
            case NotificationType::DOWNLOAD:
                return ImVec4(0.15f, 0.25f, 0.4f, 0.95f);
            case NotificationType::INFO:
            default:
                return ImVec4(0.2f, 0.2f, 0.2f, 0.95f);
        }
    }

    const char* NotificationPanel::get_notification_icon(NotificationType type) {
        switch (type) {
            case NotificationType::SUCCESS:
                return "[OK]";
            case NotificationType::ERROR:
                return "[!]";
            case NotificationType::DOWNLOAD:
                return "[DL]";
            case NotificationType::INFO:
            default:
                return "[i]";
        }
    }

}
