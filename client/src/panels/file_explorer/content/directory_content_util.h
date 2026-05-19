#pragma once

#include "imgui.h"

#include "panels/file_explorer/state/file_explorer_state.h"

namespace misty::panel {

enum class FileTableColumn : int {
    Name = 0,
    Size = 1,
    Type = 2,
    LastModified = 3,
    State = 4,
};

int compare_strings(const std::string& lhs, const std::string& rhs);

std::string type_label_for_item(const UnifiedFileItem& file);

std::string state_label_for_item(const FileExplorerState& state, const UnifiedFileItem& file);

std::string icon_name_for_file(const FileExplorerState& state, const UnifiedFileItem& file, bool open_directory);

std::string icon_name_for_file(const FileExplorerState& state, const UnifiedFileItem& file);

ImU32 grid_item_icon_color(const FileExplorerState& state, const UnifiedFileItem& file);

ImU32 grid_item_text_color(const FileExplorerState& state, const UnifiedFileItem& file, bool is_selected);

bool begin_grid_item_button(const std::string& id, float cell_w, float cell_h);

void grid_item_icon(ImDrawList* draw_list,
                    const FileExplorerState& state,
                    const UnifiedFileItem& file,
                    bool show_open_folder_icon,
                    const ImVec2& cell_pos,
                    float cell_w,
                    float icon_size,
                    float padding_top);

void grid_item_label(ImDrawList* draw_list,
                     const FileExplorerState& state,
                     const UnifiedFileItem& file,
                     bool is_selected,
                     const ImVec2& cell_pos,
                     float cell_w,
                     float icon_size,
                     float padding_top,
                     float label_gap,
                     float wrap_inset);

void render_empty_state(float icon_size);

void select_item(FileExplorerState& state,
                 const UnifiedFileItem& file,
                 int index,
                 bool is_selected,
                 const ImGuiIO& io);

void sort_files(FileExplorerState& state, const ImGuiTableSortSpecs& sort_specs);

void render_file_size_cell(const UnifiedFileItem& file);

}  // namespace misty::panel
