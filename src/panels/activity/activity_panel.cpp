#include "activity_panel.h"
#include "core/ui/ui_helper.h"
#include "imgui.h"
#include "imgui_internal.h"
#include "panels/navbar/navbar_state.h"
#include "views/app_view.h"
#include <ctime>
#include <sstream>
#include <iomanip>
#include <algorithm>

namespace misty::panel {

    ActivityPanel::ActivityPanel(core::UIRegistry& registry)
        : registry_(registry) {}

    void ActivityPanel::render() {
        auto& state = registry_.get_state<ActivityState>("Activity");
        if (!state.is_open) return;

        ImGuiViewport* viewport = ImGui::GetMainViewport();
        float navbar_width = 77.0f;

        const ImVec2 desired_pos(
            viewport->WorkPos.x + navbar_width + 6.0f,
            viewport->WorkPos.y + (viewport->WorkSize.y - POPUP_H) * 0.5f
        );
        const ImVec2 clamped_pos = UI::clamp_window_pos_to_viewport(
            desired_pos,
            ImVec2(POPUP_W, POPUP_H),
            *viewport
        );

        ImGui::SetNextWindowPos(clamped_pos, ImGuiCond_Always);
        ImGui::SetNextWindowSize(ImVec2(POPUP_W, POPUP_H), ImGuiCond_Always);

        ImGuiWindowFlags flags =
            ImGuiWindowFlags_NoTitleBar |
            ImGuiWindowFlags_NoResize |
            ImGuiWindowFlags_NoMove |
            ImGuiWindowFlags_NoCollapse |
            ImGuiWindowFlags_NoSavedSettings;

        ImGui::SetNextWindowViewport(viewport->ID);

        ImGui::PushStyleColor(ImGuiCol_WindowBg, ImVec4(0.14f, 0.14f, 0.14f, 0.98f));
        ImGui::PushStyleVar(ImGuiStyleVar_WindowRounding, 12.0f);
        ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(16.0f, 16.0f));
        ImGui::PushStyleVar(ImGuiStyleVar_WindowBorderSize, 1.0f);
        ImGui::PushStyleColor(ImGuiCol_Border, ImVec4(0.25f, 0.25f, 0.25f, 1.0f));

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

            ImGui::SetWindowFontScale(1.1f);
            ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(1.0f, 1.0f, 1.0f, 1.0f));
            ImGui::Text("Activity");
            ImGui::PopStyleColor();
            ImGui::SetWindowFontScale(1.0f);

            ImGui::SameLine();
            const float clear_w = 50.0f;
            const float read_w = 86.0f;
            const float transfers_w = 78.0f;
            const float button_gap = 8.0f;
            ImGui::SetCursorPosX(POPUP_W - 2.0f * 16.0f - clear_w - read_w - transfers_w - button_gap * 2.0f);
            ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.0f, 0.0f, 0.0f, 0.0f));
            ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.3f, 0.3f, 0.3f, 0.5f));
            ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.45f, 0.45f, 0.45f, 1.0f));
            if (ImGui::Button("Transfers##activity", ImVec2(transfers_w, 0))) {
                state.is_open = false;
                registry_.get_state<NavbarState>("Navbar").selected_item = view::ViewID::Transfers;
                view::switch_view(view::ViewID::Transfers);
            }
            ImGui::SameLine(0, button_gap);
            if (ImGui::Button("Mark all read##activity", ImVec2(read_w, 0))) {
                state.mark_all_read();
            }
            ImGui::SameLine(0, button_gap);
            if (ImGui::Button("Clear##activity", ImVec2(clear_w, 0))) {
                state.clear();
            }
            ImGui::PopStyleColor(3);

            ImGui::PushStyleColor(ImGuiCol_Separator, ImVec4(0.25f, 0.25f, 0.25f, 1.0f));
            ImGui::Separator();
            ImGui::PopStyleColor();
            ImGui::Spacing();

            auto entries = state.get_entries();

            if (entries.empty()) {
                ImVec2 avail = ImGui::GetContentRegionAvail();
                const char* empty_msg = "No activity yet";
                ImVec2 text_sz = ImGui::CalcTextSize(empty_msg);
                ImGui::SetCursorPos(ImVec2((avail.x - text_sz.x) * 0.5f, avail.y * 0.4f));
                ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.35f, 0.35f, 0.35f, 1.0f));
                ImGui::Text("%s", empty_msg);
                ImGui::PopStyleColor();
            } else {
                ImGui::BeginChild("##ActivityList", ImVec2(0, 0), false);
                for (int i = (int)entries.size() - 1; i >= 0; --i) {
                    render_entry(entries[i]);
                }
                ImGui::EndChild();
            }
        }
        ImGui::End();

        ImGui::PopStyleVar(3);
        ImGui::PopStyleColor(2);
    }

    void ActivityPanel::render_entry(const ActivityEntry& entry) {
        ImVec4 dot_color;
        switch (entry.type) {
            case ActivityEntryType::SUCCESS: dot_color = ImVec4(0.3f, 0.8f, 0.4f, 1.0f);  break;
            case ActivityEntryType::ERROR:   dot_color = ImVec4(0.85f, 0.35f, 0.35f, 1.0f); break;
            default:                         dot_color = ImVec4(0.45f, 0.45f, 0.55f, 1.0f); break;
        }

        // Colored dot indicator
        ImVec2 cursor = ImGui::GetCursorScreenPos();
        float dot_r = 3.5f;
        float line_mid = cursor.y + ImGui::GetTextLineHeight() * 0.5f;
        ImGui::GetWindowDrawList()->AddCircleFilled(
            ImVec2(cursor.x + dot_r + 2.0f, line_mid),
            dot_r,
            ImGui::ColorConvertFloat4ToU32(dot_color),
            12
        );
        ImGui::Dummy(ImVec2(dot_r * 2.0f + 8.0f, ImGui::GetTextLineHeight()));
        ImGui::SameLine(0, 0);

        // Timestamp (right-aligned)
        std::string time_str = format_timestamp(entry.timestamp);
        float time_w = ImGui::CalcTextSize(time_str.c_str()).x;
        float avail_w = ImGui::GetContentRegionAvail().x;

        // Sender tag
        std::string sender_tag = "[" + entry.sender + "] ";
        float sender_w = ImGui::CalcTextSize(sender_tag.c_str()).x;

        ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.4f, 0.4f, 0.5f, 1.0f));
        ImGui::Text("%s", sender_tag.c_str());
        ImGui::PopStyleColor();
        ImGui::SameLine(0, 0);

        // Message (wraps if needed, leaves space for timestamp)
        float msg_wrap = avail_w - sender_w - time_w - 16.0f;
        ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.82f, 0.82f, 0.82f, 1.0f));
        ImGui::PushTextWrapPos(ImGui::GetCursorPosX() + std::max(40.0f, msg_wrap));
        ImGui::TextWrapped("%s", entry.message.c_str());
        ImGui::PopTextWrapPos();
        ImGui::PopStyleColor();
        ImGui::SameLine();

        // Right-align timestamp
        float remaining = ImGui::GetContentRegionAvail().x;
        if (remaining > time_w) {
            ImGui::Dummy(ImVec2(remaining - time_w, 0));
            ImGui::SameLine(0, 0);
        }
        ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.3f, 0.3f, 0.3f, 1.0f));
        ImGui::Text("%s", time_str.c_str());
        ImGui::PopStyleColor();

        ImGui::Spacing();
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

}
