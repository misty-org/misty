#pragma once

#include <array>
#include <string>
#include <vector>

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

    protected:
        virtual TabController::Tab create_default_tab(std::int16_t tab_idx) const = 0;
        virtual Pane create_default_pane(std::int16_t pane_idx, std::int16_t tab_idx) const;
        virtual void render_panel_contents() = 0;

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
            Pane pane;
            PaneRestoreMode restore_mode = PaneRestoreMode::SameLane;
            int lane_index = -1;
            int row_index = -1;
        };

        void default_multi_panel();
        void create_new_tab(Pane& pane);
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

        static constexpr float kPaneHandleWidth = 6.0f;
        static constexpr float kPaneMinWidth = 280.0f;
        static constexpr float kPaneMinHeight = 220.0f;
        static constexpr int kMaxPaneCount = 4;
    };
}
