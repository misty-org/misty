#include "panels/panel/pane_controller.h"

namespace misty::panel {
    const PaneController::Pane* PaneController::get_active_pane() const {
        return get_pane(active_pane_id);
    }

    void PaneController::set_active_pane(const std::string& pane_id) {
        if (panes.find(pane_id) == panes.end()) {
            return;
        }
        active_pane_id = pane_id;
    }

    PaneController::Pane* PaneController::get_pane(const std::string& pane_id) {
        const auto it = panes.find(pane_id);
        return it == panes.end() ? nullptr : &it->second;
    }

    const PaneController::Pane* PaneController::get_pane(const std::string& pane_id) const {
        const auto it = panes.find(pane_id);
        return it == panes.end() ? nullptr : &it->second;
    }

    void PaneController::add_pane(const Pane& pane) {
        if (pane.pane_id.empty()) {
            return;
        }
        panes.insert_or_assign(pane.pane_id, pane);
        active_pane_id = pane.pane_id;
    }

    void PaneController::remove_pane(const std::string& pane_id) {
        panes.erase(pane_id);
        if (active_pane_id == pane_id) {
            active_pane_id.clear();
        }
    }

    PaneController::PaneLocation PaneController::find_pane_location(
        const std::vector<std::vector<std::string>>& grid_pane_ids,
        const std::string& pane_id) const {
        for (size_t lane_index = 0; lane_index < grid_pane_ids.size(); ++lane_index) {
            const auto& lane = grid_pane_ids[lane_index];
            for (size_t row_index = 0; row_index < lane.size(); ++row_index) {
                if (lane[row_index] == pane_id) {
                    return PaneLocation{
                        .lane_index = static_cast<int>(lane_index),
                        .row_index = static_cast<int>(row_index),
                    };
                }
            }
        }
        return {};
    }

    int PaneController::pane_count() const {
        return static_cast<int>(panes.size());
    }
}
