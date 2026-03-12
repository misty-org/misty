#include "panels/transfers/transfers_panel.h"

#include "imgui.h"
#include "panels/transfers/content/transfers_content_util.h"
#include "panels/transfers/content/transfers_table.h"

namespace misty::panel {
namespace {

constexpr ImVec4 kWindowBg(0.035f, 0.047f, 0.060f, 1.0f);
constexpr ImVec4 kMutedText(0.64f, 0.66f, 0.72f, 1.0f);

void render_header_text() {
    ImGui::SetWindowFontScale(1.22f);
    ImGui::TextUnformatted("File Transfers");
    ImGui::SetWindowFontScale(1.0f);
    ImGui::PushStyleColor(ImGuiCol_Text, kMutedText);
    ImGui::TextUnformatted("In development. Please don't rely on this yet.");
    ImGui::PopStyleColor();
}

}  // namespace

TransfersPanel::TransfersPanel(core::StateRegistry& registry)
    : registry_(registry) {}

void TransfersPanel::render() {
    auto& tracker = registry_.get_state<core::FileTransfer>("FileMasterTransfers");

    auto rows = transfers_content::sorted_rows(tracker.get_all_transfers());
    const ImGuiWindowFlags window_flags =
        ImGuiWindowFlags_NoTitleBar |
        ImGuiWindowFlags_NoMove |
        ImGuiWindowFlags_NoCollapse |
        ImGuiWindowFlags_NoResize |
        ImGuiWindowFlags_NoScrollbar |
        ImGuiWindowFlags_NoScrollWithMouse |
        ImGuiWindowFlags_NoSavedSettings;

    ImGui::PushStyleColor(ImGuiCol_WindowBg, kWindowBg);
    ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(28.0f, 30.0f));
    if (!ImGui::Begin("Transfers", nullptr, window_flags)) {
        ImGui::End();
        ImGui::PopStyleVar();
        ImGui::PopStyleColor();
        return;
    }

    render_header_text();

    ImGui::Dummy(ImVec2(0.0f, 18.0f));
    render_transfers_table(rows, ImGui::GetContentRegionAvail().y);

    ImGui::End();
    ImGui::PopStyleVar();
    ImGui::PopStyleColor();
}

}  // namespace misty::panel
