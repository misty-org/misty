#include "notification_panel.h"

#include <algorithm>

#include "imgui.h"

namespace misty::panel {
namespace {

ImU32 bg_color(NotificationType type) {
    switch (type) {
        case NotificationType::SUCCESS:
            return IM_COL32(24, 58, 34, 236);
        case NotificationType::ERROR:
            return IM_COL32(74, 28, 30, 236);
        case NotificationType::INFO:
        default:
            return IM_COL32(28, 30, 34, 236);
    }
}

ImU32 border_color(NotificationType type) {
    switch (type) {
        case NotificationType::SUCCESS:
            return IM_COL32(74, 137, 85, 230);
        case NotificationType::ERROR:
            return IM_COL32(172, 70, 72, 230);
        case NotificationType::INFO:
        default:
            return IM_COL32(78, 82, 92, 230);
    }
}

std::string compact_message(const std::string& message) {
    constexpr size_t max_chars = 64;
    if (message.size() <= max_chars) {
        return message;
    }
    return message.substr(0, max_chars - 3) + "...";
}

}  // namespace

NotificationPanel::NotificationPanel(core::StateRegistry& registry)
    : registry_(registry) {}

void NotificationPanel::render_at(const ImVec2& anchor_min, const ImVec2& anchor_max) {
    auto& notifications = registry_.get_state<NotificationState>("Notifications");
    notifications.update();
    const auto items = notifications.get_notifications();
    if (items.empty()) {
        return;
    }

    ImGuiViewport* viewport = ImGui::GetMainViewport();
    ImDrawList* draw_list = ImGui::GetForegroundDrawList(viewport);
    constexpr float pad_x = 13.0f;
    constexpr float pad_y = 7.0f;
    constexpr float gap = 8.0f;
    constexpr float rounding = 10.0f;
    constexpr float max_width = 360.0f;
    const float text_height = ImGui::GetTextLineHeight();
    const float pill_height = text_height + pad_y * 2.0f;
    const Notification& item = items.back();
    const std::string text = compact_message(item.message);
    const ImVec2 text_size = ImGui::CalcTextSize(text.c_str());
    const float available_width = std::max(1.0f, anchor_max.x - anchor_min.x);
    const float anchor_max_width = std::max(1.0f, available_width - 24.0f);
    const float pill_width = std::min(std::min(max_width, anchor_max_width), text_size.x + pad_x * 2.0f);
    const float center_x = (anchor_min.x + anchor_max.x) * 0.5f;
    const float center_y = (anchor_min.y + anchor_max.y) * 0.5f;
    const float x = center_x - pill_width * 0.5f;
    const float y = center_y - pill_height * 0.5f;
    const ImVec2 min(x, y);
    const ImVec2 max(x + pill_width, y + pill_height);

    draw_list->AddRectFilled(min, max, bg_color(item.type), rounding);
    draw_list->AddRect(min, max, border_color(item.type), rounding, 0, 1.0f);
    draw_list->AddText(ImVec2(x + pad_x, y + pad_y - 1.0f),
                       IM_COL32(241, 238, 232, 255),
                       text.c_str());
}

void NotificationPanel::render() {
    auto& notifications = registry_.get_state<NotificationState>("Notifications");
    notifications.update();
    const auto items = notifications.get_notifications();
    if (items.empty()) {
        return;
    }

    ImGuiViewport* viewport = ImGui::GetMainViewport();
    ImDrawList* draw_list = ImGui::GetForegroundDrawList(viewport);
    constexpr float pad_x = 13.0f;
    constexpr float pad_y = 7.0f;
    constexpr float gap = 8.0f;
    constexpr float rounding = 10.0f;
    constexpr float max_width = 360.0f;
    const float text_height = ImGui::GetTextLineHeight();
    const float pill_height = text_height + pad_y * 2.0f;
    float bottom_y = viewport->WorkPos.y + viewport->WorkSize.y - 28.0f;

    for (auto it = items.rbegin(); it != items.rend(); ++it) {
        const std::string text = compact_message(it->message);
        const ImVec2 text_size = ImGui::CalcTextSize(text.c_str());
        const float pill_width = std::min(max_width, text_size.x + pad_x * 2.0f);
        const float x = viewport->WorkPos.x + (viewport->WorkSize.x - pill_width) * 0.5f;
        const float y = bottom_y - pill_height;
        const ImVec2 min(x, y);
        const ImVec2 max(x + pill_width, y + pill_height);

        draw_list->AddRectFilled(min, max, bg_color(it->type), rounding);
        draw_list->AddRect(min, max, border_color(it->type), rounding, 0, 1.0f);
        draw_list->AddText(ImVec2(x + pad_x, y + pad_y - 1.0f),
                           IM_COL32(241, 238, 232, 255),
                           text.c_str());

        bottom_y = y - gap;
    }
}

}  // namespace misty::panel
