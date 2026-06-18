#include "panels/providers/state/providers_state_util.h"

#include <algorithm>
#include <cctype>
#include <set>
#include <thread>
#include <utility>

#include <nlohmann/json.hpp>

#include "core/manager/env_manager.h"

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

    std::string rclone_rc_url_from_port_text(const std::string& port_text) {
        std::string digits;
        for (char c : port_text) {
            if (std::isdigit(static_cast<unsigned char>(c))) {
                digits.push_back(c);
            }
        }
        if (digits.empty()) {
            return "http://127.0.0.1:5572";
        }
        return "http://127.0.0.1:" + digits;
    }

    std::map<std::string, std::string> provider_json_headers() {
        std::map<std::string, std::string> headers;
        headers["Content-Type"] = "application/json";
        headers["Accept"] = "application/json";
        return headers;
    }

    std::vector<ProviderTokenField> parse_rclone_token_fields(const std::string& token_json) {
        const json parsed = json::parse(token_json, nullptr, false);
        if (!parsed.is_object()) {
            return {};
        }

        std::vector<ProviderTokenField> fields;
        fields.reserve(parsed.size());
        for (const auto& [key, value] : parsed.items()) {
            ProviderTokenField field;
            field.key = key;
            field.sensitive = (key != "token_type" && key.find("token") != std::string::npos) ||
                              key.find("secret") != std::string::npos;
            if (value.is_string()) {
                field.value = value.get<std::string>();
            } else if (!value.is_null()) {
                field.value = value.dump();
            }
            fields.push_back(std::move(field));
        }

        const auto priority = [](const std::string& key) {
            if (key == "access_token") return 0;
            if (key == "refresh_token") return 1;
            if (key == "token_type") return 2;
            if (key == "expiry") return 3;
            if (key == "expires_in") return 4;
            return 5;
        };
        std::stable_sort(fields.begin(), fields.end(), [&](const auto& left, const auto& right) {
            return priority(left.key) < priority(right.key);
        });
        return fields;
    }

    std::string update_rclone_token_field(
        const std::string& token_json,
        const std::string& key,
        const std::string& value
    ) {
        json parsed = json::parse(token_json, nullptr, false);
        if (!parsed.is_object() || !parsed.contains(key)) {
            return token_json;
        }

        const json& original = parsed[key];
        if (original.is_boolean()) {
            if (value == "true") parsed[key] = true;
            else if (value == "false") parsed[key] = false;
            else parsed[key] = value;
        } else if (original.is_number_integer()) {
            try {
                parsed[key] = std::stoll(value);
            } catch (const std::exception&) {
                parsed[key] = value;
            }
        } else if (original.is_number_float()) {
            try {
                parsed[key] = std::stod(value);
            } catch (const std::exception&) {
                parsed[key] = value;
            }
        } else if (original.is_object() || original.is_array()) {
            const json replacement = json::parse(value, nullptr, false);
            parsed[key] = replacement.is_discarded() ? json(value) : replacement;
        } else {
            parsed[key] = value;
        }
        return parsed.dump();
    }

    std::string provider_rename_validation_error(
        const std::string& old_name,
        const std::string& new_name,
        const std::vector<std::string>& existing_names
    ) {
        if (new_name.empty()) {
            return "Enter a remote name.";
        }
        if (new_name == old_name) {
            return "Choose a different remote name.";
        }
        if (new_name.find(':') != std::string::npos ||
            new_name.find('/') != std::string::npos ||
            new_name.find('\\') != std::string::npos) {
            return "Remote names cannot contain colons or path separators.";
        }
        const auto exists = std::find(existing_names.begin(), existing_names.end(), new_name);
        if (exists != existing_names.end()) {
            return "A remote with that name already exists.";
        }
        return {};
    }

    std::string provider_response_error_message(const core::HttpResponse& response, const std::string& fallback) {
        if (!response.body.empty()) {
            try {
                const json parsed = json::parse(response.body);
                if (parsed.is_object()) {
                    const std::string message = parsed.value("error", std::string{});
                    if (!message.empty()) {
                        return message;
                    }
                    const std::string detail = parsed.value("message", std::string{});
                    if (!detail.empty()) {
                        return detail;
                    }
                }
            } catch (const std::exception&) {
            }
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
        if (option.name.empty()) {
            option.name = option_json.value("Name", std::string{});
        }
        option.label = option_json.value("label", std::string{});
        if (option.label.empty()) {
            option.label = option_json.value("title", std::string{});
        }
        if (option.label.empty()) {
            option.label = option_json.value("question", std::string{});
        }
        if (option.label.empty()) {
            option.label = option_json.value("display_name", std::string{});
        }
        if (option.label.empty()) {
            option.label = option_json.value("displayName", std::string{});
        }
        if (option.label.empty()) {
            option.label = option_json.value("FieldName", std::string{});
        }
        option.help = option_json.value("help", std::string{});
        if (option.help.empty()) {
            option.help = option_json.value("Help", std::string{});
        }
        option.default_value = option_json.value("default", std::string{});
        if (option.default_value.empty()) {
            option.default_value = option_json.value("DefaultStr", std::string{});
        }
        option.required = option_json.value("required", false);
        if (!option.required) {
            option.required = option_json.value("Required", false);
        }
        option.password = option_json.value("password", false);
        if (!option.password) {
            option.password = option_json.value("IsPassword", false);
        }

        const auto choices_json = option_json.value("choices", json::array());
        if (choices_json.is_array()) {
            for (const auto& choice_json : choices_json) {
                ProviderChoice choice;
                if (choice_json.is_string()) {
                    choice.value = choice_json.get<std::string>();
                } else {
                    choice.value = choice_json.value("value", std::string{});
                    if (choice.value.empty()) {
                        choice.value = choice_json.value("Value", std::string{});
                    }
                    choice.help = choice_json.value("help", std::string{});
                    if (choice.help.empty()) {
                        choice.help = choice_json.value("Help", std::string{});
                    }
                }
                option.choices.push_back(std::move(choice));
            }
        }
        const auto examples_json = option_json.value("Examples", json::array());
        if (option.choices.empty() && examples_json.is_array()) {
            for (const auto& choice_json : examples_json) {
                ProviderChoice choice;
                choice.value = choice_json.value("Value", std::string{});
                choice.help = choice_json.value("Help", std::string{});
                if (!choice.value.empty()) {
                    option.choices.push_back(std::move(choice));
                }
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

    std::vector<std::string> parse_rclone_configured_remotes(const std::string& body) {
        std::vector<std::string> names;
        const json parsed = json::parse(body);
        const auto remotes_json = parsed.value("remotes", json::array());
        if (!remotes_json.is_array()) {
            return names;
        }
        for (const auto& remote_json : remotes_json) {
            if (!remote_json.is_string()) {
                continue;
            }
            std::string name = remote_json.get<std::string>();
            if (name.empty()) {
                continue;
            }
            if (!name.empty() && name.back() == ':') {
                name.pop_back();
            }
            if (!name.empty()) {
                names.push_back(std::move(name));
            }
        }
        return names;
    }

    std::map<std::string, std::string> parse_rclone_config_map(const std::string& body) {
        std::map<std::string, std::string> config;
        const json parsed = json::parse(body);
        if (!parsed.is_object()) {
            return config;
        }

        for (auto it = parsed.begin(); it != parsed.end(); ++it) {
            if (it.value().is_string()) {
                config[it.key()] = it.value().get<std::string>();
            } else if (it.value().is_boolean()) {
                config[it.key()] = it.value().get<bool>() ? "true" : "false";
            } else if (it.value().is_number_integer() || it.value().is_number_unsigned() || it.value().is_number_float()) {
                config[it.key()] = it.value().dump();
            } else if (!it.value().is_null()) {
                config[it.key()] = it.value().dump();
            }
        }
        return config;
    }

    std::string rclone_config_update_body(
        const std::string& name,
        const std::map<std::string, std::string>& parameters
    ) {
        json parameter_json = json::object();
        for (const auto& [key, value] : parameters) {
            if (key == "type") {
                continue;
            }
            parameter_json[key] = value;
        }

        const json body = {
            {"name", name},
            {"parameters", parameter_json},
            {"opt", {
                {"nonInteractive", true},
                {"noOutput", true},
            }},
        };
        return body.dump();
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
        } else if (parsed.contains("field") && parsed["field"].is_object()) {
            step.option = parse_provider_option(parsed["field"]);
        } else if (parsed.contains("prompt") && parsed["prompt"].is_object()) {
            step.option = parse_provider_option(parsed["prompt"]);
        } else if (parsed.contains("options") && parsed["options"].is_array() && !parsed["options"].empty() &&
                   parsed["options"].front().is_object()) {
            step.option = parse_provider_option(parsed["options"].front());
        } else if (parsed.contains("name") &&
                   (parsed.contains("choices") || parsed.contains("default") || parsed.contains("required"))) {
            step.option = parse_provider_option(parsed);
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
        if (current_step_kind == "browser_auth") {
            return "Checking browser sign-in...";
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
            card.status_detail = status_it->second.error;
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
