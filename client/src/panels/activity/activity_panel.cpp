#include "activity_panel.h"
#include "imgui.h"
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

        float px = viewport->WorkPos.x + navbar_width + 6.0f;
        float py = viewport->WorkPos.y + (viewport->WorkSize.y - POPUP_H) * 0.5f;
        py = std::max(viewport->WorkPos.y + 8.0f, py);
        py = std::min(viewport->WorkPos.y + viewport->WorkSize.y - POPUP_H - 8.0f, py);

        ImGui::SetNextWindowPos(ImVec2(px, py), ImGuiCond_Always);
        ImGui::SetNextWindowSize(ImVec2(POPUP_W, POPUP_H), ImGuiCond_Always);

        ImGuiWindowFlags flags =
            ImGuiWindowFlags_NoTitleBar |
            ImGuiWindowFlags_NoResize |
            ImGuiWindowFlags_NoMove |
            ImGuiWindowFlags_NoCollapse |
            ImGuiWindowFlags_NoSavedSettings;

        ImGui::PushStyleColor(ImGuiCol_WindowBg, ImVec4(0.14f, 0.14f, 0.14f, 0.98f));
        ImGui::PushStyleVar(ImGuiStyleVar_WindowRounding, 12.0f);
        ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(16.0f, 16.0f));
        ImGui::PushStyleVar(ImGuiStyleVar_WindowBorderSize, 1.0f);
        ImGui::PushStyleColor(ImGuiCol_Border, ImVec4(0.25f, 0.25f, 0.25f, 1.0f));

        if (ImGui::Begin("##ActivityPopup", nullptr, flags)) {
            // Close on click outside (exclude navbar region)
            if (!ImGui::IsWindowHovered(ImGuiHoveredFlags_AllowWhenBlockedByActiveItem) &&
                ImGui::IsMouseClicked(ImGuiMouseButton_Left)) {
                ImVec2 mouse = ImGui::GetMousePos();
                float navbar_right = viewport->WorkPos.x + 77.0f;
                if (mouse.x > navbar_right) {
                    state.is_open = false;
                }
            }

            // Header row
            ImGui::SetWindowFontScale(1.1f);
            ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(1.0f, 1.0f, 1.0f, 1.0f));
            ImGui::Text("Activity");
            ImGui::PopStyleColor();
            ImGui::SetWindowFontScale(1.0f);

            ImGui::SameLine();
            float clear_w = 50.0f;
            ImGui::SetCursorPosX(POPUP_W - 2.0f * 16.0f - clear_w);
            ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.0f, 0.0f, 0.0f, 0.0f));
            ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.3f, 0.3f, 0.3f, 0.5f));
            ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.45f, 0.45f, 0.45f, 1.0f));
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
