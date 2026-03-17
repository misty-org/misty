#pragma once

#include <cstdint>
#include <chrono>
#include <map>
#include <optional>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>

#include "core/net/http_client.h"
#include "panels/providers/state/providers_state.h"

namespace misty::panel {
    struct ProviderTokenField {
        std::string key;
        std::string value;
        bool sensitive = false;
    };

    struct ProvidersRetriedFetchResult {
        core::HttpResponse response;
        bool success = false;
        std::string last_error = "request failed";
    };

    std::string format_provider_uptime_text(int64_t uptime_seconds);
    std::string lowercase_provider_copy(const std::string& value);
    std::string providers_proxy_url(const std::string& path);
    std::string rclone_rc_url_from_port_text(const std::string& port_text);
    std::map<std::string, std::string> provider_json_headers();
    std::string provider_response_error_message(const core::HttpResponse& response, const std::string& fallback);
    std::string provider_rename_validation_error(
        const std::string& old_name,
        const std::string& new_name,
        const std::vector<std::string>& existing_names
    );

    ProviderOption parse_provider_option(const nlohmann::json& option_json);
    std::vector<ProviderWorkflow> parse_provider_workflows(const std::string& body);
    std::vector<ProviderRemote> parse_provider_remotes(const std::string& body);
    std::map<std::string, ProviderRemoteStatus> parse_provider_remote_statuses(const std::string& body);
    std::vector<std::string> parse_rclone_configured_remotes(const std::string& body);
    std::map<std::string, std::string> parse_rclone_config_map(const std::string& body);
    std::vector<ProviderTokenField> parse_rclone_token_fields(const std::string& token_json);
    std::string update_rclone_token_field(
        const std::string& token_json,
        const std::string& key,
        const std::string& value
    );
    std::string rclone_config_update_body(
        const std::string& name,
        const std::map<std::string, std::string>& parameters
    );
    ProviderStep parse_provider_step(const std::string& body);

    ProvidersRetriedFetchResult fetch_providers_with_retries(
        const std::string& url,
        int attempts,
        std::chrono::milliseconds retry_delay,
        const std::map<std::string, std::string>& headers
    );

    std::string provider_flow_start_message(
        const std::string& current_step_kind,
        bool reconnect_mode,
        bool repair_mode
    );

    std::string provider_flow_success_suffix(bool reconnect_mode, bool repair_mode);
    std::string provider_step_status_message(const ProviderStep& step);
    void seed_provider_option_default(ActiveProviderConfigSession& session, const ProviderStep& step);
    bool provider_card_matches_query(const ProviderCard& card, const std::string& query);
    ProviderCard build_provider_card(
        const ProviderRemote& remote,
        const std::map<std::string, std::string>& workflow_labels,
        const std::map<std::string, ProviderRemoteStatus>& remote_statuses,
        bool is_loading_remote_statuses
    );
}
