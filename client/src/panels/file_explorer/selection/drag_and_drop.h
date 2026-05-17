#pragma once

#include <functional>
#include <string>

#include <imgui.h>

#include "panels/file_explorer/state/file_explorer_state.h"

namespace misty::panel::selection_detail {

bool prominent_drag_target_hovered_this_frame();
bool show_open_folder_for_drag_hover(const UnifiedFileItem& file, const ImVec2& min, const ImVec2& max);
void draw_file_drag_preview(const FileExplorerState& state,
                            const std::function<std::string(const UnifiedFileItem&)>& icon_name_for_file);

}  // namespace misty::panel::selection_detail
