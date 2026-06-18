#include "panels/transfers/navigation/transfers_header.h"

#include "imgui.h"

namespace misty::panel {
namespace {

constexpr ImVec4 kMutedText(0.64f, 0.66f, 0.72f, 1.0f);

}  // namespace

void render_transfers_header() {
    ImGui::BeginGroup();
    ImGui::SetWindowFontScale(1.22f);
    ImGui::TextUnformatted("File Transfers");
    ImGui::SetWindowFontScale(1.0f);
    ImGui::PushStyleColor(ImGuiCol_Text, kMutedText);
    ImGui::TextUnformatted("Monitor active work and recent transfer history.");
    ImGui::PopStyleColor();
    ImGui::EndGroup();
}

}  // namespace misty::panel
