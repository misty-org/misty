#include "panels/panel/tab_controller.h"

#include <algorithm>

#include "imgui.h"

namespace misty::panel {
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

            const std::string label = tab->title + "###tab_" + scope_id + "_" + std::to_string(tab_id);
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

        closed_tabs.push_back(it->second);
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

    void TabController::restore_tab() {
        if (closed_tabs.empty()) {
            return;
        }

        const Tab tab = closed_tabs.back();
        closed_tabs.pop_back();
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
}
