#include "panels/transfers/navigation/transfers_toolbar.h"

#include <algorithm>

#include "imgui.h"
#include "panels/transfers/content/transfers_content_util.h"

namespace misty::panel {
namespace {

constexpr ImVec4 kBorder(0.16f, 0.19f, 0.23f, 1.0f);
constexpr ImVec4 kPanelBg(0.055f, 0.067f, 0.083f, 1.0f);
constexpr ImVec4 kHoverBg(0.10f, 0.13f, 0.17f, 1.0f);
constexpr ImVec4 kMutedText(0.68f, 0.70f, 0.76f, 1.0f);

void search_box(TransfersState& state, float width) {
    ImGui::PushStyleColor(ImGuiCol_FrameBg, ImVec4(0.055f, 0.067f, 0.083f, 1.0f));
    ImGui::PushStyleColor(ImGuiCol_Border, kBorder);
    ImGui::PushStyleColor(ImGuiCol_TextDisabled, kMutedText);
    ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 7.0f);
    ImGui::PushStyleVar(ImGuiStyleVar_FrameBorderSize, 1.0f);
    ImGui::SetNextItemWidth(width);
    ImGui::InputTextWithHint(
        "##transfers_search",
        "Search transfers...",
        state.search_query(),
        state.search_query_capacity());
    ImGui::PopStyleVar(2);
    ImGui::PopStyleColor(3);
}

bool menu_button() {
    ImGui::PushStyleColor(ImGuiCol_Button, kPanelBg);
    ImGui::PushStyleColor(ImGuiCol_ButtonHovered, kHoverBg);
    ImGui::PushStyleColor(ImGuiCol_ButtonActive, ImVec4(0.12f, 0.16f, 0.22f, 1.0f));
    ImGui::PushStyleColor(ImGuiCol_Border, kBorder);
    ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 7.0f);
    ImGui::PushStyleVar(ImGuiStyleVar_FrameBorderSize, 1.0f);
    const bool pressed = ImGui::Button("...", ImVec2(52.0f, 42.0f));
    ImGui::PopStyleVar(2);
    ImGui::PopStyleColor(4);
    return pressed;
}

}  // namespace

void render_transfers_toolbar(TransfersState& state) {
    const float menu_w = 52.0f;
    const float search_w = std::min(360.0f, std::max(210.0f, ImGui::GetContentRegionAvail().x * 0.34f));
    const float right_x = ImGui::GetWindowContentRegionMax().x - search_w - menu_w - 14.0f;
    ImGui::SetCursorPosX(std::max(ImGui::GetCursorPosX(), right_x));
    search_box(state, search_w);
    ImGui::SameLine(0.0f, 14.0f);
    menu_button();
}

}  // namespace misty::panel
