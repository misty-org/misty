#include "panels/transfers/content/transfers_footer.h"

#include <algorithm>

#include "imgui.h"

namespace misty::panel {
namespace {

constexpr ImVec4 kMuted(0.63f, 0.65f, 0.70f, 1.0f);
constexpr ImVec4 kDisabledButton(0.09f, 0.11f, 0.14f, 0.78f);

void disabled_button(const char* label, float width) {
    ImGui::BeginDisabled();
    ImGui::PushStyleColor(ImGuiCol_Button, kDisabledButton);
    ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 7.0f);
    ImGui::Button(label, ImVec2(width, 40.0f));
    ImGui::PopStyleVar();
    ImGui::PopStyleColor();
    ImGui::EndDisabled();
}

}  // namespace

void render_transfers_footer(std::size_t visible_count) {
    ImGui::PushStyleColor(ImGuiCol_Text, kMuted);
    ImGui::Text("Showing %zu transfers", visible_count);
    ImGui::PopStyleColor();

    const float resume_w = 130.0f;
    const float pause_w = 120.0f;
    const float right_x = ImGui::GetWindowContentRegionMax().x - resume_w - pause_w - 14.0f;
    ImGui::SameLine();
    ImGui::SetCursorPosX(std::max(ImGui::GetCursorPosX(), right_x));
    disabled_button("Pause All", pause_w);
    ImGui::SameLine(0.0f, 14.0f);
    disabled_button("Resume All", resume_w);
}

}  // namespace misty::panel
