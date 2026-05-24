#include "panels/providers/state/providers_state.h"

#include <algorithm>
#include <chrono>
#include <cctype>
#include <set>
#include <sstream>
#include <utility>

#include <nlohmann/json.hpp>

#include "core/manager/session_manager.h"
#include "core/net/http_client.h"
#include "core/system/util.h"
#include "panels/providers/dialogs/onedrive_dialogs.h"
#include "panels/providers/state/providers_state_util.h"

namespace misty::panel {
    using nlohmann::json;

    namespace {
        constexpr int kProviderFetchAttempts = 12;
        constexpr auto kProviderFetchRetryDelay = std::chrono::milliseconds(750);

        std::string provider_option_default_value(const ProviderOption& option) {
            if (!option.default_value.empty()) {
                return option.default_value;
            }
            if (!option.choices.empty()) {
                return option.choices.front().value;
            }
            return {};
        }

        std::string normalized_provider_key(std::string value) {
            std::transform(value.begin(), value.end(), value.begin(), [](unsigned char c) {
                return static_cast<char>(std::tolower(c));
            });
            value.erase(std::remove_if(value.begin(), value.end(), [](char c) {
                return c == '-' || c == '_' || c == ' ';
            }), value.end());
            return value;
        }

        std::vector<std::string> provider_name_tokens(const std::string& value) {
            std::vector<std::string> tokens;
            std::string current;
            for (unsigned char c : value) {
                if (std::isalnum(c)) {
                    current.push_back(static_cast<char>(std::tolower(c)));
                } else if (!current.empty()) {
                    tokens.push_back(current);
                    current.clear();
                }
            }
            if (!current.empty()) {
                tokens.push_back(current);
            }
            return tokens;
        }

        bool has_shared_provider_token(const std::string& left, const std::string& right) {
            const auto left_tokens = provider_name_tokens(left);
            const auto right_tokens = provider_name_tokens(right);
            for (const auto& left_token : left_tokens) {
                if (left_token.size() < 3) {
                    continue;
                }
                for (const auto& right_token : right_tokens) {
                    if (right_token.size() < 3) {
                        continue;
                    }
                    if (left_token == right_token ||
                        left_token.find(right_token) != std::string::npos ||
                        right_token.find(left_token) != std::string::npos) {
                        return true;
                    }
                }
            }
            return false;
        }

        std::string canonical_remote_name(
            const ProviderRemote& remote,
            const std::vector<std::string>& configured_remotes
        ) {
            if (configured_remotes.empty()) {
                return remote.name;
            }
            if (std::find(configured_remotes.begin(), configured_remotes.end(), remote.name) != configured_remotes.end()) {
                return remote.name;
            }

            std::vector<std::string> candidates;
            for (const auto& configured : configured_remotes) {
                if (!remote.type.empty() && has_shared_provider_token(remote.type, configured)) {
                    candidates.push_back(configured);
                    continue;
                }
                if (has_shared_provider_token(remote.name, configured)) {
                    candidates.push_back(configured);
                }
            }

            if (candidates.size() == 1) {
                return candidates.front();
            }
            return remote.name;
        }

        std::vector<std::string> parse_rclone_configured_remotes(const std::string& body) {
            std::vector<std::string> names;
            const json parsed = json::parse(body);
            const auto remotes_json = parsed.value("remotes", json::array());
            if (!remotes_json.is_array()) {
                return names;
            }
            for (const auto& remote_json : remotes_json) {
                if (remote_json.is_string()) {
                    std::string name = remote_json.get<std::string>();
                    if (!name.empty()) {
                        names.push_back(std::move(name));
                    }
                }
            }
            return names;
        }

        std::map<std::string, ProviderRemoteStatus> parse_rclone_config_dump_statuses(const std::string& body) {
            std::map<std::string, ProviderRemoteStatus> statuses;
            const json parsed = json::parse(body);
            if (!parsed.is_object()) {
                return statuses;
            }

            for (auto it = parsed.begin(); it != parsed.end(); ++it) {
                if (!it.value().is_object()) {
                    continue;
                }

                ProviderRemoteStatus status;
                status.name = it.key();
                status.type = it.value().value("type", std::string{});
                status.status_label = "Connected";
                status.needs_reconnect = false;

                const bool missing_token = it.value().value("token", std::string{}).empty();
                if (missing_token) {
                    status.status_label = "Needs reconnect";
                    status.needs_reconnect = true;
                    status.error = "Missing provider token";
                }

                if (normalized_provider_key(status.type) == "onedrive") {
                    const bool missing_drive_id = it.value().value("drive_id", std::string{}).empty();
                    const bool missing_drive_type = it.value().value("drive_type", std::string{}).empty();
                    if (missing_drive_id || missing_drive_type) {
                        status.status_label = "Needs reconnect";
                        status.needs_reconnect = true;
                        status.error = "Missing OneDrive drive ID or drive type";
                    }
                }

                if (!status.name.empty()) {
                    statuses[status.name] = std::move(status);
                }
            }

            return statuses;
        }

        std::string rclone_rc_url_from_port_text(const std::string& port_text) {
            std::string digits;
            for (unsigned char c : port_text) {
                if (std::isdigit(c)) {
                    digits.push_back(static_cast<char>(c));
                }
            }
            if (digits.empty()) {
                return "http://127.0.0.1:5572";
            }
            return "http://127.0.0.1:" + digits;
        }

        void seed_provider_options_defaults(
            ActiveProviderConfigSession& session,
            const std::vector<ProviderOption>& options
        ) {
            for (const auto& option : options) {
                auto it = session.parameters.find(option.name);
                if (it != session.parameters.end() && !it->second.empty()) {
                    continue;
                }

                const std::string value = provider_option_default_value(option);
                if (!value.empty()) {
                    session.parameters[option.name] = value;
                }
            }
        }

        std::string validate_required_provider_options(
            const std::map<std::string, std::string>& parameters,
            const std::vector<ProviderOption>& options
        ) {
            for (const auto& option : options) {
                if (!option.required) {
                    continue;
                }
                if ((option.name == "drive_id" || option.name == "drive_type") &&
                    is_onedrive_provider_type(parameters.count("type") ? parameters.at("type") : "onedrive")) {
                    const auto config_type_it = parameters.find("config_type");
                    const std::string config_type = config_type_it == parameters.end() ? "onedrive" : config_type_it->second;
                    if (config_type != "driveid") {
                        continue;
                    }
                }
                auto it = parameters.find(option.name);
                std::string value = it == parameters.end() ? std::string{} : it->second;
                if (value.empty()) {
                    value = provider_option_default_value(option);
                }
                if (value.empty()) {
                    const std::string label = option.label.empty() ? option.name : option.label;
                    return label + " is required.";
                }
            }
            return {};
        }
    }

    ProvidersState::ProvidersState() {
        health_card.path_text = "Waiting for proxy-backed provider workflows.";
        health_card.port_text.clear();
        health_card.uptime_text.clear();
        health_card.remote_count_text = "0 connected providers";
        health_card.provider_count_text = "0 providers available";
        health_card.status_value = "Unavailable";
    }

    void ProvidersState::init(core::WorkerPool& pool) {
        if (worker_pool_) {
            return;
        }
        worker_pool_ = &pool;
        refresh_all();
    }

    void ProvidersState::set_search_query(const std::string& query) {
        std::lock_guard<std::mutex> lock(mu);
        search_query_ = query;
    }

    std::string ProvidersState::search_query() const {
        std::lock_guard<std::mutex> lock(mu);
        return search_query_;
    }

    std::vector<ProviderCard> ProvidersState::provider_cards_snapshot() const {
        std::lock_guard<std::mutex> lock(mu);
        return provider_cards;
    }

    std::vector<ProviderCard> ProvidersState::filtered_provider_cards() const {
        std::lock_guard<std::mutex> lock(mu);

        std::vector<ProviderCard> filtered;
        filtered.reserve(provider_cards.size());
        for (const auto& card : provider_cards) {
            if (matches_query(card, search_query_)) {
                filtered.push_back(card);
            }
        }
        return filtered;
    }

    ProvidersHealthCard ProvidersState::health_card_snapshot() const {
        std::lock_guard<std::mutex> lock(mu);
        return health_card;
    }

    std::vector<ProviderWorkflow> ProvidersState::workflows_snapshot() const {
        std::lock_guard<std::mutex> lock(mu);
        return workflows_;
    }

    ActiveProviderConfigSession ProvidersState::add_provider_session_snapshot() const {
        std::lock_guard<std::mutex> lock(mu);
        return add_provider_session_;
    }

    void ProvidersState::refresh_all() {
        refresh_health();
        refresh_workflows();
        refresh_remotes();
    }

    void ProvidersState::refresh_health() {
        if (!worker_pool_) {
            return;
        }
        {
            std::lock_guard<std::mutex> lock(mu);
            is_loading_health = true;
            error_message.clear();
        }

        worker_pool_->add(
            [this]() {
                const std::string url = providers_proxy_url("/api/remote/health");
                if (url.empty()) {
                    std::lock_guard<std::mutex> lock(mu);
                    proxy_ready_ = false;
                    proxy_error_ = "PROXY_SERVICE_URL not set";
                    is_loading_health = false;
                    rebuild_health_card_locked();
                    return;
                }

                const auto response = core::HTTPClient::get().get(url);
                bool ready = response.status_code >= 200 && response.status_code < 300;
                std::string error;
                std::string port_text;
                std::string uptime_text;
                std::string remote_count_text;
                std::string provider_count_text;
                std::string version_text;
                try {
                    const json parsed = json::parse(response.body);
                    ready = parsed.value("ready", ready);
                    error = parsed.value("error", std::string{});
                    const std::string port = parsed.value("port", std::string{});
                    version_text = parsed.value("version", std::string{});
                    const int64_t uptime_seconds = parsed.value("uptime_seconds", static_cast<int64_t>(0));
                    const int connected_providers = parsed.value("connected_providers", 0);
                    const int available_providers = parsed.value("available_providers", 0);
                    if (!port.empty()) {
                        port_text = "Port " + port;
                    }
                    if (ready) {
                        uptime_text = format_provider_uptime_text(uptime_seconds);
                    }
                    remote_count_text = std::to_string(connected_providers) + " connected";
                    provider_count_text = std::to_string(available_providers) + " available";
                } catch (const std::exception&) {
                    if (!ready && error.empty()) {
                        error = provider_response_error_message(response, "Failed to check provider health");
                    }
                }
                if (!ready && error.empty()) {
                    error = provider_response_error_message(response, "Provider service unavailable");
                }

                std::lock_guard<std::mutex> lock(mu);
                proxy_ready_ = ready;
                proxy_error_ = std::move(error);
                health_card.port_text = std::move(port_text);
                health_card.uptime_text = std::move(uptime_text);
                health_card.version_text = std::move(version_text);
                health_card.remote_count_text = std::move(remote_count_text);
                health_card.provider_count_text = std::move(provider_count_text);
                is_loading_health = false;
                rebuild_health_card_locked();
            },
            []() {},
            [this](const std::string& err) {
                std::lock_guard<std::mutex> lock(mu);
                proxy_ready_ = false;
                proxy_error_ = "refresh_health: " + err;
                is_loading_health = false;
                rebuild_health_card_locked();
            }
        );
    }

    void ProvidersState::refresh_workflows() {
        if (!worker_pool_) {
            return;
        }
        {
            std::lock_guard<std::mutex> lock(mu);
            is_loading_workflows = true;
            error_message.clear();
        }

        worker_pool_->add(
            [this]() {
                const std::string url = providers_proxy_url("/api/remote/workflows");
                if (url.empty()) {
                    std::lock_guard<std::mutex> lock(mu);
                    error_message = "PROXY_SERVICE_URL not set";
                    is_loading_workflows = false;
                    return;
                }

                const auto fetch = fetch_providers_with_retries(
                    url,
                    kProviderFetchAttempts,
                    kProviderFetchRetryDelay,
                    core::SessionManager::get().get_auth_headers()
                );
                if (!fetch.success) {
                    std::lock_guard<std::mutex> lock(mu);
                    error_message = "Failed to load provider workflows: " + fetch.last_error;
                    is_loading_workflows = false;
                    return;
                }

                std::vector<ProviderWorkflow> workflows = parse_provider_workflows(fetch.response.body);
                std::lock_guard<std::mutex> lock(mu);
                workflows_ = std::move(workflows);
                is_loading_workflows = false;
                if (!add_provider_session_.selected_provider_type.empty() &&
                    !workflow_for_type_locked(add_provider_session_.selected_provider_type).has_value()) {
                    reset_add_provider_session_locked();
                    add_provider_session_.show_modal = true;
                }
                rebuild_provider_cards_locked();
                rebuild_health_card_locked();
            },
            []() {},
            [this](const std::string& err) {
                std::lock_guard<std::mutex> lock(mu);
                error_message = "refresh_workflows: " + err;
                is_loading_workflows = false;
            }
        );
    }

    void ProvidersState::refresh_remotes() {
        if (!worker_pool_) {
            return;
        }
        {
            std::lock_guard<std::mutex> lock(mu);
            is_loading_remotes = true;
            error_message.clear();
        }

        worker_pool_->add(
            [this]() {
                const std::string url = providers_proxy_url("/api/remote");
                if (url.empty()) {
                    std::lock_guard<std::mutex> lock(mu);
                    error_message = "PROXY_SERVICE_URL not set";
                    is_loading_remotes = false;
                    return;
                }

                const auto fetch = fetch_providers_with_retries(
                    url,
                    kProviderFetchAttempts,
                    kProviderFetchRetryDelay,
                    core::SessionManager::get().get_auth_headers()
                );
                if (!fetch.success) {
                    std::lock_guard<std::mutex> lock(mu);
                    error_message = "Failed to load connected providers: " + fetch.last_error;
                    is_loading_remotes = false;
                    return;
                }

                std::vector<ProviderRemote> remotes = parse_provider_remotes(fetch.response.body);
                bool refresh_statuses_after = false;
                {
                    std::lock_guard<std::mutex> lock(mu);
                    remotes_ = std::move(remotes);
                    is_loading_remotes = false;
                    if (remotes_.empty()) {
                        remote_statuses_.clear();
                    } else {
                        refresh_statuses_after = true;
                    }
                    rebuild_provider_cards_locked();
                    rebuild_health_card_locked();
                }

                if (refresh_statuses_after) {
                    refresh_remote_statuses();
                }
            },
            []() {},
            [this](const std::string& err) {
                std::lock_guard<std::mutex> lock(mu);
                error_message = "refresh_remotes: " + err;
                is_loading_remotes = false;
            }
        );
    }

    void ProvidersState::refresh_remote_statuses() {
        if (!worker_pool_) {
            return;
        }
        {
            std::lock_guard<std::mutex> lock(mu);
            if (remotes_.empty()) {
                remote_statuses_.clear();
                is_loading_remote_statuses = false;
                rebuild_provider_cards_locked();
                return;
            }
            is_loading_remote_statuses = true;
            error_message.clear();
            rebuild_provider_cards_locked();
        }

        worker_pool_->add(
            [this]() {
                const std::string url = providers_proxy_url("/api/remote/status");
                std::string rclone_rc_url;
                {
                    std::lock_guard<std::mutex> lock(mu);
                    rclone_rc_url = rclone_rc_url_from_port_text(health_card.port_text);
                }
                if (url.empty()) {
                    std::lock_guard<std::mutex> lock(mu);
                    is_loading_remote_statuses = false;
                    error_message = "PROXY_SERVICE_URL not set";
                    rebuild_provider_cards_locked();
                    return;
                }

                const auto fetch = fetch_providers_with_retries(
                    url,
                    kProviderFetchAttempts,
                    kProviderFetchRetryDelay,
                    core::SessionManager::get().get_auth_headers()
                );
                if (!fetch.success) {
                    std::lock_guard<std::mutex> lock(mu);
                    is_loading_remote_statuses = false;
                    error_message = "Failed to validate connected providers: " + fetch.last_error;
                    rebuild_provider_cards_locked();
                    return;
                }

                std::map<std::string, ProviderRemoteStatus> statuses;
                try {
                    statuses = parse_provider_remote_statuses(fetch.response.body);
                } catch (const std::exception& ex) {
                    std::lock_guard<std::mutex> lock(mu);
                    is_loading_remote_statuses = false;
                    error_message = std::string("Failed to parse provider status response: ") + ex.what();
                    rebuild_provider_cards_locked();
                    return;
                }

                std::vector<std::string> configured_remotes;
                std::map<std::string, ProviderRemoteStatus> configured_statuses;
                const auto rclone_response = core::HTTPClient::get().post(rclone_rc_url + "/config/listremotes", "{}");
                if (rclone_response.status_code >= 200 && rclone_response.status_code < 300) {
                    try {
                        configured_remotes = parse_rclone_configured_remotes(rclone_response.body);
                    } catch (const std::exception&) {
                        configured_remotes.clear();
                    }
                }
                const auto rclone_dump_response = core::HTTPClient::get().post(rclone_rc_url + "/config/dump", "{}");
                if (rclone_dump_response.status_code >= 200 && rclone_dump_response.status_code < 300) {
                    try {
                        configured_statuses = parse_rclone_config_dump_statuses(rclone_dump_response.body);
                    } catch (const std::exception&) {
                        configured_statuses.clear();
                    }
                }

                std::lock_guard<std::mutex> lock(mu);
                remote_statuses_ = std::move(statuses);
                for (const auto& [remote_name, status] : configured_statuses) {
                    remote_statuses_[remote_name] = status;
                }
                if (!configured_remotes.empty()) {
                    std::vector<ProviderRemote> reconciled_remotes;
                    std::set<std::string> seen_names;
                    reconciled_remotes.reserve(remotes_.size());
                    for (auto remote : remotes_) {
                        const std::string original_name = remote.name;
                        remote.name = canonical_remote_name(remote, configured_remotes);
                        if (!seen_names.insert(remote.name).second) {
                            continue;
                        }
                        if (original_name != remote.name) {
                            auto status_it = remote_statuses_.find(original_name);
                            auto configured_status_it = configured_statuses.find(remote.name);
                            if (configured_status_it != configured_statuses.end()) {
                                remote_statuses_.erase(original_name);
                                remote_statuses_[remote.name] = configured_status_it->second;
                            } else if (status_it != remote_statuses_.end() &&
                                       std::find(configured_remotes.begin(), configured_remotes.end(), remote.name) != configured_remotes.end()) {
                                ProviderRemoteStatus status = status_it->second;
                                status.name = remote.name;
                                status.status_label = "Connected";
                                status.needs_reconnect = false;
                                status.error.clear();
                                remote_statuses_.erase(status_it);
                                remote_statuses_[remote.name] = std::move(status);
                            }
                        }
                        reconciled_remotes.push_back(std::move(remote));
                    }
                    remotes_ = std::move(reconciled_remotes);
                }
                is_loading_remote_statuses = false;
                rebuild_provider_cards_locked();
            },
            []() {},
            [this](const std::string& err) {
                std::lock_guard<std::mutex> lock(mu);
                error_message = "refresh_remote_statuses: " + err;
                is_loading_remote_statuses = false;
                rebuild_provider_cards_locked();
            }
        );
    }

    void ProvidersState::on_add_provider() {
        bool refresh_workflows_after = false;
        {
            std::lock_guard<std::mutex> lock(mu);
            reset_add_provider_session_locked();
            add_provider_session_.show_modal = true;
            show_rename_modal = false;
            show_disconnect_modal = false;
            pending_provider_id.clear();
            dialog_message.clear();
            error_message.clear();
            success_message.clear();
            if (worker_pool_ && workflows_.empty() && !is_loading_workflows) {
                refresh_workflows_after = true;
            }
        }
        if (refresh_workflows_after) {
            refresh_workflows();
        }
    }

    void ProvidersState::on_request_reconnect(const std::string& provider_id) {
        bool refresh_workflows_after = false;
        {
            std::lock_guard<std::mutex> lock(mu);
            auto remote_it = std::find_if(remotes_.begin(), remotes_.end(), [&](const ProviderRemote& remote) {
                return remote.name == provider_id;
            });
            if (remote_it == remotes_.end()) {
                error_message = "Provider \"" + provider_id + "\" was not found.";
                return;
            }

            const auto status_it = remote_statuses_.find(remote_it->name);
            const ProviderRemoteStatus* remote_status = status_it == remote_statuses_.end() ? nullptr : &status_it->second;
            const bool configure_drive_selection = status_needs_onedrive_drive_repair(remote_status);

            reset_add_provider_session_locked();
            add_provider_session_.show_modal = !configure_drive_selection;
            show_onedrive_repair_modal = configure_drive_selection;
            add_provider_session_.reconnect_mode = !configure_drive_selection;
            add_provider_session_.repair_mode = configure_drive_selection;
            add_provider_session_.selected_provider_type = remote_it->type;
            add_provider_session_.remote_name = remote_it->name;
            add_provider_session_.ui_step = 2;
            add_provider_session_.status_message.clear();
            const auto workflow = workflow_for_type_locked(remote_it->type);
            const std::vector<ProviderOption> fallback_options =
                (configure_drive_selection ||
                 ((!workflow || workflow->options.empty()) && is_onedrive_provider_type(remote_it->type)))
                    ? onedrive_drive_repair_options()
                    : std::vector<ProviderOption>{};
            const std::vector<ProviderOption>& options_to_seed =
                configure_drive_selection || !workflow || workflow->options.empty() ? fallback_options : workflow->options;
            seed_provider_options_defaults(add_provider_session_, options_to_seed);
            show_rename_modal = false;
            show_disconnect_modal = false;
            pending_provider_id.clear();
            dialog_message.clear();
            error_message.clear();
            success_message.clear();
            if (worker_pool_ && workflows_.empty() && !is_loading_workflows) {
                refresh_workflows_after = true;
            }
        }
        if (refresh_workflows_after) {
            refresh_workflows();
        }
    }

    void ProvidersState::on_request_repair(const std::string& provider_id) {
        bool refresh_workflows_after = false;
        {
            std::lock_guard<std::mutex> lock(mu);
            auto remote_it = std::find_if(remotes_.begin(), remotes_.end(), [&](const ProviderRemote& remote) {
                return remote.name == provider_id;
            });
            if (remote_it == remotes_.end()) {
                error_message = "Provider \"" + provider_id + "\" was not found.";
                return;
            }

            reset_add_provider_session_locked();
            const bool onedrive_repair = is_onedrive_provider_type(remote_it->type);
            add_provider_session_.show_modal = !onedrive_repair;
            show_onedrive_repair_modal = onedrive_repair;
            add_provider_session_.reconnect_mode = false;
            add_provider_session_.repair_mode = true;
            add_provider_session_.selected_provider_type = remote_it->type;
            add_provider_session_.remote_name = remote_it->name;
            add_provider_session_.ui_step = 2;
            add_provider_session_.status_message.clear();
            const auto workflow = workflow_for_type_locked(remote_it->type);
            const std::vector<ProviderOption> fallback_options =
                (onedrive_repair ||
                 ((!workflow || workflow->options.empty()) && is_onedrive_provider_type(remote_it->type)))
                    ? onedrive_drive_repair_options()
                    : std::vector<ProviderOption>{};
            const std::vector<ProviderOption>& options_to_seed =
                onedrive_repair || !workflow || workflow->options.empty() ? fallback_options : workflow->options;
            seed_provider_options_defaults(add_provider_session_, options_to_seed);
            show_rename_modal = false;
            show_disconnect_modal = false;
            pending_provider_id.clear();
            dialog_message.clear();
            error_message.clear();
            success_message.clear();
            if (worker_pool_ && workflows_.empty() && !is_loading_workflows) {
                refresh_workflows_after = true;
            }
        }
        if (refresh_workflows_after) {
            refresh_workflows();
        }
    }

    void ProvidersState::select_provider_type(const std::string& provider_type) {
        std::lock_guard<std::mutex> lock(mu);
        add_provider_session_.reconnect_mode = false;
        add_provider_session_.repair_mode = false;
        add_provider_session_.selected_provider_type = provider_type;
        add_provider_session_.ui_step = 1;
        add_provider_session_.parameters.clear();
        add_provider_session_.current_step_kind.clear();
        add_provider_session_.step_state.clear();
        add_provider_session_.step_result.clear();
        add_provider_session_.authorize_url.clear();
        add_provider_session_.instructions.clear();
        add_provider_session_.poll_after_ms = 1000;
        add_provider_session_.current_option.reset();
        add_provider_session_.browser_launch_attempted = false;
        add_provider_session_.browser_launch_succeeded = false;
        add_provider_session_.completed = false;
        add_provider_session_.status_message.clear();
        add_provider_session_.inline_error.clear();
        add_provider_session_.poll_in_flight = false;
        add_provider_session_.generation++;
    }

    void ProvidersState::continue_add_provider_dialog() {
        std::lock_guard<std::mutex> lock(mu);
        if (add_provider_session_.selected_provider_type.empty()) {
            add_provider_session_.inline_error = "Choose a provider to continue.";
            return;
        }
        if (add_provider_session_.remote_name.empty()) {
            add_provider_session_.remote_name = add_provider_session_.selected_provider_type;
        }
        const auto workflow = workflow_for_type_locked(add_provider_session_.selected_provider_type);
        const std::vector<ProviderOption> fallback_options =
            (!workflow || workflow->options.empty()) && is_onedrive_provider_type(add_provider_session_.selected_provider_type)
                ? onedrive_drive_repair_options()
                : std::vector<ProviderOption>{};
        seed_provider_options_defaults(add_provider_session_, workflow && !workflow->options.empty() ? workflow->options : fallback_options);
        add_provider_session_.inline_error.clear();
        add_provider_session_.ui_step = 2;
    }

    void ProvidersState::back_to_configure_add_provider_dialog() {
        std::lock_guard<std::mutex> lock(mu);
        add_provider_session_.completed = false;
        add_provider_session_.current_step_kind.clear();
        add_provider_session_.status_message.clear();
        add_provider_session_.inline_error.clear();
        add_provider_session_.ui_step = 2;
    }

    void ProvidersState::set_remote_name(const std::string& remote_name) {
        std::lock_guard<std::mutex> lock(mu);
        add_provider_session_.remote_name = remote_name;
    }

    void ProvidersState::set_parameter_value(const std::string& key, const std::string& value) {
        std::lock_guard<std::mutex> lock(mu);
        add_provider_session_.parameters[key] = value;
    }

    void ProvidersState::submit_add_provider() {
        if (!worker_pool_) {
            return;
        }

        std::string selected_provider_type;
        std::string remote_name;
        std::string current_step_kind;
        std::map<std::string, std::string> parameters;
        std::optional<ProviderOption> current_option;
        std::string step_state;
        std::string step_result;
        bool reconnect_mode = false;
        bool repair_mode = false;
        bool onedrive_repair_modal_open = false;
        std::uint64_t generation = 0;
        {
            std::lock_guard<std::mutex> lock(mu);
            add_provider_session_.inline_error.clear();

            selected_provider_type = add_provider_session_.selected_provider_type;
            remote_name = add_provider_session_.remote_name;
            current_step_kind = add_provider_session_.current_step_kind;
            parameters = add_provider_session_.parameters;
            current_option = add_provider_session_.current_option;
            step_state = add_provider_session_.step_state;
            step_result = add_provider_session_.step_result;
            reconnect_mode = add_provider_session_.reconnect_mode;
            repair_mode = add_provider_session_.repair_mode;
            onedrive_repair_modal_open = show_onedrive_repair_modal;
            generation = add_provider_session_.generation;

            if (selected_provider_type.empty()) {
                add_provider_session_.inline_error = "Choose a provider to continue.";
                return;
            }
            if (remote_name.empty()) {
                add_provider_session_.inline_error = "Remote name is required.";
                return;
            }
            const bool use_onedrive_repair_options =
                onedrive_repair_modal_open &&
                repair_mode &&
                is_onedrive_provider_type(selected_provider_type);
            const auto workflow = workflow_for_type_locked(selected_provider_type);
            const std::vector<ProviderOption> fallback_options =
                (use_onedrive_repair_options ||
                 ((!workflow || workflow->options.empty()) && is_onedrive_provider_type(selected_provider_type)))
                    ? (use_onedrive_repair_options
                        ? onedrive_visible_drive_repair_options(add_provider_session_)
                        : onedrive_drive_repair_options())
                    : std::vector<ProviderOption>{};
            if (use_onedrive_repair_options || (workflow && !workflow->options.empty()) || !fallback_options.empty()) {
                const std::vector<ProviderOption>& options =
                    use_onedrive_repair_options || !workflow || workflow->options.empty()
                        ? fallback_options
                        : workflow->options;
                seed_provider_options_defaults(add_provider_session_, options);
                parameters = add_provider_session_.parameters;
                const std::string workflow_error = validate_required_provider_options(parameters, options);
                if (!workflow_error.empty()) {
                    add_provider_session_.inline_error = workflow_error;
                    return;
                }
            }
            if (current_option.has_value()) {
                auto it = parameters.find(current_option->name);
                std::string value = (it == parameters.end()) ? std::string{} : it->second;
                if (value.empty()) {
                    value = current_option->default_value;
                }
                if (value.empty() && !current_option->choices.empty()) {
                    value = current_option->choices.front().value;
                }
                if (current_option->required && value.empty()) {
                    add_provider_session_.inline_error = current_option->name + " is required.";
                    return;
                }
            }

            add_provider_session_.submit_in_flight = true;
            if (current_step_kind == "browser_auth") {
                add_provider_session_.poll_in_flight = false;
                add_provider_session_.generation++;
                generation = add_provider_session_.generation;
            }
            add_provider_session_.status_message = provider_flow_start_message(
                current_step_kind,
                reconnect_mode,
                repair_mode
            );
        }

        const bool bootstrap_existing_config_continue =
            onedrive_repair_modal_open &&
            repair_mode &&
            current_step_kind.empty() &&
            is_onedrive_provider_type(selected_provider_type);
        const bool is_continue = bootstrap_existing_config_continue ||
            current_option.has_value() ||
            current_step_kind == "post_auth_config" ||
            current_step_kind == "browser_auth";
        json body = {
            {"name", remote_name},
            {"type", selected_provider_type},
            {"parameters", parameters},
        };
        std::string endpoint = "/api/remote/config/start";
        if (is_continue) {
            body["state"] = step_state;
            body["result"] = step_result;
            if (onedrive_repair_modal_open && repair_mode && is_onedrive_provider_type(selected_provider_type)) {
                body["continue_existing"] = true;
            }
            endpoint = "/api/remote/config/continue";
        } else if (repair_mode) {
            endpoint = "/api/remote/config/repair";
        } else if (reconnect_mode) {
            endpoint = "/api/remote/config/reconnect";
        }
        const std::string body_str = body.dump();

        worker_pool_->add(
            [this, endpoint, body_str, remote_name, reconnect_mode, repair_mode, generation]() {
                const std::string url = providers_proxy_url(endpoint);
                if (url.empty()) {
                    std::lock_guard<std::mutex> lock(mu);
                    add_provider_session_.submit_in_flight = false;
                    add_provider_session_.inline_error = "PROXY_SERVICE_URL not set";
                    return;
                }

                const auto response = core::HTTPClient::get().post(
                    url,
                    body_str,
                    {.headers = provider_json_headers()}
                );
                if (response.status_code < 200 || response.status_code >= 300) {
                    std::lock_guard<std::mutex> lock(mu);
                    add_provider_session_.submit_in_flight = false;
                    add_provider_session_.inline_error = provider_response_error_message(
                        response,
                        "Provider configuration request failed"
                    );
                    add_provider_session_.status_message.clear();
                    return;
                }

                ProviderStep step;
                try {
                    step = parse_provider_step(response.body);
                } catch (const std::exception& ex) {
                    std::lock_guard<std::mutex> lock(mu);
                    add_provider_session_.submit_in_flight = false;
                    add_provider_session_.inline_error = std::string("Invalid provider response: ") + ex.what();
                    add_provider_session_.status_message.clear();
                    return;
                }

                bool refresh_remotes_after = false;
                bool start_polling = false;
                bool browser_launch_attempted = false;
                bool browser_launch_succeeded = false;

                if (!step.authorize_url.empty()) {
                    browser_launch_attempted = true;
                    browser_launch_succeeded = core::open_path_default(step.authorize_url);
                }

                {
                    std::lock_guard<std::mutex> lock(mu);
                    if (generation != add_provider_session_.generation) {
                        return;
                    }

                    add_provider_session_.submit_in_flight = false;

                    if (!step.error.empty() || step.kind == "error") {
                        add_provider_session_.inline_error = step.error.empty()
                            ? "Provider configuration failed."
                            : step.error;
                        add_provider_session_.status_message.clear();
                        return;
                    }

                    if (step.done || step.kind == "done") {
                        success_message = "Provider \"" + remote_name + "\" " +
                            provider_flow_success_suffix(reconnect_mode, repair_mode);
                        error_message.clear();
                        add_provider_session_.submit_in_flight = false;
                        add_provider_session_.poll_in_flight = false;
                        add_provider_session_.completed = true;
                        add_provider_session_.ui_step = 3;
                        add_provider_session_.current_step_kind = "done";
                        add_provider_session_.step_state.clear();
                        add_provider_session_.step_result.clear();
                        add_provider_session_.authorize_url.clear();
                        add_provider_session_.instructions.clear();
                        add_provider_session_.current_option.reset();
                        add_provider_session_.status_message = "Provider authorization complete.";
                        add_provider_session_.inline_error.clear();
                        if (show_onedrive_repair_modal) {
                            show_onedrive_repair_modal = false;
                            add_provider_session_.show_modal = false;
                        }
                        refresh_remotes_after = true;
                    } else {
                        add_provider_session_.current_step_kind = step.kind;
                        add_provider_session_.step_state = step.state;
                        add_provider_session_.step_result = step.result;
                        add_provider_session_.authorize_url = step.authorize_url;
                        add_provider_session_.instructions = step.instructions;
                        add_provider_session_.poll_after_ms = step.poll_after_ms > 0 ? step.poll_after_ms : 1000;
                        add_provider_session_.current_option = step.option;
                        add_provider_session_.browser_launch_attempted = browser_launch_attempted;
                        add_provider_session_.browser_launch_succeeded = browser_launch_succeeded;
                        add_provider_session_.poll_in_flight = step.kind == "browser_auth";
                        add_provider_session_.status_message = provider_step_status_message(step);
                        seed_provider_option_default(add_provider_session_, step);
                        start_polling = step.kind == "browser_auth";
                    }
                }

                if (refresh_remotes_after) {
                    refresh_remotes();
                    return;
                }
                if (start_polling) {
                    schedule_browser_auth_poll(generation);
                }
            },
            []() {},
            [this](const std::string& err) {
                std::lock_guard<std::mutex> lock(mu);
                add_provider_session_.submit_in_flight = false;
                add_provider_session_.status_message.clear();
                add_provider_session_.inline_error = "submit_add_provider: " + err;
            }
        );
    }

    void ProvidersState::reopen_browser_auth() {
        std::lock_guard<std::mutex> lock(mu);
        if (add_provider_session_.authorize_url.empty()) {
            add_provider_session_.inline_error = "This provider flow did not return a browser URL to reopen.";
            return;
        }

        add_provider_session_.browser_launch_attempted = true;
        add_provider_session_.browser_launch_succeeded = core::open_path_default(add_provider_session_.authorize_url);
        if (!add_provider_session_.browser_launch_succeeded) {
            add_provider_session_.inline_error = "Failed to reopen the browser sign-in page.";
        } else {
            add_provider_session_.inline_error.clear();
        }
    }

    void ProvidersState::schedule_browser_auth_poll(std::uint64_t generation) {
        if (!worker_pool_) {
            return;
        }

        worker_pool_->add(
            [this, generation]() {
                while (true) {
                    std::string remote_name;
                    std::string provider_type;
                    std::string step_state;
                    std::string step_result;
                    int poll_after_ms = 1000;

                    {
                        std::lock_guard<std::mutex> lock(mu);
                        const bool config_modal_open = add_provider_session_.show_modal || show_onedrive_repair_modal;
                        if (generation != add_provider_session_.generation ||
                            !config_modal_open ||
                            add_provider_session_.current_step_kind != "browser_auth") {
                            add_provider_session_.poll_in_flight = false;
                            return;
                        }
                        remote_name = add_provider_session_.remote_name;
                        provider_type = add_provider_session_.selected_provider_type;
                        step_state = add_provider_session_.step_state;
                        step_result = add_provider_session_.step_result;
                        poll_after_ms = add_provider_session_.poll_after_ms > 0
                            ? add_provider_session_.poll_after_ms
                            : 1000;
                    }

                    std::this_thread::sleep_for(std::chrono::milliseconds(poll_after_ms));

                    {
                        std::lock_guard<std::mutex> lock(mu);
                        const bool config_modal_open = add_provider_session_.show_modal || show_onedrive_repair_modal;
                        if (generation != add_provider_session_.generation ||
                            !config_modal_open ||
                            add_provider_session_.current_step_kind != "browser_auth") {
                            add_provider_session_.poll_in_flight = false;
                            return;
                        }
                    }

                    json body = {
                        {"name", remote_name},
                        {"type", provider_type},
                        {"parameters", json::object()},
                        {"state", step_state},
                        {"result", step_result},
                    };

                    const std::string url = providers_proxy_url("/api/remote/config/continue");
                    if (url.empty()) {
                        std::lock_guard<std::mutex> lock(mu);
                        if (generation == add_provider_session_.generation) {
                            add_provider_session_.poll_in_flight = false;
                            add_provider_session_.inline_error = "PROXY_SERVICE_URL not set";
                            add_provider_session_.status_message.clear();
                        }
                        return;
                    }

                    const auto response = core::HTTPClient::get().post(
                        url,
                        body.dump(),
                        {.headers = provider_json_headers()}
                    );
                    if (response.status_code < 200 || response.status_code >= 300) {
                        std::lock_guard<std::mutex> lock(mu);
                        if (generation == add_provider_session_.generation) {
                            add_provider_session_.poll_in_flight = false;
                            add_provider_session_.inline_error = provider_response_error_message(
                                response,
                                "Provider authentication polling failed"
                            );
                            add_provider_session_.status_message.clear();
                        }
                        return;
                    }

                    ProviderStep step;
                    try {
                        step = parse_provider_step(response.body);
                    } catch (const std::exception& ex) {
                        std::lock_guard<std::mutex> lock(mu);
                        if (generation == add_provider_session_.generation) {
                            add_provider_session_.poll_in_flight = false;
                            add_provider_session_.inline_error = std::string("Invalid provider response: ") + ex.what();
                            add_provider_session_.status_message.clear();
                        }
                        return;
                    }

                    bool refresh_remotes_after = false;
                    bool browser_launch_attempted = false;
                    bool browser_launch_succeeded = false;

                    if (!step.authorize_url.empty()) {
                        bool should_launch = false;
                        {
                            std::lock_guard<std::mutex> lock(mu);
                            should_launch = generation == add_provider_session_.generation &&
                                !add_provider_session_.browser_launch_attempted;
                        }
                        if (should_launch) {
                            browser_launch_attempted = true;
                            browser_launch_succeeded = core::open_path_default(step.authorize_url);
                        }
                    }

                    {
                        std::lock_guard<std::mutex> lock(mu);
                        if (generation != add_provider_session_.generation) {
                            return;
                        }

                        if (!step.error.empty() || step.kind == "error") {
                            add_provider_session_.poll_in_flight = false;
                            add_provider_session_.inline_error = step.error.empty()
                                ? "Provider authentication failed."
                                : step.error;
                            add_provider_session_.status_message.clear();
                            return;
                        }

                        if (step.done || step.kind == "done") {
                            add_provider_session_.poll_in_flight = false;
                            success_message = "Provider \"" + remote_name + "\" " +
                                provider_flow_success_suffix(
                                    add_provider_session_.reconnect_mode,
                                    add_provider_session_.repair_mode
                                );
                            error_message.clear();
                            add_provider_session_.completed = true;
                            add_provider_session_.ui_step = 3;
                            add_provider_session_.current_step_kind = "done";
                            add_provider_session_.step_state.clear();
                            add_provider_session_.step_result.clear();
                            add_provider_session_.authorize_url.clear();
                            add_provider_session_.instructions.clear();
                            add_provider_session_.current_option.reset();
                            add_provider_session_.status_message = "Provider authorization complete.";
                            add_provider_session_.inline_error.clear();
                            if (show_onedrive_repair_modal) {
                                show_onedrive_repair_modal = false;
                                add_provider_session_.show_modal = false;
                            }
                            refresh_remotes_after = true;
                        } else {
                            add_provider_session_.current_step_kind = step.kind;
                            add_provider_session_.step_state = step.state;
                            add_provider_session_.step_result = step.result;
                            add_provider_session_.authorize_url = step.authorize_url;
                            add_provider_session_.instructions = step.instructions;
                            add_provider_session_.poll_after_ms = step.poll_after_ms > 0 ? step.poll_after_ms : 1000;
                            add_provider_session_.current_option = step.option;
                            add_provider_session_.poll_in_flight = step.kind == "browser_auth";
                            if (browser_launch_attempted) {
                                add_provider_session_.browser_launch_attempted = true;
                                add_provider_session_.browser_launch_succeeded = browser_launch_succeeded;
                            }
                            add_provider_session_.status_message = provider_step_status_message(step);
                            seed_provider_option_default(add_provider_session_, step);
                        }
                    }

                    if (refresh_remotes_after) {
                        refresh_remotes();
                        return;
                    }
                }
            },
            []() {},
            [this](const std::string& err) {
                std::lock_guard<std::mutex> lock(mu);
                add_provider_session_.poll_in_flight = false;
                add_provider_session_.status_message.clear();
                add_provider_session_.inline_error = "schedule_browser_auth_poll: " + err;
            }
        );
    }

    void ProvidersState::on_request_rename(const std::string& provider_id) {
        std::lock_guard<std::mutex> lock(mu);
        add_provider_session_.show_modal = false;
        show_rename_modal = true;
        show_disconnect_modal = false;
        pending_provider_id = provider_id;
        dialog_message = "Rename is not wired yet for proxy-backed providers.";
    }

    void ProvidersState::on_request_disconnect(const std::string& provider_id) {
        std::lock_guard<std::mutex> lock(mu);
        add_provider_session_.show_modal = false;
        show_rename_modal = false;
        show_disconnect_modal = true;
        pending_provider_id = provider_id;
        disconnect_in_flight = false;
        dialog_message = "Disconnecting this provider will remove it from Misty until you connect it again.";
    }

    void ProvidersState::confirm_disconnect() {
        if (!worker_pool_) {
            return;
        }

        std::string provider_id;
        {
            std::lock_guard<std::mutex> lock(mu);
            if (pending_provider_id.empty()) {
                error_message = "No provider selected to disconnect.";
                return;
            }
            if (disconnect_in_flight) {
                return;
            }
            disconnect_in_flight = true;
            error_message.clear();
            success_message.clear();
            provider_id = pending_provider_id;
        }

        worker_pool_->add(
            [this, provider_id]() {
                const std::string base = providers_proxy_url("/api/remote");
                if (base.empty()) {
                    std::lock_guard<std::mutex> lock(mu);
                    disconnect_in_flight = false;
                    error_message = "PROXY_SERVICE_URL not set";
                    return;
                }

                const std::string url = base + "?name=" + core::url_encode(provider_id);
                const auto response = core::HTTPClient::get().del(
                    url,
                    {.headers = core::SessionManager::get().get_auth_headers()}
                );
                if (response.status_code < 200 || response.status_code >= 300) {
                    std::lock_guard<std::mutex> lock(mu);
                    disconnect_in_flight = false;
                    error_message = "Failed to disconnect provider: " +
                        provider_response_error_message(response, "request failed");
                    return;
                }

                {
                    std::lock_guard<std::mutex> lock(mu);
                    disconnect_in_flight = false;
                    show_disconnect_modal = false;
                    pending_provider_id.clear();
                    dialog_message.clear();
                    success_message = "Provider \"" + provider_id + "\" disconnected.";
                    error_message.clear();
                }

                refresh_remotes();
            },
            []() {},
            [this](const std::string& err) {
                std::lock_guard<std::mutex> lock(mu);
                disconnect_in_flight = false;
                error_message = "confirm_disconnect: " + err;
            }
        );
    }

    void ProvidersState::dismiss_active_dialog() {
        std::lock_guard<std::mutex> lock(mu);
        reset_add_provider_session_locked();
        show_rename_modal = false;
        show_disconnect_modal = false;
        disconnect_in_flight = false;
        pending_provider_id.clear();
        dialog_message.clear();
    }

    void ProvidersState::clear_messages() {
        std::lock_guard<std::mutex> lock(mu);
        error_message.clear();
        success_message.clear();
    }

    bool ProvidersState::matches_query(const ProviderCard& card, const std::string& query) {
        if (query.empty()) {
            return true;
        }

        return provider_card_matches_query(card, query);
    }

    void ProvidersState::rebuild_provider_cards_locked() {
        std::map<std::string, std::string> workflow_labels;
        for (const auto& workflow : workflows_) {
            workflow_labels[workflow.type] = workflow.name.empty() ? workflow.type : workflow.name;
        }

        provider_cards.clear();
        provider_cards.reserve(remotes_.size());
        for (const auto& remote : remotes_) {
            provider_cards.push_back(build_provider_card(
                remote,
                workflow_labels,
                remote_statuses_,
                is_loading_remote_statuses
            ));
        }
    }

    void ProvidersState::rebuild_health_card_locked() {
        health_card.title = proxy_ready_ ? "rclone provider service ready" : "rclone provider service unavailable";
        health_card.path_text = proxy_error_.empty()
            ? "Provider workflows are served through the local Misty proxy."
            : proxy_error_;
        if (health_card.remote_count_text.empty()) {
            health_card.remote_count_text = std::to_string(remotes_.size()) + " connected";
        }
        if (health_card.provider_count_text.empty()) {
            health_card.provider_count_text = std::to_string(workflows_.size()) + " available";
        }
        health_card.status_heading = "Status";
        health_card.status_value = proxy_ready_ ? "Ready" : "Unavailable";
        health_card.is_ready = proxy_ready_;
    }

    std::optional<ProviderWorkflow> ProvidersState::workflow_for_type_locked(const std::string& provider_type) const {
        auto it = std::find_if(workflows_.begin(), workflows_.end(), [&](const ProviderWorkflow& workflow) {
            return workflow.type == provider_type;
        });
        if (it != workflows_.end()) {
            return *it;
        }

        const std::string provider_key = normalized_provider_key(provider_type);
        it = std::find_if(workflows_.begin(), workflows_.end(), [&](const ProviderWorkflow& workflow) {
            const std::string workflow_type_key = normalized_provider_key(workflow.type);
            const std::string workflow_name_key = normalized_provider_key(workflow.name);
            return !provider_key.empty() &&
                (workflow_type_key == provider_key ||
                 workflow_name_key == provider_key ||
                 workflow_type_key.find(provider_key) != std::string::npos ||
                 provider_key.find(workflow_type_key) != std::string::npos);
        });
        return it == workflows_.end() ? std::nullopt : std::optional<ProviderWorkflow>(*it);
    }

    void ProvidersState::reset_add_provider_session_locked() {
        const std::uint64_t next_generation = add_provider_session_.generation + 1;
        add_provider_session_ = ActiveProviderConfigSession{};
        add_provider_session_.generation = next_generation;
        add_provider_session_.poll_after_ms = 1000;
        show_onedrive_repair_modal = false;
    }
}
