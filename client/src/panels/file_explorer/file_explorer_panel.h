#pragma once

#include <cstdint>
#include <functional>
#include <memory>
#include <string>

#include "core/file_master/file_master.h"
#include "core/threading/worker_pool.h"
#include "core/ui/ui_registry.h"
#include "panels/file_explorer/sidebar/file_sidebar_panel.h"
#include "panels/file_explorer/state/file_explorer_state.h"
#include "panels/panel/multi_panel.h"
#include "panels/search/search_panel.h"
#include "panels/search/search_state.h"

namespace misty::panel {

class FileTreeMultiPanel;

struct FileExplorerPanelProps {
    std::string state_key = "Files";
    std::string panel_id = "primary";
    bool restore_persistent_state = true;
    std::string initial_path_override;
    bool owns_state_cleanup = false;
};

class FileExplorerPanel : public panel::MultiPanel {
    friend class FileTreeMultiPanel;
public:
    FileExplorerPanel(core::UIRegistry& registry,
                      core::WorkerPool& worker_pool,
                      FileExplorerPanelProps props = {});
    ~FileExplorerPanel() override;
    void render() override;
    std::string tab_title() const override;
    std::string save_restore_state() const override;
    void load_restore_state(const std::string& state) override;
    void release_state() override;

    void render_sidebar();
    void render_content();
    void toggle_chat_overlay();
    std::string active_explorer_state_key() const;
    void drop_selected_items_to_path(const std::string& source_state_key,
                                     const std::string& dest_path,
                                     ClipboardOp op);

    void navigate_to_path(const std::string& path, bool update_history = true, bool create_if_missing = true);

private:
    TabController::Tab create_default_tab(std::int16_t tab_idx) const override;
    void render_panel_contents() override;
    void handle_pending_navigation(panel::FileExplorerState& state);
    void update_periodic_save(panel::FileExplorerState& state);
    void update_periodic_watched_sync(panel::FileExplorerState& state);
    void render_chat_overlay(panel::FileExplorerState& state,
                             float overlay_width,
                             float overlay_height,
                             float min_overlay_height,
                             float max_overlay_height,
                             float overlay_bottom_y);
    void submit_chat_message(panel::FileExplorerState& state);
    std::string build_chat_context(const panel::FileExplorerState& state) const;

    void update_navigation_history(panel::FileExplorerState& state, const std::string& target_path, bool update_history);
    void set_active_path(panel::FileExplorerState& state, const std::string& path);
    void reset_selection(panel::FileExplorerState& state);
    bool resolve_drop_destination_path(const std::string& path,
                                       std::string& resolved_path,
                                       std::string* error_message = nullptr) const;
    void request_manual_refresh(panel::FileExplorerState& state);

    void show_nav_history(panel::FileExplorerState& state, float button_width, float spacing);
    void show_search_bar(panel::FileExplorerState& state, SearchState& search_state);
    void show_breadcrumb_bar(panel::FileExplorerState& state);
    void show_directory_contents(panel::FileExplorerState& state);
    void apply_table_sort(panel::FileExplorerState& state, const ImGuiTableSortSpecs& sort_specs);
    void show_file_item(panel::FileExplorerState& state, int i);
    void show_grid_item(panel::FileExplorerState& state, int i, float cell_w, float cell_h);
    void begin_file_drag_source(panel::FileExplorerState& state, const panel::UnifiedFileItem& file, int index, bool is_selected);
    void handle_file_drop_target(panel::FileExplorerState& state,
                                 const std::string& dest_dir,
                                 const ImVec2& min,
                                 const ImVec2& max,
                                 bool prominent,
                                 bool auto_navigate,
                                 bool draw_hover_feedback = true);
    void handle_drag_navigation_target(panel::FileExplorerState& state,
                                       const std::string& target_path,
                                       const ImVec2& min,
                                       const ImVec2& max,
                                       bool prominent,
                                       std::function<void()> navigate_callback = {});

    void open_context_menu(panel::FileExplorerState& state);
    void open_background_context_menu(panel::FileExplorerState& state);
    void show_new_entry_modal(panel::FileExplorerState& state);
    void show_rename_modal(panel::FileExplorerState& state);
    void show_permanent_delete_modal(panel::FileExplorerState& state);
    void show_permission_delete_modal(panel::FileExplorerState& state);

#ifdef MISTY_TESTING
public:
#endif
    void perform_copy(panel::FileExplorerState& state);
    void perform_cut(panel::FileExplorerState& state);
    void perform_paste(panel::FileExplorerState& state);
    void perform_drop_items(panel::FileExplorerState& state,
                            const std::vector<panel::UnifiedFileItem>& items,
                            const std::string& dest_dir,
                            panel::ClipboardOp op);
    void perform_paste_local_to_local(panel::FileExplorerState& state,
                                      const panel::UnifiedFileItem& item,
                                      const std::string& dest_dir,
                                      panel::ClipboardOp op);
    void perform_delete_selected(panel::FileExplorerState& state);
    void initiate_rename(panel::FileExplorerState& state);
    void confirm_permanent_delete(panel::FileExplorerState& state);
    void retry_permission_delete(panel::FileExplorerState& state);
    const UnifiedFileItem* find_context_menu_target(const panel::FileExplorerState& state) const;

#ifdef MISTY_TESTING
private:
#endif
    void navigate_to_local_path_async(const std::string& path, bool update_history, uint64_t navigation_generation);
    core::FileMasterProps make_local_props(const panel::UnifiedFileItem& item,
                                           const std::string& dest_path = {}) const;

private:
    core::UIRegistry& registry_;
    core::WorkerPool& worker_pool_;
    std::shared_ptr<FileSidebarPanel> sidebar_panel_;
    std::string state_key_;
    std::string search_state_key_;
    std::unique_ptr<SearchPanel> search_panel_;
    bool owns_state_cleanup_ = false;
};

}  // namespace misty::panel
