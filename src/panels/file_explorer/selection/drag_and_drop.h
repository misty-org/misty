#pragma once

#include <functional>
#include <string>

#include <imgui.h>

#include "panels/file_explorer/state/file_explorer_state.h"
#include "panels/file_explorer/state/file_listings_state.h"

namespace misty::panel::selection_detail {

/**
 * @brief Returns true when a prominent drag target has been hovered during this frame.
 */
bool prominent_drag_target_hovered_this_frame();
/**
 * @brief Returns true when hovering a dragged item should preview opening a folder.
 */
bool show_open_folder_for_drag_hover(const FileItem& file, const ImVec2& min, const ImVec2& max);
/**
 * @brief Draws the floating preview for the current file drag payload.
 */
void draw_file_drag_preview(const FileExplorerState& state,
                            const std::function<std::string(const FileItem&)>& icon_name_for_file);

}  // namespace misty::panel::selection_detail
