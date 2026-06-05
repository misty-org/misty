#include "panels/transfers/navigation/transfers_header.h"

#include <algorithm>

#include "imgui.h"

namespace misty::panel {
namespace {

constexpr ImVec4 kMutedText(0.64f, 0.66f, 0.72f, 1.0f);
constexpr ImVec4 kCardBg(0.065f, 0.078f, 0.095f, 1.0f);
constexpr ImVec4 kCardBorder(0.16f, 0.19f, 0.23f, 1.0f);

bool clear_button(const char* label, float width) {
    ImGui::PushStyleColor(ImGuiCol_Button, kCardBg);
    ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.10f, 0.12f, 0.15f, 1.0f));
    ImGui::PushStyleColor(ImGuiCol_ButtonActive, ImVec4(0.08f, 0.10f, 0.13f, 1.0f));
    ImGui::PushStyleColor(ImGuiCol_Border, kCardBorder);
    ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 8.0f);
    ImGui::PushStyleVar(ImGuiStyleVar_FrameBorderSize, 1.0f);
    const bool pressed = ImGui::Button(label, ImVec2(width, 48.0f));
    ImGui::PopStyleVar(2);
    ImGui::PopStyleColor(4);
    return pressed;
}

}  // namespace

void render_transfers_header(bool& clear_finished, bool& clear_failed) {
    clear_finished = false;
    clear_failed = false;

    ImGui::BeginGroup();
    ImGui::SetWindowFontScale(1.22f);
    ImGui::TextUnformatted("File Transfers");
    ImGui::SetWindowFontScale(1.0f);
    ImGui::PushStyleColor(ImGuiCol_Text, kMutedText);
    ImGui::TextUnformatted("Unified transfer monitor");
    ImGui::TextUnformatted("Preview: transfer UI is still being refined before full release.");
    ImGui::PopStyleColor();
    ImGui::EndGroup();

    const float clear_w = 170.0f;
    const float right_x = std::max(ImGui::GetCursorPosX(), ImGui::GetWindowContentRegionMax().x - (clear_w * 2.0f) - 12.0f);
    ImGui::SameLine();
    ImGui::SetCursorPosX(right_x);
    clear_finished = clear_button("Clear Finished", clear_w);
    ImGui::SameLine(0.0f, 12.0f);
    clear_failed = clear_button("Clear Failed", clear_w);
}

}  // namespace misty::panel
