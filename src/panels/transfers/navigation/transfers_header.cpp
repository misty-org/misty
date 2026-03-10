#include "panels/transfers/navigation/transfers_header.h"

#include <algorithm>

#include "imgui.h"

namespace misty::panel {
namespace {

constexpr ImVec4 kMutedText(0.64f, 0.66f, 0.72f, 1.0f);
constexpr ImVec4 kCardBg(0.065f, 0.078f, 0.095f, 1.0f);
constexpr ImVec4 kCardBorder(0.16f, 0.19f, 0.23f, 1.0f);
constexpr ImVec4 kBlue(0.32f, 0.55f, 1.0f, 1.0f);
constexpr ImVec4 kGreen(0.29f, 0.83f, 0.42f, 1.0f);
constexpr ImVec4 kRed(0.95f, 0.25f, 0.22f, 1.0f);

void draw_status_icon(ImVec2 min, ImVec4 color, const char* kind) {
    ImDrawList* dl = ImGui::GetWindowDrawList();
    const ImU32 col = ImGui::ColorConvertFloat4ToU32(color);
    const ImVec2 center(min.x + 9.0f, min.y + 9.0f);
    dl->AddCircle(center, 7.0f, col, 20, 2.0f);
    if (kind[0] == 'c') {
        dl->AddLine(ImVec2(center.x - 3.0f, center.y), ImVec2(center.x - 0.5f, center.y + 2.5f), col, 2.0f);
        dl->AddLine(ImVec2(center.x - 0.5f, center.y + 2.5f), ImVec2(center.x + 4.0f, center.y - 3.5f), col, 2.0f);
    } else if (kind[0] == 'f') {
        dl->AddLine(ImVec2(center.x - 3.0f, center.y - 3.0f), ImVec2(center.x + 3.0f, center.y + 3.0f), col, 2.0f);
        dl->AddLine(ImVec2(center.x + 3.0f, center.y - 3.0f), ImVec2(center.x - 3.0f, center.y + 3.0f), col, 2.0f);
    }
}

void stat_card(const char* label, std::size_t value, ImVec4 color, const char* icon_kind, float width) {
    ImGui::PushStyleColor(ImGuiCol_ChildBg, kCardBg);
    ImGui::PushStyleColor(ImGuiCol_Border, kCardBorder);
    ImGui::PushStyleVar(ImGuiStyleVar_ChildRounding, 8.0f);
    ImGui::PushStyleVar(ImGuiStyleVar_ChildBorderSize, 1.0f);
    ImGui::BeginChild(label, ImVec2(width, 48.0f), true, ImGuiWindowFlags_NoScrollbar | ImGuiWindowFlags_NoScrollWithMouse);

    const ImVec2 icon_pos = ImGui::GetCursorScreenPos();
    draw_status_icon(ImVec2(icon_pos.x + 10.0f, icon_pos.y + 14.0f), color, icon_kind);
    ImGui::SetCursorPos(ImVec2(42.0f, 15.0f));
    ImGui::PushStyleColor(ImGuiCol_Text, color);
    ImGui::TextUnformatted(label);
    ImGui::PopStyleColor();
    ImGui::SameLine();
    ImGui::SetCursorPosX(width - 34.0f);
    ImGui::Text("%zu", value);

    ImGui::EndChild();
    ImGui::PopStyleVar(2);
    ImGui::PopStyleColor(2);
}

bool clear_button(float width) {
    ImGui::PushStyleColor(ImGuiCol_Button, kCardBg);
    ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.10f, 0.12f, 0.15f, 1.0f));
    ImGui::PushStyleColor(ImGuiCol_ButtonActive, ImVec4(0.08f, 0.10f, 0.13f, 1.0f));
    ImGui::PushStyleColor(ImGuiCol_Border, kCardBorder);
    ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 8.0f);
    ImGui::PushStyleVar(ImGuiStyleVar_FrameBorderSize, 1.0f);
    const bool pressed = ImGui::Button("Clear Finished", ImVec2(width, 48.0f));
    ImGui::PopStyleVar(2);
    ImGui::PopStyleColor(4);
    return pressed;
}

}  // namespace

void render_transfers_header(const transfers_content::TransferCounts& counts, bool& clear_finished) {
    clear_finished = false;

    const float content_w = ImGui::GetContentRegionAvail().x;
    const float title_w = std::max(260.0f, content_w - 650.0f);
    ImGui::BeginGroup();
    ImGui::SetWindowFontScale(1.22f);
    ImGui::TextUnformatted("File Transfers");
    ImGui::SetWindowFontScale(1.0f);
    ImGui::PushStyleColor(ImGuiCol_Text, kMutedText);
    ImGui::TextUnformatted("Unified transfer monitor");
    ImGui::PopStyleColor();
    ImGui::EndGroup();

    ImGui::SameLine(title_w);
    stat_card("Active", counts.active, kBlue, "active", 146.0f);
    ImGui::SameLine(0.0f, 14.0f);
    stat_card("Completed", counts.completed, kGreen, "complete", 182.0f);
    ImGui::SameLine(0.0f, 14.0f);
    stat_card("Failed", counts.failed, kRed, "failed", 146.0f);
    ImGui::SameLine();

    const float clear_w = 170.0f;
    const float right_x = std::max(ImGui::GetCursorPosX(), ImGui::GetWindowContentRegionMax().x - clear_w);
    ImGui::SetCursorPosX(right_x);
    clear_finished = clear_button(clear_w);
}

}  // namespace misty::panel
