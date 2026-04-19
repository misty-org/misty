#pragma once

#include <cstdint>
#include <functional>
#include <memory>

#include "core/ui/ui_registry.h"
#include "dfs/client/misty_client.h"
#include "panels/panel.h"
#include "core/threading/worker_pool.h"
#include "panels/file_explorer/file_explorer_state.h"
#include "panels/workspace/workspace_state.h"
#include "panels/activity/upload_state.h"
#include "panels/search/search_state.h"


namespace misty::panel {
    class SearchPanel;  // forward declaration

    class FileExplorerPanel : public panel::Panel {
    public:
        FileExplorerPanel(core::UIRegistry& registry,
                          core::WorkerPool& worker_pool,
                          std::shared_ptr<MistyClient> client,
                          std::string state_key = "Files",
                          std::string search_state_key = "Search",
                          std::string panel_id = "primary",
                          bool restore_persistent_state = true,
                          std::string initial_path_override = "");
        ~FileExplorerPanel() override;
        void render() override;

        void set_search_panel(SearchPanel* panel) { search_panel_ = panel; }
        void set_body_drag_source_callback(std::function<void()> callback) {
            body_drag_source_callback_ = std::move(callback);
        }
        void set_shared_path_refresh_callback(std::function<void(const std::string&)> callback) {
            shared_path_refresh_callback_ = std::move(callback);
        }
        bool consume_activation_request();
        void toggle_chat_overlay();
        bool toggle_preview_pane();
        bool zoom_preview_in();
        bool zoom_preview_out();
        bool reset_preview_zoom();

        // Unified navigation - routes to local or remote based on path
        void navigate_to_path(const std::string& path, bool update_history = true, bool create_if_missing = true);

    private:
        void apply_workspace_mount_if_ready(panel::FileExplorerState& state, panel::WorkspaceState& workspace_state);
        void handle_pending_navigation(panel::FileExplorerState& state);
        void render_search_overlay(panel::SearchState& search_state, const ImVec2& list_start, float list_height);
        void process_deferred_search_actions(panel::SearchState& search_state);
        void update_periodic_save(panel::FileExplorerState& state);
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
        void notify_shared_path_refresh(const std::string& path);
        void request_manual_refresh(panel::FileExplorerState& state);

        void show_nav_history(panel::FileExplorerState& state, float button_width, float spacing);
        void show_search_bar(panel::FileExplorerState& state);
        void show_inline_search(panel::FileExplorerState& state, SearchState& search_state);
        void show_directory_contents(panel::FileExplorerState& state);
        void render_preview_pane(const std::string& selected_path, float preview_width);
        bool load_preview_texture(const std::string& path, std::string* error_message);
        void clear_preview_texture();
        std::string selected_preview_path(panel::FileExplorerState& state) const;
        void apply_table_sort(panel::FileExplorerState& state, const ImGuiTableSortSpecs& sort_specs);
        void show_file_item(panel::FileExplorerState& state, int i);
        void show_grid_item(panel::FileExplorerState& state, int i, float cell_w, float cell_h);

        // Context menu + file operations
        void show_context_menu(panel::FileExplorerState& state);
        void show_background_context_menu(panel::FileExplorerState& state);
        void show_new_entry_modal(panel::FileExplorerState& state);
        void show_rename_modal(panel::FileExplorerState& state);
        void show_permanent_delete_modal(panel::FileExplorerState& state);
        void show_permission_delete_modal(panel::FileExplorerState& state);

        // File operation helpers
        void perform_copy(panel::FileExplorerState& state);
        void perform_cut(panel::FileExplorerState& state);
        void perform_paste(panel::FileExplorerState& state);
        void perform_paste_local_to_local(panel::FileExplorerState& state, const panel::UnifiedFileItem& item, const std::string& dest_dir, panel::ClipboardOp op);
        void perform_paste_to_cloud(panel::FileExplorerState& state, const panel::UnifiedFileItem& item, const std::string& dest_dir, panel::ClipboardOp op);
        void perform_paste_cloud_to_local(panel::FileExplorerState& state, const panel::UnifiedFileItem& item, const std::string& dest_dir, panel::ClipboardOp op);
        void trigger_upload(const std::string& local_path, const std::string& dest_dir);
        void perform_delete_selected(panel::FileExplorerState& state);
        void perform_delete_local_selected(panel::FileExplorerState& state);
        bool perform_delete(panel::FileExplorerState& state, const std::string& path, bool* requires_permission = nullptr);
        void initiate_rename(panel::FileExplorerState& state);
        void confirm_permanent_delete(panel::FileExplorerState& state);
        void retry_permission_delete(panel::FileExplorerState& state);
        bool open_context_menu_target(panel::FileExplorerState& state);
        const UnifiedFileItem* find_context_menu_target(const panel::FileExplorerState& state) const;

        // Async local filesystem navigation
        void navigate_to_local_path_async(const std::string& path, bool update_history, uint64_t navigation_generation);

        // Sync account mappings from services state
        void sync_account_mappings();

        // Unified remote navigation (replaces per-provider methods)
        void navigate_to_remote_mount_root(bool update_history);
        void navigate_to_provider_folder(const std::string& provider_folder, bool update_history);
        void navigate_to_remote(const std::string& remote_name, const std::string& path,
                                bool update_history, bool create_if_missing, uint64_t navigation_generation);
        void fetch_remote_folder(const std::string& remote_name, const std::string& remote_path,
                                 const std::string& target_path, uint64_t navigation_generation);
        void handle_remote_folder_fetch(const std::string& remote_name, const std::string& target_path,
                                        uint64_t navigation_generation,
                                        bool success, const std::string& body, const std::string& error);
        void download_remote_file(const UnifiedFileItem& file);
        bool delete_remote_file(const UnifiedFileItem& file, std::string* error_message = nullptr);

    private:
        core::UIRegistry& registry_;
        core::WorkerPool& worker_pool_;
        std::shared_ptr<MistyClient> client_;
        std::string state_key_;
        std::string search_state_key_;
        std::string window_name_;

        std::string initial_start_path_;
        bool workspace_mount_applied_ = false;
        SearchPanel* search_panel_ = nullptr;
        std::function<void()> body_drag_source_callback_;
        std::function<void(const std::string&)> shared_path_refresh_callback_;
        bool activation_requested_ = false;
        bool preview_pane_open_ = false;
        bool preview_pane_resizing_ = false;
        float preview_pane_width_ = 360.0f;
        float preview_pane_drag_start_width_ = 360.0f;
        float preview_pane_drag_start_mouse_x_ = 0.0f;
        std::uint32_t preview_texture_id_ = 0;
        int preview_texture_width_ = 0;
        int preview_texture_height_ = 0;
        float preview_zoom_ = 1.0f;
        std::string preview_selected_path_;
        std::string preview_source_path_;
        std::string preview_error_;

    };
};
