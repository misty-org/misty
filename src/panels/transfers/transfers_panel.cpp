#include "panels/transfers/transfers_panel.h"

#include <algorithm>
#include <map>
#include <array>
#include <string>
#include <vector>

#include "imgui.h"
#include <nlohmann/json.hpp>
#include "panels/file_explorer/operations/operation_queue_state.h"
#include "panels/providers/state/providers_state.h"
#include "panels/transfers/content/transfers_content_util.h"
#include "panels/transfers/content/transfers_table.h"
#include "panels/transfers/navigation/transfers_header.h"
#include "panels/transfers/navigation/transfers_toolbar.h"
#include "panels/transfers/state/transfers_state.h"

namespace misty::panel {
namespace {

using json = nlohmann::json;

constexpr ImVec4 kWindowBg(0.035f, 0.047f, 0.060f, 1.0f);
constexpr ImVec4 kMutedText(0.64f, 0.66f, 0.72f, 1.0f);
constexpr ImVec4 kPanelBg(0.045f, 0.057f, 0.071f, 1.0f);
constexpr ImVec4 kPanelHover(0.075f, 0.091f, 0.110f, 1.0f);
constexpr ImVec4 kPanelSelected(0.105f, 0.135f, 0.175f, 1.0f);
constexpr ImVec4 kBorder(0.245f, 0.270f, 0.305f, 1.0f);
constexpr ImVec4 kText(0.945f, 0.933f, 0.910f, 1.0f);
constexpr float kTransfersWorkspaceMinWidth = 1120.0f;

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

bool render_delete_confirmation(const char* popup_id,
                                const char* title,
                                const std::string& message,
                                const char* confirm_label) {
    bool confirmed = false;
    ImGui::SetNextWindowSize(ImVec2(420.0f, 0.0f), ImGuiCond_Appearing);
    if (ImGui::BeginPopupModal(popup_id,
                               nullptr,
                               ImGuiWindowFlags_AlwaysAutoResize | ImGuiWindowFlags_NoMove)) {
        ImGui::TextUnformatted(title);
        ImGui::Separator();
        ImGui::TextWrapped("%s", message.c_str());
        ImGui::Dummy(ImVec2(0.0f, 10.0f));

        if (ImGui::Button("Cancel", ImVec2(110.0f, 0.0f))) {
            ImGui::CloseCurrentPopup();
        }
        ImGui::SameLine();
        ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.22f, 0.08f, 0.08f, 1.0f));
        ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.32f, 0.12f, 0.12f, 1.0f));
        ImGui::PushStyleColor(ImGuiCol_ButtonActive, ImVec4(0.42f, 0.14f, 0.14f, 1.0f));
        if (ImGui::Button(confirm_label, ImVec2(140.0f, 0.0f))) {
            confirmed = true;
            ImGui::CloseCurrentPopup();
        }
        ImGui::PopStyleColor(3);
        ImGui::EndPopup();
    }
    return confirmed;
}

std::map<std::string, std::string> remote_label_map(core::StateRegistry& registry) {
    std::map<std::string, std::string> labels;
    auto& providers = registry.get_state<ProvidersState>("Providers");
    for (const auto& card : providers.provider_cards_snapshot()) {
        std::string label = card.provider_label.empty() ? card.id : card.provider_label;
        if (!card.account_label.empty() && card.account_label != card.id) {
            label += " · " + card.account_label;
        } else if (label != card.id) {
            label += " · " + card.id;
        }
        labels[card.id] = std::move(label);
    }
    return labels;
}

std::string selected_provider_label(
    const std::vector<transfers_content::TransferProviderGroup>& groups,
    const std::string& selected) {
    if (selected.empty()) {
        return "All Transfers";
    }
    for (const auto& group : groups) {
        if (group.key == selected) {
            return group.label;
        }
    }
    return selected == transfers_content::kTransferProviderLocal ? "Local" : selected;
}

void filter_heading(const char* label) {
    ImGui::Dummy(ImVec2(0.0f, 6.0f));
    ImGui::PushStyleColor(ImGuiCol_Text, kText);
    ImGui::TextUnformatted(label);
    ImGui::PopStyleColor();
    ImGui::Dummy(ImVec2(0.0f, 2.0f));
}

void render_filter_controls(TransfersState& state,
                            const std::vector<transfers_content::TransferProviderGroup>& groups) {
    filter_heading("Providers");
    for (const auto& group : groups) {
        if (group.key == transfers_content::kTransferProviderLocal) {
            continue;
        }
        bool selected = state.provider_selected(group.key);
        const std::string label = group.label + "  " + std::to_string(group.count);
        ImGui::PushID(group.key.c_str());
        if (ImGui::Checkbox(label.c_str(), &selected)) {
            state.toggle_provider_filter(group.key);
        }
        ImGui::PopID();
    }
    if (groups.empty()) {
        ImGui::PushStyleColor(ImGuiCol_Text, kMutedText);
        ImGui::TextUnformatted("No remote providers");
        ImGui::PopStyleColor();
    }

    filter_heading("Transfer Type");
    constexpr std::array<core::FileTransferType, 7> types = {
        core::FileTransferType::Upload,
        core::FileTransferType::Download,
        core::FileTransferType::Create,
        core::FileTransferType::Copy,
        core::FileTransferType::Move,
        core::FileTransferType::Rename,
        core::FileTransferType::Delete,
    };
    for (const auto type : types) {
        bool selected = state.type_selected(type);
        ImGui::PushID(static_cast<int>(type));
        if (ImGui::Checkbox(transfers_content::type_label(type), &selected)) {
            state.toggle_type_filter(type);
        }
        ImGui::PopID();
    }

    filter_heading("Location");
    ImGui::PushID("location_filters");
    const auto location_item = [&](const char* label, TransferLocationScope scope) {
        if (ImGui::RadioButton(label, state.location_scope() == scope)) {
            state.set_location_scope(scope);
        }
    };
    location_item("All", TransferLocationScope::All);
    location_item("Local only", TransferLocationScope::Local);
    location_item("Remote", TransferLocationScope::Remote);
    ImGui::PopID();

    filter_heading("Status");
    ImGui::PushID("status_filters");
    const auto status_item = [&](core::FileTransferFilter filter) {
        if (ImGui::RadioButton(transfers_content::filter_label(filter), state.filter() == filter)) {
            state.set_filter(filter);
        }
    };
    status_item(core::FileTransferFilter::All);
    status_item(core::FileTransferFilter::Active);
    status_item(core::FileTransferFilter::Completed);
    status_item(core::FileTransferFilter::Failed);
    ImGui::PopID();

    filter_heading("Sort");
    constexpr std::array<std::pair<TransferSortKey, const char*>, 4> sort_keys = {{
        {TransferSortKey::Time, "Time"},
        {TransferSortKey::Name, "Name"},
        {TransferSortKey::Operation, "Operation"},
        {TransferSortKey::Status, "Status"},
    }};
    const char* sort_preview = "Time";
    for (const auto& [key, label] : sort_keys) {
        if (state.sort_key() == key) sort_preview = label;
    }
    ImGui::SetNextItemWidth(-1.0f);
    if (ImGui::BeginCombo("##transfer_sort_key", sort_preview)) {
        for (const auto& [key, label] : sort_keys) {
            if (ImGui::Selectable(label, state.sort_key() == key)) {
                state.set_sort(key, state.sort_direction());
            }
        }
        ImGui::EndCombo();
    }
    const bool ascending = state.sort_direction() == TransferSortDirection::Ascending;
    if (ImGui::RadioButton("Ascending", ascending)) {
        state.set_sort(state.sort_key(), TransferSortDirection::Ascending);
    }
    if (ImGui::RadioButton("Descending", !ascending)) {
        state.set_sort(state.sort_key(), TransferSortDirection::Descending);
    }

    ImGui::Dummy(ImVec2(0.0f, 8.0f));
    ImGui::BeginDisabled(state.active_filter_count() == 0);
    if (ImGui::Button("Clear filters", ImVec2(-1.0f, 32.0f))) {
        state.clear_filters();
    }
    ImGui::EndDisabled();
}

void render_filters_panel(TransfersState& state,
                          const std::vector<transfers_content::TransferProviderGroup>& groups,
                          float width,
                          float height) {
    ImGui::PushStyleVar(ImGuiStyleVar_ChildRounding, 8.0f);
    ImGui::PushStyleVar(ImGuiStyleVar_ChildBorderSize, 1.0f);
    ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(12.0f, 14.0f));
    ImGui::PushStyleColor(ImGuiCol_ChildBg, kPanelBg);
    ImGui::PushStyleColor(ImGuiCol_Border, kBorder);
    if (ImGui::BeginChild("##transfers_provider_nav", ImVec2(width, height), true)) {
        ImGui::PushStyleColor(ImGuiCol_Text, kText);
        ImGui::TextUnformatted("Filters");
        ImGui::PopStyleColor();
        ImGui::Dummy(ImVec2(0.0f, 8.0f));
        render_filter_controls(state, groups);
    }
    ImGui::EndChild();
    ImGui::PopStyleColor(2);
    ImGui::PopStyleVar(3);
}

const core::FileTransferRecord* find_transfer(const std::vector<core::FileTransferRecord>& rows, uint64_t transfer_id) {
    const auto it = std::find_if(rows.begin(), rows.end(), [&](const core::FileTransferRecord& row) {
        return row.id == transfer_id;
    });
    return it == rows.end() ? nullptr : &*it;
}

void detail_row(const char* label, const std::string& value) {
    ImGui::PushStyleColor(ImGuiCol_Text, kMutedText);
    ImGui::TextUnformatted(label);
    ImGui::PopStyleColor();
    ImGui::PushTextWrapPos(ImGui::GetCursorPosX() + ImGui::GetContentRegionAvail().x);
    ImGui::PushStyleColor(ImGuiCol_Text, value.empty() ? kMutedText : kText);
    ImGui::TextWrapped("%s", value.empty() ? "--" : value.c_str());
    ImGui::PopStyleColor();
    ImGui::PopTextWrapPos();
    ImGui::Dummy(ImVec2(0.0f, 8.0f));
}

void render_transfer_detail(core::StateRegistry& registry,
                            core::WorkerPool& worker_pool,
                            TransfersState& state,
                            const core::FileTransferRecord* row,
                            float width,
                            float height,
                            bool show_back = false) {
    ImGui::PushStyleVar(ImGuiStyleVar_ChildRounding, 8.0f);
    ImGui::PushStyleVar(ImGuiStyleVar_ChildBorderSize, 1.0f);
    ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(16.0f, 16.0f));
    ImGui::PushStyleColor(ImGuiCol_ChildBg, kPanelBg);
    ImGui::PushStyleColor(ImGuiCol_Border, kBorder);
    if (ImGui::BeginChild("##transfers_detail_panel", ImVec2(width, height), true)) {
        if (show_back && ImGui::Button("Back", ImVec2(72.0f, 30.0f))) {
            state.clear_focused_transfer();
        }
        if (show_back) {
            ImGui::SameLine();
        }
        ImGui::PushStyleColor(ImGuiCol_Text, kText);
        ImGui::TextUnformatted("Transfer Detail");
        ImGui::PopStyleColor();
        ImGui::Dummy(ImVec2(0.0f, 12.0f));
        if (!row) {
            ImGui::PushStyleColor(ImGuiCol_Text, kMutedText);
            ImGui::TextWrapped("Select a transfer to inspect its endpoints, progress, and actions.");
            ImGui::PopStyleColor();
        } else {
            detail_row("File", row->file_name);
            detail_row("Operation", transfers_content::type_label(row->transfer_type));
            detail_row("Status", transfers_content::status_label(*row));
            detail_row("Progress", transfers_content::progress_text(*row));
            detail_row("Source", transfers_content::source_endpoint(*row));
            detail_row("Destination", transfers_content::target_endpoint(*row));
            detail_row("Remote", row->remote_source_name.empty() ? row->remote_dest_name : row->remote_source_name);
            detail_row("Started", transfers_content::started_text(*row));
            detail_row("Job", transfers_content::job_id_text(*row));
            if (!row->detail_message.empty()) {
                detail_row("Detail", row->detail_message);
            }
            if (!row->error_message.empty()) {
                detail_row("Error", row->error_message);
            }

            ImGui::Separator();
            ImGui::Dummy(ImVec2(0.0f, 10.0f));
            if (row->cancelable && ImGui::Button("Cancel", ImVec2(-1.0f, 34.0f))) {
                cancel_queued_operation_async(registry, worker_pool, row->id);
            }
            if (row->retryable &&
                (row->status == core::FileTransferStatus::Failed ||
                 row->status == core::FileTransferStatus::Interrupted) &&
                ImGui::Button("Retry", ImVec2(-1.0f, 34.0f))) {
                retry_operation_async(registry, worker_pool, row->id);
            }
            if (row->undoable && row->undo_token_id != 0 && ImGui::Button("Undo", ImVec2(-1.0f, 34.0f))) {
                undo_operation_async(registry, worker_pool, row->undo_token_id);
            }
        }
    }
    ImGui::EndChild();
    ImGui::PopStyleColor(2);
    ImGui::PopStyleVar(3);
}

}  // namespace

TransfersPanel::TransfersPanel(core::StateRegistry& registry,
                               core::WorkerPool& worker_pool,
                               TransfersPanelProps props)
    : MultiPanel(std::move(props.panel_id)),
      registry_(registry),
      worker_pool_(worker_pool),
      state_key_(std::move(props.state_key)),
      owns_state_cleanup_(props.owns_state_cleanup) {}

std::string TransfersPanel::save_restore_state() const {
    const auto& state = const_cast<core::StateRegistry&>(registry_).get_state<TransfersState>(state_key_);
    json data;
    data["search"] = state.search_query();
    data["status"] = static_cast<int>(state.filter());
    data["location"] = static_cast<int>(state.location_scope());
    data["sort_key"] = static_cast<int>(state.sort_key());
    data["sort_direction"] = static_cast<int>(state.sort_direction());
    data["filters_visible"] = state.filters_panel_visible();
    data["page"] = state.page_index();
    data["focused"] = state.focused_transfer_id();
    data["providers"] = state.provider_filters();
    std::vector<int> types;
    for (const auto type : state.type_filters()) types.push_back(static_cast<int>(type));
    data["types"] = std::move(types);
    data["selected"] = state.selected_transfer_ids();
    return data.dump();
}

void TransfersPanel::load_restore_state(const std::string& encoded_state) {
    if (encoded_state.empty()) return;
    const json data = json::parse(encoded_state, nullptr, false);
    if (data.is_discarded()) return;
    auto& state = registry_.get_state<TransfersState>(state_key_);
    const std::string search = data.value("search", std::string{});
    std::snprintf(state.search_query(), state.search_query_capacity(), "%s", search.c_str());
    state.set_filter(static_cast<core::FileTransferFilter>(data.value("status", 1)));
    state.set_location_scope(static_cast<TransferLocationScope>(data.value("location", 0)));
    state.set_sort(static_cast<TransferSortKey>(data.value("sort_key", 0)),
                   static_cast<TransferSortDirection>(data.value("sort_direction", 1)));
    state.set_filters_panel_visible(data.value("filters_visible", true));
    for (const auto& provider : data.value("providers", std::vector<std::string>{})) {
        state.toggle_provider_filter(provider);
    }
    for (const int type : data.value("types", std::vector<int>{})) {
        state.toggle_type_filter(static_cast<core::FileTransferType>(type));
    }
    state.set_page_index(data.value("page", static_cast<std::size_t>(0)));
    state.set_focused_transfer_id(data.value("focused", static_cast<uint64_t>(0)));
    for (const uint64_t id : data.value("selected", std::vector<uint64_t>{})) {
        state.set_selected(id, true);
    }
}

void TransfersPanel::release_state() {
    if (owns_state_cleanup_) registry_.erase_state(state_key_);
}

TabController::Tab TransfersPanel::create_default_tab(std::int16_t tab_idx) const {
    TransfersPanelProps props;
    props.panel_id = panel_id() + "_tab_" + std::to_string(tab_idx);
    props.state_key = state_key_ + "_tab_" + std::to_string(tab_idx);
    props.owns_state_cleanup = true;
    TabController::Tab tab;
    tab.context_key = props.state_key;
    tab.state_key = props.state_key;
    tab.title = "Transfers";
    tab.idx = tab_idx;
    tab.panel = std::make_shared<TransfersPanel>(registry_, worker_pool_, std::move(props));
    return tab;
}

bool TransfersPanel::shows_tab_bar(const Pane& pane) const {
    (void)pane;
    return true;
}

void TransfersPanel::render_panel_contents() {
    auto& tracker = registry_.get_state<core::FileTransfer>("FileMasterTransfers");
    auto& state = registry_.get_state<TransfersState>(state_key_);

    const float pane_width = ImGui::GetContentRegionAvail().x;
    const bool compact_pane = pane_width < 760.0f;
    const ImVec2 workspace_padding(
        compact_pane ? 16.0f : 28.0f,
        compact_pane ? 18.0f : 24.0f);

    ImGui::PushStyleColor(ImGuiCol_ChildBg, kWindowBg);
    ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, workspace_padding);
    ImGui::BeginChild("##transfers_workspace", ImVec2(0.0f, 0.0f),
                      ImGuiChildFlags_AlwaysUseWindowPadding,
                      ImGuiWindowFlags_NoScrollbar | ImGuiWindowFlags_NoScrollWithMouse);

    render_transfers_header();

    ImGui::Dummy(ImVec2(0.0f, 14.0f));
    auto all_rows = tracker.get_all_transfers();
    state.prune_selection(all_rows);
    const auto counts = transfers_content::count_rows(all_rows);
    const TransfersToolbarAction toolbar_action = render_transfers_toolbar(state, counts);
    switch (toolbar_action) {
        case TransfersToolbarAction::ToggleFilters:
            ImGui::OpenPopup("##transfer_filters_popup");
            break;
        case TransfersToolbarAction::DeleteSelected:
            ImGui::OpenPopup("Delete selected transfers?");
            break;
        case TransfersToolbarAction::DeleteAll:
            ImGui::OpenPopup("Delete all transfers?");
            break;
        case TransfersToolbarAction::None:
            break;
    }
    const std::string selected_message = "This will remove " + std::to_string(state.selected_count()) +
        " selected transfer history entries. Running operations are not canceled.";
    if (render_delete_confirmation("Delete selected transfers?", "Delete selected transfers?",
                                   selected_message, "Delete selected")) {
        for (const auto transfer_id : state.selected_transfer_ids()) tracker.remove_transfer(transfer_id);
        state.clear_selection();
        all_rows = tracker.get_all_transfers();
    }
    const std::string all_message = "This will remove all " + std::to_string(all_rows.size()) +
        " transfer history entries. Current filters are ignored and running operations are not canceled.";
    if (render_delete_confirmation("Delete all transfers?", "Delete all transfers?",
                                   all_message, "Delete all")) {
        tracker.clear_all();
        state.clear_selection();
        state.set_page_index(0);
        all_rows = tracker.get_all_transfers();
    }
    state.update_search_revision();

    const auto provider_labels = remote_label_map(registry_);
    const auto provider_groups = transfers_content::provider_groups(all_rows, provider_labels);
    auto visible_rows = transfers_content::visible_rows(
        all_rows, state.search_query(), state.filter(), state.provider_filters(),
        state.type_filters(), state.location_scope());
    visible_rows = transfers_content::sorted_rows(
        std::move(visible_rows), state.sort_key(), state.sort_direction());
    state.clamp_page(visible_rows.size());
    state.prune_focused_transfer(visible_rows);
    auto page = page_for_rows(visible_rows, state.page_offset(), TransfersState::kPageSize);
    state.clamp_page(page.total_count);

    ImGui::Dummy(ImVec2(0.0f, 18.0f));
    const float panel_height = std::max(220.0f, ImGui::GetContentRegionAvail().y);
    const float gap = 12.0f;
    const float content_width = ImGui::GetContentRegionAvail().x;

    ImGui::SetNextWindowSize(ImVec2(290.0f, 0.0f), ImGuiCond_Appearing);
    if (ImGui::BeginPopup("##transfer_filters_popup")) {
        render_filter_controls(state, provider_groups);
        ImGui::EndPopup();
    }

    const core::FileTransferRecord* focused = find_transfer(visible_rows, state.focused_transfer_id());
    const float canvas_width = std::max(content_width, kTransfersWorkspaceMinWidth);
    const float filters_width = 230.0f;
    const float detail_width = std::clamp(canvas_width * 0.27f, 300.0f, 360.0f);
    const float table_width = canvas_width - filters_width - detail_width - gap * 2.0f;

    ImGui::SetNextWindowContentSize(ImVec2(canvas_width, 0.0f));
    ImGui::PushStyleVar(ImGuiStyleVar_ScrollbarSize, 8.0f);
    if (ImGui::BeginChild("##transfers_three_panel_workspace", ImVec2(content_width, panel_height), false,
                          ImGuiWindowFlags_HorizontalScrollbar)) {
        const float inner_height = std::max(220.0f, ImGui::GetContentRegionAvail().y);
        render_filters_panel(state, provider_groups, filters_width, inner_height);
        ImGui::SameLine(0.0f, gap);

        ImGui::PushStyleVar(ImGuiStyleVar_ChildRounding, 8.0f);
        ImGui::PushStyleVar(ImGuiStyleVar_ChildBorderSize, 1.0f);
        ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(12.0f, 12.0f));
        ImGui::PushStyleColor(ImGuiCol_ChildBg, kPanelBg);
        ImGui::PushStyleColor(ImGuiCol_Border, kBorder);
        if (ImGui::BeginChild("##transfers_main_panel", ImVec2(table_width, inner_height), true)) {
            ImGui::PushStyleColor(ImGuiCol_Text, kMutedText);
            ImGui::TextUnformatted("Transfers");
            ImGui::PopStyleColor();
            const float table_height = std::max(160.0f, ImGui::GetContentRegionAvail().y - 38.0f);
            render_transfers_table(registry_, worker_pool_, state, page.rows, table_height);
            ImGui::Dummy(ImVec2(0.0f, 8.0f));
            render_pagination_controls(state, page.total_count);
        }
        ImGui::EndChild();
        ImGui::PopStyleColor(2);
        ImGui::PopStyleVar(3);

        ImGui::SameLine(0.0f, gap);
        render_transfer_detail(registry_, worker_pool_, state, focused, detail_width, inner_height);
    }
    ImGui::EndChild();
    ImGui::PopStyleVar();
    render_operation_conflict_modal(registry_, worker_pool_);

    ImGui::EndChild();
    ImGui::PopStyleVar();
    ImGui::PopStyleColor();
}

}  // namespace misty::panel
