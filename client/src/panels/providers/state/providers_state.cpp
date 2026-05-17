#include "panels/providers/state/providers_state.h"

#include <algorithm>
#include <cctype>
#include <chrono>
#include <thread>
#include <utility>

#include <nlohmann/json.hpp>

#include "core/manager/env_manager.h"
#include "core/manager/session_manager.h"
#include "core/net/http_client.h"
#include "core/system/util.h"

namespace misty::panel {
    using nlohmann::json;

    namespace {
        std::string format_uptime_text(int64_t uptime_seconds) {
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

        std::string lowercase_copy(const std::string& value) {
            std::string lowered = value;
            std::transform(lowered.begin(), lowered.end(), lowered.begin(), [](unsigned char c) {
                return static_cast<char>(std::tolower(c));
            });
            return lowered;
        }

        std::string proxy_url(const std::string& path) {
            const std::string base = core::EnvManager::get().get("PROXY_SERVICE_URL", "");
            if (base.empty()) {
                return "";
            }
            return base + path;
        }

        std::map<std::string, std::string> json_headers() {
            auto headers = core::SessionManager::get().get_auth_headers();
            headers["Content-Type"] = "application/json";
            headers["Accept"] = "application/json";
            return headers;
        }

        std::string response_error_message(const core::HttpResponse& response, const std::string& fallback) {
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

        std::vector<ProviderWorkflow> parse_workflows(const std::string& body) {
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

        std::vector<ProviderRemote> parse_remotes(const std::string& body) {
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
                const std::string url = proxy_url("/api/remote/health");
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
                try {
                    const json parsed = json::parse(response.body);
                    ready = parsed.value("ready", ready);
                    error = parsed.value("error", std::string{});
                    const std::string port = parsed.value("port", std::string{});
                    const int64_t uptime_seconds = parsed.value("uptime_seconds", static_cast<int64_t>(0));
                    const int connected_providers = parsed.value("connected_providers", 0);
                    const int available_providers = parsed.value("available_providers", 0);
                    if (!port.empty()) {
                        port_text = "Port " + port;
                    }
                    if (ready) {
                        uptime_text = format_uptime_text(uptime_seconds);
                    }
                    remote_count_text = std::to_string(connected_providers) + " connected";
                    provider_count_text = std::to_string(available_providers) + " available";
                } catch (const std::exception&) {
                    if (!ready && error.empty()) {
                        error = response_error_message(response, "Failed to check provider health");
                    }
                }
                if (!ready && error.empty()) {
                    error = response_error_message(response, "Provider service unavailable");
                }

                std::lock_guard<std::mutex> lock(mu);
                proxy_ready_ = ready;
                proxy_error_ = std::move(error);
                health_card.port_text = std::move(port_text);
                health_card.uptime_text = std::move(uptime_text);
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
                const std::string url = proxy_url("/api/remote/workflows");
                if (url.empty()) {
                    std::lock_guard<std::mutex> lock(mu);
                    error_message = "PROXY_SERVICE_URL not set";
                    is_loading_workflows = false;
                    return;
                }

                const auto response = core::HTTPClient::get().get(
                    url,
                    {.headers = core::SessionManager::get().get_auth_headers()}
                );
                if (response.status_code < 200 || response.status_code >= 300) {
                    std::lock_guard<std::mutex> lock(mu);
                    error_message = "Failed to load provider workflows: " +
                                    response_error_message(response, "request failed");
                    is_loading_workflows = false;
                    return;
                }

                std::vector<ProviderWorkflow> workflows = parse_workflows(response.body);
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
                const std::string url = proxy_url("/api/remote");
                if (url.empty()) {
                    std::lock_guard<std::mutex> lock(mu);
                    error_message = "PROXY_SERVICE_URL not set";
                    is_loading_remotes = false;
                    return;
                }

                const auto response = core::HTTPClient::get().get(
                    url,
                    {.headers = core::SessionManager::get().get_auth_headers()}
                );
                if (response.status_code < 200 || response.status_code >= 300) {
                    std::lock_guard<std::mutex> lock(mu);
                    error_message = "Failed to load connected providers: " +
                                    response_error_message(response, "request failed");
                    is_loading_remotes = false;
                    return;
                }

                std::vector<ProviderRemote> remotes = parse_remotes(response.body);
                std::lock_guard<std::mutex> lock(mu);
                remotes_ = std::move(remotes);
                is_loading_remotes = false;
                rebuild_provider_cards_locked();
                rebuild_health_card_locked();
            },
            []() {},
            [this](const std::string& err) {
                std::lock_guard<std::mutex> lock(mu);
                error_message = "refresh_remotes: " + err;
                is_loading_remotes = false;
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

    void ProvidersState::select_provider_type(const std::string& provider_type) {
        std::lock_guard<std::mutex> lock(mu);
        add_provider_session_.selected_provider_type = provider_type;
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
        add_provider_session_.status_message.clear();
        add_provider_session_.inline_error.clear();
        add_provider_session_.poll_in_flight = false;
        add_provider_session_.generation++;
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
            generation = add_provider_session_.generation;

            if (selected_provider_type.empty()) {
                add_provider_session_.inline_error = "Choose a provider to continue.";
                return;
            }
            if (remote_name.empty()) {
                add_provider_session_.inline_error = "Remote name is required.";
                return;
            }
            if (current_step_kind == "post_auth_config" && current_option.has_value()) {
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
            add_provider_session_.status_message = current_step_kind == "post_auth_config"
                ? "Applying provider settings..."
                : "Starting browser sign-in...";
        }

        const bool is_continue = current_step_kind == "post_auth_config";
        json body = {
            {"name", remote_name},
            {"type", selected_provider_type},
            {"parameters", parameters},
        };
        std::string endpoint = "/api/remote/config/start";
        if (is_continue) {
            body["state"] = step_state;
            body["result"] = step_result;
            endpoint = "/api/remote/config/continue";
        }
        const std::string body_str = body.dump();

        worker_pool_->add(
            [this, endpoint, body_str, remote_name, generation]() {
                const std::string url = proxy_url(endpoint);
                if (url.empty()) {
                    std::lock_guard<std::mutex> lock(mu);
                    add_provider_session_.submit_in_flight = false;
                    add_provider_session_.inline_error = "PROXY_SERVICE_URL not set";
                    return;
                }

                const auto response = core::HTTPClient::get().post(
                    url,
                    body_str,
                    {.headers = json_headers()}
                );
                if (response.status_code < 200 || response.status_code >= 300) {
                    std::lock_guard<std::mutex> lock(mu);
                    add_provider_session_.submit_in_flight = false;
                    add_provider_session_.inline_error = response_error_message(
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
                        success_message = "Provider \"" + remote_name + "\" connected.";
                        error_message.clear();
                        reset_add_provider_session_locked();
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
                        add_provider_session_.status_message = step.instructions.empty()
                            ? (step.kind == "post_auth_config"
                                ? "Choose the provider settings to finish setup."
                                : "Waiting for browser sign-in to finish...")
                            : step.instructions;
                        if (step.option.has_value()) {
                            const auto& option = *step.option;
                            auto it = add_provider_session_.parameters.find(option.name);
                            if (it == add_provider_session_.parameters.end() || it->second.empty()) {
                                std::string value = option.default_value;
                                if (value.empty() && !option.choices.empty()) {
                                    value = option.choices.front().value;
                                }
                                add_provider_session_.parameters[option.name] = value;
                            }
                        }
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
                        if (generation != add_provider_session_.generation ||
                            !add_provider_session_.show_modal ||
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
                        if (generation != add_provider_session_.generation ||
                            !add_provider_session_.show_modal ||
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

                    const std::string url = proxy_url("/api/remote/config/continue");
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
                        {.headers = json_headers()}
                    );
                    if (response.status_code < 200 || response.status_code >= 300) {
                        std::lock_guard<std::mutex> lock(mu);
                        if (generation == add_provider_session_.generation) {
                            add_provider_session_.poll_in_flight = false;
                            add_provider_session_.inline_error = response_error_message(
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
                            success_message = "Provider \"" + remote_name + "\" connected.";
                            error_message.clear();
                            reset_add_provider_session_locked();
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
                            add_provider_session_.status_message = step.instructions.empty()
                                ? (step.kind == "post_auth_config"
                                    ? "Choose the provider settings to finish setup."
                                    : "Waiting for browser sign-in to finish...")
                                : step.instructions;
                            if (step.option.has_value()) {
                                const auto& option = *step.option;
                                auto it = add_provider_session_.parameters.find(option.name);
                                if (it == add_provider_session_.parameters.end() || it->second.empty()) {
                                    std::string value = option.default_value;
                                    if (value.empty() && !option.choices.empty()) {
                                        value = option.choices.front().value;
                                    }
                                    add_provider_session_.parameters[option.name] = value;
                                }
                            }
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
                const std::string base = proxy_url("/api/remote");
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
                        response_error_message(response, "request failed");
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

        const std::string lowered_query = lowercase_copy(query);
        const std::string haystack = lowercase_copy(
            card.provider_label + " " + card.account_label + " " + card.status_label + " " + card.id);
        return haystack.find(lowered_query) != std::string::npos;
    }

    void ProvidersState::rebuild_provider_cards_locked() {
        std::map<std::string, std::string> workflow_labels;
        for (const auto& workflow : workflows_) {
            workflow_labels[workflow.type] = workflow.name.empty() ? workflow.type : workflow.name;
        }

        provider_cards.clear();
        provider_cards.reserve(remotes_.size());
        for (const auto& remote : remotes_) {
            ProviderCard card;
            card.id = remote.name;
            card.provider_id = remote.type;
            auto it = workflow_labels.find(remote.type);
            card.provider_label = it == workflow_labels.end() ? remote.type : it->second;
            card.account_label = remote.name;
            card.status_label = "Connected";
            provider_cards.push_back(std::move(card));
        }
    }

    void ProvidersState::rebuild_health_card_locked() {
        health_card.title = proxy_ready_ ? "rclone provider service ready" : "rclone provider service unavailable";
        health_card.version_text.clear();
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
        if (it == workflows_.end()) {
            return std::nullopt;
        }
        return *it;
    }

    void ProvidersState::reset_add_provider_session_locked() {
        const std::uint64_t next_generation = add_provider_session_.generation + 1;
        add_provider_session_ = ActiveProviderConfigSession{};
        add_provider_session_.generation = next_generation;
        add_provider_session_.poll_after_ms = 1000;
    }
}
