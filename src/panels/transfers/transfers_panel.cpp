#include "panels/transfers/transfers_panel.h"

#include <algorithm>
#include <string>
#include <vector>

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

std::size_t page_count_for(std::size_t total_count) {
    if (total_count == 0) {
        return 1;
    }
    return (total_count + TransfersState::kPageSize - 1) / TransfersState::kPageSize;
}

core::FileTransferPage page_for_rows(const std::vector<core::FileTransferRecord>& rows,
                                     std::size_t offset,
                                     std::size_t limit) {
    core::FileTransferPage page;
    page.total_count = rows.size();
    if (offset >= rows.size() || limit == 0) {
        return page;
    }
    const auto first = rows.begin() + static_cast<std::ptrdiff_t>(offset);
    const auto last = rows.begin() + static_cast<std::ptrdiff_t>(std::min(rows.size(), offset + limit));
    page.rows.assign(first, last);
    return page;
}

void render_pagination_controls(TransfersState& state, std::size_t total_count) {
    const std::size_t page_count = page_count_for(total_count);
    const std::size_t page_number = total_count == 0 ? 0 : state.page_index() + 1;
    const std::string label = total_count == 0
        ? "No transfers"
        : "Page " + std::to_string(page_number) + " of " + std::to_string(page_count) +
              "  |  " + std::to_string(total_count) + " transfers";

    ImGui::PushStyleColor(ImGuiCol_Text, kMutedText);
    ImGui::TextUnformatted(label.c_str());
    ImGui::PopStyleColor();

    const float next_w = 68.0f;
    const float prev_w = 84.0f;
    const float gap = 8.0f;
    ImGui::SameLine();
    ImGui::SetCursorPosX(std::max(ImGui::GetCursorPosX(),
                                  ImGui::GetWindowContentRegionMax().x - prev_w - next_w - gap));

    ImGui::BeginDisabled(state.page_index() == 0 || total_count == 0);
    if (ImGui::Button("Previous", ImVec2(prev_w, 0.0f))) {
        state.previous_page();
    }
    ImGui::EndDisabled();
    ImGui::SameLine(0.0f, gap);
    ImGui::BeginDisabled(state.page_index() + 1 >= page_count || total_count == 0);
    if (ImGui::Button("Next", ImVec2(next_w, 0.0f))) {
        state.next_page(page_count);
    }
    ImGui::EndDisabled();
}

bool render_delete_all_confirmation(std::size_t total_count) {
    bool confirmed = false;
    ImGui::SetNextWindowSize(ImVec2(420.0f, 0.0f), ImGuiCond_Appearing);
    if (ImGui::BeginPopupModal("Delete all transfers?",
                               nullptr,
                               ImGuiWindowFlags_AlwaysAutoResize | ImGuiWindowFlags_NoMove)) {
        ImGui::TextWrapped("This will remove all %zu transfer history entries from this list.", total_count);
        ImGui::Dummy(ImVec2(0.0f, 10.0f));

        if (ImGui::Button("Cancel", ImVec2(110.0f, 0.0f))) {
            ImGui::CloseCurrentPopup();
        }
        ImGui::SameLine();
        ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.22f, 0.08f, 0.08f, 1.0f));
        ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.32f, 0.12f, 0.12f, 1.0f));
        ImGui::PushStyleColor(ImGuiCol_ButtonActive, ImVec4(0.42f, 0.14f, 0.14f, 1.0f));
        if (ImGui::Button("Delete all", ImVec2(120.0f, 0.0f))) {
            confirmed = true;
            ImGui::CloseCurrentPopup();
        }
        ImGui::PopStyleColor(3);
        ImGui::EndPopup();
    }
    return confirmed;
}

}  // namespace

TransfersPanel::TransfersPanel(core::StateRegistry& registry, core::WorkerPool& worker_pool)
    : registry_(registry),
      worker_pool_(worker_pool) {}

void TransfersPanel::render() {
    auto& tracker = registry_.get_state<core::FileTransfer>("FileMasterTransfers");
    auto& state = registry_.get_state<TransfersState>(kTransfersStateKey);
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

    render_transfers_header();

    ImGui::Dummy(ImVec2(0.0f, 14.0f));
    auto all_rows = tracker.get_all_transfers();
    state.prune_selection(all_rows);
    const auto counts = transfers_content::count_rows(all_rows);
    const TransfersToolbarAction toolbar_action = render_transfers_toolbar(state, counts);
    switch (toolbar_action) {
        case TransfersToolbarAction::DeleteSelected:
            for (const auto transfer_id : state.selected_transfer_ids()) {
                tracker.remove_transfer(transfer_id);
            }
            state.clear_selection();
            all_rows = tracker.get_all_transfers();
            break;
        case TransfersToolbarAction::DeleteAll:
            ImGui::OpenPopup("Delete all transfers?");
            break;
        case TransfersToolbarAction::None:
            break;
    }
    if (render_delete_all_confirmation(all_rows.size())) {
        tracker.clear_all();
        state.clear_selection();
        state.set_page_index(0);
        all_rows = tracker.get_all_transfers();
    }
    state.update_search_revision();

    auto visible_rows = transfers_content::visible_rows(
        transfers_content::sorted_rows(all_rows), state.search_query(), state.filter());
    state.clamp_page(visible_rows.size());
    auto page = page_for_rows(visible_rows, state.page_offset(), TransfersState::kPageSize);
    state.clamp_page(page.total_count);

    ImGui::Dummy(ImVec2(0.0f, 18.0f));
    render_transfers_table(
        registry_, worker_pool_, state, page.rows, std::max(180.0f, ImGui::GetContentRegionAvail().y - 38.0f));
    ImGui::Dummy(ImVec2(0.0f, 8.0f));
    render_pagination_controls(state, page.total_count);
    render_operation_conflict_modal(registry_, worker_pool_);

    ImGui::End();
    ImGui::PopStyleVar();
    ImGui::PopStyleColor();
}

}  // namespace misty::panel
