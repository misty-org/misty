#pragma once

#include "imgui.h"

#include "panels/file_explorer/state/file_explorer_state.h"
#include "panels/file_explorer/state/file_listings_state.h"
#include "panels/file_explorer/file_explorer_panel.h"

namespace misty::panel {

/**
 * @brief Columns supported by the file explorer table view.
 */
enum class FileTableColumn : int {
    Name = 0,
    LastModified = 1,
    Size = 2,
    Type = 3,
};

/**
 * @brief Case-insensitive string comparison used by file sorting.
 */
int compare_strings(const std::string& lhs, const std::string& rhs);

/**
 * @brief Returns a human-readable type label for an explorer item.
 */
std::string type_label_for_item(const FileItem& file);

/**
 * @brief Formats a stored modified-time string for user-facing display.
 */
std::string display_last_modified(const std::string& raw_value);

/**
 * @brief Returns a human-readable lifecycle label for an explorer item.
 */
std::string state_label_for_item(const FileListing& listing, const FileItem& file);

/**
 * @brief Returns the icon name for an explorer item, optionally treating directories as open.
 */
std::string icon_name_for_file(const FileListing& listing, const FileItem& file, bool open_directory);

/**
 * @brief Returns the default icon name for an explorer item.
 */
std::string icon_name_for_file(const FileListing& listing, const FileItem& file);

/**
 * @brief Returns the icon color for a grid item.
 */
ImU32 grid_item_icon_color(const FileListing& listing, const FileItem& file);

/**
 * @brief Returns the text color for a grid item.
 */
ImU32 grid_item_text_color(const FileListing& listing, const FileItem& file, bool is_selected);

/**
 * @brief Starts the invisible button that owns one grid cell's interaction area.
 */
bool begin_grid_item_button(const std::string& id, float cell_w, float cell_h);

/**
 * @brief Draws the file icon for a grid cell.
 */
void grid_item_icon(ImDrawList* draw_list,
                    const FileExplorerState& state,
                    const FileListing& listing,
                    const FileItem& file,
                    bool show_open_folder_icon,
                    const ImVec2& cell_pos,
                    float cell_w,
                    float icon_size,
                    float padding_top);

/**
 * @brief Draws the wrapped label for a grid cell.
 */
void grid_item_label(ImDrawList* draw_list,
                     const FileExplorerState& state,
                     const FileListing& listing,
                     const FileItem& file,
                     bool is_selected,
                     const ImVec2& cell_pos,
                     float cell_w,
                     float icon_size,
                     float padding_top,
                     float label_gap,
                     float wrap_inset);

/**
 * @brief Renders the directory empty state.
 */
void render_empty_state(float icon_size);

/**
 * @brief Applies click, range-select, and toggle-select behavior to an item.
 */
void select_item(FileExplorerState& state,
                 FileExplorerPanel::TransientUiState& ui,
                 const FileListing& listing,
                 const FileItem& file,
                 int index,
                 bool is_selected,
                 const ImGuiIO& io);

/**
 * @brief Sorts the current file list according to ImGui table sort specs.
 */
void sort_files(FileListing& listing, const ImGuiTableSortSpecs& sort_specs);

/**
 * @brief Renders the size cell for a table row.
 */
void render_file_size_cell(const FileItem& file);

/**
 * @brief Renders the lifecycle/sync state cell for a table row.
 */
void render_file_state_cell(const FileListing& listing, const FileItem& file);

/**
 * @brief Renders an ImGui input that edits a std::string in place.
 */
bool input_text_string(const char* id,
                       std::string& value,
                       ImGuiInputTextFlags flags = 0,
                       const char* hint = nullptr,
                       float width = 0.0f);

}  // namespace misty::panel
