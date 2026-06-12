#pragma once

#include <atomic>
#include <cstdint>
#include <functional>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <unordered_set>
#include <vector>

#include "core/file_transfer/file_transfer.h"
#include "core/file_sync/file_sync_compare.h"
#include "core/file_sync/file_sync_master.h"
#include "core/threading/worker_pool.h"
#include "core/ui/state_registry.h"
#include "panels/file_explorer/sidebar/file_sidebar_panel.h"
#include "panels/file_explorer/state/clipboard_state.h"
#include "panels/file_explorer/state/file_explorer_state.h"
#include "panels/file_explorer/state/file_listings_state.h"
#include "panels/file_explorer/state/file_sync_compare_state.h"
#include "panels/file_explorer/state/library_state.h"
#include "panels/file_explorer/state/rename_session_state.h"
#include "panels/file_explorer/navigation/toolbar_util.h"
#include "panels/panel/multi_panel.h"
#include "panels/preview/preview_panel.h"

namespace misty::panel {

class FileTreeMultiPanel;

enum class FileExplorerPanelMode {
    Standard,
    CompareSync,
};

/**
 * @brief Construction options for a file explorer panel instance.
 */
struct FileExplorerPanelProps {
    std::string state_key = "Files";
    std::string panel_id = "primary";
    bool restore_persistent_state = true;
    std::string initial_path_override;
    bool defer_initial_navigation = false;
    bool owns_state_cleanup = false;
    FileExplorerPanelMode mode = FileExplorerPanelMode::Standard;
    std::string compare_owner_state_key;
    std::int64_t compare_pair_id = 0;
    bool compare_watch_mode = false;
    bool compare_diff_tray_open = false;
};

/**
 * @brief Main file explorer panel, including tabs, sidebar, navigation, and operations.
 */
class FileExplorerPanel : public panel::MultiPanel {
    friend class FileTreeMultiPanel;
public:
    struct ChatMessage {
        std::string role;
        std::string content;
    };

    struct TransientUiState {
        std::unordered_set<std::string> selected_files;
        int last_selected_index = -1;
        bool is_hidden = false;
        bool show_hidden = false;
        bool grid_view = false;
        std::string error_msg;
        std::mutex mu;

        bool show_rename_modal = false;
        char rename_buffer[256] = "";
        std::string rename_target_path;

        std::string context_menu_target_path;

        bool show_new_entry_modal = false;
        bool new_entry_is_dir = false;
        char new_entry_name_buffer[256] = "";

        bool show_permission_delete_modal = false;
        bool permission_delete_permanent = false;
        std::vector<std::string> permission_delete_paths;

        bool show_permanent_delete_modal = false;
        std::vector<std::string> permanent_delete_paths;

        bool chat_overlay_open = false;
        bool chat_request_in_flight = false;
        bool chat_focus_input = false;
        bool chat_resizing = false;
        bool chat_resize_just_finished = false;
        float chat_overlay_height = 0.0f;
        char chat_input_buffer[2048] = "";
        std::vector<ChatMessage> chat_messages;
        std::string chat_error_msg;
        std::string breadcrumb_path;
        std::vector<BreadcrumbSegment> breadcrumb_segments;
        bool path_bar_editing = false;
        bool path_bar_focus = false;
        float path_bar_scroll_x = 0.0f;
        bool path_bar_scroll_to_end = false;
        char compare_pair_name_buffer[128] = "";

        void clear_transient();
    };
    /**
     * @brief Creates a file explorer panel bound to registry state and the shared worker pool.
     */
    FileExplorerPanel(core::StateRegistry& registry,
                      core::WorkerPool& worker_pool,
                      FileExplorerPanelProps props = {});
    /**
     * @brief Releases panel-owned state when configured to do so.
     */
    ~FileExplorerPanel() override;
    /**
     * @brief Renders the multi-panel shell and active explorer content.
     */
    void render() override;
    /**
     * @brief Handles file explorer keyboard shortcuts and pane commands.
     */
    void handle_commands();
    /**
     * @brief Returns the title to show for the current tab.
     */
    std::string tab_title() const override;
    /**
     * @brief Serializes panel navigation state for pane restoration.
     */
    std::string save_restore_state() const override;
    /**
     * @brief Restores the split-pane workspace snapshot without issuing throwaway startup navigation.
     */
    void restore_workspace_snapshot(const core::WorkspaceExplorerSnapshot& snapshot);
    /**
     * @brief Restores panel navigation state from a serialized pane payload.
     */
    void load_restore_state(const std::string& state) override;
    /**
     * @brief Releases state owned by this panel from the UI registry.
     */
    void release_state() override;

    /**
     * @brief Renders the sidebar section of the file explorer.
     */
    void render_sidebar();
    /**
     * @brief Connects sidebar workspace switching UI to the owning Files view.
     */
    void set_workspace_controls(std::function<std::vector<FileSidebarPanel::WorkspaceEntry>()> entries_provider,
                                std::function<void(std::int16_t)> select_handler,
                                std::function<void(std::string)> create_handler,
                                std::function<void(std::int16_t, std::string)> rename_handler,
                                std::function<void(std::int16_t)> delete_handler);
    bool workspace_dropdown_open() const;
    /**
     * @brief Renders the active content section of the file explorer.
     */
    void render_content();
    /**
     * @brief Renders the shell-level toolbar for the currently active explorer pane.
     */
    void render_active_toolbar();
    /**
     * @brief Renders the compare-mode controls above the pane content.
     */
    void render_compare_header();
    /**
     * @brief Renders the compare diff tray above the bottom bar.
     */
    void render_compare_diff_tray();
    /**
     * @brief Returns the fixed shell toolbar height.
     */
    float toolbar_height() const;
    /**
     * @brief Returns the dedicated compare header height for compare tabs.
     */
    float compare_header_height() const;
    /**
     * @brief Returns the dedicated compare diff tray height for compare tabs.
     */
    float compare_diff_tray_height() const;
    /**
     * @brief Returns the explorer panel mode for the current top-level tab.
     */
    FileExplorerPanelMode mode() const;
    bool is_compare_mode() const;
    bool compare_diff_tray_open() const;
    void set_compare_diff_tray_open(bool open);
    std::int64_t compare_pair_id() const;
    bool compare_watch_mode() const;
    /**
     * @brief Returns the second toolbar row bounds used for centered transient notifications.
     */
    bool notification_anchor_bounds(ImVec2& min, ImVec2& max) const;
    /**
     * @brief Renders the persistent details/preview inspector for the active explorer.
     */
    void render_inspector();
    /**
     * @brief Opens or closes the ephemeral chat overlay.
     */
    void toggle_chat_overlay();
    /**
     * @brief Returns the state key for the currently active explorer pane or tab.
     */
    std::string active_explorer_state_key() const;
    std::vector<std::string> workspace_search_roots() const;
    /**
     * @brief Drops the selected items from one explorer state onto a destination path.
     */
    void drop_selected_items_to_path(const std::string& source_state_key,
                                     const std::vector<std::string>& selected_ids,
                                     const std::string& dest_path,
                                     ClipboardOp op);

    /**
     * @brief Navigates the explorer to a local, virtual, or remote path.
     */
    void navigate_to_path(const std::string& path, bool update_history = true, bool create_if_missing = true);
    void set_search_palette_state_provider(std::function<bool()> open_provider,
                                           std::function<std::string()> query_provider,
                                           std::function<void()> open_handler);
    bool execute_palette_command(const std::string& command_id);

private:
    /**
     * @brief Creates a new tab that inherits the current explorer location.
     */
    TabController::Tab create_default_tab(std::int16_t tab_idx) const override;
    /**
     * @brief Renders the top bar, directory content, search overlay, and breadcrumb bar.
     */
    void render_panel_contents() override;
    float pane_header_height(const Panel& panel, bool is_active, bool has_multiple_panes) const override;
    void render_pane_header(Panel& panel, bool is_active, bool has_multiple_panes) override;
    void render_pane_drop_zone(Panel& panel,
                               bool is_active,
                               bool has_multiple_panes,
                               const ImVec2& min,
                               const ImVec2& max) override;
    /**
     * @brief Renders the inspector body inside either a window or embedded child.
     */
    void render_inspector_contents();
    /**
     * @brief Periodically persists dirty explorer state through the worker pool.
     */
    void update_periodic_save(panel::FileExplorerState& state);
    /**
     * @brief Runs periodic sync hooks for watched locations.
     */
    void update_periodic_watched_sync(panel::FileExplorerState& state);
    /**
     * @brief Renders the chat overlay anchored to the file explorer content area.
     */
    void render_chat_overlay(TransientUiState& ui,
                             float overlay_width,
                             float overlay_height,
                             float min_overlay_height,
                             float max_overlay_height,
                             float overlay_bottom_y);
    /**
     * @brief Submits the current chat input for the given explorer state.
     */
    void submit_chat_message(TransientUiState& ui);
    /**
     * @brief Builds contextual text for the chat overlay from the current explorer state.
     */
    std::string build_chat_context(const TransientUiState& ui) const;
    const std::string& compare_state_scope_key() const;
    bool is_compare_context() const;
    void ensure_compare_state_initialized();
    std::vector<FileExplorerPanel*> compare_child_panels() const;
    std::optional<std::pair<FileExplorerPanel*, FileExplorerPanel*>> compare_child_panel_pair() const;
    std::optional<std::pair<core::FileSyncEndpoint, core::FileSyncEndpoint>> compare_current_endpoints() const;
    std::pair<std::string, std::string> compare_display_paths() const;
    bool set_compare_roots(const core::FileSyncEndpoint& left, const core::FileSyncEndpoint& right);
    bool swap_compare_roots();
    void sync_compare_state_from_panes();
    void ensure_compare_dual_pane();
    bool compare_row_snapshot_for_file(const panel::FileExplorerState& state,
                                       const panel::FileItem& file,
                                       core::FileSyncCompareRow* out,
                                       bool* is_left_side = nullptr) const;
    void set_compare_row_action(const std::string& relative_path,
                                core::FileSyncPlannedAction action);
    void apply_compare_row_action(const panel::FileExplorerState& state,
                                  const core::FileSyncCompareRow& row,
                                  core::FileSyncPlannedAction action);
    void run_compare_session_async(const core::FileSyncEndpoint& left,
                                   const core::FileSyncEndpoint& right,
                                   int64_t pair_id,
                                   bool watch_mode);
    void maybe_refresh_watched_compare();
    void render_compare_results(FileSyncCompareState& compare_state);
    void apply_compare_rows(FileSyncCompareState& compare_state);

    /**
     * @brief Pushes the current path onto history when navigating to a distinct target.
     */
    void update_navigation_history(panel::FileExplorerState& state, const std::string& target_path, bool update_history);
    /**
     * @brief Updates the state buffers that represent the active path and search scope.
     */
    void set_active_path(panel::FileExplorerState& state, const std::string& path);
    /**
     * @brief Clears the current selection and anchor index.
     */
    void reset_selection(TransientUiState& ui);
    /**
     * @brief Resolves a drag/drop destination path before an operation is performed.
     */
    bool resolve_drop_destination_path(const std::string& path,
                                       std::string& resolved_path,
                                       std::string* error_message = nullptr) const;
    /**
     * @brief Refreshes the current listing without adding a history entry.
     */
    void request_manual_refresh(panel::FileExplorerState& state);
    /**
     * @brief Queues a relist when a completed transfer touches the active directory.
     */
    void queue_transfer_refresh(const core::FileTransferRecord& record);
    /**
     * @brief Returns true when a transfer should refresh the explorer's current listing.
     */
    bool transfer_touches_current_listing(const core::FileTransferRecord& record) const;

    /**
     * @brief Renders back and forward history controls.
     */
    void show_nav_history(panel::FileExplorerState& state, float button_width, float spacing);
    /**
     * @brief Renders the breadcrumb path control, switching to an editable path field when activated.
     */
    void show_path_control(panel::FileExplorerState& state, float width);
    /**
     * @brief Renders the scoped search field in the file explorer toolbar.
     */
    void show_search_field(panel::FileExplorerState& state, float width);
    /**
     * @brief Renders the combined grid/list view segmented control.
     */
    void show_view_mode_toggle();
    /**
     * @brief Renders toolbar actions that sit to the right of the path control.
     */
    void show_toolbar_actions(panel::FileExplorerState& state);
    /**
     * @brief Renders the file operation toolbar below the navigation row.
     */
    void show_file_action_toolbar(panel::FileExplorerState& state);
    /**
     * @brief Renders breadcrumb navigation for the current path.
     */
    void show_breadcrumb_bar(panel::FileExplorerState& state);
    /**
     * @brief Renders the Finder-style command toolbar.
     */
    void show_command_toolbar(panel::FileExplorerState& state);
    /**
     * @brief Returns the primary selected item, if exactly one selected item is loaded.
     */
    const FileItem* primary_selected_item(const panel::FileListing& listing) const;
    /**
     * @brief Renders the active directory listing in grid or table mode.
     */
    void show_directory_contents(panel::FileExplorerState& state,
                                 panel::FileListing& listing,
                                 TransientUiState& ui);
    /**
     * @brief Applies ImGui table sorting to the current file list.
     */
    void apply_table_sort(panel::FileExplorerState& state,
                          panel::FileListing& listing,
                          TransientUiState& ui,
                          const ImGuiTableSortSpecs& sort_specs);
    /**
     * @brief Renders one row in list view.
     */
    void show_file_item(panel::FileExplorerState& state,
                        panel::FileListing& listing,
                        TransientUiState& ui,
                        int i);
    /**
     * @brief Renders one tile in grid view.
     */
    void show_grid_item(panel::FileExplorerState& state,
                        panel::FileListing& listing,
                        TransientUiState& ui,
                        int i,
                        float cell_w,
                        float cell_h);
    /**
     * @brief Starts an ImGui drag source for a file item.
     */
    void begin_file_drag_source(panel::FileExplorerState& state,
                                panel::FileListing& listing,
                                TransientUiState& ui,
                                const panel::FileItem& file,
                                int index,
                                bool is_selected);
    /**
     * @brief Handles a drop target that accepts file explorer items.
     */
    void handle_file_drop_target(panel::FileExplorerState& state,
                                 const std::string& dest_dir,
                                 const ImVec2& min,
                                 const ImVec2& max,
                                 bool prominent,
                                 bool auto_navigate,
                                 bool draw_hover_feedback = true);
    /**
     * @brief Handles hover-to-navigate behavior while dragging over a path target.
     */
    void handle_drag_navigation_target(panel::FileExplorerState& state,
                                       const std::string& target_path,
                                       const ImVec2& min,
                                       const ImVec2& max,
                                       bool prominent,
                                       std::function<void()> navigate_callback = {});

    /**
     * @brief Opens the context menu for the current selected or targeted item.
     */
    void open_context_menu(panel::FileExplorerState& state, TransientUiState& ui);
    /**
     * @brief Opens the context menu for the directory background.
     */
    void open_background_context_menu(panel::FileExplorerState& state, TransientUiState& ui);
    /**
     * @brief Renders and processes the new file/folder modal.
     */
    void show_new_entry_modal(TransientUiState& ui);
    /**
     * @brief Renders and processes the final rename review modal.
     */
    void show_rename_review_modal();
    /**
     * @brief Renders and processes permanent delete confirmation.
     */
    void show_permanent_delete_modal(TransientUiState& ui);
    /**
     * @brief Renders and processes elevated-permission delete retry.
     */
    void show_permission_delete_modal(TransientUiState& ui);

    /**
     * @brief Copies the selected files into the shared explorer clipboard.
     */
    void perform_copy(panel::FileExplorerState& state);
    /**
     * @brief Cuts the selected files into the shared explorer clipboard.
     */
    void perform_cut(panel::FileExplorerState& state);
    /**
     * @brief Pastes the current clipboard payload into the active directory.
     */
    void perform_paste(panel::FileExplorerState& state);
    /**
     * @brief Performs copy or cut operations for a drag/drop payload.
     */
    void perform_drop_items(panel::FileExplorerState& state,
                            const std::vector<panel::FileItem>& items,
                            const std::string& dest_dir,
                            panel::ClipboardOp op,
                            const std::string& source_state_key = {});
    /**
     * @brief Performs one paste/drop operation through the local or remote file master.
     */
    bool perform_paste_item(panel::FileExplorerState& state,
                            const panel::FileItem& item,
                            const std::string& dest_dir,
                            panel::ClipboardOp op,
                            uint64_t job_id,
                            const std::string& source_state_key = {});
    /**
     * @brief Downloads a remote row into its mounted local destination path.
     */
    void download_remote_item(panel::FileExplorerState& state,
                              const panel::FileItem& item);
    /**
     * @brief Starts a sync watcher rooted at the current local directory.
     */
    void create_sync_object_for_current_directory(panel::FileExplorerState& state);
    /**
     * @brief Begins delete handling for the current selection.
     */
    void perform_delete_selected(panel::FileExplorerState& state);
    /**
     * @brief Starts or expands the shared rename mode from the current selection.
     */
    void initiate_rename(TransientUiState& ui);
    /**
     * @brief Opens the final review modal for the active rename session.
     */
    void open_rename_review_modal();
    /**
     * @brief Executes all valid rename rows from the review modal.
     */
    void confirm_rename_review();
    /**
     * @brief Permanently deletes paths staged in the permanent delete modal.
     */
    void confirm_permanent_delete(TransientUiState& ui);
    /**
     * @brief Retries a delete operation that previously required elevated permission.
     */
    void retry_permission_delete(TransientUiState& ui);
    /**
     * @brief Handles keyboard shortcuts for copy, cut, paste, rename, and delete.
     */
    void handle_file_operation_commands();
    /**
     * @brief Synchronizes visible selection state into the shared rename session.
     */
    void sync_rename_session_selection(panel::FileExplorerState& state,
                                       const panel::FileListing& listing,
                                       bool clear_visible_directory = false);
    /**
     * @brief Exits rename mode and discards unresolved drafts.
     */
    void cancel_rename_mode();
    /**
     * @brief Renders the in-toolbar rename status pill while rename mode is active.
     */
    void render_rename_status_banner(float available_width);
    /**
     * @brief Returns the shared rename session registry entry.
     */
    RenameSessionState& rename_session_state();
    /**
     * @brief Returns true when the shared rename session is active.
     */
    bool rename_mode_active() const;
    /**
     * @brief Returns the rename participant for a visible file item, if any.
     */
    bool rename_participant_snapshot_for_file(const panel::FileExplorerState& state,
                                              const panel::FileItem& file,
                                              RenameParticipant* out) const;
    /**
     * @brief Updates a participant draft and revalidates the session.
     */
    void update_rename_participant_draft(const std::string& participant_key,
                                         const std::string& draft_name,
                                         bool propagate_to_all = false);
    /**
     * @brief Returns the item targeted by the context menu, if it is still loaded.
     */
    const FileItem* find_context_menu_target(const panel::FileExplorerState& state,
                                             const panel::FileListing& listing,
                                             const TransientUiState& ui) const;

    /**
     * @brief Asynchronously lists a local or remote path and streams results into state.
     */
    void navigate_to_local_path_async(const std::string& path,
                                      bool update_history,
                                      uint64_t load_generation,
                                      bool force_remote_refresh = false);
    /**
     * @brief Returns the shared listing state registry entry.
     */
    panel::FileListingsState& file_listings_state();

    /**
     * @brief Returns the listing for this panel's explorer state.
     */
    panel::FileListing& active_listing();

    /**
     * @brief Returns the listing for a specific explorer state key.
     */
    panel::FileListing& listing_for_key(const std::string& state_key);

    /**
     * @brief Returns the shared explorer library state.
     */
    panel::LibraryState& library_state();

private:
    core::StateRegistry& registry_;
    core::WorkerPool& worker_pool_;
    std::shared_ptr<FileSidebarPanel> sidebar_panel_;
    std::vector<std::unique_ptr<core::FileSyncMaster>> file_sync_objects_;
    std::unordered_set<std::string> file_sync_roots_;
    std::string state_key_;
    std::string compare_owner_state_key_;
    std::unique_ptr<PreviewPanel> preview_panel_;
    uint64_t transfer_listener_id_ = 0;
    std::shared_ptr<std::atomic<bool>> transfer_listener_alive_ = std::make_shared<std::atomic<bool>>(true);
    TransientUiState ui_;
    std::string pending_drag_navigation_path_;
    bool notification_anchor_valid_ = false;
    ImVec2 notification_anchor_min_{};
    ImVec2 notification_anchor_max_{};
    mutable bool suppress_child_initial_navigation_ = false;
    bool owns_state_cleanup_ = false;
    FileExplorerPanelMode mode_ = FileExplorerPanelMode::Standard;
    std::int64_t initial_compare_pair_id_ = 0;
    bool initial_compare_watch_mode_ = false;
    bool initial_compare_diff_tray_open_ = false;
    std::function<bool()> search_palette_open_provider_;
    std::function<std::string()> search_palette_query_provider_;
    std::function<void()> search_palette_open_handler_;
};

}  // namespace misty::panel
