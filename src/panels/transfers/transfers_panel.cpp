#include "panels/transfers/transfers_panel.h"

#include "imgui.h"
#include "panels/transfers/content/transfers_content_util.h"
#include "panels/transfers/content/transfers_footer.h"
#include "panels/transfers/content/transfers_table.h"
#include "panels/transfers/navigation/transfers_header.h"
#include "panels/transfers/navigation/transfers_toolbar.h"
#include "panels/transfers/state/transfers_state.h"

namespace misty::panel {
namespace {

constexpr ImVec4 kWindowBg(0.035f, 0.047f, 0.060f, 1.0f);
constexpr ImVec4 kShellBg(0.052f, 0.065f, 0.082f, 1.0f);
constexpr ImVec4 kShellBorder(0.16f, 0.19f, 0.23f, 1.0f);

}  // namespace

TransfersPanel::TransfersPanel(core::StateRegistry& registry)
    : registry_(registry) {}

void TransfersPanel::render() {
    auto& ui_state = registry_.get_state<TransfersState>(kTransfersStateKey);
    auto& tracker = registry_.get_state<core::FileTransfer>("FileMasterTransfers");

    auto rows = transfers_content::sorted_rows(tracker.get_all_transfers());
    const auto counts = transfers_content::count_rows(rows);
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

    bool clear_finished = false;
    render_transfers_header(counts, clear_finished);
    if (clear_finished) {
        tracker.clear_completed();
        rows = transfers_content::sorted_rows(tracker.get_all_transfers());
    }
    const auto visible_rows = transfers_content::visible_rows(rows, ui_state.search_query());

    ImGui::Dummy(ImVec2(0.0f, 26.0f));

    ImGui::PushStyleColor(ImGuiCol_ChildBg, kShellBg);
    ImGui::PushStyleColor(ImGuiCol_Border, kShellBorder);
    ImGui::PushStyleVar(ImGuiStyleVar_ChildRounding, 8.0f);
    ImGui::PushStyleVar(ImGuiStyleVar_ChildBorderSize, 1.0f);
    ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(18.0f, 18.0f));
    if (ImGui::BeginChild("##transfers_content_shell", ImVec2(0.0f, 0.0f), true,
                          ImGuiWindowFlags_NoScrollbar | ImGuiWindowFlags_NoScrollWithMouse)) {
        render_transfers_toolbar(ui_state);
        ImGui::Dummy(ImVec2(0.0f, 14.0f));
        const float footer_h = 50.0f;
        const float table_h = std::max(180.0f, ImGui::GetContentRegionAvail().y - footer_h - 14.0f);
        render_transfers_table(visible_rows, table_h);
        ImGui::Dummy(ImVec2(0.0f, 10.0f));
        render_transfers_footer(visible_rows.size());
    }
    ImGui::EndChild();
    ImGui::PopStyleVar(3);
    ImGui::PopStyleColor(2);

    ImGui::End();
    ImGui::PopStyleVar();
    ImGui::PopStyleColor();
}

}  // namespace misty::panel
