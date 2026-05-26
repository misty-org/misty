#include "panels/transfers/navigation/transfers_toolbar.h"

#include <algorithm>

#include "imgui.h"
#include "panels/transfers/content/transfers_content_util.h"

namespace misty::panel {
namespace {

constexpr ImVec4 kBorder(0.16f, 0.19f, 0.23f, 1.0f);
constexpr ImVec4 kPanelBg(0.055f, 0.067f, 0.083f, 1.0f);
constexpr ImVec4 kActiveBg(0.14f, 0.28f, 0.58f, 1.0f);
constexpr ImVec4 kHoverBg(0.10f, 0.13f, 0.17f, 1.0f);
constexpr ImVec4 kMutedText(0.68f, 0.70f, 0.76f, 1.0f);

bool filter_button(const char* label, bool selected, float width) {
    ImGui::PushStyleColor(ImGuiCol_Button, selected ? kActiveBg : kPanelBg);
    ImGui::PushStyleColor(ImGuiCol_ButtonHovered, selected ? kActiveBg : kHoverBg);
    ImGui::PushStyleColor(ImGuiCol_ButtonActive, selected ? kActiveBg : ImVec4(0.12f, 0.16f, 0.22f, 1.0f));
    ImGui::PushStyleColor(ImGuiCol_Border, kBorder);
    ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 6.0f);
    ImGui::PushStyleVar(ImGuiStyleVar_FrameBorderSize, 1.0f);
    const bool pressed = ImGui::Button(label, ImVec2(width, 42.0f));
    ImGui::PopStyleVar(2);
    ImGui::PopStyleColor(4);
    return pressed;
}

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
    const auto current = state.filter();
    if (filter_button("Active", current == core::FileTransferFilter::Active, 88.0f)) {
        state.set_filter(core::FileTransferFilter::Active);
    }
    ImGui::SameLine(0.0f, 0.0f);
    if (filter_button("All", current == core::FileTransferFilter::All, 70.0f)) {
        state.set_filter(core::FileTransferFilter::All);
    }
    ImGui::SameLine(0.0f, 0.0f);
    if (filter_button("Failed", current == core::FileTransferFilter::Failed, 88.0f)) {
        state.set_filter(core::FileTransferFilter::Failed);
    }
    ImGui::SameLine(0.0f, 0.0f);
    if (filter_button("Completed", current == core::FileTransferFilter::Completed, 122.0f)) {
        state.set_filter(core::FileTransferFilter::Completed);
    }

    const float menu_w = 52.0f;
    const float search_w = std::min(360.0f, std::max(210.0f, ImGui::GetContentRegionAvail().x * 0.34f));
    const float right_x = ImGui::GetWindowContentRegionMax().x - search_w - menu_w - 14.0f;
    ImGui::SameLine();
    ImGui::SetCursorPosX(std::max(ImGui::GetCursorPosX() + 12.0f, right_x));
    search_box(state, search_w);
    ImGui::SameLine(0.0f, 14.0f);
    menu_button();
}

}  // namespace misty::panel
