#pragma once

#include <array>
#include <string>
#include <vector>

#include "core/workspaces/workspace.h"
#include "panels/panel/panel.h"
#include "panels/panel/pane_controller.h"
#include "panels/panel/tab_controller.h"

namespace misty::panel {
    class MultiPanel : public Panel, public TabController, public PaneController {
    public:
        explicit MultiPanel(std::string panel_id);
        ~MultiPanel() = default;

        void handle_commands();
        void render() override;
        core::WorkspaceExplorerSnapshot export_workspace_snapshot() const;
        void restore_workspace_snapshot(const core::WorkspaceExplorerSnapshot& snapshot);

    protected:
        virtual TabController::Tab create_default_tab(std::int16_t tab_idx) const = 0;
        virtual Pane create_default_pane(std::int16_t pane_idx, std::int16_t tab_idx) const;
        virtual void render_panel_contents() = 0;
        virtual float pane_header_height(const Panel& panel, bool is_active, bool has_multiple_panes) const;
        virtual void render_pane_header(Panel& panel, bool is_active, bool has_multiple_panes);

        const std::string& panel_id() const { return panel_id_; }
        const Pane* active_pane() const;
        const TabController::Tab* active_tab() const;
        Panel* active_panel() const;

    private:
        enum class PaneRestoreMode {
            NewLane,
            SameLane,
        };

        struct MultiPanelGrid {
            struct GridLane {
                std::vector<std::string> pane_ids;
            };

            std::vector<GridLane> lanes;
        };

        struct ClosedPaneSnapshot {
            std::string pane_id;
            std::vector<TabController::ClosedTabSnapshot> tabs;
            std::vector<TabController::ClosedTabSnapshot> closed_tabs;
            std::int16_t active_tab_idx = -1;
            PaneRestoreMode restore_mode = PaneRestoreMode::SameLane;
            int lane_index = -1;
            int row_index = -1;
        };

        void default_multi_panel();
        void close_tab(Pane& pane, std::int16_t tab_idx);
        void split_active_vertical();
        void split_active_horizontal();
        void close_active_pane();
        void restore_last_closed_pane();
        void normalize_grid();
        void choose_active_pane_after_removal(const PaneLocation& removed_location);
        void render_grid_lane(int lane_index, const ImVec2& pos, const ImVec2& size);
        void render_pane(const std::string& pane_id, const ImVec2& pos, const ImVec2& size);
        std::vector<std::vector<std::string>> grid_pane_ids() const;

        std::string panel_id_;
        std::string error_msg_;
        bool initialized_ = false;
        std::int16_t next_tab_idx_ = 1;
        std::int16_t next_pane_idx_ = 1;
        MultiPanelGrid grid_;
        std::vector<ClosedPaneSnapshot> closed_pane_snapshots_;
        float grid_split_ratio_ = 0.5f;
        std::array<float, 2> lane_split_ratios_ = {0.5f, 0.5f};

        static constexpr float kPaneHandleWidth = 8.0f;
        static constexpr float kPaneDividerThickness = 1.0f;
        static constexpr float kPaneMinWidth = 280.0f;
        static constexpr float kPaneMinHeight = 220.0f;
        static constexpr int kMaxPaneCount = 4;
        static constexpr std::size_t kMaxClosedPanes = 4;
    };
}
