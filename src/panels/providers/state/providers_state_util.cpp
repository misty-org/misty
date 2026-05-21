#include "panels/providers/state/providers_state_util.h"

#include <algorithm>
#include <cctype>
#include <thread>
#include <utility>

#include <nlohmann/json.hpp>

#include "core/manager/env_manager.h"
#include "core/manager/session_manager.h"

namespace misty::panel {
    using nlohmann::json;

    std::string format_provider_uptime_text(int64_t uptime_seconds) {
        if (uptime_seconds <= 0) {
            return "Just started";
        }

        const int64_t days = uptime_seconds / 86400;
        uptime_seconds %= 86400;
        const int64_t hours = uptime_seconds / 3600;
        uptime_seconds %= 3600;
        const int64_t minutes = uptime_seconds / 60;

        if (days > 0) {
            return "Up " + std::to_string(days) + "d " + std::to_string(hours) + "h";
        }
        if (hours > 0) {
            return "Up " + std::to_string(hours) + "h " + std::to_string(minutes) + "m";
        }
        if (minutes > 0) {
            return "Up " + std::to_string(minutes) + "m";
        }
        return "Up " + std::to_string(uptime_seconds) + "s";
    }

    std::string lowercase_provider_copy(const std::string& value) {
        std::string lowered = value;
        std::transform(lowered.begin(), lowered.end(), lowered.begin(), [](unsigned char c) {
            return static_cast<char>(std::tolower(c));
        });
        return lowered;
    }

    std::string providers_proxy_url(const std::string& path) {
        const std::string base = core::EnvManager::get().get("PROXY_SERVICE_URL", "");
        if (base.empty()) {
            return "";
        }
        return base + path;
    }

    std::map<std::string, std::string> provider_json_headers() {
        auto headers = core::SessionManager::get().get_auth_headers();
        headers["Content-Type"] = "application/json";
        headers["Accept"] = "application/json";
        return headers;
    }

    std::string provider_response_error_message(const core::HttpResponse& response, const std::string& fallback) {
        if (!response.body.empty()) {
            return response.body;
        }
        if (response.status_code > 0) {
            return fallback + " (HTTP " + std::to_string(response.status_code) + ")";
        }
        return fallback;
    }

    ProviderOption parse_provider_option(const json& option_json) {
        ProviderOption option;
        option.name = option_json.value("name", std::string{});
        option.help = option_json.value("help", std::string{});
        option.default_value = option_json.value("default", std::string{});
        option.required = option_json.value("required", false);
        option.password = option_json.value("password", false);

        const auto choices_json = option_json.value("choices", json::array());
        if (choices_json.is_array()) {
            for (const auto& choice_json : choices_json) {
                ProviderChoice choice;
                choice.value = choice_json.value("value", std::string{});
                choice.help = choice_json.value("help", std::string{});
                option.choices.push_back(std::move(choice));
            }
        }
        return option;
    }

    std::vector<ProviderWorkflow> parse_provider_workflows(const std::string& body) {
        const json parsed = json::parse(body);
        std::vector<ProviderWorkflow> workflows;
        if (!parsed.is_array()) {
            return workflows;
        }

        workflows.reserve(parsed.size());
        for (const auto& workflow_json : parsed) {
            ProviderWorkflow workflow;
            workflow.type = workflow_json.value("type", std::string{});
            workflow.name = workflow_json.value("name", std::string{});
            workflow.description = workflow_json.value("description", std::string{});

            const auto options_json = workflow_json.value("options", json::array());
            if (options_json.is_array()) {
                workflow.options.reserve(options_json.size());
                for (const auto& option_json : options_json) {
                    workflow.options.push_back(parse_provider_option(option_json));
                }
            }

            if (!workflow.type.empty()) {
                workflows.push_back(std::move(workflow));
            }
        }
        return workflows;
    }

    std::vector<ProviderRemote> parse_provider_remotes(const std::string& body) {
        const json parsed = json::parse(body);
        std::vector<ProviderRemote> remotes;
        if (!parsed.is_array()) {
            return remotes;
        }

        remotes.reserve(parsed.size());
        for (const auto& remote_json : parsed) {
            ProviderRemote remote;
            remote.name = remote_json.value("name", std::string{});
            remote.type = remote_json.value("type", std::string{});
            if (!remote.name.empty()) {
                remotes.push_back(std::move(remote));
            }
        }
        return remotes;
    }

    std::map<std::string, ProviderRemoteStatus> parse_provider_remote_statuses(const std::string& body) {
        const json parsed = json::parse(body);
        std::map<std::string, ProviderRemoteStatus> statuses;
        if (!parsed.is_array()) {
            return statuses;
        }

        for (const auto& status_json : parsed) {
            ProviderRemoteStatus status;
            status.name = status_json.value("name", std::string{});
            status.type = status_json.value("type", std::string{});
            status.status_label = status_json.value("status_label", std::string{"Connected"});
            status.needs_reconnect = status_json.value("needs_reconnect", false);
            status.error = status_json.value("error", std::string{});
            if (!status.name.empty()) {
                statuses[status.name] = std::move(status);
            }
        }

        return statuses;
    }

    ProviderStep parse_provider_step(const std::string& body) {
        const json parsed = json::parse(body);
        ProviderStep step;
        step.kind = parsed.value("kind", std::string{});
        step.name = parsed.value("name", std::string{});
        step.state = parsed.value("state", std::string{});
        step.result = parsed.value("result", std::string{});
        step.done = parsed.value("done", false);
        step.error = parsed.value("error", std::string{});
        step.authorize_url = parsed.value("authorize_url", std::string{});
        step.instructions = parsed.value("instructions", std::string{});
        step.poll_after_ms = parsed.value("poll_after_ms", 1000);
        if (step.poll_after_ms <= 0) {
            step.poll_after_ms = 1000;
        }
        if (parsed.contains("option") && parsed["option"].is_object()) {
            step.option = parse_provider_option(parsed["option"]);
        }
        return step;
    }

    ProvidersRetriedFetchResult fetch_providers_with_retries(
        const std::string& url,
        int attempts,
        std::chrono::milliseconds retry_delay,
        const std::map<std::string, std::string>& headers
    ) {
        ProvidersRetriedFetchResult result;
        for (int attempt = 0; attempt < attempts; ++attempt) {
            result.response = core::HTTPClient::get().get(url, {.headers = headers});
            if (result.response.status_code >= 200 && result.response.status_code < 300) {
                result.success = true;
                return result;
            }
            result.last_error = provider_response_error_message(result.response, "request failed");
            std::this_thread::sleep_for(retry_delay);
        }
        return result;
    }

    std::string provider_flow_start_message(
        const std::string& current_step_kind,
        bool reconnect_mode,
        bool repair_mode
    ) {
        if (current_step_kind == "post_auth_config") {
            return "Applying provider settings...";
        }
        if (repair_mode) {
            return "Starting configure flow...";
        }
        if (reconnect_mode) {
            return "Starting reconnect flow...";
        }
        return "Starting browser sign-in...";
    }

    std::string provider_flow_success_suffix(bool reconnect_mode, bool repair_mode) {
        if (repair_mode) {
            return "configured.";
        }
        if (reconnect_mode) {
            return "reconnected.";
        }
        return "connected.";
    }

    std::string provider_step_status_message(const ProviderStep& step) {
        if (!step.instructions.empty()) {
            return step.instructions;
        }
        if (step.kind == "post_auth_config") {
            return "Choose the provider settings to finish setup.";
        }
        return "Waiting for browser sign-in to finish...";
    }

    void seed_provider_option_default(ActiveProviderConfigSession& session, const ProviderStep& step) {
        if (!step.option.has_value()) {
            return;
        }

        const auto& option = *step.option;
        auto it = session.parameters.find(option.name);
        if (it != session.parameters.end() && !it->second.empty()) {
            return;
        }

        std::string value = option.default_value;
        if (value.empty() && !option.choices.empty()) {
            value = option.choices.front().value;
        }
        session.parameters[option.name] = value;
    }

    bool provider_card_matches_query(const ProviderCard& card, const std::string& query) {
        if (query.empty()) {
            return true;
        }

        const std::string lowered_query = lowercase_provider_copy(query);
        const std::string haystack = lowercase_provider_copy(
            card.provider_label + " " + card.account_label + " " + card.status_label + " " + card.id);
        return haystack.find(lowered_query) != std::string::npos;
    }

    ProviderCard build_provider_card(
        const ProviderRemote& remote,
        const std::map<std::string, std::string>& workflow_labels,
        const std::map<std::string, ProviderRemoteStatus>& remote_statuses,
        bool is_loading_remote_statuses
    ) {
        ProviderCard card;
        card.id = remote.name;
        card.provider_id = remote.type;

        const auto label_it = workflow_labels.find(remote.type);
        card.provider_label = label_it == workflow_labels.end() ? remote.type : label_it->second;
        card.account_label = remote.name;

        const auto status_it = remote_statuses.find(remote.name);
        if (status_it != remote_statuses.end()) {
            card.status_label = status_it->second.status_label.empty()
                ? "Connected"
                : status_it->second.status_label;
            card.needs_reconnect = status_it->second.needs_reconnect;
            card.unavailable = !status_it->second.needs_reconnect && card.status_label == "Unavailable";
        } else if (is_loading_remote_statuses) {
            card.status_label = "Checking...";
        } else {
            card.status_label = "Connected";
        }

        return card;
    }
}
