#pragma once

#include <cstdint>
#include <functional>
#include <memory>
#include <string>
#include <unordered_map>
#include <vector>

#include "panels/panel/panel.h"

namespace misty::panel {
    class MultiPanel;

    // A TabController manages a collection of tabs.
    // Soft delete tabs when they are removed from the collection allows restoration.
    class TabController {
        friend class MultiPanel;

    public:
        struct Tab {
            std::string context_key;
            std::string state_key;
            std::string title;
            std::int16_t idx = -1;
            std::shared_ptr<Panel> panel;
        };

        TabController() = default;
        ~TabController() = default;

    protected:
        const Tab* get_active_tab() const;
        void set_active_tab(std::int16_t idx);

        const Tab* get_tab(std::int16_t idx) const;
        void render_tab_bar(const std::string& scope_id,
                            bool* create_new_tab_requested,
                            std::int16_t* close_tab_idx,
                            const std::function<void(const Tab&)>& render_tab_content);
        void add_tab(const Tab& tab);
        void remove_tab(std::int16_t idx);

        void restore_tab();
        int tab_count() const;

    protected:
        std::int16_t active_tab_idx = -1;
        std::unordered_map<std::int16_t, Tab> tabs;
        std::vector<std::int16_t> tab_order;
        std::vector<Tab> closed_tabs;
    };
}
