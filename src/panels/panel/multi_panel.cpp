#include "panels/panel/multi_panel.h"

#include <algorithm>
#include <utility>

#include "core/commands/command_manager.h"
#include "core/ui/ui_style.h"
#include "imgui.h"

namespace misty::panel {
    namespace {
        // calculate the split size based on the ratio, total size, and minimum size
        float split_size(float ratio, float total, float min_size) {
            if (total <= 0.0f) return 0.0f;

            const float effective_min = std::min(min_size, std::max(0.0f, total * 0.5f - 1.0f));
            if (total <= effective_min * 2.0f) {
                return total * 0.5f;
            }

            return std::clamp(ratio * total, effective_min, total - effective_min);
        }

    }

    // initialize the panel with a default pane and grid lane
    MultiPanel::MultiPanel(std::string panel_id)
        : panel_id_(std::move(panel_id)) {}

    // create a default pane with a single tab
    MultiPanel::Pane MultiPanel::create_default_pane(std::int16_t pane_idx, std::int16_t tab_idx) const {
        Pane pane;
        pane.pane_id = panel_id_ + "_pane_" + std::to_string(pane_idx);
        pane.tab_controller.set_restore_tab_factory(
            [this](std::int16_t restore_tab_idx) { return create_default_tab(restore_tab_idx); });
        pane.tab_controller.add_tab(create_default_tab(tab_idx));
        return pane;
    }

    const PaneController::Pane* MultiPanel::active_pane() const {
        return get_active_pane();
    }

    const TabController::Tab* MultiPanel::active_tab() const {
        const Pane* pane = get_active_pane();
        if (!pane) {
            return nullptr;
        }
        return pane->tab_controller.get_active_tab();
    }

    Panel* MultiPanel::active_panel() const {
        const TabController::Tab* tab = active_tab();
        return tab ? tab->panel.get() : nullptr;
    }

    void MultiPanel::default_multi_panel() {
        if (initialized_) {
            return;
        }

        Pane first_pane = create_default_pane(0, 0);
        if (first_pane.pane_id.empty() || first_pane.tab_controller.tab_count() == 0) {
            error_msg_ = "Failed to initialize MultiPanel with its first tab.";
            initialized_ = true;
            return;
        }

        add_pane(first_pane);
        grid_.lanes.push_back(MultiPanelGrid::GridLane{.pane_ids = {first_pane.pane_id}});
        active_pane_id = first_pane.pane_id;
        initialized_ = true;
    }

    // handle commands for the panel, such as creating new tabs or splitting panes
    // TODO: create commands interface such that each panel registers commands
    void MultiPanel::handle_commands() {
        default_multi_panel();

        Pane* active_pane = get_pane(active_pane_id);
        if (!active_pane) {
            error_msg_ = "Active pane not found.";
            return;
        }

        if (core::CommandManager::get().matches("explorer.new_tab")) {
            create_new_tab(*active_pane);
        }
        if (core::CommandManager::get().matches("explorer.restore_tab")) {
            active_pane->tab_controller.restore_tab();
        }
        if (core::CommandManager::get().matches("explorer.split_vertical")) {
            split_active_vertical();
        }
        if (core::CommandManager::get().matches("explorer.split_horizontal")) {
            split_active_horizontal();
        }
        if (core::CommandManager::get().matches("explorer.close_pane")) {
            close_active_pane();
        }
        if (core::CommandManager::get().matches("explorer.restore_pane")) {
            restore_last_closed_pane();
        }
    }

    void MultiPanel::create_new_tab(Pane& pane) {
        const std::int16_t tab_idx = next_tab_idx_++;
        TabController::Tab tab = create_default_tab(tab_idx);
        if (!tab.panel) {
            error_msg_ = "Failed to create a default tab.";
            return;
        }
        pane.tab_controller.add_tab(tab);
    }

    void MultiPanel::close_tab(Pane& pane, std::int16_t tab_idx) {
        if (pane.tab_controller.tab_count() <= 1) {
            return;
        }
        pane.tab_controller.remove_tab(tab_idx);
    }

    void MultiPanel::split_active_vertical() {
        if (pane_count() >= kMaxPaneCount) {
            error_msg_ = "Pane limit reached.";
            return;
        }

        if (grid_.lanes.size() != 1) {
            error_msg_ = "Vertical split requires a single grid lane.";
            return;
        }

        Pane split_pane = create_default_pane(next_pane_idx_++, next_tab_idx_++);
        if (split_pane.pane_id.empty() || split_pane.tab_controller.tab_count() == 0) {
            error_msg_ = "Failed to create a default split pane.";
            return;
        }

        add_pane(split_pane);
        grid_.lanes.push_back(MultiPanelGrid::GridLane{.pane_ids = {split_pane.pane_id}});
        grid_split_ratio_ = 0.5f;
        active_pane_id = split_pane.pane_id;
    }

    void MultiPanel::split_active_horizontal() {
        if (pane_count() >= kMaxPaneCount) {
            error_msg_ = "Pane limit reached.";
            return;
        }

        const PaneLocation location = find_pane_location(grid_pane_ids(), active_pane_id);
        if (!location.is_valid()) {
            error_msg_ = "Active pane is not placed in the grid.";
            return;
        }

        if (location.lane_index >= static_cast<int>(grid_.lanes.size())) {
            error_msg_ = "Active pane lane is out of bounds.";
            return;
        }

        MultiPanelGrid::GridLane& lane = grid_.lanes[location.lane_index];
        if (lane.pane_ids.size() != 1) {
            error_msg_ = "Horizontal split requires a lane with one pane.";
            return;
        }

        Pane split_pane = create_default_pane(next_pane_idx_++, next_tab_idx_++);
        if (split_pane.pane_id.empty() || split_pane.tab_controller.tab_count() == 0) {
            error_msg_ = "Failed to create a default split pane.";
            return;
        }

        add_pane(split_pane);
        lane.pane_ids.push_back(split_pane.pane_id);
        lane_split_ratios_[location.lane_index] = 0.5f;
        active_pane_id = split_pane.pane_id;
    }

    void MultiPanel::close_active_pane() {
        if (pane_count() <= 1) {
            return;
        }

        const PaneLocation location = find_pane_location(grid_pane_ids(), active_pane_id);
        if (!location.is_valid()) {
            error_msg_ = "Active pane is not placed in the grid.";
            return;
        }

        Pane* active_pane = get_pane(active_pane_id);
        if (!active_pane) {
            error_msg_ = "No active pane available to close.";
            return;
        }

        ClosedPaneSnapshot snapshot;
        snapshot.pane_id = active_pane->pane_id;
        snapshot.tabs = active_pane->tab_controller.export_tab_snapshots();
        snapshot.closed_tabs = active_pane->tab_controller.take_closed_tab_snapshots();
        snapshot.active_tab_idx = active_pane->tab_controller.active_tab_index();
        snapshot.lane_index = location.lane_index;
        snapshot.row_index = location.row_index;
        snapshot.restore_mode = grid_.lanes[location.lane_index].pane_ids.size() == 1
            ? PaneRestoreMode::NewLane
            : PaneRestoreMode::SameLane;
        closed_pane_snapshots_.push_back(std::move(snapshot));
        if (closed_pane_snapshots_.size() > kMaxClosedPanes) {
            closed_pane_snapshots_.erase(closed_pane_snapshots_.begin());
        }

        auto& lane = grid_.lanes[location.lane_index].pane_ids;
        lane.erase(lane.begin() + location.row_index);
        remove_pane(active_pane_id);
        normalize_grid();
        choose_active_pane_after_removal(location);
    }

    void MultiPanel::restore_last_closed_pane() {
        if (closed_pane_snapshots_.empty()) {
            return;
        }

        if (pane_count() >= kMaxPaneCount) {
            error_msg_ = "Pane limit reached.";
            return;
        }

        ClosedPaneSnapshot snapshot = std::move(closed_pane_snapshots_.back());
        closed_pane_snapshots_.pop_back();

        Pane pane;
        pane.pane_id = snapshot.pane_id;
        pane.tab_controller.set_restore_tab_factory(
            [this](std::int16_t restore_tab_idx) { return create_default_tab(restore_tab_idx); });
        pane.tab_controller.restore_tabs_from_snapshots(
            snapshot.tabs,
            [this](std::int16_t tab_idx) { return create_default_tab(tab_idx); },
            snapshot.active_tab_idx);
        pane.tab_controller.restore_closed_tab_snapshots(snapshot.closed_tabs);
        add_pane(pane);

        bool placed = false;
        if (snapshot.restore_mode == PaneRestoreMode::NewLane && grid_.lanes.size() < 2) {
            const int lane_index = std::clamp(snapshot.lane_index, 0, static_cast<int>(grid_.lanes.size()));
            grid_.lanes.insert(grid_.lanes.begin() + lane_index, MultiPanelGrid::GridLane{.pane_ids = {snapshot.pane_id}});
            placed = true;
        }

        if (!placed && snapshot.lane_index >= 0 && snapshot.lane_index < static_cast<int>(grid_.lanes.size())) {
            auto& pane_ids = grid_.lanes[snapshot.lane_index].pane_ids;
            if (pane_ids.size() < 2) {
                const int row_index = std::clamp(snapshot.row_index, 0, static_cast<int>(pane_ids.size()));
                pane_ids.insert(pane_ids.begin() + row_index, snapshot.pane_id);
                placed = true;
            }
        }

        if (!placed && grid_.lanes.size() < 2) {
            grid_.lanes.push_back(MultiPanelGrid::GridLane{.pane_ids = {snapshot.pane_id}});
            placed = true;
        }

        if (!placed) {
            for (auto& lane : grid_.lanes) {
                if (lane.pane_ids.size() < 2) {
                    lane.pane_ids.push_back(snapshot.pane_id);
                    placed = true;
                    break;
                }
            }
        }

        if (!placed) {
            remove_pane(snapshot.pane_id);
            error_msg_ = "No valid grid slot is available to restore the pane.";
            return;
        }

        normalize_grid();
        active_pane_id = snapshot.pane_id;
    }

    void MultiPanel::normalize_grid() {
        for (auto& lane : grid_.lanes) {
            auto& pane_ids = lane.pane_ids;
            pane_ids.erase(std::remove_if(pane_ids.begin(), pane_ids.end(), [&](const std::string& pane_id) {
                return panes.find(pane_id) == panes.end();
            }), pane_ids.end());

            if (pane_ids.size() > 2) {
                pane_ids.resize(2);
            }
        }

        grid_.lanes.erase(std::remove_if(grid_.lanes.begin(), grid_.lanes.end(), [](const MultiPanelGrid::GridLane& lane) {
            return lane.pane_ids.empty();
        }), grid_.lanes.end());

        if (grid_.lanes.size() > 2) {
            grid_.lanes.resize(2);
        }

        if (grid_.lanes.empty() && !panes.empty()) {
            grid_.lanes.push_back(MultiPanelGrid::GridLane{});
            grid_.lanes.front().pane_ids.push_back(panes.begin()->first);
        }
    }

    void MultiPanel::choose_active_pane_after_removal(const PaneLocation& removed_location) {
        if (grid_.lanes.empty()) {
            active_pane_id.clear();
            return;
        }

        const int lane_index = std::clamp(removed_location.lane_index, 0, static_cast<int>(grid_.lanes.size()) - 1);
        const auto& lane = grid_.lanes[lane_index].pane_ids;
        if (!lane.empty()) {
            const int row_index = std::clamp(removed_location.row_index, 0, static_cast<int>(lane.size()) - 1);
            active_pane_id = lane[row_index];
            return;
        }

        for (const auto& fallback_lane : grid_.lanes) {
            if (!fallback_lane.pane_ids.empty()) {
                active_pane_id = fallback_lane.pane_ids.front();
                return;
            }
        }

        active_pane_id.clear();
    }

    std::vector<std::vector<std::string>> MultiPanel::grid_pane_ids() const {
        std::vector<std::vector<std::string>> pane_ids;
        pane_ids.reserve(grid_.lanes.size());
        for (const auto& lane : grid_.lanes) {
            pane_ids.push_back(lane.pane_ids);
        }
        return pane_ids;
    }

    void MultiPanel::render_grid_lane(int lane_index, const ImVec2& pos, const ImVec2& size) {
        if (lane_index < 0 || lane_index >= static_cast<int>(grid_.lanes.size())) {
            return;
        }

        const auto& lane = grid_.lanes[lane_index].pane_ids;
        if (lane.empty()) {
            return;
        }

        if (lane.size() == 1) {
            render_pane(lane.front(), pos, size);
            return;
        }

        const float total_height = std::max(0.0f, size.y - kPaneHandleWidth);
        const float top_height = split_size(lane_split_ratios_[lane_index], total_height, kPaneMinHeight);
        const float bottom_height = std::max(0.0f, total_height - top_height);

        render_pane(lane[0], pos, ImVec2(size.x, top_height));

        const ImVec2 splitter_pos(pos.x, pos.y + top_height);
        ImGui::SetCursorScreenPos(splitter_pos);
        ImGui::InvisibleButton(("##pane_lane_splitter_" + std::to_string(lane_index)).c_str(), ImVec2(size.x, kPaneHandleWidth));
        if (ImGui::IsItemActive()) {
            lane_split_ratios_[lane_index] = std::clamp(
                lane_split_ratios_[lane_index] + ImGui::GetIO().MouseDelta.y / std::max(1.0f, total_height),
                0.1f,
                0.9f);
        }

        render_pane(lane[1], ImVec2(pos.x, pos.y + top_height + kPaneHandleWidth), ImVec2(size.x, bottom_height));
    }

    void MultiPanel::render_pane(const std::string& pane_id, const ImVec2& pos, const ImVec2& size) {
        Pane* pane = get_pane(pane_id);
        if (!pane) {
            error_msg_ = "Grid references a missing pane: " + pane_id;
            return;
        }

        const bool is_active_pane = pane_id == active_pane_id;
        ImGui::SetCursorScreenPos(pos);
        const std::string child_id = "##pane_" + pane_id;
        UI::WithStyle([&](UI::StyleScope& style) {
            style.var(ImGuiStyleVar_ChildBorderSize, 1.0f);
            if (is_active_pane) {
                style.color(ImGuiCol_Border, ImVec4(1.0f, 1.0f, 1.0f, 0.95f));
            } else {
                style.color(ImGuiCol_Border, ImVec4(0.24f, 0.24f, 0.26f, 1.0f));
                style.color(ImGuiCol_ChildBg, ImVec4(0.12f, 0.12f, 0.12f, 1.0f));
            }

            constexpr ImGuiWindowFlags pane_flags =
                ImGuiWindowFlags_NoScrollbar |
                ImGuiWindowFlags_NoScrollWithMouse;
            if (ImGui::BeginChild(child_id.c_str(), size, ImGuiChildFlags_Borders, pane_flags)) {
                const bool pane_clicked =
                    ImGui::IsWindowHovered(ImGuiHoveredFlags_AllowWhenBlockedByPopup | ImGuiHoveredFlags_ChildWindows) &&
                    ImGui::IsMouseClicked(ImGuiMouseButton_Left);
                const bool pane_focused = ImGui::IsWindowFocused(ImGuiFocusedFlags_ChildWindows);
                if (pane_clicked || pane_focused) {
                    active_pane_id = pane_id;
                }

                bool create_new_tab_requested = false;
                std::int16_t close_tab_idx = -1;
                pane->tab_controller.render_tab_bar(
                    pane_id,
                    &create_new_tab_requested,
                    &close_tab_idx,
                    [this](const TabController::Tab& tab) {
                        if (!tab.panel) {
                            error_msg_ = "Active tab has no panel.";
                            return;
                        }

                        if (auto* multi_panel = dynamic_cast<MultiPanel*>(tab.panel.get())) {
                            multi_panel->render_panel_contents();
                        } else {
                            tab.panel->render();
                        }
                    });

                if (close_tab_idx >= 0) {
                    close_tab(*pane, close_tab_idx);
                }
                if (create_new_tab_requested) {
                    create_new_tab(*pane);
                }
            }
            ImGui::EndChild();
        });
    }

    void MultiPanel::render() {
        default_multi_panel();

        constexpr ImGuiWindowFlags flags =
            ImGuiWindowFlags_NoTitleBar |
            ImGuiWindowFlags_NoResize |
            ImGuiWindowFlags_NoMove |
            ImGuiWindowFlags_NoCollapse |
            ImGuiWindowFlags_NoSavedSettings;

        if (ImGuiViewport* main_viewport = ImGui::GetMainViewport()) {
            ImGui::SetNextWindowViewport(main_viewport->ID);
        }

        const std::string window_name = "##multi_panel_" + panel_id_;
        ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(0.0f, 0.0f));
        const bool is_open = ImGui::Begin(window_name.c_str(), nullptr, flags);

        if (is_open) {
            normalize_grid();

            const ImVec2 origin = ImGui::GetCursorScreenPos();
            const ImVec2 avail = ImGui::GetContentRegionAvail();

            if (grid_.lanes.empty()) {
                error_msg_ = "MultiPanel has no panes to render.";
            } else if (grid_.lanes.size() == 1) {
                render_grid_lane(0, origin, avail);
            } else {
                const float total_width = std::max(0.0f, avail.x - kPaneHandleWidth);
                const float left_width = split_size(grid_split_ratio_, total_width, kPaneMinWidth);
                const float right_width = std::max(0.0f, total_width - left_width);

                render_grid_lane(0, origin, ImVec2(left_width, avail.y));

                const ImVec2 splitter_pos(origin.x + left_width, origin.y);
                ImGui::SetCursorScreenPos(splitter_pos);
                ImGui::InvisibleButton("##multi_panel_grid_splitter", ImVec2(kPaneHandleWidth, avail.y));
                if (ImGui::IsItemActive()) {
                    grid_split_ratio_ = std::clamp(
                        grid_split_ratio_ + ImGui::GetIO().MouseDelta.x / std::max(1.0f, total_width),
                        0.1f,
                        0.9f);
                }

                render_grid_lane(1,
                                 ImVec2(origin.x + left_width + kPaneHandleWidth, origin.y),
                                 ImVec2(right_width, avail.y));
            }
        }

        show_error_modal(error_msg_, "MultiPanelError");
        ImGui::End();
        ImGui::PopStyleVar();
    }
}
