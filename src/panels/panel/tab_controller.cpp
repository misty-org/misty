#include "panels/panel/tab_controller.h"

#include <algorithm>

#include "imgui.h"
#include "panels/panel/tab_bar.h"

namespace misty::panel {
    namespace {
        TabController::ClosedTabSnapshot make_snapshot(const TabController::Tab& tab) {
            TabController::ClosedTabSnapshot snapshot;
            snapshot.context_key = tab.context_key;
            snapshot.state_key = tab.state_key;
            snapshot.title = tab.title;
            snapshot.idx = tab.idx;
            if (tab.panel) {
                snapshot.restore_state = tab.panel->save_restore_state();
            }
            return snapshot;
        }
    }

    std::string TabController::Tab::display_title() const {
        if (panel) {
            const std::string dynamic_title = panel->tab_title();
            if (!dynamic_title.empty()) {
                return dynamic_title;
            }
        }

        if (!title.empty()) {
            return title;
        }

        return "Untitled";
    }

    const TabController::Tab* TabController::get_active_tab() const {
        return get_tab(active_tab_idx);
    }

    void TabController::set_active_tab(std::int16_t idx) {
        if (tabs.find(idx) == tabs.end()) {
            return;
        }
        active_tab_idx = idx;
    }

    void TabController::request_tab_selection(std::int16_t idx) {
        if (tabs.find(idx) == tabs.end()) {
            return;
        }
        active_tab_idx = idx;
        pending_selected_tab_idx = idx;
    }

    const TabController::Tab* TabController::get_tab(std::int16_t idx) const {
        const auto it = tabs.find(idx);
        return it == tabs.end() ? nullptr : &it->second;
    }

    void TabController::render_tab_bar(const std::string& scope_id,
                                       bool* create_new_tab_requested,
                                       std::int16_t* close_tab_idx,
                                       const std::function<void(const Tab&)>& render_tab_content) {
        const float avail_w = ImGui::GetContentRegionAvail().x;
        if (avail_w <= 0.0f) {
            return;
        }

        ImGui::BeginChild(("##tab_strip_" + scope_id).c_str(),
                          ImVec2(0.0f, kTabBarHeight),
                          ImGuiChildFlags_None,
                          ImGuiWindowFlags_NoScrollbar | ImGuiWindowFlags_NoScrollWithMouse | ImGuiWindowFlags_NoBackground);
        std::vector<TabBarItem> items;
        items.reserve(tab_order.size());
        for (std::size_t tab_index = 0; tab_index < tab_order.size(); ++tab_index) {
            const std::int16_t tab_id = tab_order[tab_index];
            const Tab* tab = get_tab(tab_id);
            if (!tab) {
                continue;
            }
            items.push_back(TabBarItem{
                .id = "tab_" + scope_id + "_" + std::to_string(tab_id),
                .title = tab->display_title(),
                .active = tab_id == active_tab_idx,
                .closable = tab_order.size() > 1,
            });
        }
        const TabBarResult strip_result = ::misty::panel::render_tab_bar(items, create_new_tab_requested != nullptr);
        if (strip_result.close_index >= 0 &&
            close_tab_idx &&
            strip_result.close_index < static_cast<int>(tab_order.size())) {
            *close_tab_idx = tab_order[strip_result.close_index];
        }
        if (strip_result.pressed_index >= 0 &&
            strip_result.pressed_index < static_cast<int>(tab_order.size())) {
            request_tab_selection(tab_order[strip_result.pressed_index]);
        }
        if (create_new_tab_requested && strip_result.plus_pressed) {
            *create_new_tab_requested = true;
        }
        ImGui::EndChild();

        if (pending_selected_tab_idx >= 0) {
            set_active_tab(pending_selected_tab_idx);
            pending_selected_tab_idx = -1;
        }

        const Tab* active = get_active_tab();
        if (active && render_tab_content) {
            ImGui::BeginChild(("##tab_content_" + scope_id).c_str(),
                              ImVec2(0.0f, 0.0f),
                              ImGuiChildFlags_None,
                              ImGuiWindowFlags_NoScrollbar | ImGuiWindowFlags_NoScrollWithMouse | ImGuiWindowFlags_NoBackground);
            render_tab_content(*active);
            ImGui::EndChild();
        }
    }

    void TabController::add_tab(const Tab& tab) {
        if (tab.idx < 0) {
            return;
        }

        const bool already_present = tabs.find(tab.idx) != tabs.end();
        tabs.insert_or_assign(tab.idx, tab);
        if (!already_present) {
            tab_order.push_back(tab.idx);
        }
        request_tab_selection(tab.idx);
    }

    void TabController::remove_tab(std::int16_t idx) {
        const auto it = tabs.find(idx);
        if (it == tabs.end()) {
            return;
        }

        closed_tabs.push_back(make_snapshot(it->second));
        if (closed_tabs.size() > kMaxClosedTabs) {
            closed_tabs.erase(closed_tabs.begin());
        }
        if (it->second.panel) {
            it->second.panel->release_state();
        }
        tabs.erase(it);
        tab_order.erase(std::remove(tab_order.begin(), tab_order.end(), idx), tab_order.end());

        if (active_tab_idx != idx) {
            return;
        }

        active_tab_idx = -1;
        if (!tab_order.empty()) {
            active_tab_idx = tab_order.back();
        }
    }

    void TabController::set_tab_title(std::int16_t idx, std::string title) {
        auto it = tabs.find(idx);
        if (it == tabs.end()) {
            return;
        }

        it->second.title = std::move(title);
    }

    void TabController::set_active_tab_title(std::string title) {
        set_tab_title(active_tab_idx, std::move(title));
    }

    void TabController::restore_tab() {
        if (closed_tabs.empty()) {
            return;
        }

        const ClosedTabSnapshot snapshot = closed_tabs.back();
        closed_tabs.pop_back();
        if (snapshot.idx < 0) {
            return;
        }

        Tab tab = restore_tab_factory_ ? restore_tab_factory_(snapshot.idx) : Tab{};
        tab.context_key = snapshot.context_key;
        tab.state_key = snapshot.state_key;
        tab.title = snapshot.title;
        tab.idx = snapshot.idx;
        if (tab.panel) {
            tab.panel->load_restore_state(snapshot.restore_state);
        }

        const bool already_present = tabs.find(tab.idx) != tabs.end();
        tabs.insert_or_assign(tab.idx, tab);
        if (!already_present) {
            tab_order.push_back(tab.idx);
        }
        active_tab_idx = tab.idx;
    }

    int TabController::tab_count() const {
        return static_cast<int>(tabs.size());
    }

    std::vector<TabController::ClosedTabSnapshot> TabController::take_closed_tab_snapshots() {
        std::vector<ClosedTabSnapshot> snapshots;
        snapshots.swap(closed_tabs);
        return snapshots;
    }

    std::vector<TabController::ClosedTabSnapshot> TabController::export_tab_snapshots() const {
        std::vector<ClosedTabSnapshot> snapshots;
        snapshots.reserve(tab_order.size());
        for (const std::int16_t tab_id : tab_order) {
            const Tab* tab = get_tab(tab_id);
            if (!tab) {
                continue;
            }
            snapshots.push_back(make_snapshot(*tab));
        }
        return snapshots;
    }

    void TabController::restore_tabs_from_snapshots(
        const std::vector<ClosedTabSnapshot>& snapshots,
        const std::function<Tab(std::int16_t)>& create_tab,
        std::int16_t restored_active_tab_idx) {
        tabs.clear();
        tab_order.clear();
        active_tab_idx = -1;

        for (const ClosedTabSnapshot& snapshot : snapshots) {
            if (snapshot.idx < 0) {
                continue;
            }

            Tab tab = create_tab(snapshot.idx);
            tab.context_key = snapshot.context_key;
            tab.state_key = snapshot.state_key;
            tab.title = snapshot.title;
            tab.idx = snapshot.idx;
            if (tab.panel) {
                tab.panel->load_restore_state(snapshot.restore_state);
            }
            add_tab(tab);
        }

        if (tabs.find(restored_active_tab_idx) != tabs.end()) {
            active_tab_idx = restored_active_tab_idx;
        } else if (!tab_order.empty()) {
            active_tab_idx = tab_order.front();
        }
    }

    void TabController::release_all_tabs() {
        for (auto& [_, tab] : tabs) {
            if (tab.panel) {
                tab.panel->release_state();
            }
        }
        tabs.clear();
        tab_order.clear();
        active_tab_idx = -1;
        closed_tabs.clear();
    }

    void TabController::restore_closed_tab_snapshots(const std::vector<ClosedTabSnapshot>& snapshots) {
        closed_tabs = snapshots;
        if (closed_tabs.size() > kMaxClosedTabs) {
            closed_tabs.erase(closed_tabs.begin(), closed_tabs.end() - static_cast<std::ptrdiff_t>(kMaxClosedTabs));
        }
    }
}
