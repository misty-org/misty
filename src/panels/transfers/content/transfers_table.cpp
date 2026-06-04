#include "panels/transfers/content/transfers_table.h"

#include <algorithm>
#include <cfloat>

#include "imgui.h"
#include "panels/transfers/content/transfers_content_util.h"

namespace misty::panel {
namespace {

constexpr ImVec4 kGreen(0.48f, 0.82f, 0.54f, 1.0f);
constexpr ImVec4 kRed(0.83f, 0.42f, 0.42f, 1.0f);
constexpr ImVec4 kText(0.945f, 0.933f, 0.910f, 1.0f);
constexpr ImVec4 kMuted(0.788f, 0.769f, 0.737f, 1.0f);
constexpr ImVec4 kProgressBg(0.094f, 0.094f, 0.106f, 1.0f);
constexpr ImVec4 kProgressFill(0.941f, 0.922f, 0.894f, 1.0f);

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

void render_progress_cell(const core::FileTransferRecord& row) {
    ImGui::PushStyleColor(ImGuiCol_PlotHistogram, kProgressFill);
    ImGui::PushStyleColor(ImGuiCol_FrameBg, kProgressBg);
    ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 7.0f);
    ImGui::ProgressBar(transfers_content::progress_fraction(row), ImVec2(-FLT_MIN, 14.0f), "");
    ImGui::PopStyleVar();
    ImGui::PopStyleColor(2);
    ImGui::PushStyleColor(ImGuiCol_Text, kMuted);
    ImGui::TextUnformatted(transfers_content::progress_text(row).c_str());
    ImGui::PopStyleColor();
}

void render_row(const core::FileTransferRecord& row) {
    ImGui::TableNextRow(ImGuiTableRowFlags_None, 62.0f);

    ImGui::TableSetColumnIndex(0);
    ImGui::PushStyleColor(ImGuiCol_Text, kMuted);
    ImGui::TextUnformatted(transfers_content::job_id_text(row).c_str());
    ImGui::PopStyleColor();

    ImGui::TableSetColumnIndex(1);
    ImGui::TextUnformatted(transfers_content::type_label(row.transfer_type));

    ImGui::TableSetColumnIndex(2);
    const std::string source = transfers_content::source_endpoint(row);
    ImGui::TextWrapped("%s", source.empty() ? "--" : source.c_str());
    if (!row.error_message.empty()) {
        ImGui::PushStyleColor(ImGuiCol_Text, kRed);
        ImGui::TextWrapped("%s", row.error_message.c_str());
        ImGui::PopStyleColor();
    }

    ImGui::TableSetColumnIndex(3);
    const std::string target = transfers_content::target_endpoint(row);
    ImGui::TextWrapped("%s", target.empty() ? "--" : target.c_str());

    ImGui::TableSetColumnIndex(4);
    ImGui::PushID(static_cast<int>(row.id));
    render_progress_cell(row);
    ImGui::PopID();

    ImGui::TableSetColumnIndex(5);
    ImGui::PushStyleColor(ImGuiCol_Text,
                          row.status == core::FileTransferStatus::Failed ? kRed :
                          row.status == core::FileTransferStatus::Completed ? kGreen : kText);
    ImGui::TextUnformatted(transfers_content::status_label(row));
    ImGui::PopStyleColor();

    ImGui::TableSetColumnIndex(6);
    ImGui::PushStyleColor(ImGuiCol_Text, kMuted);
    ImGui::TextUnformatted(transfers_content::started_text(row).c_str());
    ImGui::PopStyleColor();
}

}  // namespace

void render_transfers_table(const std::vector<core::FileTransferRecord>& rows,
                            float height) {
    const float table_height = std::max(180.0f, height);
    const ImGuiTableFlags flags =
        ImGuiTableFlags_RowBg |
        ImGuiTableFlags_BordersInnerH |
        ImGuiTableFlags_BordersOuter |
        ImGuiTableFlags_ScrollY |
        ImGuiTableFlags_Resizable |
        ImGuiTableFlags_SizingStretchProp;

    const float table_shell_height = rows.empty() ? 54.0f : table_height;
    if (ImGui::BeginTable("##transfers_table", 7, flags, ImVec2(0.0f, table_shell_height))) {
        ImGui::TableSetupScrollFreeze(0, 1);
        ImGui::TableSetupColumn("Job ID", ImGuiTableColumnFlags_WidthFixed, 76.0f);
        ImGui::TableSetupColumn("Type", ImGuiTableColumnFlags_WidthFixed, 92.0f);
        ImGui::TableSetupColumn("Source", ImGuiTableColumnFlags_WidthStretch, 0.27f);
        ImGui::TableSetupColumn("Target", ImGuiTableColumnFlags_WidthStretch, 0.30f);
        ImGui::TableSetupColumn("Progress", ImGuiTableColumnFlags_WidthStretch, 0.25f);
        ImGui::TableSetupColumn("Status", ImGuiTableColumnFlags_WidthFixed, 110.0f);
        ImGui::TableSetupColumn("Started", ImGuiTableColumnFlags_WidthFixed, 100.0f);
        ImGui::TableHeadersRow();

        if (!rows.empty()) {
            for (const auto& row : rows) {
                render_row(row);
            }
        }

        ImGui::EndTable();
    }
    if (rows.empty()) {
        render_empty_state(std::max(180.0f, table_height - table_shell_height));
    }
}

}  // namespace misty::panel
