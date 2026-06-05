#include "panels/transfers/transfers_panel.h"

#include "imgui.h"
#include "panels/file_explorer/operations/operation_queue_state.h"
#include "panels/transfers/content/transfers_content_util.h"
#include "panels/transfers/content/transfers_table.h"
#include "panels/transfers/navigation/transfers_header.h"
#include "panels/transfers/navigation/transfers_toolbar.h"
#include "panels/transfers/state/transfers_state.h"

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

TransfersPanel::TransfersPanel(core::StateRegistry& registry, core::WorkerPool& worker_pool)
    : registry_(registry),
      worker_pool_(worker_pool) {}

void TransfersPanel::render() {
    auto& tracker = registry_.get_state<core::FileTransfer>("FileMasterTransfers");
    auto& state = registry_.get_state<TransfersState>(kTransfersStateKey);

    auto rows = transfers_content::sorted_rows(tracker.get_all_transfers());
    rows = transfers_content::visible_rows(rows, state.search_query());
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
    bool clear_failed = false;
    render_transfers_header(clear_finished, clear_failed);

    ImGui::Dummy(ImVec2(0.0f, 14.0f));
    render_transfers_toolbar(state);

    ImGui::Dummy(ImVec2(0.0f, 18.0f));
    render_transfers_table(registry_, worker_pool_, rows, ImGui::GetContentRegionAvail().y);
    if (clear_finished) {
        clear_completed_operations(registry_);
    }
    if (clear_failed) {
        clear_failed_operations(registry_);
    }
    render_operation_conflict_modal(registry_, worker_pool_);

    ImGui::End();
    ImGui::PopStyleVar();
    ImGui::PopStyleColor();
}

}  // namespace misty::panel
