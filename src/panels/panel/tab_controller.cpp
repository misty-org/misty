#include "panels/panel/tab_controller.h"

#include <algorithm>

#include "imgui.h"

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

    const TabController::Tab* TabController::get_tab(std::int16_t idx) const {
        const auto it = tabs.find(idx);
        return it == tabs.end() ? nullptr : &it->second;
    }

    void TabController::render_tab_bar(const std::string& scope_id,
                                       bool* create_new_tab_requested,
                                       std::int16_t* close_tab_idx,
                                       const std::function<void(const Tab&)>& render_tab_content) {
        const std::string tab_bar_id = "##tab_bar_" + scope_id;
        if (!ImGui::BeginTabBar(tab_bar_id.c_str())) {
            return;
        }

        for (std::int16_t tab_id : tab_order) {
            const Tab* tab = get_tab(tab_id);
            if (!tab) {
                continue;
            }

            const std::string label = tab->display_title() + "###tab_" + scope_id + "_" + std::to_string(tab_id);
            bool is_open = true;
            if (ImGui::BeginTabItem(label.c_str(), &is_open)) {
                set_active_tab(tab_id);
                if (render_tab_content) {
                    render_tab_content(*tab);
                }
                ImGui::EndTabItem();
            }
            if (!is_open && close_tab_idx) {
                *close_tab_idx = tab_id;
            }
        }

        if (create_new_tab_requested &&
            ImGui::TabItemButton("+", ImGuiTabItemFlags_Trailing | ImGuiTabItemFlags_NoTooltip)) {
            *create_new_tab_requested = true;
        }

        ImGui::EndTabBar();
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
        active_tab_idx = tab.idx;
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
