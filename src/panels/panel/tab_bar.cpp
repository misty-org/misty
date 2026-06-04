#include "panels/panel/tab_bar.h"

#include <algorithm>

#include "core/manager/asset_manager.h"
#include "imgui.h"
#include "imgui_internal.h"

namespace misty::panel {
    namespace {
        constexpr float kTabButtonHeight = 32.0f;
        constexpr float kTabOuterPadX = 6.0f;
        constexpr float kTabTopPadY = 6.0f;
        constexpr float kTabGap = 2.0f;
        constexpr float kTabMinWidth = 132.0f;
        constexpr float kTabMaxWidth = 210.0f;
        constexpr float kPlusWidth = 34.0f;
        constexpr float kCloseIconSize = 12.0f;
        constexpr ImU32 kTabStripBg = IM_COL32(7, 9, 11, 255);
        constexpr ImU32 kTabStripBorder = IM_COL32(39, 39, 42, 190);
        constexpr ImU32 kTabIdle = IM_COL32(24, 24, 27, 255);
        constexpr ImU32 kTabHovered = IM_COL32(31, 31, 33, 255);
        constexpr ImU32 kTabActive = IM_COL32(241, 238, 232, 255);
        constexpr ImU32 kTabText = IM_COL32(7, 9, 11, 255);
        constexpr ImU32 kTabMutedText = IM_COL32(201, 196, 188, 230);
        constexpr ImU32 kTabClose = IM_COL32(38, 37, 35, 230);
        constexpr ImU32 kTabCloseMuted = IM_COL32(201, 196, 188, 220);
        constexpr ImU32 kTabSeparator = IM_COL32(64, 62, 59, 135);
        constexpr ImU32 kPlusHover = IM_COL32(39, 39, 42, 255);
        constexpr ImU32 kPlusText = IM_COL32(241, 238, 232, 255);

        void draw_chrome_tab_shape(ImDrawList* dl, const ImRect& rect, ImU32 fill) {
            constexpr float kShoulderWidth = 20.0f;
            constexpr float kShoulderLift = 9.0f;
            dl->PathClear();
            dl->PathLineTo(ImVec2(rect.Min.x, rect.Max.y));
            dl->PathBezierCubicCurveTo(ImVec2(rect.Min.x + 9.0f, rect.Max.y),
                                       ImVec2(rect.Min.x + 8.0f, rect.Min.y + kShoulderLift),
                                       ImVec2(rect.Min.x + kShoulderWidth, rect.Min.y),
                                       10);
            dl->PathLineTo(ImVec2(rect.Max.x - kShoulderWidth, rect.Min.y));
            dl->PathBezierCubicCurveTo(ImVec2(rect.Max.x - 8.0f, rect.Min.y + kShoulderLift),
                                       ImVec2(rect.Max.x - 9.0f, rect.Max.y),
                                       ImVec2(rect.Max.x, rect.Max.y),
                                       10);
            dl->PathLineTo(ImVec2(rect.Min.x, rect.Max.y));
            dl->PathFillConvex(fill);
        }

        bool draw_tab_button(const TabBarItem& item, float width, bool* close_requested) {
            const ImVec2 size(width, kTabButtonHeight);
            ImGui::PushID(item.id.c_str());
            const bool pressed = ImGui::InvisibleButton("##tab", size);
            const bool hovered = ImGui::IsItemHovered();
            const ImRect rect(ImGui::GetItemRectMin(), ImGui::GetItemRectMax());
            ImGui::PopID();

            ImDrawList* dl = ImGui::GetWindowDrawList();
            const ImU32 fill = item.active ? kTabActive : hovered ? kTabHovered : kTabIdle;
            draw_chrome_tab_shape(dl, rect, fill);
            if (item.active) {
                dl->AddLine(ImVec2(rect.Min.x + 8.0f, rect.Max.y - 1.0f),
                            ImVec2(rect.Max.x - 8.0f, rect.Max.y - 1.0f),
                            kTabActive,
                            2.0f);
            } else {
                dl->AddLine(ImVec2(rect.Max.x, rect.Min.y + 8.0f),
                            ImVec2(rect.Max.x, rect.Max.y - 6.0f),
                            kTabSeparator,
                            1.0f);
            }

            const float text_pad_x = 20.0f;
            const float close_pad_x = item.closable ? 26.0f : 0.0f;
            const float available_text_w = std::max(0.0f, width - text_pad_x * 2.0f - close_pad_x);
            std::string visible_title = item.title;
            while (!visible_title.empty() &&
                   ImGui::CalcTextSize(visible_title.c_str()).x > available_text_w) {
                visible_title.pop_back();
            }
            if (visible_title != item.title && visible_title.size() > 2) {
                visible_title.pop_back();
                visible_title.pop_back();
                visible_title += "..";
            }

            const ImVec2 text_size = ImGui::CalcTextSize(visible_title.c_str());
            const float text_y = rect.Min.y + (size.y - text_size.y) * 0.5f;
            dl->AddText(ImVec2(rect.Min.x + text_pad_x, text_y),
                        item.active ? kTabText : kTabMutedText,
                        visible_title.c_str());

            if (item.closable) {
                const ImVec2 close_center(rect.Max.x - 20.0f, rect.Min.y + size.y * 0.5f);
                const ImVec2 close_button_min(close_center.x - 9.0f, close_center.y - 9.0f);
                const ImVec2 close_button_max(close_center.x + 9.0f, close_center.y + 9.0f);
                const bool close_hovered = hovered && ImGui::IsMouseHoveringRect(close_button_min, close_button_max);
                if (close_hovered) {
                    dl->AddCircleFilled(close_center, 9.0f, IM_COL32(212, 206, 198, 130), 16);
                }
                if (close_hovered && ImGui::IsMouseClicked(ImGuiMouseButton_Left)) {
                    if (close_requested) {
                        *close_requested = true;
                    }
                    return false;
                }
                auto& close_icon = core::AssetManager::get().get_svg_texture("x-24", static_cast<int>(kCloseIconSize * 2.0f));
                if (close_icon.id != 0) {
                    const ImVec2 close_min(close_center.x - kCloseIconSize * 0.5f,
                                           close_center.y - kCloseIconSize * 0.5f);
                    dl->AddImage(close_icon.id,
                                 close_min,
                                 ImVec2(close_min.x + kCloseIconSize, close_min.y + kCloseIconSize),
                                 ImVec2(0.0f, 0.0f),
                                 ImVec2(1.0f, 1.0f),
                                 item.active ? kTabClose : kTabCloseMuted);
                }
            }

            return pressed;
        }

        bool draw_plus_button() {
            const ImVec2 size(kPlusWidth, kTabButtonHeight);
            ImGui::PushID("plus");
            const bool pressed = ImGui::InvisibleButton("##plus", size);
            const bool hovered = ImGui::IsItemHovered();
            const ImRect rect(ImGui::GetItemRectMin(), ImGui::GetItemRectMax());
            ImGui::PopID();

            ImDrawList* dl = ImGui::GetWindowDrawList();
            if (hovered) {
                dl->AddCircleFilled(ImVec2(rect.Min.x + size.x * 0.5f, rect.Min.y + size.y * 0.5f),
                                    15.0f,
                                    kPlusHover,
                                    24);
            }

            const ImVec2 text_size = ImGui::CalcTextSize("+");
            dl->AddText(ImVec2(rect.Min.x + (size.x - text_size.x) * 0.5f,
                               rect.Min.y + (size.y - text_size.y) * 0.5f - 1.0f),
                        kPlusText, "+");
            return pressed;
        }
    }

    TabBarResult render_tab_bar(const std::vector<TabBarItem>& items, bool show_plus) {
        TabBarResult result;

        ImDrawList* dl = ImGui::GetWindowDrawList();
        const ImVec2 strip_min = ImGui::GetWindowPos();
        const ImVec2 strip_max(strip_min.x + ImGui::GetWindowSize().x, strip_min.y + ImGui::GetWindowSize().y);
        dl->AddRectFilled(strip_min, strip_max, kTabStripBg, 0.0f);
        dl->AddLine(ImVec2(strip_min.x, strip_max.y - 1.0f),
                    ImVec2(strip_max.x, strip_max.y - 1.0f),
                    kTabStripBorder,
                    1.0f);

        const int tab_count = std::max(1, static_cast<int>(items.size()));
        const float plus_width = show_plus ? kPlusWidth : 0.0f;
        const float usable_w = std::max(
            0.0f,
            ImGui::GetContentRegionAvail().x - kTabOuterPadX * 2.0f - plus_width - kTabGap * static_cast<float>(tab_count));
        const float tab_w = std::clamp(usable_w / static_cast<float>(tab_count), kTabMinWidth, kTabMaxWidth);

        ImGui::SetCursorPos(ImVec2(kTabOuterPadX, kTabTopPadY));
        for (std::size_t i = 0; i < items.size(); ++i) {
            bool close_requested = false;
            if (draw_tab_button(items[i], tab_w, &close_requested)) {
                result.pressed_index = static_cast<int>(i);
            }

            if (close_requested) {
                result.close_index = static_cast<int>(i);
            }
            if (i + 1 < items.size()) {
                ImGui::SameLine(0.0f, kTabGap);
            }
        }

        if (show_plus) {
            if (!items.empty()) {
                ImGui::SameLine(0.0f, kTabGap);
            } else {
                ImGui::SetCursorPos(ImVec2(kTabOuterPadX, kTabTopPadY));
            }
            result.plus_pressed = draw_plus_button();
        }

        return result;
    }
}
