#include "activity_panel.h"
#include "core/manager/asset_manager.h"
#include "core/ui/ui_helper.h"
#include "imgui.h"
#include "imgui_internal.h"
#include "panels/navbar/navbar_state.h"
#include "views/app_view.h"
#include <ctime>
#include <sstream>
#include <iomanip>
#include <algorithm>
#include <cctype>
#include <iterator>
#include <vector>

namespace misty::panel {
    namespace {
        constexpr ImVec4 kPanelBg(0.060f, 0.070f, 0.085f, 1.0f);
        constexpr ImVec4 kPanelBorder(0.23f, 0.26f, 0.32f, 1.0f);
        constexpr ImVec4 kMutedText(0.58f, 0.62f, 0.69f, 1.0f);
        constexpr ImVec4 kDimText(0.44f, 0.48f, 0.55f, 1.0f);

        ImU32 rgba(float r, float g, float b, float a) {
            return ImGui::ColorConvertFloat4ToU32(ImVec4(r, g, b, a));
        }

        void draw_button_depth(const ImVec2& min, const ImVec2& size, bool selected, bool enabled, float rounding) {
            ImDrawList* dl = ImGui::GetWindowDrawList();
            const ImVec2 max(min.x + size.x, min.y + size.y);
            dl->AddRectFilled(
                ImVec2(min.x, min.y + 2.0f),
                ImVec2(max.x, max.y + 2.0f),
                rgba(0.0f, 0.0f, 0.0f, enabled ? 0.30f : 0.16f),
                rounding);
            dl->AddRectFilled(
                min,
                max,
                selected ? rgba(0.10f, 0.24f, 0.50f, 1.0f) : rgba(0.10f, 0.12f, 0.16f, enabled ? 1.0f : 0.48f),
                rounding);
            dl->AddRectFilled(
                ImVec2(min.x + 1.0f, min.y + 1.0f),
                ImVec2(max.x - 1.0f, min.y + size.y * 0.48f),
                selected ? rgba(0.18f, 0.38f, 0.72f, 0.70f) : rgba(1.0f, 1.0f, 1.0f, enabled ? 0.055f : 0.025f),
                std::max(0.0f, rounding - 1.0f));
            dl->AddRect(
                min,
                max,
                selected ? rgba(0.31f, 0.55f, 0.95f, 0.48f) : rgba(1.0f, 1.0f, 1.0f, enabled ? 0.075f : 0.035f),
                rounding,
                0,
                1.0f);
        }

        bool pill_button(const char* label, bool selected, const ImVec2& size = ImVec2(0.0f, 28.0f)) {
            const ImVec2 pos = ImGui::GetCursorScreenPos();
            draw_button_depth(pos, size, selected, true, 6.0f);
            bool pressed = false;
            ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 6.0f);
            ImGui::PushStyleVar(ImGuiStyleVar_FramePadding, ImVec2(12.0f, 5.0f));
            ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.0f, 0.0f, 0.0f, 0.01f));
            ImGui::PushStyleColor(ImGuiCol_ButtonHovered, selected ? ImVec4(0.20f, 0.39f, 0.72f, 0.70f) : ImVec4(0.20f, 0.23f, 0.29f, 0.62f));
            ImGui::PushStyleColor(ImGuiCol_ButtonActive, ImVec4(0.18f, 0.34f, 0.62f, 0.70f));
            ImGui::PushStyleColor(ImGuiCol_Text, selected ? ImVec4(0.86f, 0.92f, 1.0f, 1.0f) : kMutedText);
            pressed = ImGui::Button(label, size);
            ImGui::PopStyleColor(4);
            ImGui::PopStyleVar(2);
            return pressed;
        }

        bool toolbar_button(const char* label, const char* icon_name, bool enabled, float width) {
            const ImVec2 pos = ImGui::GetCursorScreenPos();
            const ImVec2 size(width, 30.0f);
            draw_button_depth(pos, size, false, enabled, 7.0f);
            bool pressed = false;
            ImGui::BeginDisabled(!enabled);
            ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 6.0f);
            ImGui::PushStyleVar(ImGuiStyleVar_FramePadding, ImVec2(13.0f, 6.0f));
            ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.0f, 0.0f, 0.0f, 0.01f));
            ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.19f, 0.22f, 0.28f, 0.70f));
            ImGui::PushStyleColor(ImGuiCol_ButtonActive, ImVec4(0.12f, 0.24f, 0.46f, 0.78f));
            ImGui::PushStyleColor(ImGuiCol_Text, enabled ? kMutedText : ImVec4(0.34f, 0.37f, 0.43f, 0.70f));
            const std::string id = std::string("##activity_toolbar_") + label;
            pressed = ImGui::Button(id.c_str(), size);
            ImGui::PopStyleColor(4);
            ImGui::PopStyleVar(2);
            ImGui::EndDisabled();

            auto& icon = core::AssetManager::get().get_svg_texture(icon_name, 14);
            const ImU32 text_col = ImGui::ColorConvertFloat4ToU32(enabled ? kMutedText : ImVec4(0.34f, 0.37f, 0.43f, 0.70f));
            ImDrawList* dl = ImGui::GetWindowDrawList();
            dl->AddImage(
                icon.id,
                ImVec2(pos.x + 8.0f, pos.y + 8.0f),
                ImVec2(pos.x + 22.0f, pos.y + 22.0f),
                ImVec2(0.0f, 0.0f),
                ImVec2(1.0f, 1.0f),
                text_col);
            dl->AddText(ImVec2(pos.x + 28.0f, pos.y + 7.0f), text_col, label);
            return pressed && enabled;
        }

        bool icon_square_button(const char* id, const char* icon_name) {
            const ImVec2 pos = ImGui::GetCursorScreenPos();
            const ImVec2 size(34.0f, 30.0f);
            draw_button_depth(pos, size, false, true, 7.0f);
            ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 7.0f);
            ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.0f, 0.0f, 0.0f, 0.01f));
            ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.19f, 0.22f, 0.28f, 0.70f));
            ImGui::PushStyleColor(ImGuiCol_ButtonActive, ImVec4(0.12f, 0.24f, 0.46f, 0.78f));
            const bool pressed = ImGui::Button(id, size);
            ImGui::PopStyleColor(3);
            ImGui::PopStyleVar();

            auto& icon = core::AssetManager::get().get_svg_texture(icon_name, 16);
            ImGui::GetWindowDrawList()->AddImage(
                icon.id,
                ImVec2(pos.x + 9.0f, pos.y + 7.0f),
                ImVec2(pos.x + 25.0f, pos.y + 23.0f),
                ImVec2(0.0f, 0.0f),
                ImVec2(1.0f, 1.0f),
                IM_COL32(178, 186, 198, 235));
            return pressed;
        }

        bool is_transfer_entry(const ActivityEntry& entry) {
            std::string haystack = entry.sender + " " + entry.message;
            std::transform(haystack.begin(), haystack.end(), haystack.begin(), [](unsigned char c) {
                return static_cast<char>(std::tolower(c));
            });
            return haystack.find("transfer") != std::string::npos ||
                   haystack.find("upload") != std::string::npos ||
                   haystack.find("download") != std::string::npos ||
                   haystack.find("copy") != std::string::npos ||
                   haystack.find("move") != std::string::npos;
        }
    }

    ActivityPanel::ActivityPanel(core::StateRegistry& registry)
        : registry_(registry) {}

    void ActivityPanel::render() {
        auto& state = registry_.get_state<ActivityState>("Activity");
        if (!state.is_open) {
            return;
        }

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
            ImGuiWindowFlags_NoScrollbar |
            ImGuiWindowFlags_NoScrollWithMouse |
            ImGuiWindowFlags_NoSavedSettings;

        ImGui::SetNextWindowViewport(viewport->ID);

        ImGui::PushStyleColor(ImGuiCol_WindowBg, kPanelBg);
        ImGui::PushStyleVar(ImGuiStyleVar_WindowRounding, 8.0f);
        ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(16.0f, 14.0f));
        ImGui::PushStyleVar(ImGuiStyleVar_WindowBorderSize, 1.0f);
        ImGui::PushStyleColor(ImGuiCol_Border, kPanelBorder);

        if (ImGui::Begin("##ActivityPopup", nullptr, flags)) {
            if (ImGuiWindow* window = ImGui::FindWindowByName("##ActivityPopup")) {
                ImGui::BringWindowToDisplayFront(window);
            }
            ImDrawList* panel_draw_list = ImGui::GetWindowDrawList();
            const ImVec2 panel_min = ImGui::GetWindowPos();
            const ImVec2 panel_max(panel_min.x + POPUP_W, panel_min.y + POPUP_H);
            panel_draw_list->AddRectFilled(panel_min, panel_max, rgba(0.060f, 0.070f, 0.085f, 1.0f), 8.0f);
            panel_draw_list->AddRect(panel_min, panel_max, rgba(0.28f, 0.31f, 0.38f, 0.92f), 8.0f, 0, 1.0f);

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

            ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(1.0f, 1.0f, 1.0f, 1.0f));
            ImGui::Text("Activity");
            ImGui::PopStyleColor();

            const bool has_entries = state.count() > 0;
            const float top_button_gap = 8.0f;
            ImGui::SetCursorPosY(47.0f);
            if (pill_button("Activity##activity_tab", true, ImVec2(62.0f, 28.0f))) {
                filter_ = Filter::All;
            }
            ImGui::SameLine(0.0f, 0.0f);
            if (pill_button("Transfers##activity_tab", false, ImVec2(74.0f, 28.0f))) {
                state.is_open = false;
                registry_.get_state<NavbarState>("Navbar").selected_item = view::ViewID::Transfers;
                view::switch_view(view::ViewID::Transfers);
            }

            ImGui::SameLine();
            ImGui::SetCursorPosX(POPUP_W - 16.0f - 112.0f - 74.0f - top_button_gap);
            if (toolbar_button("Mark all read", "activity-check-svgrepo", has_entries && state.unread_count() > 0, 112.0f)) {
                state.mark_all_read();
            }
            ImGui::SameLine(0.0f, top_button_gap);
            if (toolbar_button("Clear", "activity-trash-svgrepo", has_entries, 74.0f)) {
                state.clear();
            }

            ImGui::SetCursorPosY(84.0f);
            ImGui::PushStyleColor(ImGuiCol_Separator, ImVec4(0.20f, 0.23f, 0.28f, 0.85f));
            ImGui::Separator();
            ImGui::PopStyleColor();

            ImGui::SetCursorPosY(100.0f);
            if (pill_button("All##activity_filter", filter_ == Filter::All, ImVec2(32.0f, 24.0f))) {
                filter_ = Filter::All;
            }
            ImGui::SameLine(0.0f, 8.0f);
            if (pill_button("Unread##activity_filter", filter_ == Filter::Unread, ImVec2(60.0f, 24.0f))) {
                filter_ = Filter::Unread;
            }
            ImGui::SameLine(0.0f, 8.0f);
            if (pill_button("Transfers##activity_filter", filter_ == Filter::Transfers, ImVec2(76.0f, 24.0f))) {
                filter_ = Filter::Transfers;
            }
            ImGui::SameLine();
            ImGui::SetCursorPosX(POPUP_W - 16.0f - 34.0f);
            icon_square_button("##activity_filter_options", "activity-sliders-svgrepo");

            auto entries = state.get_entries();
            std::vector<ActivityEntry> visible_entries;
            visible_entries.reserve(entries.size());
            if (filter_ == Filter::Unread) {
                const size_t unread_count = std::min(state.unread_count(), entries.size());
                const size_t first_unread = entries.size() - unread_count;
                visible_entries.insert(visible_entries.end(), entries.begin() + static_cast<std::ptrdiff_t>(first_unread), entries.end());
            } else if (filter_ == Filter::Transfers) {
                std::copy_if(entries.begin(), entries.end(), std::back_inserter(visible_entries), is_transfer_entry);
            } else {
                visible_entries = std::move(entries);
            }

            ImGui::SetCursorPosY(138.0f);
            if (visible_entries.empty()) {
                render_empty_state();
            } else {
                ImGui::BeginChild("##ActivityList", ImVec2(0, 236.0f), false);
                for (int i = (int)visible_entries.size() - 1; i >= 0; --i) {
                    render_entry(visible_entries[i]);
                }
                ImGui::EndChild();
            }

            ImGui::SetCursorPosY(POPUP_H - 34.0f);
            ImGui::PushStyleColor(ImGuiCol_Separator, ImVec4(0.20f, 0.23f, 0.28f, 0.85f));
            ImGui::Separator();
            ImGui::PopStyleColor();
            ImGui::SetCursorPosY(POPUP_H - 20.0f);
            ImDrawList* dl = ImGui::GetWindowDrawList();
            const ImVec2 footer_cursor = ImGui::GetCursorScreenPos();
            dl->AddCircle(ImVec2(footer_cursor.x + 8.0f, footer_cursor.y + 7.5f), 5.4f, IM_COL32(118, 126, 140, 210), 16, 1.2f);
            ImGui::PushStyleColor(ImGuiCol_Text, kDimText);
            ImGui::SetCursorPosX(ImGui::GetCursorPosX() + 5.5f);
            ImGui::TextUnformatted("i");
            ImGui::SameLine(0.0f, 9.0f);
            ImGui::TextUnformatted("Notifications are local to this device.");
            ImGui::PopStyleColor();
        }
        ImGui::End();

        ImGui::PopStyleVar(3);
        ImGui::PopStyleColor(2);
    }

    void ActivityPanel::render_empty_state() {
        auto& bell = core::AssetManager::get().get_svg_texture("activity-bell-svgrepo", 58);
        ImGui::SetCursorPosY(188.0f);
        ImGui::SetCursorPosX((POPUP_W - 58.0f) * 0.5f);
        const ImVec2 bell_pos = ImGui::GetCursorScreenPos();
        ImGui::GetWindowDrawList()->AddImage(
            bell.id,
            bell_pos,
            ImVec2(bell_pos.x + 58.0f, bell_pos.y + 58.0f),
            ImVec2(0.0f, 0.0f),
            ImVec2(1.0f, 1.0f),
            rgba(0.54f, 0.57f, 0.64f, 0.92f));
        ImGui::Dummy(ImVec2(58.0f, 58.0f));

        ImGui::SetCursorPosY(268.0f);
        const char* title = "No activity yet";
        const ImVec2 title_size = ImGui::CalcTextSize(title);
        ImGui::SetCursorPosX((POPUP_W - title_size.x) * 0.5f);
        ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.93f, 0.94f, 0.97f, 1.0f));
        ImGui::TextUnformatted(title);
        ImGui::PopStyleColor();

        ImGui::SetCursorPosY(298.0f);
        ImGui::PushStyleColor(ImGuiCol_Text, kMutedText);
        const char* line_1 = "File changes, provider events, and";
        const char* line_2 = "transfer updates will appear here.";
        ImVec2 line_size = ImGui::CalcTextSize(line_1);
        ImGui::SetCursorPosX((POPUP_W - line_size.x) * 0.5f);
        ImGui::TextUnformatted(line_1);
        line_size = ImGui::CalcTextSize(line_2);
        ImGui::SetCursorPosX((POPUP_W - line_size.x) * 0.5f);
        ImGui::TextUnformatted(line_2);
        ImGui::PopStyleColor();
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
