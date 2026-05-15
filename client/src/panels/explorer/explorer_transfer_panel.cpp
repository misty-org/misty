#include "panels/explorer/explorer_transfer_panel.h"

#include <algorithm>
#include <array>
#include <cfloat>
#include <iomanip>
#include <sstream>

#include "panels/explorer/explorer_transfer_ui_state.h"

namespace misty::panel {
namespace {

using misty::core::FileMasterTransfers;
using misty::core::FileTransferDirection;
using misty::core::FileTransferFilter;
using misty::core::FileTransferRecord;
using misty::core::FileTransferStatus;

std::string format_bytes(int64_t bytes) {
    if (bytes < 0) {
        return "--";
    }

    static constexpr std::array<const char*, 5> suffixes = {"B", "KB", "MB", "GB", "TB"};
    double value = static_cast<double>(bytes);
    size_t suffix_index = 0;
    while (value >= 1024.0 && suffix_index + 1 < suffixes.size()) {
        value /= 1024.0;
        ++suffix_index;
    }

    std::ostringstream out;
    if (suffix_index == 0) {
        out << static_cast<int64_t>(value) << ' ' << suffixes[suffix_index];
    } else {
        out << std::fixed << std::setprecision(value >= 10.0 ? 0 : 1) << value << ' ' << suffixes[suffix_index];
    }
    return out.str();
}

const char* filter_label(FileTransferFilter filter) {
    switch (filter) {
        case FileTransferFilter::Active: return "Active";
        case FileTransferFilter::All: return "All";
        case FileTransferFilter::Failed: return "Failed";
        case FileTransferFilter::Completed: return "Completed";
    }
    return "Active";
}

bool matches_filter(const FileTransferRecord& row, FileTransferFilter filter) {
    switch (filter) {
        case FileTransferFilter::Active:
            return row.is_active();
        case FileTransferFilter::Failed:
            return row.status == FileTransferStatus::Failed;
        case FileTransferFilter::Completed:
            return row.status == FileTransferStatus::Completed;
        case FileTransferFilter::All:
            return true;
    }
    return true;
}

std::string progress_text(const FileTransferRecord& row) {
    if (row.total_bytes > 0) {
        return format_bytes(row.transferred_bytes) + " / " + format_bytes(row.total_bytes);
    }
    if (row.transferred_bytes > 0) {
        return format_bytes(row.transferred_bytes);
    }
    return "--";
}

float progress_fraction(const FileTransferRecord& row) {
    if (row.total_bytes <= 0) {
        return row.is_active() ? 0.0f : 1.0f;
    }
    return std::clamp(
        static_cast<float>(row.transferred_bytes) / static_cast<float>(row.total_bytes),
        0.0f,
        1.0f);
}

bool render_filter_button(const char* label, bool selected) {
    const ImVec4 active_bg(0.19f, 0.32f, 0.55f, 1.0f);
    const ImVec4 inactive_bg(0.12f, 0.12f, 0.14f, 1.0f);
    const ImVec4 hover_bg(0.16f, 0.16f, 0.20f, 1.0f);
    const ImVec4 border(0.22f, 0.22f, 0.25f, 1.0f);

    ImGui::PushStyleColor(ImGuiCol_Button, selected ? active_bg : inactive_bg);
    ImGui::PushStyleColor(ImGuiCol_ButtonHovered, selected ? active_bg : hover_bg);
    ImGui::PushStyleColor(ImGuiCol_ButtonActive, active_bg);
    ImGui::PushStyleColor(ImGuiCol_Border, border);
    ImGui::PushStyleVar(ImGuiStyleVar_FrameBorderSize, 1.0f);
    ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 6.0f);
    const bool pressed = ImGui::Button(label);
    ImGui::PopStyleVar(2);
    ImGui::PopStyleColor(4);
    return pressed;
}

}  // namespace

ExplorerTransferPanel::ExplorerTransferPanel(core::UIRegistry& registry)
    : registry_(registry) {}

void ExplorerTransferPanel::render() {
    auto& ui_state = registry_.get_state<ExplorerTransferUiState>(kExplorerTransferUiStateKey);
    if (!ui_state.is_open()) {
        return;
    }

    auto& tracker = registry_.get_state<FileMasterTransfers>("FileMasterTransfers");
    auto rows = tracker.get_all_transfers();
    const auto summary = tracker.get_summary();
    const FileTransferFilter current_filter = ui_state.filter();

    std::sort(rows.begin(), rows.end(), [](const FileTransferRecord& lhs, const FileTransferRecord& rhs) {
        if (lhs.is_active() != rhs.is_active()) {
            return lhs.is_active() > rhs.is_active();
        }
        if ((lhs.status == FileTransferStatus::Failed) != (rhs.status == FileTransferStatus::Failed)) {
            return (lhs.status == FileTransferStatus::Failed) > (rhs.status == FileTransferStatus::Failed);
        }
        const auto lhs_time = lhs.is_active() ? lhs.started_at : lhs.completed_at;
        const auto rhs_time = rhs.is_active() ? rhs.started_at : rhs.completed_at;
        if (lhs_time != rhs_time) {
            return lhs_time > rhs_time;
        }
        return lhs.id > rhs.id;
    });

    ImGuiViewport* viewport = ImGui::GetMainViewport();
    ImGui::SetNextWindowViewport(viewport->ID);
    ImGui::SetNextWindowSize(ImVec2(860.0f, 520.0f), ImGuiCond_FirstUseEver);

    bool open = true;
    ImGuiWindowFlags flags = ImGuiWindowFlags_NoCollapse | ImGuiWindowFlags_NoDocking;
    if (!ImGui::Begin("Explorer Transfers", &open, flags)) {
        ImGui::End();
        if (!open) {
            ui_state.close();
        }
        return;
    }

    if (!open) {
        ui_state.close();
    }

    ImGui::PushStyleColor(ImGuiCol_ChildBg, ImVec4(0.08f, 0.08f, 0.10f, 1.0f));
    ImGui::BeginChild("##explorer_transfer_header", ImVec2(0.0f, 92.0f), true, ImGuiWindowFlags_NoScrollbar);
    ImGui::TextUnformatted("File Transfers");
    ImGui::TextDisabled("Explorer-owned transfer monitor backed by FileMaster.");
    ImGui::Spacing();
    ImGui::Text("Active %zu", summary.active);
    ImGui::SameLine(0.0f, 16.0f);
    ImGui::Text("Completed %zu", summary.completed);
    ImGui::SameLine(0.0f, 16.0f);
    ImGui::Text("Failed %zu", summary.failed);
    ImGui::SameLine();
    const float clear_width = 112.0f;
    const float total_width = clear_width + 12.0f;
    const float right_x = std::max(ImGui::GetCursorPosX(), ImGui::GetWindowContentRegionMax().x - total_width);
    ImGui::SetCursorPosX(right_x);
    if (ImGui::Button("Clear Finished", ImVec2(clear_width, 0.0f))) {
        tracker.clear_completed();
        rows = tracker.get_all_transfers();
    }
    ImGui::EndChild();
    ImGui::PopStyleColor();

    if (render_filter_button("Active", current_filter == FileTransferFilter::Active)) {
        ui_state.set_filter(FileTransferFilter::Active);
    }
    ImGui::SameLine();
    if (render_filter_button("All", current_filter == FileTransferFilter::All)) {
        ui_state.set_filter(FileTransferFilter::All);
    }
    ImGui::SameLine();
    if (render_filter_button("Failed", current_filter == FileTransferFilter::Failed)) {
        ui_state.set_filter(FileTransferFilter::Failed);
    }
    ImGui::SameLine();
    if (render_filter_button("Completed", current_filter == FileTransferFilter::Completed)) {
        ui_state.set_filter(FileTransferFilter::Completed);
    }

    ImGui::Spacing();
    const float table_height = std::max(120.0f, ImGui::GetContentRegionAvail().y);
    ImGuiTableFlags table_flags =
        ImGuiTableFlags_RowBg |
        ImGuiTableFlags_BordersInnerH |
        ImGuiTableFlags_BordersOuter |
        ImGuiTableFlags_ScrollY |
        ImGuiTableFlags_Resizable |
        ImGuiTableFlags_SizingStretchProp;

    if (ImGui::BeginTable("##explorer_transfers_table", 5, table_flags, ImVec2(0.0f, table_height))) {
        ImGui::TableSetupScrollFreeze(0, 1);
        ImGui::TableSetupColumn("Type", ImGuiTableColumnFlags_WidthFixed, 80.0f);
        ImGui::TableSetupColumn("Name", ImGuiTableColumnFlags_WidthStretch, 0.30f);
        ImGui::TableSetupColumn("Target", ImGuiTableColumnFlags_WidthStretch, 0.22f);
        ImGui::TableSetupColumn("Progress", ImGuiTableColumnFlags_WidthStretch, 0.30f);
        ImGui::TableSetupColumn("Status", ImGuiTableColumnFlags_WidthStretch, 0.18f);
        ImGui::TableHeadersRow();

        size_t visible_rows = 0;
        for (const auto& row : rows) {
            if (!matches_filter(row, ui_state.filter())) {
                continue;
            }

            ++visible_rows;
            ImGui::TableNextRow();
            ImGui::TableSetColumnIndex(0);
            ImGui::TextUnformatted(row.direction == FileTransferDirection::Upload ? "Upload" : "Download");
            ImGui::TableSetColumnIndex(1);
            ImGui::TextUnformatted(row.file_name.empty() ? "(unnamed)" : row.file_name.c_str());
            if (!row.error_message.empty()) {
                ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.83f, 0.42f, 0.42f, 1.0f));
                ImGui::TextWrapped("%s", row.error_message.c_str());
                ImGui::PopStyleColor();
            }
            ImGui::TableSetColumnIndex(2);
            ImGui::TextWrapped("%s", row.endpoint.empty() ? "--" : row.endpoint.c_str());
            ImGui::TableSetColumnIndex(3);
            ImGui::ProgressBar(progress_fraction(row), ImVec2(-FLT_MIN, 0.0f));
            ImGui::TextUnformatted(progress_text(row).c_str());
            ImGui::TableSetColumnIndex(4);
            if (row.status == FileTransferStatus::Failed) {
                ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.83f, 0.42f, 0.42f, 1.0f));
                ImGui::TextUnformatted("Failed");
            } else if (row.status == FileTransferStatus::Completed) {
                ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.50f, 0.82f, 0.54f, 1.0f));
                ImGui::TextUnformatted("Completed");
            } else {
                ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.82f, 0.82f, 0.86f, 1.0f));
                ImGui::TextUnformatted("In Progress");
            }
            ImGui::PopStyleColor();
        }

        if (visible_rows == 0) {
            ImGui::TableNextRow();
            ImGui::TableSetColumnIndex(0);
            ImGui::TextDisabled("No %s transfers", filter_label(ui_state.filter()));
        }

        ImGui::EndTable();
    }

    ImGui::End();
}

}  // namespace misty::panel
