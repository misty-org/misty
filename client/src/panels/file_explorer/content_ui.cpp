#include "panels/file_explorer/file_explorer_panel.h"

#include <algorithm>
#include <chrono>
#include <cstdio>
#include <cstring>

#include "core/commands/command_manager.h"
#include "core/ui/imgui_utils.h"
#include "panels/notification/notification_state.h"
#include "panels/search/search_state.h"
#include "panels/services/services_state.h"

namespace fs = std::filesystem;

using namespace misty::core;

namespace misty::panel {
namespace {

constexpr float kNameColumnWidth = 320.0f;
constexpr float kSizeColumnWidth = 96.0f;
constexpr float kTypeColumnWidth = 120.0f;
constexpr float kModifiedColumnWidth = 180.0f;
constexpr float kStateColumnWidth = 72.0f;
constexpr float kSyncColumnWidth = 56.0f;
constexpr float kTableMinInnerWidth =
    kNameColumnWidth +
    kSizeColumnWidth +
    kTypeColumnWidth +
    kModifiedColumnWidth +
    kStateColumnWidth +
    kSyncColumnWidth;

enum class FileTableColumn : int {
    Name = 0,
    Size = 1,
    Type = 2,
    LastModified = 3,
    State = 4,
    Sync = 5,
};

std::string lowercase_copy(std::string value) {
    std::transform(value.begin(), value.end(), value.begin(), [](unsigned char c) {
        return static_cast<char>(std::tolower(c));
    });
    return value;
}

std::string type_label_for_item(const UnifiedFileItem& file) {
    if (file.is_dir) return "folder";
    if (!file.mime_type.empty()) return lowercase_copy(file.mime_type);
    const std::string ext = fs::path(file.name).extension().string();
    return lowercase_copy(ext);
}

std::string state_label_for_item(const UnifiedFileItem& file) {
    if (!file.state_code.empty()) return file.state_code;
    return file.source == FileSource::REMOTE ? "REM" : "LOC";
}

int compare_strings(const std::string& lhs, const std::string& rhs) {
    const std::string a = lowercase_copy(lhs);
    const std::string b = lowercase_copy(rhs);
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
}

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
        if (is_selected) state.selected_files.erase(file.id);
        else state.selected_files.insert(file.id);
    } else if (io.KeyShift && state.last_selected_index != -1) {
        state.selected_files.clear();
        int start = std::min(state.last_selected_index, index);
        int end = std::max(state.last_selected_index, index);
        for (int j = start; j <= end; ++j) state.selected_files.insert(state.files[j].id);
    } else {
        state.selected_files.clear();
        state.selected_files.insert(file.id);
    }
    state.last_selected_index = index;
}

} // namespace
void FileExplorerPanel::show_directory_contents(FileExplorerState& state) {
    static ImGuiTableFlags flags = ImGuiTableFlags_Reorderable | ImGuiTableFlags_Sortable |
        ImGuiTableFlags_Hideable | ImGuiTableFlags_ScrollY | ImGuiTableFlags_ScrollX |
        ImGuiTableFlags_Resizable;
    const ImVec4 scrollbar_bg(1.0f, 1.0f, 1.0f, 0.04f);
    const ImVec4 scrollbar_grab(0.96f, 0.96f, 0.96f, 0.32f);
    const ImVec4 scrollbar_grab_hovered(0.98f, 0.98f, 0.98f, 0.46f);
    const ImVec4 scrollbar_grab_active(1.0f, 1.0f, 1.0f, 0.62f);

    const bool loading = state.is_loading;
    const bool show_loading_animation = loading && state.show_loading_animation &&
        std::chrono::steady_clock::now() >= state.loading_animation_ready_at;
    const ImVec2 overlay_min = ImGui::GetCursorScreenPos();
    const ImVec2 overlay_size = ImGui::GetContentRegionAvail();
    const ImVec2 overlay_max(overlay_min.x + overlay_size.x, overlay_min.y + overlay_size.y);

    ImGuiIO& io = ImGui::GetIO();
    if (!loading && ImGui::IsWindowFocused(ImGuiFocusedFlags_RootAndChildWindows) && !io.WantTextInput) {
        if (CommandManager::get().matches("explorer.copy")) perform_copy(state);
        if (CommandManager::get().matches("explorer.cut")) perform_cut(state);
        if (CommandManager::get().matches("explorer.paste")) {
            auto& clipboard = registry_.get_state<ClipboardState>("Clipboard");
            if (clipboard.has_content()) perform_paste(state);
        }
        if (CommandManager::get().matches("explorer.delete") && !state.selected_files.empty()) perform_delete_selected(state);
        if (CommandManager::get().matches("explorer.rename") && !state.selected_files.empty()) initiate_rename(state);
        if (CommandManager::get().matches("explorer.refresh")) {
            std::string current(state.current_path);
            if (!current.empty()) {
                request_manual_refresh(state);
            }
        }
    }

    ImGui::PushStyleVar(ImGuiStyleVar_ScrollbarSize, 8.0f);
    ImGui::PushStyleColor(ImGuiCol_ScrollbarBg, scrollbar_bg);
    ImGui::PushStyleColor(ImGuiCol_ScrollbarGrab, scrollbar_grab);
    ImGui::PushStyleColor(ImGuiCol_ScrollbarGrabHovered, scrollbar_grab_hovered);
    ImGui::PushStyleColor(ImGuiCol_ScrollbarGrabActive, scrollbar_grab_active);
    ImGui::PushStyleColor(ImGuiCol_Header, ImVec4(0.45f, 0.45f, 0.45f, 0.35f));
    ImGui::PushStyleColor(ImGuiCol_HeaderHovered, ImVec4(0.45f, 0.45f, 0.45f, 0.35f));
    ImGui::PushStyleColor(ImGuiCol_HeaderActive, ImVec4(0.45f, 0.45f, 0.45f, 0.45f));

    if (state.grid_view) {
        const float cell_w = 100.0f;
        const float cell_h = 104.0f;
        const float padding = 8.0f;

        ImGui::PushStyleVar(ImGuiStyleVar_ItemSpacing, ImVec2(padding, padding));
        if (state.files.empty()) {
            render_empty_state(48.0f);
        } else {
            ImGui::BeginChild("##grid_scroll", ImVec2(0, 0), false, ImGuiWindowFlags_AlwaysVerticalScrollbar);
            float avail_w = ImGui::GetContentRegionAvail().x;
            int cols = std::max(1, static_cast<int>(avail_w / (cell_w + padding)));
            const float base_x = ImGui::GetCursorPosX();
            const float grid_width = cols * cell_w + std::max(0, cols - 1) * padding;
            const float side_padding = std::max(2.0f, (avail_w - grid_width) * 0.5f);
            for (int i = 0; i < static_cast<int>(state.files.size()); ++i) {
                const int column = i % cols;
                if (column == 0) {
                    ImGui::SetCursorPosX(base_x + side_padding);
                } else {
                    ImGui::SameLine(0.0f, padding);
                }
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
    } else {
        const float table_inner_width = std::max(ImGui::GetContentRegionAvail().x, kTableMinInnerWidth);
        if (ImGui::BeginTable("FileTable", 6, flags | ImGuiTableFlags_NoHostExtendY,
                              ImVec2(0.0f, ImGui::GetContentRegionAvail().y), table_inner_width)) {
        ImGui::TableSetupColumn("Name", ImGuiTableColumnFlags_WidthFixed | ImGuiTableColumnFlags_DefaultSort,
                                kNameColumnWidth);
        ImGui::TableSetupColumn("Size", ImGuiTableColumnFlags_WidthFixed, kSizeColumnWidth);
        ImGui::TableSetupColumn("Type", ImGuiTableColumnFlags_WidthFixed, kTypeColumnWidth);
        ImGui::TableSetupColumn("Last Modified", ImGuiTableColumnFlags_WidthFixed, kModifiedColumnWidth);
        ImGui::TableSetupColumn("State", ImGuiTableColumnFlags_WidthFixed, kStateColumnWidth);
        ImGui::TableSetupColumn("Sync", ImGuiTableColumnFlags_WidthFixed | ImGuiTableColumnFlags_NoSort,
                                kSyncColumnWidth);
        ImGui::TableHeadersRow();

        if (ImGuiTableSortSpecs* sorts_specs = ImGui::TableGetSortSpecs()) {
            if (sorts_specs->SpecsDirty || state.sort_dirty) {
                apply_table_sort(state, *sorts_specs);
                sorts_specs->SpecsDirty = false;
                state.sort_dirty = false;
            }
        }

        if (state.files.empty()) {
            ImGui::TableNextRow();
            ImGui::TableSetColumnIndex(0);
            render_empty_state(40.0f);
        } else {
            for (int i = 0; i < static_cast<int>(state.files.size()); ++i) {
                show_file_item(state, i);
            }
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
    }

    ImGui::PopStyleColor(7);
    ImGui::PopStyleVar();

    if (loading && overlay_size.x > 0.0f && overlay_size.y > 0.0f) {
        ImGui::SetCursorScreenPos(overlay_min);
        ImGui::InvisibleButton("##file_loading_blocker", overlay_size);
        if (show_loading_animation) {
            core::DrawMistyLoadingAnimation(overlay_min, overlay_max);
        }
    }

    show_rename_modal(state);
    show_new_entry_modal(state);
    show_permanent_delete_modal(state);
    show_permission_delete_modal(state);
}

void FileExplorerPanel::apply_table_sort(FileExplorerState& state, const ImGuiTableSortSpecs& sort_specs) {
    if (state.files.size() < 2 || sort_specs.SpecsCount <= 0 || sort_specs.Specs == nullptr) {
        return;
    }

    auto compare_for_column = [](const UnifiedFileItem& lhs, const UnifiedFileItem& rhs, ImGuiTableColumnSortSpecs spec) {
        int delta = 0;

        if (lhs.is_dir != rhs.is_dir) {
            delta = lhs.is_dir ? -1 : 1;
        } else {
            switch (static_cast<FileTableColumn>(spec.ColumnIndex)) {
                case FileTableColumn::Name:
                    delta = compare_strings(lhs.name, rhs.name);
                    break;
                case FileTableColumn::Size:
                    if (lhs.size < rhs.size) delta = -1;
                    else if (lhs.size > rhs.size) delta = 1;
                    break;
                case FileTableColumn::Type:
                    delta = compare_strings(type_label_for_item(lhs), type_label_for_item(rhs));
                    break;
                case FileTableColumn::LastModified:
                    delta = compare_strings(lhs.last_modified, rhs.last_modified);
                    break;
                case FileTableColumn::State:
                    delta = compare_strings(state_label_for_item(lhs), state_label_for_item(rhs));
                    break;
                case FileTableColumn::Sync:
                    if (lhs.sync_dirty != rhs.sync_dirty) delta = lhs.sync_dirty ? 1 : -1;
                    break;
            }
        }

        if (delta == 0) {
            delta = compare_strings(lhs.name, rhs.name);
        }
        if (delta == 0) {
            delta = compare_strings(lhs.path, rhs.path);
        }
        if (spec.SortDirection == ImGuiSortDirection_Descending) {
            delta = -delta;
        }
        return delta;
    };

    std::stable_sort(state.files.begin(), state.files.end(),
        [&sort_specs, &compare_for_column](const UnifiedFileItem& lhs, const UnifiedFileItem& rhs) {
            for (int i = 0; i < sort_specs.SpecsCount; ++i) {
                const int delta = compare_for_column(lhs, rhs, sort_specs.Specs[i]);
                if (delta < 0) return true;
                if (delta > 0) return false;
            }
            return false;
        });
}

void FileExplorerPanel::show_file_item(FileExplorerState& state, int i) {
    ImGuiIO& io = ImGui::GetIO();
    const UnifiedFileItem& file = state.files[i];
    bool is_selected = state.selected_files.count(file.id) > 0;

    auto& icon = AssetManager::get().get_svg_texture(icon_name_for_file(state, file), 16);

    float row_height = 32.0f;
    ImGui::TableNextRow(ImGuiTableRowFlags_None, row_height);
    ImGui::TableNextColumn();

    std::string label_id = "##row_" + file.id;

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
    ImGui::SetCursorPosY(ImGui::GetCursorPosY() + text_y_offset);
    ImGui::TextUnformatted(state_label_for_item(file).c_str());

    ImGui::TableNextColumn();
    ImGui::SetCursorPosY(ImGui::GetCursorPosY() + content_padding_y);
    if (file.source == FileSource::REMOTE) {
        const char* icon_name = file.sync_dirty ? "x-circle-fill-16" : "cloud-24";
        auto& sync_icon = AssetManager::get().get_svg_texture(icon_name, 16);
        if (sync_icon.id != 0) {
            const ImVec4 tint = file.sync_dirty ? ImVec4(0.91f, 0.30f, 0.24f, 1.0f) : ImVec4(0.18f, 0.80f, 0.44f, 1.0f);
            ImGui::Image(sync_icon.id, ImVec2(16, 16), ImVec2(0, 0), ImVec2(1, 1), tint, ImVec4(0, 0, 0, 0));
        } else {
            ImGui::TextUnformatted(file.sync_dirty ? "!" : "");
        }

        if (ImGui::IsItemHovered()) {
            if (file.sync_dirty) {
                if (!file.sync_direction.empty()) ImGui::SetTooltip("Dirty (%s)", file.sync_direction.c_str());
                else ImGui::SetTooltip("Dirty");
            } else {
                ImGui::SetTooltip("In Sync");
            }
        }
    } else {
        ImGui::TextUnformatted("-");
    }
}

void FileExplorerPanel::show_grid_item(FileExplorerState& state, int i, float cell_w, float cell_h) {
    ImGuiIO& io = ImGui::GetIO();
    const UnifiedFileItem& file = state.files[i];
    bool is_selected = state.selected_files.count(file.id) > 0;
    auto& icon = AssetManager::get().get_svg_texture(icon_name_for_file(state, file), 32);

    ImVec2 cell_pos = ImGui::GetCursorScreenPos();
    std::string btn_id = "##grid_" + file.id;
    bool clicked = ImGui::InvisibleButton(btn_id.c_str(), ImVec2(cell_w, cell_h));
    bool hovered = ImGui::IsItemHovered();
    bool double_clicked = hovered && ImGui::IsMouseDoubleClicked(0);

    ImDrawList* dl = ImGui::GetWindowDrawList();
    ImVec2 cell_max = ImVec2(cell_pos.x + cell_w, cell_pos.y + cell_h);
    dl->PushClipRect(cell_pos, cell_max, true);
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
    const float text_wrap_width = cell_w - 10.0f;
    ImVec2 name_size = ImGui::CalcTextSize(file.name.c_str(), nullptr, false, text_wrap_width);
    float text_x = cell_pos.x + (cell_w - std::min(name_size.x, text_wrap_width)) * 0.5f;
    dl->AddText(ImGui::GetFont(), ImGui::GetFontSize(), ImVec2(text_x, text_y),
        is_selected ? IM_COL32(255, 255, 255, 255) : IM_COL32(212, 212, 216, 255),
        file.name.c_str(), nullptr, text_wrap_width);
    dl->PopClipRect();

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
