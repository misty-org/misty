#include "panels/transfers/navigation/transfers_toolbar.h"

#include <algorithm>
#include <string>

#include "imgui.h"
#include "panels/transfers/content/transfers_content_util.h"

namespace misty::panel {
namespace {

constexpr ImVec4 kBorder(0.16f, 0.19f, 0.23f, 1.0f);
constexpr ImVec4 kPanelBg(0.055f, 0.067f, 0.083f, 1.0f);
constexpr ImVec4 kHoverBg(0.10f, 0.13f, 0.17f, 1.0f);
constexpr ImVec4 kMutedText(0.68f, 0.70f, 0.76f, 1.0f);
constexpr ImVec4 kSelectedBg(0.15f, 0.20f, 0.27f, 1.0f);
constexpr ImVec4 kSelectedText(0.93f, 0.95f, 0.98f, 1.0f);
constexpr ImVec4 kDangerBg(0.22f, 0.08f, 0.08f, 1.0f);
constexpr ImVec4 kDangerHover(0.32f, 0.12f, 0.12f, 1.0f);

std::size_t count_for_filter(const transfers_content::TransferCounts& counts,
                             core::FileTransferFilter filter) {
    switch (filter) {
        case core::FileTransferFilter::Active:
            return counts.active;
        case core::FileTransferFilter::Completed:
            return counts.completed;
        case core::FileTransferFilter::Failed:
            return counts.failed;
        case core::FileTransferFilter::All:
            return counts.active + counts.completed + counts.failed;
    }
    return 0;
}

bool toolbar_button(const char* label, ImVec2 size, bool danger = false) {
    ImGui::PushStyleColor(ImGuiCol_Button, danger ? kDangerBg : kPanelBg);
    ImGui::PushStyleColor(ImGuiCol_ButtonHovered, danger ? kDangerHover : kHoverBg);
    ImGui::PushStyleColor(ImGuiCol_ButtonActive, danger ? ImVec4(0.42f, 0.14f, 0.14f, 1.0f)
                                                        : ImVec4(0.12f, 0.16f, 0.22f, 1.0f));
    ImGui::PushStyleColor(ImGuiCol_Border, kBorder);
    ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 7.0f);
    ImGui::PushStyleVar(ImGuiStyleVar_FrameBorderSize, 1.0f);
    ImGui::PushStyleVar(ImGuiStyleVar_FramePadding, ImVec2(12.0f, 9.0f));
    const bool pressed = ImGui::Button(label, size);
    ImGui::PopStyleVar(3);
    ImGui::PopStyleColor(4);
    return pressed;
}

void draw_filter_icon(const ImVec2& min, const ImVec2& max) {
    const float center_x = (min.x + max.x) * 0.5f;
    const float top = min.y + 12.0f;
    ImDrawList* draw_list = ImGui::GetWindowDrawList();
    const ImU32 color = ImGui::GetColorU32(kSelectedText);
    draw_list->AddLine(ImVec2(center_x - 9.0f, top), ImVec2(center_x + 9.0f, top), color, 2.0f);
    draw_list->AddLine(ImVec2(center_x - 6.0f, top + 7.0f), ImVec2(center_x + 6.0f, top + 7.0f), color, 2.0f);
    draw_list->AddLine(ImVec2(center_x - 3.0f, top + 14.0f), ImVec2(center_x + 3.0f, top + 14.0f), color, 2.0f);
}

bool filter_icon_button() {
    const bool pressed = toolbar_button("##transfers_filter", ImVec2(44.0f, 38.0f));
    draw_filter_icon(ImGui::GetItemRectMin(), ImGui::GetItemRectMax());
    if (ImGui::IsItemHovered()) {
        ImGui::SetTooltip("Filter transfers");
    }
    return pressed;
}

void render_filter_popup(TransfersState& state, const transfers_content::TransferCounts& counts) {
    if (!ImGui::BeginPopup("##transfers_filter_popup")) {
        return;
    }

    ImGui::PushStyleColor(ImGuiCol_Text, kMutedText);
    ImGui::TextUnformatted("Show");
    ImGui::PopStyleColor();
    ImGui::Separator();
    const auto item = [&](core::FileTransferFilter filter) {
        const std::string label = std::string(transfers_content::filter_label(filter)) +
            " (" + std::to_string(count_for_filter(counts, filter)) + ")";
        if (ImGui::MenuItem(label.c_str(), nullptr, state.filter() == filter)) {
            state.set_filter(filter);
        }
    };

    item(core::FileTransferFilter::All);
    item(core::FileTransferFilter::Active);
    item(core::FileTransferFilter::Completed);
    item(core::FileTransferFilter::Failed);
    ImGui::EndPopup();
}

bool filter_summary_button(TransfersState& state, const transfers_content::TransferCounts& counts) {
    const std::string label = std::string(transfers_content::filter_label(state.filter())) +
        "  " + std::to_string(count_for_filter(counts, state.filter()));
    ImGui::PushStyleColor(ImGuiCol_Button, kSelectedBg);
    ImGui::PushStyleColor(ImGuiCol_ButtonHovered, kSelectedBg);
    ImGui::PushStyleColor(ImGuiCol_ButtonActive, ImVec4(0.18f, 0.24f, 0.32f, 1.0f));
    ImGui::PushStyleColor(ImGuiCol_Text, kSelectedText);
    ImGui::PushStyleColor(ImGuiCol_Border, kBorder);
    ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 7.0f);
    ImGui::PushStyleVar(ImGuiStyleVar_FrameBorderSize, 1.0f);
    ImGui::PushStyleVar(ImGuiStyleVar_FramePadding, ImVec2(12.0f, 9.0f));
    const bool pressed = ImGui::Button(label.c_str(), ImVec2(116.0f, 38.0f));
    ImGui::PopStyleVar(3);
    ImGui::PopStyleColor(5);
    return pressed;
}

void search_box(TransfersState& state, float width) {
    ImGui::PushStyleColor(ImGuiCol_FrameBg, ImVec4(0.055f, 0.067f, 0.083f, 1.0f));
    ImGui::PushStyleColor(ImGuiCol_Border, kBorder);
    ImGui::PushStyleColor(ImGuiCol_TextDisabled, kMutedText);
    ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 7.0f);
    ImGui::PushStyleVar(ImGuiStyleVar_FrameBorderSize, 1.0f);
    ImGui::PushStyleVar(ImGuiStyleVar_FramePadding, ImVec2(12.0f, 9.0f));
    ImGui::SetNextItemWidth(width);
    ImGui::InputTextWithHint(
        "##transfers_search",
        "Search transfers...",
        state.search_query(),
        state.search_query_capacity());
    ImGui::PopStyleVar(3);
    ImGui::PopStyleColor(3);
}

}  // namespace

TransfersToolbarAction render_transfers_toolbar(TransfersState& state,
                                                const transfers_content::TransferCounts& counts) {
    TransfersToolbarAction action = TransfersToolbarAction::None;
    const std::size_t total_count = count_for_filter(counts, core::FileTransferFilter::All);
    const std::size_t selected_count = state.selected_count();

    if (filter_icon_button()) {
        action = TransfersToolbarAction::ToggleFilters;
    }
    if (state.active_filter_count() > 0) {
        const std::string count = std::to_string(state.active_filter_count());
        const ImVec2 max = ImGui::GetItemRectMax();
        ImGui::GetWindowDrawList()->AddCircleFilled(ImVec2(max.x - 4.0f, max.y - 4.0f), 9.0f,
                                                     IM_COL32(53, 120, 221, 255));
        const ImVec2 text_size = ImGui::CalcTextSize(count.c_str());
        ImGui::GetWindowDrawList()->AddText(ImVec2(max.x - 4.0f - text_size.x * 0.5f,
                                                   max.y - 4.0f - text_size.y * 0.5f),
                                            IM_COL32(245, 247, 250, 255), count.c_str());
    }

    ImGui::SameLine(0.0f, 12.0f);
    const float search_w = std::min(420.0f, std::max(180.0f, ImGui::GetContentRegionAvail().x * 0.34f));
    search_box(state, search_w);

    if (selected_count > 0) {
        if (ImGui::GetContentRegionAvail().x > 190.0f) {
            ImGui::SameLine(0.0f, 12.0f);
        }
        const std::string delete_selected_label = "Delete selected (" + std::to_string(selected_count) + ")";
        if (toolbar_button(delete_selected_label.c_str(), ImVec2(174.0f, 38.0f), true)) {
            action = TransfersToolbarAction::DeleteSelected;
        }

    }
    if (total_count > 0) {
        if (ImGui::GetContentRegionAvail().x > 116.0f) {
            ImGui::SameLine(0.0f, 8.0f);
        }
        if (toolbar_button("Delete all", ImVec2(104.0f, 38.0f), true)) {
            action = TransfersToolbarAction::DeleteAll;
        }
    }

    return action;
}

}  // namespace misty::panel
