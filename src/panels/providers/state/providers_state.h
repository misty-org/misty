#pragma once

#include <cstdint>
#include <functional>
#include <map>
#include <mutex>
#include <optional>
#include <string>
#include <vector>

#include "core/threading/worker_pool.h"
#include "core/ui/state_registry.h"

namespace misty::panel {

    struct ProviderCard {
        std::string id;
        std::string provider_id;
        std::string provider_label;
        std::string account_label;
        std::string status_label = "Connected";
        std::string status_detail;
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
        std::string label;
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

    enum class ProvidersPageTab {
        Remotes,
        Diagnostics,
    };

    struct ProviderRcloneConfigSession {
        bool loading = false;
        bool revealing = false;
        std::string config_path;
        std::string cache_path;
        std::string temp_path;
        std::string error_message;
        std::string success_message;
        std::uint64_t generation = 0;
    };

    struct ProviderRenameSession {
        bool show_modal = false;
        bool in_flight = false;
        std::string old_name;
        std::string new_name;
        std::string validation_error;
    };

    struct ProviderDetailsSession {
        bool show_modal = false;
        bool in_flight = false;
        std::string remote_name;
        std::string provider_type;
        std::string config_json;
        std::string about_json;
        std::string error;
    };

    struct ProviderRemoteEditSession {
        bool has_selection = false;
        bool loading = false;
        bool saving = false;
        bool testing = false;
        bool revealing = false;
        bool token_visible = false;
        bool dirty = false;
        bool can_save = false;
        bool stale = false;
        std::string selected_remote;
        std::string original_remote_name;
        std::string provider_type;
        std::map<std::string, std::string> original_config;
        std::map<std::string, std::string> edit_config;
        std::string about_json;
        std::string validation_error;
        std::string error_message;
        std::string success_message;
        std::string test_message;
        std::string reveal_error;
        std::int64_t last_checked_unix = 0;
        std::uint64_t generation = 0;
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
        bool completed = false;
        int ui_step = 1;
        std::uint64_t generation = 0;
        std::string status_message;
        std::string inline_error;
    };

    class ProvidersState : public core::StateEntry {
    public:
        ProvidersState();
        ~ProvidersState() = default;

        void init(core::WorkerPool& pool, bool refresh_on_init = true);
        void attach_shared_state(ProvidersState* shared_state);
        void sync_shared_data_from(const ProvidersState& shared_state);
        bool has_in_flight_work() const;
        void prepare_for_workspace_close();
        void set_provider_added_callback(std::function<void()> callback);

        void set_search_query(const std::string& query);
        std::string search_query() const;

        std::vector<ProviderCard> provider_cards_snapshot() const;
        std::vector<ProviderCard> filtered_provider_cards() const;
        ProvidersHealthCard health_card_snapshot() const;
        std::vector<ProviderWorkflow> workflows_snapshot() const;
        ActiveProviderConfigSession add_provider_session_snapshot() const;
        ProviderRenameSession rename_session_snapshot() const;
        ProviderDetailsSession details_session_snapshot() const;
        ProviderRemoteEditSession remote_edit_session_snapshot() const;
        ProviderRcloneConfigSession rclone_config_session_snapshot() const;
        ProvidersPageTab selected_page_tab() const;
        bool edit_panel_visible() const;

        void refresh_all();
        void refresh_health();
        void refresh_workflows();
        void refresh_remotes();
        void refresh_remote_statuses();

        void on_add_provider();
        void on_request_reconnect(const std::string& provider_id);
        void on_request_repair(const std::string& provider_id);
        void select_provider_type(const std::string& provider_type);
        void continue_add_provider_dialog();
        void back_to_configure_add_provider_dialog();
        void set_remote_name(const std::string& remote_name);
        void set_parameter_value(const std::string& key, const std::string& value);
        void submit_add_provider();
        void reopen_browser_auth();

        void on_request_rename(const std::string& provider_id);
        void set_pending_rename_name(const std::string& name);
        void confirm_rename();
        void on_request_details(const std::string& provider_id);
        void select_remote(const std::string& provider_id);
        void set_edit_remote_name(const std::string& name);
        void set_edit_field(const std::string& key, const std::string& value);
        void set_page_tab(ProvidersPageTab tab);
        void show_edit_panel();
        void hide_edit_panel();
        void toggle_token_visibility();
        void save_selected_remote();
        void test_selected_remote();
        void refresh_rclone_config_paths();
        void open_rclone_config_file();
        void reveal_rclone_config();
        void on_request_disconnect(const std::string& provider_id);
        void confirm_disconnect();
        void dismiss_active_dialog();
        void clear_messages();

        mutable std::mutex mu;
        ProvidersHealthCard health_card;
        bool show_rename_modal = false;
        bool show_disconnect_modal = false;
        bool show_onedrive_repair_modal = false;
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
        std::vector<std::string> current_remote_names_locked() const;
        void validate_remote_edit_session_locked();
        void reset_remote_edit_session_locked();
        void rebuild_provider_cards_locked();
        void rebuild_health_card_locked();
        std::optional<ProviderWorkflow> workflow_for_type_locked(const std::string& provider_type) const;
        void reset_add_provider_session_locked();
        std::function<void()> provider_added_callback_locked() const;

        core::WorkerPool* worker_pool_ = nullptr;
        ProvidersState* shared_state_ = nullptr;
        std::vector<ProviderCard> provider_cards;
        std::vector<ProviderWorkflow> workflows_;
        std::vector<ProviderRemote> remotes_;
        std::vector<std::string> configured_remote_names_;
        std::map<std::string, ProviderRemoteStatus> remote_statuses_;
        ActiveProviderConfigSession add_provider_session_;
        ProviderRenameSession rename_session_;
        ProviderDetailsSession details_session_;
        ProviderRemoteEditSession remote_edit_session_;
        ProviderRcloneConfigSession rclone_config_session_;
        std::function<void()> provider_added_callback_;
        bool proxy_ready_ = false;
        std::string proxy_error_;
        std::string search_query_;
        ProvidersPageTab selected_page_tab_ = ProvidersPageTab::Remotes;
        bool edit_panel_visible_ = true;
    };
}
