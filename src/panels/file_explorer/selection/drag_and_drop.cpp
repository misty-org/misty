#include "panels/file_explorer/selection/drag_and_drop.h"

#include "panels/file_explorer/file_explorer_panel.h"

namespace misty::panel {

namespace selection_detail {

bool prominent_drag_target_hovered_this_frame() {
    return false;
}

bool show_open_folder_for_drag_hover(const FileItem& file, const ImVec2& min, const ImVec2& max) {
    (void)file;
    (void)min;
    (void)max;
    return false;
}

void draw_file_drag_preview(const FileExplorerState& state,
                            const std::function<std::string(const FileItem&)>& icon_name_for_file) {
    (void)state;
    (void)icon_name_for_file;
}

}  // namespace selection_detail

void FileExplorerPanel::begin_file_drag_source(FileExplorerState& state,
                                               FileListing& listing,
                                               FileExplorerPanel::TransientUiState& ui,
                                               const FileItem& file,
                                               int index,
                                               bool is_selected) {
    (void)state;
    (void)listing;
    (void)ui;
    (void)file;
    (void)index;
    (void)is_selected;
}

void FileExplorerPanel::handle_file_drop_target(FileExplorerState& state,
                                                const std::string& dest_dir,
                                                const ImVec2& min,
                                                const ImVec2& max,
                                                bool prominent,
                                                bool auto_navigate,
                                                bool draw_hover_feedback) {
    (void)state;
    (void)dest_dir;
    (void)min;
    (void)max;
    (void)prominent;
    (void)auto_navigate;
    (void)draw_hover_feedback;
}

void FileExplorerPanel::handle_drag_navigation_target(FileExplorerState& state,
                                                      const std::string& target_path,
                                                      const ImVec2& min,
                                                      const ImVec2& max,
                                                      bool prominent,
                                                      std::function<void()> navigate_callback) {
    (void)state;
    (void)target_path;
    (void)min;
    (void)max;
    (void)prominent;
    (void)navigate_callback;
}

}  // namespace misty::panel
