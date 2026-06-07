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

            std::string display_title() const;
        };

        struct ClosedTabSnapshot {
            std::string context_key;
            std::string state_key;
            std::string title;
            std::string restore_state;
            std::int16_t idx = -1;
        };

        TabController() = default;
        ~TabController() = default;

        const Tab* current_active_tab() const { return get_active_tab(); }
        std::int16_t current_active_tab_index() const { return active_tab_idx; }

    protected:
        const Tab* get_active_tab() const;
        void set_active_tab(std::int16_t idx);
        void request_tab_selection(std::int16_t idx);

        const Tab* get_tab(std::int16_t idx) const;
        void render_tab_bar(const std::string& scope_id,
                            bool* create_new_tab_requested,
                            std::int16_t* close_tab_idx,
                            const std::function<void(const Tab&)>& render_tab_content);
        void add_tab(const Tab& tab);
        void remove_tab(std::int16_t idx);
        void set_tab_title(std::int16_t idx, std::string title);
        void set_active_tab_title(std::string title);

        void restore_tab();
        int tab_count() const;
        std::vector<ClosedTabSnapshot> take_closed_tab_snapshots();
        std::vector<ClosedTabSnapshot> export_tab_snapshots() const;
        void restore_tabs_from_snapshots(
            const std::vector<ClosedTabSnapshot>& snapshots,
            const std::function<Tab(std::int16_t)>& create_tab,
            std::int16_t restored_active_tab_idx);
        void release_all_tabs();
        void restore_closed_tab_snapshots(const std::vector<ClosedTabSnapshot>& snapshots);
        std::int16_t active_tab_index() const { return active_tab_idx; }
        void set_restore_tab_factory(std::function<Tab(std::int16_t)> factory) {
            restore_tab_factory_ = std::move(factory);
        }

    protected:
        std::int16_t active_tab_idx = -1;
        std::unordered_map<std::int16_t, Tab> tabs;
        std::vector<std::int16_t> tab_order;
        std::vector<ClosedTabSnapshot> closed_tabs;
        std::function<Tab(std::int16_t)> restore_tab_factory_;
        std::int16_t pending_selected_tab_idx = -1;

        static constexpr std::size_t kMaxClosedTabs = 8;
    };
}
