#pragma once

#include <string>
#include <unordered_map>
#include <vector>

#include "panels/panel/tab_controller.h"

namespace misty::panel {
    // A PaneController manages multiple panes, each containing a collection of tabs.
    class PaneController {
    public:
        struct Pane {
            std::string pane_id;
            TabController tab_controller;
        };

        struct PaneLocation {
            int lane_index = -1;
            int row_index = -1;

            bool is_valid() const {
                return lane_index >= 0 && row_index >= 0;
            }
        };

        PaneController() = default;
        ~PaneController() = default;

    protected:
        const Pane* get_active_pane() const;
        void set_active_pane(const std::string& pane_id);

        Pane* get_pane(const std::string& pane_id);
        const Pane* get_pane(const std::string& pane_id) const;
        void add_pane(const Pane& pane);
        void remove_pane(const std::string& pane_id);

        PaneLocation find_pane_location(const std::vector<std::vector<std::string>>& grid_pane_ids,
                                        const std::string& pane_id) const;
        int pane_count() const;

    protected:
        std::string active_pane_id;
        std::unordered_map<std::string, Pane> panes;
    };
}
