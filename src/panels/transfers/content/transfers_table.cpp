#include "panels/transfers/content/transfers_table.h"

#include <algorithm>
#include <string>

#include "imgui.h"
#include "panels/file_explorer/operations/operation_queue_state.h"
#include "panels/transfers/content/transfers_content_util.h"

namespace misty::panel {
namespace {

constexpr ImVec4 kGreen(0.48f, 0.82f, 0.54f, 1.0f);
constexpr ImVec4 kRed(0.83f, 0.42f, 0.42f, 1.0f);
constexpr ImVec4 kText(0.945f, 0.933f, 0.910f, 1.0f);
constexpr ImVec4 kMuted(0.66f, 0.69f, 0.76f, 1.0f);
constexpr ImVec4 kFaint(0.47f, 0.51f, 0.59f, 1.0f);
constexpr ImVec4 kProgressBg(0.12f, 0.14f, 0.17f, 1.0f);
constexpr ImVec4 kProgressFill(0.40f, 0.64f, 0.88f, 1.0f);
constexpr ImU32 kRowAltBg = IM_COL32(255, 255, 255, 8);
constexpr ImU32 kRowSelectedBg = IM_COL32(59, 86, 122, 70);
constexpr float kCheckboxLeftPadding = 12.0f;

std::string trim_trailing_separators(std::string value) {
    while (value.size() > 1 && (value.back() == '/' || value.back() == '\\')) {
        value.pop_back();
    }
    return value;
}

std::string basename(std::string value) {
    value = trim_trailing_separators(std::move(value));
    const auto slash = value.find_last_of("/\\");
    if (slash != std::string::npos && slash + 1 < value.size()) {
        return value.substr(slash + 1);
    }
    const auto colon = value.find_last_of(':');
    if (colon != std::string::npos && colon + 1 < value.size()) {
        return value.substr(colon + 1);
    }
    return value.empty() ? "Transfer" : value;
}

std::string ellipsize(const std::string& value, float max_width) {
    if (value.empty() || ImGui::CalcTextSize(value.c_str()).x <= max_width) {
        return value;
    }
    constexpr const char* kEllipsis = "...";
    const float ellipsis_width = ImGui::CalcTextSize(kEllipsis).x;
    if (ellipsis_width >= max_width) {
        return kEllipsis;
    }
    std::size_t keep = value.size();
    while (keep > 0) {
        const std::string candidate = value.substr(0, keep) + kEllipsis;
        if (ImGui::CalcTextSize(candidate.c_str()).x <= max_width) {
            return candidate;
        }
        --keep;
    }
    return kEllipsis;
}

void text_ellipsis(const std::string& value, float max_width) {
    const std::string rendered = ellipsize(value, max_width);
    ImGui::TextUnformatted(rendered.c_str());
    if (rendered != value && ImGui::IsItemHovered()) {
        ImGui::SetTooltip("%s", value.c_str());
    }
}

std::string primary_label(const core::FileTransferRecord& row) {
    if (!row.file_name.empty()) {
        return row.file_name;
    }
    const std::string source = transfers_content::source_endpoint(row);
    const std::string target = transfers_content::target_endpoint(row);
    if (!target.empty() && row.transfer_type != core::FileTransferType::Delete) {
        return basename(target);
    }
    return basename(source);
}

std::string secondary_label(const core::FileTransferRecord& row) {
    const std::string source = transfers_content::source_endpoint(row);
    const std::string target = transfers_content::target_endpoint(row);
    if (!target.empty()) {
        return source + " -> " + target;
    }
    return source.empty() ? "--" : source;
}

bool is_failed_status(const core::FileTransferRecord& row) {
    return row.status == core::FileTransferStatus::Failed ||
           row.status == core::FileTransferStatus::Interrupted;
}

ImVec4 status_text_color(const core::FileTransferRecord& row) {
    if (is_failed_status(row)) {
        return kRed;
    }
    if (row.status == core::FileTransferStatus::Completed) {
        return kGreen;
    }
    if (row.status == core::FileTransferStatus::Canceled ||
        row.status == core::FileTransferStatus::Skipped) {
        return kMuted;
    }
    return ImVec4(0.54f, 0.73f, 0.96f, 1.0f);
}

ImVec4 status_bg_color(const core::FileTransferRecord& row) {
    if (is_failed_status(row)) {
        return ImVec4(0.24f, 0.08f, 0.08f, 1.0f);
    }
    if (row.status == core::FileTransferStatus::Completed) {
        return ImVec4(0.07f, 0.20f, 0.13f, 1.0f);
    }
    if (row.status == core::FileTransferStatus::Canceled ||
        row.status == core::FileTransferStatus::Skipped) {
        return ImVec4(0.12f, 0.14f, 0.17f, 1.0f);
    }
    return ImVec4(0.08f, 0.15f, 0.24f, 1.0f);
}

void render_empty_state(float height) {
    ImGui::Dummy(ImVec2(0.0f, std::max(24.0f, height * 0.28f)));
    const float center_x = ImGui::GetCursorPosX() + ImGui::GetContentRegionAvail().x * 0.5f;
    ImDrawList* dl = ImGui::GetWindowDrawList();
    const ImVec2 icon_center(ImGui::GetCursorScreenPos().x + ImGui::GetContentRegionAvail().x * 0.5f,
                             ImGui::GetCursorScreenPos().y + 36.0f);
    dl->AddLine(ImVec2(icon_center.x - 28.0f, icon_center.y - 2.0f),
                ImVec2(icon_center.x + 26.0f, icon_center.y - 2.0f),
                IM_COL32(241, 238, 232, 255), 4.0f);
    dl->AddLine(ImVec2(icon_center.x + 8.0f, icon_center.y - 20.0f),
                ImVec2(icon_center.x + 28.0f, icon_center.y - 2.0f),
                IM_COL32(241, 238, 232, 255), 4.0f);
    dl->AddLine(ImVec2(icon_center.x + 8.0f, icon_center.y + 16.0f),
                ImVec2(icon_center.x + 28.0f, icon_center.y - 2.0f),
                IM_COL32(241, 238, 232, 255), 4.0f);
    dl->AddLine(ImVec2(icon_center.x + 24.0f, icon_center.y + 32.0f),
                ImVec2(icon_center.x - 24.0f, icon_center.y + 32.0f),
                IM_COL32(105, 116, 134, 180), 4.0f);
    dl->AddLine(ImVec2(icon_center.x - 8.0f, icon_center.y + 14.0f),
                ImVec2(icon_center.x - 28.0f, icon_center.y + 32.0f),
                IM_COL32(105, 116, 134, 180), 4.0f);
    dl->AddLine(ImVec2(icon_center.x - 8.0f, icon_center.y + 50.0f),
                ImVec2(icon_center.x - 28.0f, icon_center.y + 32.0f),
                IM_COL32(105, 116, 134, 180), 4.0f);
    ImGui::Dummy(ImVec2(0.0f, 86.0f));

    const std::string title = "No transfers";
    ImGui::SetCursorPosX(center_x - ImGui::CalcTextSize(title.c_str()).x * 0.5f);
    ImGui::TextUnformatted(title.c_str());
    ImGui::PushStyleColor(ImGuiCol_Text, kMuted);
    const char* body = "New uploads, downloads, and local operations will appear here.";
    ImGui::SetCursorPosX(center_x - ImGui::CalcTextSize(body).x * 0.5f);
    ImGui::TextUnformatted(body);
    ImGui::PopStyleColor();
}

void render_inline_progress(const core::FileTransferRecord& row, float width) {
    if (row.status == core::FileTransferStatus::Completed ||
        row.status == core::FileTransferStatus::Canceled ||
        row.status == core::FileTransferStatus::Skipped) {
        return;
    }

    const float progress = transfers_content::progress_fraction(row);
    const ImVec2 pos = ImGui::GetCursorScreenPos();
    const float bar_width = std::max(72.0f, width);
    const float bar_height = 5.0f;
    ImDrawList* draw_list = ImGui::GetWindowDrawList();
    draw_list->AddRectFilled(pos, ImVec2(pos.x + bar_width, pos.y + bar_height),
                             ImGui::GetColorU32(kProgressBg), 3.0f);
    draw_list->AddRectFilled(pos, ImVec2(pos.x + bar_width * progress, pos.y + bar_height),
                             ImGui::GetColorU32(kProgressFill), 3.0f);
    ImGui::Dummy(ImVec2(bar_width, bar_height + 3.0f));
}

void render_status_pill(const core::FileTransferRecord& row) {
    const char* label = transfers_content::status_label(row);
    const ImVec2 text_size = ImGui::CalcTextSize(label);
    const ImVec2 pos = ImGui::GetCursorScreenPos();
    const ImVec2 size(text_size.x + 20.0f, 24.0f);
    ImDrawList* draw_list = ImGui::GetWindowDrawList();
    draw_list->AddRectFilled(pos, ImVec2(pos.x + size.x, pos.y + size.y),
                             ImGui::GetColorU32(status_bg_color(row)), 12.0f);
    draw_list->AddText(ImVec2(pos.x + 10.0f, pos.y + (size.y - text_size.y) * 0.5f),
                       ImGui::GetColorU32(status_text_color(row)), label);
    ImGui::Dummy(size);
}

void render_row_actions(core::StateRegistry& registry,
                        core::WorkerPool& worker_pool,
                        TransfersState& state,
                        const core::FileTransferRecord& row) {
    ImGui::PushID(static_cast<int>(row.id));
    ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 6.0f);
    bool rendered_primary = false;
    if (row.cancelable) {
        if (ImGui::SmallButton("Cancel")) {
            cancel_queued_operation_async(registry, worker_pool, row.id);
        }
        rendered_primary = true;
    } else if (row.retryable &&
               (row.status == core::FileTransferStatus::Failed ||
                row.status == core::FileTransferStatus::Interrupted)) {
        if (ImGui::SmallButton("Retry")) {
            retry_operation_async(registry, worker_pool, row.id);
        }
        rendered_primary = true;
    } else if (row.undoable && row.undo_token_id != 0) {
        if (ImGui::SmallButton("Undo")) {
            undo_operation_async(registry, worker_pool, row.undo_token_id);
        }
        rendered_primary = true;
    }
    if (rendered_primary) {
        ImGui::SameLine(0.0f, 6.0f);
    }
    if (ImGui::SmallButton("Dismiss")) {
        registry.get_state<core::FileTransfer>("FileMasterTransfers").remove_transfer(row.id);
        state.set_selected(row.id, false);
    }
    ImGui::PopStyleVar();
    ImGui::PopID();
}

void render_row(core::StateRegistry& registry,
                core::WorkerPool& worker_pool,
                TransfersState& state,
                const core::FileTransferRecord& row) {
    ImGui::TableNextRow(ImGuiTableRowFlags_None, 76.0f);
    if (state.is_selected(row.id)) {
        ImGui::TableSetBgColor(ImGuiTableBgTarget_RowBg0, kRowSelectedBg);
    }
    if ((row.id % 2) == 0) {
        ImGui::TableSetBgColor(ImGuiTableBgTarget_RowBg1, kRowAltBg);
    }

    ImGui::TableSetColumnIndex(0);
    ImGui::SetCursorPosX(ImGui::GetCursorPosX() + kCheckboxLeftPadding);
    ImGui::PushID(static_cast<int>(row.id));
    bool selected = state.is_selected(row.id);
    if (ImGui::Checkbox("##select_transfer", &selected)) {
        state.set_selected(row.id, selected);
    }
    ImGui::PopID();

    ImGui::TableSetColumnIndex(1);
    const float transfer_width = ImGui::GetContentRegionAvail().x;
    ImGui::PushStyleColor(ImGuiCol_Text, kText);
    text_ellipsis(primary_label(row), transfer_width);
    ImGui::PopStyleColor();
    ImGui::PushStyleColor(ImGuiCol_Text, kMuted);
    text_ellipsis(secondary_label(row), transfer_width);
    ImGui::PopStyleColor();
    if (!row.error_message.empty()) {
        ImGui::PushStyleColor(ImGuiCol_Text, kRed);
        text_ellipsis(row.error_message, transfer_width);
        ImGui::PopStyleColor();
    } else if (!row.detail_message.empty() && row.is_alive()) {
        ImGui::PushStyleColor(ImGuiCol_Text, kFaint);
        text_ellipsis(row.detail_message, transfer_width);
        ImGui::PopStyleColor();
    } else {
        render_inline_progress(row, transfer_width);
    }

    ImGui::TableSetColumnIndex(2);
    ImGui::TextUnformatted(transfers_content::type_label(row.transfer_type));
    ImGui::PushStyleColor(ImGuiCol_Text, kFaint);
    ImGui::TextUnformatted(transfers_content::job_id_text(row).c_str());
    ImGui::PopStyleColor();

    ImGui::TableSetColumnIndex(3);
    render_status_pill(row);

    ImGui::TableSetColumnIndex(4);
    ImGui::PushStyleColor(ImGuiCol_Text, kMuted);
    ImGui::TextUnformatted(transfers_content::started_text(row).c_str());
    ImGui::PopStyleColor();

    ImGui::TableSetColumnIndex(5);
    render_row_actions(registry, worker_pool, state, row);
}

void render_select_page_header(TransfersState& state,
                               const std::vector<core::FileTransferRecord>& rows) {
    if (rows.empty()) {
        ImGui::Dummy(ImVec2(0.0f, ImGui::GetFrameHeight()));
        return;
    }

    bool all_selected = !rows.empty();
    for (const auto& row : rows) {
        all_selected = all_selected && state.is_selected(row.id);
    }
    bool checked = all_selected;
    ImGui::SetCursorPosX(ImGui::GetCursorPosX() + kCheckboxLeftPadding);
    if (ImGui::Checkbox("##select_transfers_page", &checked)) {
        for (const auto& row : rows) {
            state.set_selected(row.id, checked);
        }
    }
    if (ImGui::IsItemHovered()) {
        ImGui::SetTooltip(checked ? "Deselect visible transfers" : "Select visible transfers");
    }
}

}  // namespace

void render_transfers_table(core::StateRegistry& registry,
                            core::WorkerPool& worker_pool,
                            TransfersState& state,
                            const std::vector<core::FileTransferRecord>& rows,
                            float height) {
    const float table_height = std::max(180.0f, height);
    const ImGuiTableFlags flags =
        ImGuiTableFlags_BordersInnerH |
        ImGuiTableFlags_ScrollY |
        ImGuiTableFlags_SizingStretchProp;

    const float content_height = 40.0f + static_cast<float>(rows.size()) * 76.0f;
    const float table_shell_height = rows.empty() ? 50.0f : std::min(table_height, std::max(180.0f, content_height));
    constexpr float kTableOuterPadding = 12.0f;
    ImGui::Indent(kTableOuterPadding);
    ImGui::PushStyleVar(ImGuiStyleVar_CellPadding, ImVec2(6.0f, 12.0f));
    if (ImGui::BeginTable("##transfers_table", 6, flags, ImVec2(0.0f, table_shell_height))) {
        ImGui::TableSetupScrollFreeze(0, 1);
        ImGui::TableSetupColumn("", ImGuiTableColumnFlags_WidthFixed | ImGuiTableColumnFlags_NoResize, 58.0f);
        ImGui::TableSetupColumn("Transfer", ImGuiTableColumnFlags_WidthStretch, 0.58f);
        ImGui::TableSetupColumn("Operation", ImGuiTableColumnFlags_WidthFixed, 124.0f);
        ImGui::TableSetupColumn("Status", ImGuiTableColumnFlags_WidthFixed, 136.0f);
        ImGui::TableSetupColumn("Time", ImGuiTableColumnFlags_WidthFixed, 96.0f);
        ImGui::TableSetupColumn("Actions", ImGuiTableColumnFlags_WidthFixed, 168.0f);
        ImGui::TableNextRow(ImGuiTableRowFlags_Headers, 42.0f);
        ImGui::TableSetColumnIndex(0);
        render_select_page_header(state, rows);
        for (int column = 1; column < 6; ++column) {
            ImGui::TableSetColumnIndex(column);
            const char* label = ImGui::TableGetColumnName(column);
            ImGui::TableHeader(label);
        }

        if (!rows.empty()) {
            for (const auto& row : rows) {
                render_row(registry, worker_pool, state, row);
            }
        }

        ImGui::EndTable();
    }
    ImGui::PopStyleVar();
    ImGui::Unindent(kTableOuterPadding);
    if (rows.empty()) {
        render_empty_state(std::max(180.0f, table_height - table_shell_height));
    }
}

}  // namespace misty::panel
