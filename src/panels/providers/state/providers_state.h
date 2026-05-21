#pragma once

#include <cstdint>
#include <map>
#include <mutex>
#include <optional>
#include <string>
#include <vector>

#include "core/threading/worker_pool.h"
#include "core/ui/ui_registry.h"

namespace misty::panel {

    struct ProviderCard {
        std::string id;
        std::string provider_id;
        std::string provider_label;
        std::string account_label;
        std::string status_label = "Connected";
        std::string logo_asset_path;
        bool connected = true;
        bool needs_reconnect = false;
        bool unavailable = false;
    };

    struct ProvidersHealthCard {
        std::string title = "rclone status unavailable";
        std::string version_text;
        std::string path_text;
        std::string port_text;
        std::string uptime_text;
        std::string remote_count_text;
        std::string provider_count_text;
        std::string status_heading = "Status";
        std::string status_value = "Unavailable";
        bool is_ready = false;
    };

    struct ProviderChoice {
        std::string value;
        std::string help;
    };

    struct ProviderOption {
        std::string name;
        std::string help;
        std::string default_value;
        bool required = false;
        bool password = false;
        std::vector<ProviderChoice> choices;
    };

    struct ProviderWorkflow {
        std::string type;
        std::string name;
        std::string description;
        std::vector<ProviderOption> options;
    };

    struct ProviderRemote {
        std::string name;
        std::string type;
    };

    struct ProviderRemoteStatus {
        std::string name;
        std::string type;
        std::string status_label = "Connected";
        bool needs_reconnect = false;
        std::string error;
    };

    struct ProviderStep {
        std::string kind;
        std::string name;
        std::string state;
        std::string result;
        bool done = false;
        std::string error;
        std::string authorize_url;
        std::string instructions;
        int poll_after_ms = 1000;
        std::optional<ProviderOption> option;
    };

    struct ActiveProviderConfigSession {
        bool show_modal = false;
        bool submit_in_flight = false;
        bool poll_in_flight = false;
        bool reconnect_mode = false;
        bool repair_mode = false;
        std::string selected_provider_type;
        std::string remote_name;
        std::map<std::string, std::string> parameters;
        std::string current_step_kind;
        std::string step_state;
        std::string step_result;
        std::string authorize_url;
        std::string instructions;
        int poll_after_ms = 1000;
        std::optional<ProviderOption> current_option;
        bool browser_launch_attempted = false;
        bool browser_launch_succeeded = false;
        std::uint64_t generation = 0;
        std::string status_message;
        std::string inline_error;
    };

    class ProvidersState : public core::UIState {
    public:
        ProvidersState();
        ~ProvidersState() = default;

        void init(core::WorkerPool& pool);

        void set_search_query(const std::string& query);
        std::string search_query() const;

        std::vector<ProviderCard> provider_cards_snapshot() const;
        std::vector<ProviderCard> filtered_provider_cards() const;
        ProvidersHealthCard health_card_snapshot() const;
        std::vector<ProviderWorkflow> workflows_snapshot() const;
        ActiveProviderConfigSession add_provider_session_snapshot() const;

        void refresh_all();
        void refresh_health();
        void refresh_workflows();
        void refresh_remotes();
        void refresh_remote_statuses();

        void on_add_provider();
        void on_request_reconnect(const std::string& provider_id);
        void on_request_repair(const std::string& provider_id);
        void select_provider_type(const std::string& provider_type);
        void set_remote_name(const std::string& remote_name);
        void set_parameter_value(const std::string& key, const std::string& value);
        void submit_add_provider();
        void reopen_browser_auth();

        void on_request_rename(const std::string& provider_id);
        void on_request_disconnect(const std::string& provider_id);
        void confirm_disconnect();
        void dismiss_active_dialog();
        void clear_messages();

        mutable std::mutex mu;
        ProvidersHealthCard health_card;
        bool show_rename_modal = false;
        bool show_disconnect_modal = false;
        std::string pending_provider_id;
        std::string dialog_message;
        std::string error_message;
        std::string success_message;
        bool is_loading_health = false;
        bool is_loading_workflows = false;
        bool is_loading_remotes = false;
        bool is_loading_remote_statuses = false;
        bool disconnect_in_flight = false;

    private:
        static bool matches_query(const ProviderCard& card, const std::string& query);

        void schedule_browser_auth_poll(std::uint64_t generation);
        void rebuild_provider_cards_locked();
        void rebuild_health_card_locked();
        std::optional<ProviderWorkflow> workflow_for_type_locked(const std::string& provider_type) const;
        void reset_add_provider_session_locked();

        core::WorkerPool* worker_pool_ = nullptr;
        std::vector<ProviderCard> provider_cards;
        std::vector<ProviderWorkflow> workflows_;
        std::vector<ProviderRemote> remotes_;
        std::map<std::string, ProviderRemoteStatus> remote_statuses_;
        ActiveProviderConfigSession add_provider_session_;
        bool proxy_ready_ = false;
        std::string proxy_error_;
        std::string search_query_;
    };
}
