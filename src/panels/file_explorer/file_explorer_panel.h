#pragma once

#include <cstdint>
#include <functional>
#include <memory>
#include <mutex>
#include <string>
#include <unordered_set>
#include <vector>

#include "core/file_master/file_master.h"
#include "core/file_sync/file_sync.h"
#include "core/threading/worker_pool.h"
#include "core/ui/ui_registry.h"
#include "panels/file_explorer/sidebar/file_sidebar_panel.h"
#include "panels/file_explorer/state/clipboard_state.h"
#include "panels/file_explorer/state/file_explorer_state.h"
#include "panels/file_explorer/state/file_listings_state.h"
#include "panels/file_explorer/state/library_state.h"
#include "panels/file_explorer/navigation/toolbar_util.h"
#include "panels/panel/multi_panel.h"
#include "panels/search/search_panel.h"
#include "panels/search/search_state.h"

namespace misty::panel {

class FileTreeMultiPanel;

/**
 * @brief Construction options for a file explorer panel instance.
 */
struct FileExplorerPanelProps {
    std::string state_key = "Files";
    std::string panel_id = "primary";
    bool restore_persistent_state = true;
    std::string initial_path_override;
    bool owns_state_cleanup = false;
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

        void clear_transient();
    };
    /**
     * @brief Creates a file explorer panel bound to registry state and the shared worker pool.
     */
    FileExplorerPanel(core::UIRegistry& registry,
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
     * @brief Returns the title to show for the current tab.
     */
    std::string tab_title() const override;
    /**
     * @brief Serializes panel navigation state for pane restoration.
     */
    std::string save_restore_state() const override;
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
     * @brief Renders the active content section of the file explorer.
     */
    void render_content();
    /**
     * @brief Opens or closes the ephemeral chat overlay.
     */
    void toggle_chat_overlay();
    /**
     * @brief Returns the state key for the currently active explorer pane or tab.
     */
    std::string active_explorer_state_key() const;
    /**
     * @brief Drops the selected items from one explorer state onto a destination path.
     */
    void drop_selected_items_to_path(const std::string& source_state_key,
                                     const std::string& dest_path,
                                     ClipboardOp op);

    /**
     * @brief Navigates the explorer to a local, virtual, or remote path.
     */
    void navigate_to_path(const std::string& path, bool update_history = true, bool create_if_missing = true);

private:
    /**
     * @brief Creates a new tab that inherits the current explorer location.
     */
    TabController::Tab create_default_tab(std::int16_t tab_idx) const override;
    /**
     * @brief Renders the top bar, directory content, search overlay, and breadcrumb bar.
     */
    void render_panel_contents() override;
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
     * @brief Renders back and forward history controls.
     */
    void show_nav_history(panel::FileExplorerState& state, float button_width, float spacing);
    /**
     * @brief Renders the search input and binds it to the current explorer path.
     */
    void show_search_bar(panel::FileExplorerState& state, SearchState& search_state);
    /**
     * @brief Renders breadcrumb navigation for the current path.
     */
    void show_breadcrumb_bar(panel::FileExplorerState& state);
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
     * @brief Renders and processes the rename modal.
     */
    void show_rename_modal(TransientUiState& ui);
    /**
     * @brief Renders and processes permanent delete confirmation.
     */
    void show_permanent_delete_modal(TransientUiState& ui);
    /**
     * @brief Renders and processes elevated-permission delete retry.
     */
    void show_permission_delete_modal(TransientUiState& ui);

#ifdef MISTY_TESTING
public:
#endif
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
                            panel::ClipboardOp op);
    /**
     * @brief Performs one local-to-local paste operation.
     */
    void perform_paste_local_to_local(panel::FileExplorerState& state,
                                      const panel::FileItem& item,
                                      const std::string& dest_dir,
                                      panel::ClipboardOp op);
    /**
     * @brief Begins delete handling for the current selection.
     */
    void perform_delete_selected(panel::FileExplorerState& state);
    /**
     * @brief Opens rename state for the current context-menu target.
     */
    void initiate_rename(TransientUiState& ui);
    /**
     * @brief Permanently deletes paths staged in the permanent delete modal.
     */
    void confirm_permanent_delete(TransientUiState& ui);
    /**
     * @brief Retries a delete operation that previously required elevated permission.
     */
    void retry_permission_delete(TransientUiState& ui);
    /**
     * @brief Returns the item targeted by the context menu, if it is still loaded.
     */
    const FileItem* find_context_menu_target(const panel::FileExplorerState& state,
                                             const panel::FileListing& listing,
                                             const TransientUiState& ui) const;

#ifdef MISTY_TESTING
private:
#endif
    /**
     * @brief Asynchronously lists a local or remote path and streams results into state.
     */
    void navigate_to_local_path_async(const std::string& path, bool update_history, uint64_t load_generation);
    /**
     * @brief Builds FileMaster properties for local operations involving an item.
     */
    core::FileMasterProps make_local_props(const panel::FileItem& item,
                                           const std::string& dest_path = {}) const;

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
    core::UIRegistry& registry_;
    core::WorkerPool& worker_pool_;
    std::shared_ptr<FileSidebarPanel> sidebar_panel_;
    std::unique_ptr<core::FileSync> file_sync_;
    std::string state_key_;
    std::string search_state_key_;
    std::unique_ptr<SearchPanel> search_panel_;
    TransientUiState ui_;
    bool owns_state_cleanup_ = false;
};

}  // namespace misty::panel
