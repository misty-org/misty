#include "panels/transfers/transfers_panel.h"

#include <algorithm>
#include <array>
#include <cfloat>
#include <iomanip>
#include <sstream>

#include "imgui.h"
#include "panels/transfers/transfers_state.h"

namespace misty::panel {
namespace {

using misty::core::FileTransfer;
using misty::core::FileTransferFilter;
using misty::core::FileTransferRecord;
using misty::core::FileTransferStatus;
using misty::core::FileTransferType;

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
            return row.is_alive();
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
        return row.is_alive() ? 0.0f : 1.0f;
    }
    return std::clamp(
        static_cast<float>(row.transferred_bytes) / static_cast<float>(row.total_bytes),
        0.0f,
        1.0f);
}

std::string transfer_endpoint(const FileTransferRecord& row) {
    if (!row.remote_dest_name.empty() || !row.remote_dest_path.empty()) {
        return row.remote_dest_name + ":" + row.remote_dest_path;
    }
    if (!row.remote_source_name.empty() || !row.remote_source_path.empty()) {
        return row.remote_source_name + ":" + row.remote_source_path;
    }
    if (!row.local_dest_path.empty()) {
        return row.local_dest_path;
    }
    if (!row.local_source_path.empty()) {
        return row.local_source_path;
    }
    return "";
}

const char* type_label(FileTransferType type) {
    switch (type) {
        case FileTransferType::Upload: return "Upload";
        case FileTransferType::Download: return "Download";
        case FileTransferType::Copy: return "Copy";
        case FileTransferType::Move: return "Move";
        case FileTransferType::Rename: return "Rename";
        case FileTransferType::Delete: return "Delete";
    }
    return "Transfer";
}

const char* status_label(const FileTransferRecord& row) {
    switch (row.status) {
        case FileTransferStatus::Failed: return "Failed";
        case FileTransferStatus::Completed: return "Completed";
        case FileTransferStatus::Pending:
        case FileTransferStatus::InProgress:
            switch (row.transfer_type) {
                case FileTransferType::Upload: return "Uploading";
                case FileTransferType::Download: return "Downloading";
                case FileTransferType::Copy: return "Copying";
                case FileTransferType::Move: return "Moving";
                case FileTransferType::Rename: return "Renaming";
                case FileTransferType::Delete: return "Deleting";
            }
    }
    return "Pending";
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

TransfersPanel::TransfersPanel(core::UIRegistry& registry)
    : registry_(registry) {}

void TransfersPanel::render() {
    auto& ui_state = registry_.get_state<TransfersState>(kTransfersStateKey);
    auto& tracker = registry_.get_state<FileTransfer>("FileMasterTransfers");
    auto rows = tracker.get_all_transfers();

    size_t active = 0;
    size_t completed = 0;
    size_t failed = 0;
    for (const auto& row : rows) {
        if (row.is_alive()) {
            ++active;
        } else if (row.status == FileTransferStatus::Failed) {
            ++failed;
        } else {
            ++completed;
        }
    }

    std::sort(rows.begin(), rows.end(), [](const FileTransferRecord& lhs, const FileTransferRecord& rhs) {
        if (lhs.is_alive() != rhs.is_alive()) {
            return lhs.is_alive() > rhs.is_alive();
        }
        if ((lhs.status == FileTransferStatus::Failed) != (rhs.status == FileTransferStatus::Failed)) {
            return (lhs.status == FileTransferStatus::Failed) > (rhs.status == FileTransferStatus::Failed);
        }
        const auto lhs_time = lhs.is_alive() ? lhs.started_at : lhs.completed_at;
        const auto rhs_time = rhs.is_alive() ? rhs.started_at : rhs.completed_at;
        if (lhs_time != rhs_time) {
            return lhs_time > rhs_time;
        }
        return lhs.id > rhs.id;
    });

    const ImGuiWindowFlags window_flags =
        ImGuiWindowFlags_NoTitleBar |
        ImGuiWindowFlags_NoMove |
        ImGuiWindowFlags_NoCollapse |
        ImGuiWindowFlags_NoResize |
        ImGuiWindowFlags_NoScrollbar |
        ImGuiWindowFlags_NoScrollWithMouse |
        ImGuiWindowFlags_NoSavedSettings;

    if (!ImGui::Begin("Transfers", nullptr, window_flags)) {
        ImGui::End();
        return;
    }

    ImGui::PushStyleColor(ImGuiCol_ChildBg, ImVec4(0.08f, 0.08f, 0.10f, 1.0f));
    ImGui::BeginChild("##transfers_header", ImVec2(0.0f, 92.0f), true, ImGuiWindowFlags_NoScrollbar);
    ImGui::TextUnformatted("File Transfers");
    ImGui::TextDisabled("Unified transfer monitor powered by FileTransfer.");
    ImGui::Spacing();
    ImGui::Text("Active %zu", active);
    ImGui::SameLine(0.0f, 16.0f);
    ImGui::Text("Completed %zu", completed);
    ImGui::SameLine(0.0f, 16.0f);
    ImGui::Text("Failed %zu", failed);
    ImGui::SameLine();
    const float clear_width = 112.0f;
    const float right_x = std::max(ImGui::GetCursorPosX(), ImGui::GetWindowContentRegionMax().x - clear_width);
    ImGui::SetCursorPosX(right_x);
    if (ImGui::Button("Clear Finished", ImVec2(clear_width, 0.0f))) {
        tracker.clear_completed();
        rows = tracker.get_all_transfers();
    }
    ImGui::EndChild();
    ImGui::PopStyleColor();

    const auto current_filter = ui_state.filter();
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
    const ImGuiTableFlags table_flags =
        ImGuiTableFlags_RowBg |
        ImGuiTableFlags_BordersInnerH |
        ImGuiTableFlags_BordersOuter |
        ImGuiTableFlags_ScrollY |
        ImGuiTableFlags_Resizable |
        ImGuiTableFlags_SizingStretchProp;

    if (ImGui::BeginTable("##transfers_table", 5, table_flags, ImVec2(0.0f, table_height))) {
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
            ImGui::TextUnformatted(type_label(row.transfer_type));

            ImGui::TableSetColumnIndex(1);
            ImGui::TextUnformatted(row.file_name.empty() ? "(unnamed)" : row.file_name.c_str());
            if (!row.error_message.empty()) {
                ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.83f, 0.42f, 0.42f, 1.0f));
                ImGui::TextWrapped("%s", row.error_message.c_str());
                ImGui::PopStyleColor();
            }

            ImGui::TableSetColumnIndex(2);
            const std::string endpoint = transfer_endpoint(row);
            ImGui::TextWrapped("%s", endpoint.empty() ? "--" : endpoint.c_str());

            ImGui::TableSetColumnIndex(3);
            ImGui::ProgressBar(progress_fraction(row), ImVec2(-FLT_MIN, 0.0f));
            ImGui::TextUnformatted(progress_text(row).c_str());

            ImGui::TableSetColumnIndex(4);
            if (row.status == FileTransferStatus::Failed) {
                ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.83f, 0.42f, 0.42f, 1.0f));
            } else if (row.status == FileTransferStatus::Completed) {
                ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.50f, 0.82f, 0.54f, 1.0f));
            } else {
                ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.82f, 0.82f, 0.86f, 1.0f));
            }
            ImGui::TextUnformatted(status_label(row));
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
