#include "providers_panel.h"

#include <nlohmann/json.hpp>

namespace misty::panel {

    ProvidersPanel::ProvidersPanel(StateRegistry& registry,
                                   core::WorkerPool& worker_pool,
                                   ProvidersPanelProps props)
        : MultiPanel(std::move(props.panel_id)),
          registry_(registry),
          worker_pool_(worker_pool),
          state_key_(std::move(props.state_key)),
          owns_state_cleanup_(props.owns_state_cleanup) {
    }

    std::string ProvidersPanel::save_restore_state() const {
        using nlohmann::json;
        const auto& state = const_cast<StateRegistry&>(registry_).get_state<ProvidersState>(state_key_);
        const auto edit = state.remote_edit_session_snapshot();
        json data;
        data["search"] = state.search_query();
        data["page_tab"] = static_cast<int>(state.selected_page_tab());
        data["selected_remote"] = edit.has_selection ? edit.original_remote_name : std::string{};
        return data.dump();
    }

    void ProvidersPanel::load_restore_state(const std::string& encoded_state) {
        using nlohmann::json;
        if (encoded_state.empty()) return;
        const json data = json::parse(encoded_state, nullptr, false);
        if (data.is_discarded()) return;
        auto& state = registry_.get_state<ProvidersState>(state_key_);
        state.set_search_query(data.value("search", std::string{}));
        state.set_page_tab(static_cast<ProvidersPageTab>(data.value("page_tab", 0)));
        state.show_edit_panel();
        pending_restore_remote_ = data.value("selected_remote", std::string{});
    }

    void ProvidersPanel::release_state() {
        if (!owns_state_cleanup_) return;
        auto& state = registry_.get_state<ProvidersState>(state_key_);
        const bool in_flight = state.has_in_flight_work();
        state.prepare_for_workspace_close();
        if (!in_flight) registry_.erase_state(state_key_);
    }

    std::string ProvidersPanel::close_warning() const {
        const auto& state = const_cast<StateRegistry&>(registry_).get_state<ProvidersState>(state_key_);
        const auto edit = state.remote_edit_session_snapshot();
        if (edit.dirty) {
            return "This remote has unsaved configuration changes. Closing the tab will discard them.";
        }
        return {};
    }

    TabController::Tab ProvidersPanel::create_default_tab(std::int16_t tab_idx) const {
        ProvidersPanelProps props;
        props.panel_id = panel_id() + "_tab_" + std::to_string(tab_idx);
        props.state_key = state_key_ + "_tab_" + std::to_string(tab_idx);
        props.owns_state_cleanup = true;
        TabController::Tab tab;
        tab.context_key = props.state_key;
        tab.state_key = props.state_key;
        tab.title = "Providers";
        tab.idx = tab_idx;
        tab.panel = std::make_shared<ProvidersPanel>(registry_, worker_pool_, std::move(props));
        return tab;
    }

    bool ProvidersPanel::shows_tab_bar(const Pane& pane) const {
        (void)pane;
        return true;
    }

}
