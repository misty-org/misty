#include "activity_panel.h"

#include <ctime>
#include <iomanip>
#include <sstream>

#include "core/ui/ui_helper.h"
#include "imgui.h"
#include "imgui_internal.h"

namespace misty::panel {
namespace {

constexpr ImVec4 kPanelBg(0.043f, 0.051f, 0.059f, 1.0f);
constexpr ImVec4 kPanelBorder(0.153f, 0.153f, 0.165f, 1.0f);
constexpr ImVec4 kText(0.945f, 0.933f, 0.910f, 1.0f);
constexpr ImVec4 kMutedText(0.788f, 0.769f, 0.737f, 1.0f);
constexpr ImVec4 kDimText(0.620f, 0.596f, 0.561f, 1.0f);

ImU32 rgba(float r, float g, float b, float a) {
    return ImGui::ColorConvertFloat4ToU32(ImVec4(r, g, b, a));
}

ImVec4 dot_color(NotificationType type) {
    switch (type) {
        case NotificationType::SUCCESS:
            return ImVec4(0.42f, 0.72f, 0.47f, 1.0f);
        case NotificationType::ERROR:
            return ImVec4(0.82f, 0.34f, 0.34f, 1.0f);
        case NotificationType::INFO:
        default:
            return ImVec4(0.60f, 0.63f, 0.70f, 1.0f);
    }
}

bool compact_button(const char* label, bool selected, const ImVec2& size) {
    ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 6.0f);
    ImGui::PushStyleVar(ImGuiStyleVar_FramePadding, ImVec2(10.0f, 5.0f));
    ImGui::PushStyleColor(ImGuiCol_Button, selected ? ImVec4(0.153f, 0.153f, 0.165f, 1.0f)
                                                    : ImVec4(0.070f, 0.082f, 0.096f, 1.0f));
    ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.125f, 0.135f, 0.155f, 1.0f));
    ImGui::PushStyleColor(ImGuiCol_ButtonActive, ImVec4(0.165f, 0.175f, 0.195f, 1.0f));
    ImGui::PushStyleColor(ImGuiCol_Text, selected ? kText : kMutedText);
    const bool pressed = ImGui::Button(label, size);
    ImGui::PopStyleColor(4);
    ImGui::PopStyleVar(2);
    return pressed;
}

}  // namespace

ActivityPanel::ActivityPanel(core::StateRegistry& registry)
    : registry_(registry) {}

void ActivityPanel::render() {
    auto& state = registry_.get_state<ActivityState>("Activity");
    if (!state.is_open) {
        return;
    }

    auto& notifications = registry_.get_state<NotificationState>("Notifications");
    ImGuiViewport* viewport = ImGui::GetMainViewport();
    constexpr float navbar_width = 77.0f;

    const ImVec2 desired_pos(
        viewport->WorkPos.x + navbar_width + 6.0f,
        viewport->WorkPos.y + (viewport->WorkSize.y - POPUP_H) * 0.5f);
    const ImVec2 clamped_pos = UI::clamp_window_pos_to_viewport(
        desired_pos,
        ImVec2(POPUP_W, POPUP_H),
        *viewport);

    ImGui::SetNextWindowPos(clamped_pos, ImGuiCond_Always);
    ImGui::SetNextWindowSize(ImVec2(POPUP_W, POPUP_H), ImGuiCond_Always);
    ImGui::SetNextWindowViewport(viewport->ID);

    const ImGuiWindowFlags flags =
        ImGuiWindowFlags_NoTitleBar |
        ImGuiWindowFlags_NoResize |
        ImGuiWindowFlags_NoMove |
        ImGuiWindowFlags_NoCollapse |
        ImGuiWindowFlags_NoScrollbar |
        ImGuiWindowFlags_NoSavedSettings;

    ImGui::PushStyleColor(ImGuiCol_WindowBg, kPanelBg);
    ImGui::PushStyleColor(ImGuiCol_Border, kPanelBorder);
    ImGui::PushStyleVar(ImGuiStyleVar_WindowRounding, 8.0f);
    ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(16.0f, 14.0f));
    ImGui::PushStyleVar(ImGuiStyleVar_WindowBorderSize, 1.0f);

    if (ImGui::Begin("##ActivityPopup", nullptr, flags)) {
        if (ImGuiWindow* window = ImGui::FindWindowByName("##ActivityPopup")) {
            ImGui::BringWindowToDisplayFront(window);
        }

        if (!ImGui::IsWindowHovered(ImGuiHoveredFlags_AllowWhenBlockedByActiveItem) &&
            ImGui::IsMouseClicked(ImGuiMouseButton_Left)) {
            const ImVec2 mouse = ImGui::GetMousePos();
            const bool clicked_toggle =
                state.has_button_rect &&
                mouse.x >= state.button_min.x && mouse.x <= state.button_max.x &&
                mouse.y >= state.button_min.y && mouse.y <= state.button_max.y;
            if (!clicked_toggle) {
                state.is_open = false;
            }
        }

        ImGui::PushStyleColor(ImGuiCol_Text, kText);
        ImGui::TextUnformatted("Activity");
        ImGui::PopStyleColor();

        const bool has_entries = notifications.count() > 0;
        ImGui::SetCursorPosY(48.0f);
        ImGui::SetCursorPosX(POPUP_W - 16.0f - 70.0f);
        if (compact_button("Clear##activity_action", false, ImVec2(70.0f, 28.0f)) && has_entries) {
            notifications.clear_history();
        }

        ImGui::SetCursorPosY(88.0f);
        ImGui::PushStyleColor(ImGuiCol_Separator, ImVec4(0.20f, 0.23f, 0.28f, 0.85f));
        ImGui::Separator();
        ImGui::PopStyleColor();

        auto entries = notifications.get_history();

        ImGui::SetCursorPosY(104.0f);
        if (entries.empty()) {
            render_empty_state();
        } else {
            ImGui::BeginChild("##ActivityList", ImVec2(0.0f, POPUP_H - 146.0f), false);
            for (int i = static_cast<int>(entries.size()) - 1; i >= 0; --i) {
                render_entry(entries[static_cast<size_t>(i)]);
            }
            ImGui::EndChild();
        }

        ImGui::SetCursorPosY(POPUP_H - 30.0f);
        ImGui::PushStyleColor(ImGuiCol_Text, kDimText);
        ImGui::TextUnformatted("Notifications are local to this device.");
        ImGui::PopStyleColor();

    }
    ImGui::End();

    ImGui::PopStyleVar(3);
    ImGui::PopStyleColor(2);
}

void ActivityPanel::render_empty_state() {
    ImGui::Dummy(ImVec2(0.0f, 116.0f));

    const char* title = "No notifications";
    const ImVec2 title_size = ImGui::CalcTextSize(title);
    ImGui::SetCursorPosX((POPUP_W - title_size.x) * 0.5f);
    ImGui::PushStyleColor(ImGuiCol_Text, kText);
    ImGui::TextUnformatted(title);
    ImGui::PopStyleColor();

    ImGui::SetCursorPosY(ImGui::GetCursorPosY() + 8.0f);
    const char* body = "System updates will appear here.";
    const ImVec2 body_size = ImGui::CalcTextSize(body);
    ImGui::SetCursorPosX((POPUP_W - body_size.x) * 0.5f);
    ImGui::PushStyleColor(ImGuiCol_Text, kMutedText);
    ImGui::TextUnformatted(body);
    ImGui::PopStyleColor();
}

void ActivityPanel::render_entry(const Notification& entry) {
    const ImVec2 cursor = ImGui::GetCursorScreenPos();
    const float row_start_y = cursor.y;
    const float dot_r = 3.5f;
    const float text_y = cursor.y + 1.0f;

    ImGui::GetWindowDrawList()->AddCircleFilled(
        ImVec2(cursor.x + dot_r + 2.0f, cursor.y + 11.0f),
        dot_r,
        ImGui::ColorConvertFloat4ToU32(dot_color(entry.type)),
        12);

    if (!entry.read) {
        ImGui::GetWindowDrawList()->AddRectFilled(
            ImVec2(cursor.x, row_start_y),
            ImVec2(cursor.x + ImGui::GetContentRegionAvail().x, row_start_y + 34.0f),
            rgba(0.945f, 0.933f, 0.910f, 0.035f),
            5.0f);
    }

    ImGui::SetCursorScreenPos(ImVec2(cursor.x + 18.0f, text_y));
    const std::string time_text = format_timestamp(entry.timestamp);
    const float time_width = ImGui::CalcTextSize(time_text.c_str()).x;
    const float wrap_width = ImGui::GetContentRegionAvail().x - time_width - 16.0f;

    ImGui::PushStyleColor(ImGuiCol_Text, kText);
    ImGui::PushTextWrapPos(ImGui::GetCursorPosX() + std::max(80.0f, wrap_width));
    ImGui::TextWrapped("%s", entry.message.c_str());
    ImGui::PopTextWrapPos();
    ImGui::PopStyleColor();

    ImGui::SameLine();
    const float remaining = ImGui::GetContentRegionAvail().x;
    if (remaining > time_width) {
        ImGui::Dummy(ImVec2(remaining - time_width, 0.0f));
        ImGui::SameLine(0.0f, 0.0f);
    }
    ImGui::PushStyleColor(ImGuiCol_Text, kDimText);
    ImGui::TextUnformatted(time_text.c_str());
    ImGui::PopStyleColor();

    ImGui::Dummy(ImVec2(0.0f, 8.0f));
}

std::string ActivityPanel::format_timestamp(std::chrono::system_clock::time_point tp) {
    auto t = std::chrono::system_clock::to_time_t(tp);
    std::tm tm_buf{};
#if defined(_WIN32)
    localtime_s(&tm_buf, &t);
#else
    localtime_r(&t, &tm_buf);
#endif
    std::ostringstream ss;
    ss << std::setfill('0') << std::setw(2) << tm_buf.tm_hour
       << ":" << std::setw(2) << tm_buf.tm_min;
    return ss.str();
}

}  // namespace misty::panel
