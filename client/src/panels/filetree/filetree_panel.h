#pragma once

#include <array>
#include <memory>
#include <optional>
#include <string>
#include <unordered_map>
#include <vector>

#include "core/threading/worker_pool.h"
#include "core/ui/ui_registry.h"
#include "dfs/client/misty_client.h"
#include "panels/file_explorer/file_explorer_panel.h"
#include "panels/search/search_panel.h"
#include "imgui.h"

namespace misty::panel {
    class FileTreePanel {
    public:
        FileTreePanel(core::UIRegistry& ui_registry,
                      core::WorkerPool& worker_pool,
                      std::shared_ptr<MistyClient> client);
        ~FileTreePanel();

        void render(const ImVec2& pos, const ImVec2& size);
        void handle_commands();
        void toggle_active_search();
        std::string active_explorer_state_key() const;
        bool invoke_command(const std::string& command_id);

    private:
        enum class RestoreMode {
            Column,
            Row,
        };

        struct TabSnapshot {
            bool pinned = false;
            std::string current_path;
            bool show_hidden = false;
            bool grid_view = false;
            std::vector<std::string> back_history;
            std::vector<std::string> forward_history;
            bool search_open = false;
            std::string search_query;
        };

        struct ExplorerTab {
            int tab_id = -1;
            bool pinned = false;
            std::string explorer_state_key;
            std::string search_state_key;
            std::string panel_id;
            std::shared_ptr<FileExplorerPanel> explorer_panel;
            std::shared_ptr<SearchPanel> search_panel;
        };

        struct ExplorerPane {
            int pane_id = -1;
            std::vector<int> tab_order;
            int active_tab_id = -1;
            std::vector<TabSnapshot> closed_tabs;
        };

        struct PaneSnapshot {
            std::vector<TabSnapshot> tabs;
            int active_tab_index = 0;
            std::vector<TabSnapshot> closed_tabs;
        };

        struct ClosedPaneSnapshot {
            RestoreMode restore_mode = RestoreMode::Row;
            int column_index = 0;
            int row_index = 0;
            std::vector<PaneSnapshot> panes;
        };

        struct Column {
            std::vector<int> pane_ids;
        };

        struct TabPayload {
            int source_pane_id = -1;
            int tab_id = -1;
        };

        struct PanePayload {
            int pane_id = -1;
        };

        struct PendingPaneMove {
            int source_pane_id = -1;
            int target_pane_id = -1;
            bool insert_before = true;
        };

        struct PendingTabAppend {
            int source_pane_id = -1;
            int target_pane_id = -1;
            int tab_id = -1;
        };

        struct PaneLocation {
            int column_index = -1;
            int row_index = -1;
        };

        void init_default_layout();

        void render_column(int column_index, const ImVec2& pos, const ImVec2& size);
        void render_pane(int pane_id, const ImVec2& pos, const ImVec2& size);
        void render_tab_strip(int pane_id, const ImVec2& pos, const ImVec2& size, float& out_height);
        void render_drag_overlay(int pane_id, const ImVec2& pos, const ImVec2& size);

        int create_pane_instance(int preferred_pane_id = -1);
        int create_tab_instance(int pane_id,
                                bool restore_persistent_state,
                                const std::string& initial_path,
                                bool pinned = false,
                                const std::string& preferred_explorer_state_key = "",
                                const std::string& preferred_search_state_key = "",
                                const std::string& preferred_panel_id = "",
                                int preferred_tab_id = -1);
        int restore_pane_instance(const PaneSnapshot& snapshot);
        void destroy_pane_instance(int pane_id);

        void split_active_vertical();
        void split_active_horizontal();
        void collapse_right_column();
        void collapse_bottom_of_column(int column_index);
        void close_active_pane();
        void restore_last_closed_pane();

        void activate_tab(int pane_id, int tab_id);
        void create_tab_from_active_pane(int pane_id);
        void close_tab(int pane_id, int tab_id);
        void restore_last_closed_tab(int pane_id);
        void activate_tab_by_index(int pane_id, size_t tab_index);
        void move_tab_before(int pane_id, int dragged_tab_id, int target_tab_id);
        void append_tab_to_pane(int source_pane_id, int target_pane_id, int tab_id);
        void normalize_tab_order(ExplorerPane& pane);

        bool can_move_pane_relative(int source_pane_id, int target_pane_id, bool insert_before) const;
        bool move_pane_relative(int source_pane_id, int target_pane_id, bool insert_before);
        void remove_pane_from_layout(int pane_id);
        void normalize_columns();
        bool can_split_vertical() const;
        bool can_split_horizontal(int pane_id) const;
        int pane_count() const;
        PaneLocation find_pane(int pane_id) const;
        int choose_focus_after_removal(int removed_pane_id, const PaneLocation& location) const;

        PaneSnapshot capture_pane_snapshot(int pane_id) const;
        TabSnapshot capture_tab_snapshot(const ExplorerTab& tab) const;
        void apply_tab_snapshot(const ExplorerTab& tab, const TabSnapshot& snapshot);

        ExplorerPane* get_pane(int pane_id);
        const ExplorerPane* get_pane(int pane_id) const;
        ExplorerTab* get_tab(int tab_id);
        const ExplorerTab* get_tab(int tab_id) const;
        ExplorerTab* get_active_tab(int pane_id);
        const ExplorerTab* get_active_tab(int pane_id) const;
        SearchPanel* active_search_panel() const;
        std::string current_tab_path(const ExplorerTab& tab) const;
        std::string make_tab_title(const ExplorerTab& tab) const;
        std::string make_tab_button_label(const ExplorerTab& tab) const;
        void refresh_matching_tabs(const std::string& path, const std::string& source_state_key);
        void notify_layout_error(const std::string& title, const std::string& message);

        bool restore_layout_state();
        void maybe_persist_layout_state();
        void save_layout_state();
        std::string layout_state_file_path() const;

    private:
        core::UIRegistry& ui_registry_;
        core::WorkerPool& worker_pool_;
        std::shared_ptr<MistyClient> client_;

        std::unordered_map<int, ExplorerPane> explorer_panes_;
        std::unordered_map<int, ExplorerTab> explorer_tabs_;
        std::vector<Column> columns_;
        std::vector<ClosedPaneSnapshot> closed_pane_snapshots_;
        int active_pane_id_ = -1;
        int next_pane_id_ = 1;
        int next_tab_id_ = 1;
        float vertical_split_ratio_ = 0.5f;
        std::array<float, 2> column_split_ratios_ = {0.5f, 0.5f};
        ImVec2 current_area_size_{0.0f, 0.0f};
        std::optional<PendingPaneMove> pending_pane_move_;
        std::optional<PendingTabAppend> pending_tab_append_;
        std::string last_layout_snapshot_;
        double last_layout_save_time_ = 0.0;

        static constexpr float kPaneHandleWidth = 6.0f;
        static constexpr float kPaneMinWidth = 280.0f;
        static constexpr float kPaneMinHeight = 220.0f;
        static constexpr float kTabBarHeight = 40.0f;
        static constexpr float kTabBarGap = 6.0f;
        static constexpr float kLayoutPersistIntervalSeconds = 1.0f;
        static constexpr size_t kMaxClosedPaneSnapshots = 8;
        static constexpr int kMaxPaneCount = 4;
    };
}
