#include "transfer_window_panel.h"

#include <algorithm>
#include <array>
#include <chrono>
#include <cfloat>
#include <cstdint>
#include <iomanip>
#include <sstream>
#include <string>
#include <vector>

#include "imgui.h"
#include "panels/activity/download_state.h"
#include "panels/activity/upload_state.h"
#include "panels/transfers/transfer_window_state.h"

namespace misty::panel {
namespace {

enum class TransferDirection {
    UPLOAD,
    DOWNLOAD,
};

struct TransferRow {
    uint64_t id = 0;
    TransferDirection direction = TransferDirection::UPLOAD;
    std::string name;
    std::string endpoint;
    int64_t transferred_bytes = 0;
    int64_t total_bytes = 0;
    bool is_active = false;
    bool is_failed = false;
    std::string status_text;
    std::string error_text;
    std::chrono::steady_clock::time_point started_at{};
    std::chrono::steady_clock::time_point finished_at{};
};

struct TransferSummary {
    size_t active = 0;
    size_t completed = 0;
    size_t failed = 0;
};

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

std::string format_progress_text(const TransferRow& row) {
    if (row.total_bytes > 0) {
        return format_bytes(row.transferred_bytes) + " / " + format_bytes(row.total_bytes);
    }
    if (row.transferred_bytes > 0) {
        return format_bytes(row.transferred_bytes);
    }
    return "--";
}

float progress_fraction(const TransferRow& row) {
    if (row.total_bytes <= 0) {
        return row.is_active ? 0.0f : 1.0f;
    }
    float progress = static_cast<float>(row.transferred_bytes) / static_cast<float>(row.total_bytes);
    return std::clamp(progress, 0.0f, 1.0f);
}

const char* filter_label(TransferWindowFilter filter) {
    switch (filter) {
        case TransferWindowFilter::ACTIVE: return "Active";
        case TransferWindowFilter::ALL: return "All";
        case TransferWindowFilter::FAILED: return "Failed";
        case TransferWindowFilter::COMPLETED: return "Completed";
    }
    return "Active";
}

bool matches_filter(const TransferRow& row, TransferWindowFilter filter) {
    switch (filter) {
        case TransferWindowFilter::ACTIVE:
            return row.is_active;
        case TransferWindowFilter::FAILED:
            return row.is_failed;
        case TransferWindowFilter::COMPLETED:
            return !row.is_active && !row.is_failed;
        case TransferWindowFilter::ALL:
            return true;
    }
    return true;
}

TransferSummary summarize_rows(const std::vector<TransferRow>& rows) {
    TransferSummary summary;
    for (const auto& row : rows) {
        if (row.is_active) {
            ++summary.active;
        } else if (row.is_failed) {
            ++summary.failed;
        } else {
            ++summary.completed;
        }
    }
    return summary;
}

void append_upload_rows(std::vector<TransferRow>& rows, const std::vector<UploadItem>& uploads) {
    rows.reserve(rows.size() + uploads.size());
    for (const auto& upload : uploads) {
        TransferRow row;
        row.id = upload.id;
        row.direction = TransferDirection::UPLOAD;
        row.name = upload.file_name;
        row.endpoint = upload.destination.empty() ? upload.remote_name : upload.destination;
        row.transferred_bytes = upload.uploaded_bytes;
        row.total_bytes = upload.file_size;
        row.is_active = upload.is_active();
        row.is_failed = upload.status == UploadStatus::FAILED;
        row.status_text = row.is_failed ? "Failed" : (row.is_active ? "Uploading" : "Completed");
        row.error_text = upload.error_message;
        row.started_at = upload.started_at;
        row.finished_at = upload.completed_at;
        rows.push_back(std::move(row));
    }
}

void append_download_rows(std::vector<TransferRow>& rows, const std::vector<DownloadItem>& downloads) {
    rows.reserve(rows.size() + downloads.size());
    for (const auto& download : downloads) {
        TransferRow row;
        row.id = download.id;
        row.direction = TransferDirection::DOWNLOAD;
        row.name = download.file_name;
        row.endpoint = download.source;
        row.transferred_bytes = download.downloaded_bytes;
        row.total_bytes = download.file_size;
        row.is_active = download.is_active();
        row.is_failed = download.status == DownloadStatus::FAILED;
        row.status_text = row.is_failed ? "Failed" : (row.is_active ? "Downloading" : "Completed");
        row.error_text = download.error_message;
        row.started_at = download.started_at;
        row.finished_at = download.completed_at;
        rows.push_back(std::move(row));
    }
}

std::vector<TransferRow> collect_rows(core::UIRegistry& registry) {
    std::vector<TransferRow> rows;
    append_upload_rows(rows, registry.get_state<UploadState>("Uploads").get_all_uploads());
    append_download_rows(rows, registry.get_state<DownloadState>("Downloads").get_all_downloads());

    std::sort(rows.begin(), rows.end(), [](const TransferRow& lhs, const TransferRow& rhs) {
        if (lhs.is_active != rhs.is_active) {
            return lhs.is_active > rhs.is_active;
        }
        if (lhs.is_failed != rhs.is_failed) {
            return lhs.is_failed > rhs.is_failed;
        }
        const auto lhs_time = lhs.is_active ? lhs.started_at : lhs.finished_at;
        const auto rhs_time = rhs.is_active ? rhs.started_at : rhs.finished_at;
        if (lhs_time != rhs_time) {
            return lhs_time > rhs_time;
        }
        return lhs.id > rhs.id;
    });

    return rows;
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

TransferWindowPanel::TransferWindowPanel(core::UIRegistry& registry)
    : registry_(registry) {}

void TransferWindowPanel::render() {
    auto& window_state = registry_.get_state<TransferWindowState>(kTransferWindowStateKey);
    if (!window_state.is_open()) {
        return;
    }

    const bool reset_layout = window_state.consume_layout_reset_request();
    if (reset_layout) {
        ImGuiViewport* viewport = ImGui::GetMainViewport();
        const ImVec2 size(860.0f, 520.0f);
        const ImVec2 pos(
            viewport->WorkPos.x + (viewport->WorkSize.x - size.x) * 0.5f,
            viewport->WorkPos.y + (viewport->WorkSize.y - size.y) * 0.5f);
        ImGui::SetNextWindowPos(pos, ImGuiCond_Always);
        ImGui::SetNextWindowSize(size, ImGuiCond_Always);
    } else {
        ImGui::SetNextWindowSize(ImVec2(860.0f, 520.0f), ImGuiCond_FirstUseEver);
    }

    if (window_state.consume_focus_request()) {
        ImGui::SetNextWindowFocus();
    }

    if (window_state.prefer_external_viewport()) {
        ImGuiWindowClass window_class;
        window_class.DockingAllowUnclassed = true;
        ImGui::SetNextWindowClass(&window_class);
    }

    bool open = true;
    ImGuiWindowFlags flags = ImGuiWindowFlags_NoCollapse;

    if (!ImGui::Begin("Transfers", &open, flags)) {
        ImGui::End();
        if (!open) {
            window_state.close();
        }
        return;
    }

    if (!open) {
        window_state.close();
    }

    auto rows = collect_rows(registry_);
    TransferSummary summary = summarize_rows(rows);
    const TransferWindowFilter current_filter = window_state.filter();

    ImGui::PushStyleColor(ImGuiCol_ChildBg, ImVec4(0.08f, 0.08f, 0.10f, 1.0f));
    ImGui::BeginChild("##transfer_header", ImVec2(0.0f, 92.0f), true, ImGuiWindowFlags_NoScrollbar);

    ImGui::TextUnformatted("File Transfer Monitor");
    ImGui::TextDisabled("Dockable utility window for uploads and downloads. Detached OS windows are ready once multi-viewport is enabled.");

    ImGui::Spacing();
    ImGui::Text("Active %zu", summary.active);
    ImGui::SameLine(0.0f, 16.0f);
    ImGui::Text("Completed %zu", summary.completed);
    ImGui::SameLine(0.0f, 16.0f);
    ImGui::Text("Failed %zu", summary.failed);

    ImGui::SameLine();
    const float clear_width = 112.0f;
    const float layout_width = 110.0f;
    const float total_width = clear_width + layout_width + 12.0f;
    const float right_x = std::max(ImGui::GetCursorPosX(), ImGui::GetWindowContentRegionMax().x - total_width);
    ImGui::SetCursorPosX(right_x);
    if (ImGui::Button("Reset Layout", ImVec2(layout_width, 0.0f))) {
        window_state.reset_layout();
    }
    ImGui::SameLine();
    if (ImGui::Button("Clear Finished", ImVec2(clear_width, 0.0f))) {
        registry_.get_state<UploadState>("Uploads").clear_completed();
        registry_.get_state<DownloadState>("Downloads").clear_completed();
        rows = collect_rows(registry_);
        summary = summarize_rows(rows);
    }

    ImGui::EndChild();
    ImGui::PopStyleColor();

    if (render_filter_button("Active", current_filter == TransferWindowFilter::ACTIVE)) {
        window_state.set_filter(TransferWindowFilter::ACTIVE);
    }
    ImGui::SameLine();
    if (render_filter_button("All", current_filter == TransferWindowFilter::ALL)) {
        window_state.set_filter(TransferWindowFilter::ALL);
    }
    ImGui::SameLine();
    if (render_filter_button("Failed", current_filter == TransferWindowFilter::FAILED)) {
        window_state.set_filter(TransferWindowFilter::FAILED);
    }
    ImGui::SameLine();
    if (render_filter_button("Completed", current_filter == TransferWindowFilter::COMPLETED)) {
        window_state.set_filter(TransferWindowFilter::COMPLETED);
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
            if (!matches_filter(row, window_state.filter())) {
                continue;
            }

            ++visible_rows;
            ImGui::TableNextRow();

            ImGui::TableSetColumnIndex(0);
            ImGui::TextUnformatted(row.direction == TransferDirection::UPLOAD ? "Upload" : "Download");

            ImGui::TableSetColumnIndex(1);
            ImGui::TextUnformatted(row.name.empty() ? "(unnamed)" : row.name.c_str());
            if (!row.error_text.empty()) {
                ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.83f, 0.42f, 0.42f, 1.0f));
                ImGui::TextWrapped("%s", row.error_text.c_str());
                ImGui::PopStyleColor();
            }

            ImGui::TableSetColumnIndex(2);
            ImGui::TextWrapped("%s", row.endpoint.empty() ? "--" : row.endpoint.c_str());

            ImGui::TableSetColumnIndex(3);
            ImGui::ProgressBar(progress_fraction(row), ImVec2(-FLT_MIN, 0.0f));
            ImGui::TextUnformatted(format_progress_text(row).c_str());

            ImGui::TableSetColumnIndex(4);
            if (row.is_failed) {
                ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.83f, 0.42f, 0.42f, 1.0f));
            } else if (!row.is_active) {
                ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.50f, 0.82f, 0.54f, 1.0f));
            } else {
                ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.82f, 0.82f, 0.86f, 1.0f));
            }
            ImGui::TextUnformatted(row.status_text.c_str());
            ImGui::PopStyleColor();
        }

        if (visible_rows == 0) {
            ImGui::TableNextRow();
            ImGui::TableSetColumnIndex(0);
            ImGui::TextDisabled("No %s transfers", filter_label(window_state.filter()));
        }

        ImGui::EndTable();
    }

    ImGui::End();
}

}  // namespace misty::panel
