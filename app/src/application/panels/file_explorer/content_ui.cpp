#include "panels/file_explorer/file_explorer_panel.h"

#include <algorithm>
#include <chrono>
#include <cstdio>
#include <cstring>

#include "core/commands/command_manager.h"
#include "core/manager/asset_manager.h"
#include "panels/notification/notification_state.h"
#include "panels/search/search_state.h"
#include "panels/services/services_state.h"

namespace fs = std::filesystem;

using namespace misty::core;

namespace misty::panel {
namespace {

std::string icon_name_for_file(const FileExplorerState& state, const UnifiedFileItem& file) {
    if (state.is_downloading(file.path)) return "download-16";
    if (file.is_dir) return "file-directory-fill-16";

    std::string ext = fs::path(file.name).extension().string();
    if (ext == ".cpp" || ext == ".h" || ext == ".hpp" || ext == ".c" || ext == ".cc" ||
        ext == ".js" || ext == ".ts" || ext == ".html" || ext == ".css" || ext == ".json" ||
        ext == ".py" || ext == ".go" || ext == ".rs" || ext == ".java") {
        return "file-code-16";
    }
    if (ext == ".png" || ext == ".jpg" || ext == ".jpeg" || ext == ".gif" || ext == ".svg" || ext == ".webp") {
        return "file-media-16";
    }
    if (ext == ".mp4" || ext == ".mov" || ext == ".avi" || ext == ".mkv") {
        return "video-16";
    }
    if (ext == ".zip" || ext == ".tar" || ext == ".gz" || ext == ".7z" || ext == ".rar") {
        return "file-zip-16";
    }
    return "file-16";
}

void render_empty_state(float icon_size) {
    float avail_h = ImGui::GetContentRegionAvail().y;
    float avail_w = ImGui::GetContentRegionAvail().x;
    ImGui::SetCursorPosY(ImGui::GetCursorPosY() + avail_h * 0.3f);
    auto& folder_icon = AssetManager::get().get_svg_texture("file-directory-open-fill-24", static_cast<int>(icon_size));
    if (folder_icon.id) {
        ImGui::SetCursorPosX((avail_w - icon_size) * 0.5f);
        ImGui::Image(folder_icon.id, ImVec2(icon_size, icon_size));
        ImGui::Spacing();
    }
    const char* empty_label = "This folder is empty";
    float label_w = ImGui::CalcTextSize(empty_label).x;
    ImGui::SetCursorPosX((avail_w - label_w) * 0.5f);
    ImGui::TextDisabled("%s", empty_label);
}

void select_item(FileExplorerState& state, const UnifiedFileItem& file, int index, bool is_selected, const ImGuiIO& io) {
    if (io.KeyCtrl) {
        if (is_selected) state.selected_files.erase(file.path);
        else state.selected_files.insert(file.path);
    } else if (io.KeyShift && state.last_selected_index != -1) {
        state.selected_files.clear();
        int start = std::min(state.last_selected_index, index);
        int end = std::max(state.last_selected_index, index);
        for (int j = start; j <= end; ++j) state.selected_files.insert(state.files[j].path);
    } else {
        state.selected_files.clear();
        state.selected_files.insert(file.path);
    }
    state.last_selected_index = index;
}

} // namespace
void FileExplorerPanel::show_directory_contents(FileExplorerState& state) {
    static ImGuiTableFlags flags = ImGuiTableFlags_Reorderable | ImGuiTableFlags_Sortable |
        ImGuiTableFlags_Hideable | ImGuiTableFlags_ScrollY | ImGuiTableFlags_Resizable;

    if (state.is_loading) {
        ImGui::Text("Loading...");
        return;
    }

    ImGuiIO& io = ImGui::GetIO();
    if (ImGui::IsWindowFocused(ImGuiFocusedFlags_RootAndChildWindows) && !io.WantTextInput) {
        if (CommandManager::get().matches("explorer.copy")) perform_copy(state);
        if (CommandManager::get().matches("explorer.cut")) perform_cut(state);
        if (CommandManager::get().matches("explorer.paste") && state.clipboard_op != ClipboardOp::NONE && !state.clipboard_items.empty()) perform_paste(state);
        if (CommandManager::get().matches("explorer.delete") && !state.selected_files.empty()) perform_delete_selected(state);
        if (CommandManager::get().matches("explorer.rename") && !state.selected_files.empty()) initiate_rename(state);
        if (CommandManager::get().matches("explorer.refresh")) {
            std::string current(state.current_path);
            if (!current.empty()) navigate_to_path(current, false);
        }
    }

    ImGui::PushStyleColor(ImGuiCol_Header, ImVec4(0.45f, 0.45f, 0.45f, 0.35f));
    ImGui::PushStyleColor(ImGuiCol_HeaderHovered, ImVec4(0.45f, 0.45f, 0.45f, 0.35f));
    ImGui::PushStyleColor(ImGuiCol_HeaderActive, ImVec4(0.45f, 0.45f, 0.45f, 0.45f));

    if (state.grid_view) {
        const float cell_w = 100.0f;
        const float cell_h = 90.0f;
        const float padding = 8.0f;
        float avail_w = ImGui::GetContentRegionAvail().x;
        int cols = std::max(1, static_cast<int>(avail_w / (cell_w + padding)));

        ImGui::PushStyleVar(ImGuiStyleVar_ItemSpacing, ImVec2(padding, padding));
        if (state.files.empty()) {
            render_empty_state(48.0f);
        } else {
            ImGui::BeginChild("##grid_scroll", ImVec2(0, 0), false);
            for (int i = 0; i < static_cast<int>(state.files.size()); ++i) {
                if (i % cols != 0) ImGui::SameLine();
                show_grid_item(state, i, cell_w, cell_h);
            }

            if (ImGui::IsMouseClicked(ImGuiMouseButton_Right) &&
                ImGui::IsWindowHovered(ImGuiHoveredFlags_AllowWhenBlockedByPopup) &&
                !ImGui::IsAnyItemHovered() &&
                !ImGui::IsPopupOpen("FileContextMenu")) {
                state.context_menu_target_path.clear();
                state.selected_files.clear();
                ImGui::OpenPopup("BackgroundContextMenu");
            }

            show_context_menu(state);
            show_background_context_menu(state);
            ImGui::EndChild();
        }
        ImGui::PopStyleVar();
    } else if (ImGui::BeginTable("FileTable", 5, flags)) {
        ImGui::TableSetupColumn("Name", ImGuiTableColumnFlags_WidthStretch);
        ImGui::TableSetupColumn("Size", ImGuiTableColumnFlags_WidthFixed, 80.0f);
        ImGui::TableSetupColumn("Type", ImGuiTableColumnFlags_WidthFixed, 80.0f);
        ImGui::TableSetupColumn("Last Modified", ImGuiTableColumnFlags_WidthFixed, 150.0f);
        ImGui::TableSetupColumn("Status", ImGuiTableColumnFlags_WidthFixed, 60.0f);
        ImGui::TableHeadersRow();

        if (state.files.empty()) {
            ImGui::TableNextRow();
            ImGui::TableSetColumnIndex(0);
            render_empty_state(40.0f);
        } else {
            for (int i = 0; i < static_cast<int>(state.files.size()); ++i) {
                show_file_item(state, i);
            }
        }

        if (ImGuiTableSortSpecs* sorts_specs = ImGui::TableGetSortSpecs()) {
            if (sorts_specs->SpecsDirty) sorts_specs->SpecsDirty = false;
        }

        show_context_menu(state);
        if (ImGui::IsMouseClicked(ImGuiMouseButton_Right) &&
            ImGui::IsWindowHovered(ImGuiHoveredFlags_AllowWhenBlockedByPopup) &&
            !ImGui::IsAnyItemHovered() &&
            !ImGui::IsPopupOpen("FileContextMenu")) {
            state.context_menu_target_path.clear();
            state.selected_files.clear();
            ImGui::OpenPopup("BackgroundContextMenu");
        }
        show_background_context_menu(state);
        ImGui::EndTable();
    }

    ImGui::PopStyleColor(3);
    show_rename_modal(state);
    show_new_entry_modal(state);
}

void FileExplorerPanel::show_file_item(FileExplorerState& state, int i) {
    ImGuiIO& io = ImGui::GetIO();
    const UnifiedFileItem& file = state.files[i];
    bool is_selected = state.selected_files.count(file.path) > 0;

    auto& icon = AssetManager::get().get_svg_texture(icon_name_for_file(state, file), 16);

    float row_height = 32.0f;
    ImGui::TableNextRow(ImGuiTableRowFlags_None, row_height);
    ImGui::TableNextColumn();

    // Cloud providers (Google Drive especially) allow multiple files with the
    // exact same name in the same folder, so file.path alone is not unique.
    // Prefix with the row index so ImGui sees distinct IDs even on collisions.
    // (The "##" hides the suffix from the visible label.)
    std::string label_id = "##row_" + std::to_string(i) + "_" + file.path;

    ImVec2 p = ImGui::GetCursorScreenPos();
    if (ImGui::Selectable(label_id.c_str(), is_selected, ImGuiSelectableFlags_SpanAllColumns | ImGuiSelectableFlags_AllowDoubleClick, ImVec2(0, row_height))) {
        select_item(state, file, i, is_selected, io);
    }

    if (ImGui::IsItemHovered() && !is_selected) {
        ImDrawList* dl = ImGui::GetWindowDrawList();
        ImVec2 row_min = p;
        ImVec2 row_max = ImVec2(p.x + ImGui::GetContentRegionAvail().x, p.y + row_height);
        ImU32 col_left = ImGui::IsItemActive() ? IM_COL32(255, 255, 255, 30) : IM_COL32(255, 255, 255, 20);
        ImU32 col_right = IM_COL32(255, 255, 255, 0);
        dl->AddRectFilledMultiColor(row_min, row_max, col_left, col_right, col_right, col_left);
    }

    if (ImGui::IsItemClicked(ImGuiMouseButton_Right)) {
        state.context_menu_target_path = file.path;
        if (!is_selected) select_item(state, file, i, false, io);
        ImGui::OpenPopup("FileContextMenu");
    }

    if (ImGui::IsItemHovered() && ImGui::IsMouseDoubleClicked(0)) {
        if (file.is_dir) {
            std::string nav_path = file.path;
            navigate_to_path(nav_path);
            return;
        }

        if (file.source == FileSource::LOCAL) {
            state.add_recent(file);
            open_file(file.path);
        } else if (file.source == FileSource::REMOTE) {
            if (fs::exists(file.path)) {
                state.add_recent(file);
                open_file(file.path);
            } else if (!state.is_downloading(file.path)) {
                state.add_recent(file);
                download_remote_file(file);
            }
        }
    }

    float content_padding_y = (row_height - 16.0f) / 2.0f;
    ImVec2 icon_p = ImVec2(p.x + 4.0f, p.y + content_padding_y);
    ImGui::SetCursorScreenPos(icon_p);
    if (icon.id != 0) {
        ImU32 icon_col = file.is_dir ? IM_COL32(230, 191, 76, 255) : IM_COL32(100, 170, 230, 255);
        ImGui::GetWindowDrawList()->AddImage(icon.id, icon_p, ImVec2(icon_p.x + 16, icon_p.y + 16), ImVec2(0, 0), ImVec2(1, 1), icon_col);
    }
    ImGui::Dummy(ImVec2(16, 16));

    ImGui::SameLine(0, 8.0f);
    float text_y_offset = (row_height - ImGui::GetTextLineHeight()) / 2.0f;
    ImGui::SetCursorScreenPos(ImVec2(ImGui::GetCursorScreenPos().x, p.y + text_y_offset));
    ImGui::TextUnformatted(file.name.c_str());

    ImGui::TableNextColumn();
    ImGui::SetCursorPosY(ImGui::GetCursorPosY() + text_y_offset);
    if (!file.is_dir && file.size > 0) {
        if (file.size < 1024) ImGui::Text("%lld B", file.size);
        else if (file.size < 1024 * 1024) ImGui::Text("%.1f KB", file.size / 1024.0);
        else if (file.size < 1024 * 1024 * 1024) ImGui::Text("%.1f MB", file.size / (1024.0 * 1024.0));
        else ImGui::Text("%.1f GB", file.size / (1024.0 * 1024.0 * 1024.0));
    } else {
        ImGui::Text("-");
    }

    ImGui::TableNextColumn();
    ImGui::SetCursorPosY(ImGui::GetCursorPosY() + text_y_offset);
    ImGui::Text("%s", file.is_dir ? "Folder" : "File");

    ImGui::TableNextColumn();
    ImGui::SetCursorPosY(ImGui::GetCursorPosY() + text_y_offset);
    if (!file.last_modified.empty()) ImGui::Text("%s", file.last_modified.c_str());
    else ImGui::Text("-");

    ImGui::TableNextColumn();
    ImU32 dot_color;
    if (file.status == SyncStatus::DELETED) dot_color = IM_COL32(0, 0, 0, 255);
    else if (file.status == SyncStatus::SYNCED) dot_color = IM_COL32(0, 150, 0, 255);
    else if (file.status == SyncStatus::LOCAL) dot_color = IM_COL32(150, 150, 150, 255);
    else if (file.status == SyncStatus::MODIFIED) dot_color = IM_COL32(241, 196, 15, 255);
    else dot_color = IM_COL32(231, 76, 60, 255);
    ImVec2 p_dot = ImGui::GetCursorScreenPos();
    ImGui::GetWindowDrawList()->AddCircleFilled(ImVec2(p_dot.x + 20.0f, p.y + row_height * 0.5f), 4.0f, dot_color);
}

void FileExplorerPanel::show_grid_item(FileExplorerState& state, int i, float cell_w, float cell_h) {
    ImGuiIO& io = ImGui::GetIO();
    const UnifiedFileItem& file = state.files[i];
    bool is_selected = state.selected_files.count(file.path) > 0;
    auto& icon = AssetManager::get().get_svg_texture(icon_name_for_file(state, file), 32);

    ImVec2 cell_pos = ImGui::GetCursorScreenPos();
    std::string btn_id = "##grid_" + std::to_string(i);
    bool clicked = ImGui::InvisibleButton(btn_id.c_str(), ImVec2(cell_w, cell_h));
    bool hovered = ImGui::IsItemHovered();
    bool double_clicked = hovered && ImGui::IsMouseDoubleClicked(0);

    ImDrawList* dl = ImGui::GetWindowDrawList();
    ImVec2 cell_max = ImVec2(cell_pos.x + cell_w, cell_pos.y + cell_h);
    if (is_selected) dl->AddRectFilled(cell_pos, cell_max, IM_COL32(255, 255, 255, 40), 6.0f);
    else if (hovered) dl->AddRectFilled(cell_pos, cell_max, IM_COL32(255, 255, 255, 20), 6.0f);

    const float icon_size = 32.0f;
    float icon_x = cell_pos.x + (cell_w - icon_size) * 0.5f;
    float icon_y = cell_pos.y + 10.0f;
    if (icon.id != 0) {
        ImU32 icon_col = file.is_dir ? IM_COL32(230, 191, 76, 255) : IM_COL32(100, 170, 230, 255);
        dl->AddImage(icon.id, ImVec2(icon_x, icon_y), ImVec2(icon_x + icon_size, icon_y + icon_size), ImVec2(0, 0), ImVec2(1, 1), icon_col);
    }

    float text_y = icon_y + icon_size + 6.0f;
    ImVec2 name_size = ImGui::CalcTextSize(file.name.c_str(), nullptr, false, cell_w - 4.0f);
    float text_x = cell_pos.x + (cell_w - std::min(name_size.x, cell_w - 4.0f)) * 0.5f;
    dl->AddText(ImGui::GetFont(), ImGui::GetFontSize(), ImVec2(text_x, text_y),
        is_selected ? IM_COL32(255, 255, 255, 255) : IM_COL32(212, 212, 216, 255),
        file.name.c_str(), nullptr, cell_w - 4.0f);

    if (clicked) select_item(state, file, i, is_selected, io);
    if (double_clicked) {
        if (file.is_dir) {
            std::string nav_path = file.path;
            navigate_to_path(nav_path);
            return;
        }

        if (file.source == FileSource::LOCAL) {
            state.add_recent(file);
            open_file(file.path);
        } else if (file.source == FileSource::REMOTE) {
            if (fs::exists(file.path)) {
                state.add_recent(file);
                open_file(file.path);
            } else if (!state.is_downloading(file.path)) {
                state.add_recent(file);
                download_remote_file(file);
            }
        }
    }

    if (ImGui::IsItemClicked(ImGuiMouseButton_Right)) {
        state.context_menu_target_path = file.path;
        if (!is_selected) select_item(state, file, i, false, io);
        ImGui::OpenPopup("FileContextMenu");
    }
}


} // namespace misty::panel
