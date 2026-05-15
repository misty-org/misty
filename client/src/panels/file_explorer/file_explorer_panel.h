#pragma once

#include <cstdint>
#include <functional>

#include "core/ui/ui_registry.h"
#include "core/threading/worker_pool.h"
#include "panels/file_explorer/file_explorer_state.h"
#include "panels/file_explorer/operation_journal.h"
#include "panels/panel/multi_panel.h"

namespace misty::panel {
    class FileTreeMultiPanel;

    struct FileExplorerPanelProps {
        std::string state_key = "Files";
        std::string panel_id = "primary";
        bool restore_persistent_state = true;
        std::string initial_path_override;
    };

    class FileExplorerPanel : public panel::MultiPanel {
        friend class FileTreeMultiPanel;
    public:
        FileExplorerPanel(core::UIRegistry& registry,
                          core::WorkerPool& worker_pool,
                          FileExplorerPanelProps props = {});
        ~FileExplorerPanel() override;
        void render() override;

        void toggle_chat_overlay();
        std::string active_explorer_state_key() const;
        void drop_selected_items_to_path(const std::string& source_state_key,
                                         const std::string& dest_path,
                                         ClipboardOp op);

        // Unified navigation - routes to local or remote based on path
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
        bool resolve_remote_path_context(const std::string& path,
                                         std::string& remote_name,
                                         std::string& remote_path) const;
        bool resolve_drop_destination_path(const std::string& path,
                                           std::string& resolved_path,
                                           std::string* error_message = nullptr) const;
        void request_manual_refresh(panel::FileExplorerState& state);
        void toggle_current_sync_watch(panel::FileExplorerState& state);

        void show_nav_history(panel::FileExplorerState& state, float button_width, float spacing);
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

        void show_context_menu(panel::FileExplorerState& state);
        void show_background_context_menu(panel::FileExplorerState& state);
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
        void perform_undo(panel::FileExplorerState& state);
        void perform_redo(panel::FileExplorerState& state);
        void perform_drop_items(panel::FileExplorerState& state,
                                const std::vector<panel::UnifiedFileItem>& items,
                                const std::string& dest_dir,
                                panel::ClipboardOp op);
        void perform_paste_local_to_local(panel::FileExplorerState& state, const panel::UnifiedFileItem& item, const std::string& dest_dir, panel::ClipboardOp op);
        bool perform_paste_to_cloud(panel::FileExplorerState& state, const panel::UnifiedFileItem& item, const std::string& dest_dir, panel::ClipboardOp op);
        bool perform_paste_cloud_to_cloud(panel::FileExplorerState& state, const panel::UnifiedFileItem& item, const std::string& dest_dir, panel::ClipboardOp op);
        void perform_paste_cloud_to_local(panel::FileExplorerState& state, const panel::UnifiedFileItem& item, const std::string& dest_dir, panel::ClipboardOp op);
        void queue_cross_device_move(const panel::UnifiedFileItem& item,
                                     const std::string& source_dir,
                                     const std::string& dest_dir,
                                     const std::filesystem::path& src,
                                     const std::filesystem::path& dest,
                                     std::function<void()> on_success = {});
        void request_background_move_refresh(const std::string& source_dir,
                                             const std::string& dest_dir);
        void trigger_upload(const std::string& local_path, const std::string& dest_dir);
        void perform_delete_selected(panel::FileExplorerState& state);
        void perform_delete_local_selected(panel::FileExplorerState& state);
        bool perform_delete(panel::FileExplorerState& state, const std::string& path, bool* requires_permission = nullptr);
        void initiate_rename(panel::FileExplorerState& state);
        void confirm_permanent_delete(panel::FileExplorerState& state);
        void retry_permission_delete(panel::FileExplorerState& state);
        bool open_context_menu_target(panel::FileExplorerState& state);
        const UnifiedFileItem* find_context_menu_target(const panel::FileExplorerState& state) const;
        void record_file_operation(panel::FileOperationRecord record);
        bool undo_file_operation(panel::FileExplorerState& state,
                                 const panel::FileOperationRecord& record,
                                 std::string* error_message);
        bool redo_file_operation(panel::FileExplorerState& state,
                                 const panel::FileOperationRecord& record,
                                 std::string* error_message);

#ifdef MISTY_TESTING
    private:
#endif
        void navigate_to_local_path_async(const std::string& path, bool update_history, uint64_t navigation_generation);

        void sync_account_mappings();
        void navigate_to_remote_mount_root(bool update_history);
        void navigate_to_provider_folder(const std::string& provider_folder, bool update_history);
        void navigate_to_remote(const std::string& remote_name, const std::string& path,
                                bool update_history, bool create_if_missing, uint64_t navigation_generation);
        void fetch_remote_folder(const std::string& remote_name, const std::string& remote_path,
                                 const std::string& target_path, uint64_t navigation_generation);
        void handle_remote_folder_fetch(const std::string& remote_name, const std::string& target_path,
                                        uint64_t navigation_generation,
                                        bool success, const std::string& body, const std::string& error,
                                        bool preserve_selection = false);
        void download_remote_file(const UnifiedFileItem& file);
        bool delete_remote_file(const UnifiedFileItem& file, std::string* error_message = nullptr);
        static void apply_remote_folder_fetch(core::UIRegistry& registry,
                                              const std::string& state_key,
                                              const std::string& remote_name,
                                              const std::string& target_path,
                                              uint64_t navigation_generation,
                                              bool success,
                                              const std::string& body,
                                              const std::string& error,
                                              bool preserve_selection = false);
        static bool delete_remote_file_impl(const UnifiedFileItem& file, std::string* error_message);

    private:
        core::UIRegistry& registry_;
        core::WorkerPool& worker_pool_;
        std::string state_key_;
    };
}
