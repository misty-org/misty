#pragma once

#include <atomic>
#include <memory>
#include <string>
#include <unordered_map>
#include <vector>

#include "views/app_view.h"
#include "panels/file_explorer/file_explorer_panel.h"
#include "panels/file_sidebar/file_sidebar_panel.h"
#include "panels/navbar/navbar_panel.h"
#include "panels/notification/notification_panel.h"
#include "panels/search/search_panel.h"
#include "panels/claude/claude_panel.h"
#include "core/ui/ui_registry.h"


namespace misty::view {
    class FilesView : public view::AppView {
    public:
        FilesView(UIRegistry& ui_registry, WorkerPool& worker_pool, std::shared_ptr<MistyClient> client);
        ~FilesView() override;

        void render() override;
        view::ViewID get_view_id() override;
        std::string active_explorer_state_key() const override;
        bool invoke_command(const std::string& command_id) override;

        enum class SplitOrientation {
            None,
            Vertical,
            Horizontal,
        };

    private:
        struct TabSnapshot;
        struct ExplorerTab;
        struct ExplorerPane;
        struct PaneSnapshot;
        struct PaneSnapshotNode;
        struct ClosedPaneSnapshot;

        void init_panels();
        void handle_split_commands();
        void apply_split_command(bool vertical);
        void render_pane_tree(int node_id, const ImVec2& pos, const ImVec2& size);
        void render_leaf_pane(int pane_id, const ImVec2& pos, const ImVec2& size);
        void render_tab_strip(int pane_id, const ImVec2& pos, const ImVec2& size, float& out_height);
        bool measure_leaf_pane(int node_id, int pane_id, const ImVec2& size, ImVec2& out_size) const;
        int create_pane_instance(int preferred_pane_id = -1);
        int create_tab_instance(int pane_id,
                                bool restore_persistent_state,
                                const std::string& initial_path,
                                bool pinned = false,
                                const std::string& preferred_explorer_state_key = "",
                                const std::string& preferred_search_state_key = "",
                                const std::string& preferred_panel_id = "",
                                int preferred_tab_id = -1);
        int create_leaf_node(int pane_id, int parent_node_id);
        int find_leaf_node_for_pane(int pane_id) const;
        int count_visible_panes() const;
        void split_active_pane(SplitOrientation orientation);
        void collapse_split_node(int split_node_id);
        void close_active_pane();
        void destroy_subtree(int node_id);
        int snapshot_subtree(int node_id, ClosedPaneSnapshot& snapshot) const;
        int restore_snapshot_subtree(const ClosedPaneSnapshot& snapshot, int snapshot_node_index, int parent_node_id);
        void restore_last_closed_pane();
        void activate_tab(int pane_id, int tab_id);
        void create_tab_from_active_pane(int pane_id);
        void close_tab(int pane_id, int tab_id);
        void restore_last_closed_tab(int pane_id);
        void activate_tab_by_index(int pane_id, size_t tab_index);
        void move_tab_before(int pane_id, int dragged_tab_id, int target_tab_id);
        void normalize_tab_order(ExplorerPane& pane);
        ExplorerPane* get_pane(int pane_id);
        const ExplorerPane* get_pane(int pane_id) const;
        ExplorerTab* get_tab(int tab_id);
        const ExplorerTab* get_tab(int tab_id) const;
        ExplorerTab* get_active_tab(int pane_id);
        const ExplorerTab* get_active_tab(int pane_id) const;
        std::string current_tab_path(const ExplorerTab& tab) const;
        std::string make_tab_title(const ExplorerTab& tab) const;
        std::string make_tab_button_label(const ExplorerTab& tab) const;
        TabSnapshot capture_tab_snapshot(const ExplorerTab& tab) const;
        void apply_tab_snapshot(const ExplorerTab& tab, const TabSnapshot& snapshot);
        bool pane_has_restorable_tab(int pane_id) const;
        bool has_restorable_pane() const;
        panel::SearchPanel* active_search_panel() const;
        void notify_split_error(const std::string& title, const std::string& message);
        bool restore_layout_state();
        void maybe_persist_layout_state();
        void save_layout_state();
        std::string layout_state_file_path() const;
        void schedule_proxy_probe();
        float render_proxy_status_banner(const ImVec2& pos, float width);
        void show_session_expired_modal();

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
            std::shared_ptr<panel::FileExplorerPanel> explorer_panel;
            std::shared_ptr<panel::SearchPanel> search_panel;
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

        struct PaneSnapshotNode {
            bool is_leaf = true;
            int pane_index = -1;
            SplitOrientation orientation = SplitOrientation::None;
            float split_ratio = 0.5f;
            int first_child_index = -1;
            int second_child_index = -1;
            int collapse_source_pane_id = -1;
        };

        struct ClosedPaneSnapshot {
            SplitOrientation orientation = SplitOrientation::None;
            float split_ratio = 0.5f;
            int root_node_index = -1;
            int pane_count = 0;
            std::vector<PaneSnapshot> panes;
            std::vector<PaneSnapshotNode> nodes;
        };

        struct PaneNode {
            int node_id = -1;
            int parent_node_id = -1;
            bool is_leaf = true;
            int pane_id = -1;
            SplitOrientation orientation = SplitOrientation::None;
            float split_ratio = 0.5f;
            int first_child_id = -1;
            int second_child_id = -1;
            int collapse_source_pane_id = -1;
        };
    private:
        UIRegistry& ui_registry_;
        WorkerPool& worker_pool_;
        std::shared_ptr<MistyClient> client_;

        std::shared_ptr<panel::NavbarPanel> navbar_panel_;
        std::shared_ptr<panel::FileSidebarPanel> file_sidebar_panel_;
        std::shared_ptr<panel::NotificationPanel> notification_panel_;
        std::shared_ptr<panel::ClaudePanel> claude_panel_;
        std::unordered_map<int, ExplorerPane> explorer_panes_;
        std::unordered_map<int, ExplorerTab> explorer_tabs_;
        std::unordered_map<int, PaneNode> pane_nodes_;
        std::vector<ClosedPaneSnapshot> closed_pane_snapshots_;
        int root_node_id_ = -1;
        int next_pane_id_ = 1;
        int next_tab_id_ = 1;
        int next_node_id_ = 1;

        // Resizable sidebar
        float sidebar_width_ = 260.0f;
        bool is_resizing_sidebar_ = false;

        // Resizable Claude panel (right side)
        float claude_panel_width_ = 380.0f;
        bool is_resizing_claude_panel_ = false;
        int active_pane_id_ = -1;
        int resizing_split_node_id_ = -1;
        ImVec2 current_explorer_area_size_{0.0f, 0.0f};
        std::atomic<bool> proxy_probe_in_flight_{false};
        std::string last_layout_snapshot_;
        double last_layout_save_time_ = 0.0;

        static constexpr float kSidebarMinWidth = 180.0f;
        static constexpr float kSidebarMaxWidth = 400.0f;
        static constexpr float kResizeHandleWidth = 6.0f;
        static constexpr float kExplorerSplitMinSize = 180.0f;
        static constexpr int kMaxVisiblePanes = 3;
        static constexpr float kMinimumSplitPaneWidth = 280.0f;
        static constexpr float kMinimumSplitPaneHeight = 220.0f;
        static constexpr float kTabBarHeight = 40.0f;
        static constexpr float kTabBarGap = 6.0f;
        static constexpr float kLayoutPersistIntervalSeconds = 1.0f;
        static constexpr size_t kMaxClosedPaneSnapshots = 8;
        static constexpr float kClaudePanelMinWidth = 280.0f;
        static constexpr float kClaudePanelMaxWidth = 600.0f;

    };
}
