#include "session_manager.h"
#include "core/manager/env_manager.h"
#include "core/manager/proxy_manager.h"
#include "core/net/http_client.h"

#include <nlohmann/json.hpp>
#include <iostream>

namespace misty::core {

    SessionManager& SessionManager::get() {
        static SessionManager instance;
        return instance;
    }

    SessionManager::SessionManager() {
        load_tokens();
    }

    void SessionManager::load_tokens() {
        token_.clear();
        refresh_token_.clear();
        user_id_.clear();
        email_.clear();
    }

    bool SessionManager::save_tokens() const {
        return true;
    }

    void SessionManager::delete_tokens() const {
    }

    void SessionManager::set_user_id(const std::string& user_id) {
        std::lock_guard<std::mutex> lock(mu_);
        user_id_ = user_id;
    }

    std::string SessionManager::get_user_id() const {
        std::lock_guard<std::mutex> lock(mu_);
        return user_id_;
    }

    void SessionManager::set_email(const std::string& email) {
        std::lock_guard<std::mutex> lock(mu_);
        email_ = email;
    }

    std::string SessionManager::get_email() const {
        std::lock_guard<std::mutex> lock(mu_);
        return email_;
    }

    bool SessionManager::set_tokens(const std::string& access_token, const std::string& refresh_token) {
        std::lock_guard<std::mutex> lock(mu_);
        token_         = access_token;
        refresh_token_.clear();
        session_expired_ = false;
        (void)refresh_token;
        return true;
    }

    bool SessionManager::update_tokens(const std::string& access_token, const std::string& refresh_token) {
        std::lock_guard<std::mutex> lock(mu_);
        token_         = access_token;
        refresh_token_.clear();
        session_expired_ = false;
        (void)refresh_token;
        return true;
    }

    void SessionManager::clear_token() {
        std::lock_guard<std::mutex> lock(mu_);
        token_.clear();
        refresh_token_.clear();
        user_id_.clear();
        email_.clear();
        delete_tokens();
    }

    std::string SessionManager::get_token() const {
        std::lock_guard<std::mutex> lock(mu_);
        return token_;
    }

    std::string SessionManager::get_refresh_token() const {
        std::lock_guard<std::mutex> lock(mu_);
        return refresh_token_;
    }

    bool SessionManager::apply_session_response(const std::string& body) {
        try {
            const auto json_resp = nlohmann::json::parse(body);
            const std::string token = json_resp.value("token", std::string{});
            if (token.empty()) {
                return false;
            }

            std::lock_guard<std::mutex> lock(mu_);
            token_ = token;
            refresh_token_.clear();
            user_id_ = json_resp.value("id", std::string{});
            email_ = json_resp.value("email", std::string{});
            session_expired_ = false;
            return true;
        } catch (...) {
            return false;
        }
    }

    bool SessionManager::bootstrap_session() {
        const std::string proxy_url = EnvManager::get().get("PROXY_SERVICE_URL", "");
        if (proxy_url.empty()) {
            return false;
        }

        HttpResponse response = execute_raw_http_request("GET", proxy_url + "/api/session", "", {});
        if (response.status_code == 0 && ProxyManager::get().ensure_running()) {
            response = execute_raw_http_request("GET", proxy_url + "/api/session", "", {});
        }
        if (response.status_code == 0) {
            ProxyManager::get().record_proxy_request_result(false);
            return false;
        }
        ProxyManager::get().record_proxy_request_result(true);
        return response.status_code == 200 && apply_session_response(response.body);
    }

    bool SessionManager::is_authenticated() const {
        std::lock_guard<std::mutex> lock(mu_);
        return !token_.empty();
    }

    void SessionManager::mark_session_expired() {
        std::lock_guard<std::mutex> lock(mu_);
        session_expired_ = true;
        std::cerr << "[SessionManager] session expired — user must re-authenticate" << std::endl;
    }

    bool SessionManager::is_session_expired() const {
        std::lock_guard<std::mutex> lock(mu_);
        return session_expired_;
    }

    void SessionManager::clear_session_expired() {
        std::lock_guard<std::mutex> lock(mu_);
        session_expired_ = false;
    }

    SessionManager::RefreshResult SessionManager::attempt_token_refresh() {
        const std::string proxy_url = EnvManager::get().get("PROXY_SERVICE_URL", "");
        if (proxy_url.empty()) {
            return RefreshResult::Failed;
        }

        std::map<std::string, std::string> headers;
        headers["Content-Type"] = "application/json";

        HttpResponse response = execute_raw_http_request(
            "POST",
            proxy_url + "/api/session/refresh",
            "",
            {.headers = headers});
        if (response.status_code == 0 && ProxyManager::get().ensure_running()) {
            response = execute_raw_http_request(
                "POST",
                proxy_url + "/api/session/refresh",
                "",
                {.headers = headers});
        }

        if (response.status_code == 0) {
            ProxyManager::get().record_proxy_request_result(false);
        } else {
            ProxyManager::get().record_proxy_request_result(true);
        }

        if (response.status_code == 200) {
            if (apply_session_response(response.body)) {
                std::cerr << "[SessionManager] token refresh succeeded" << std::endl;
                return RefreshResult::Success;
            }
            std::cerr << "[SessionManager] failed to parse refresh response" << std::endl;
        } else if (response.status_code == 0) {
            std::cerr << "[SessionManager] token refresh failed because proxy is unavailable" << std::endl;
            return RefreshResult::Unavailable;
        } else {
            std::cerr << "[SessionManager] token refresh failed with status " << response.status_code << std::endl;
        }

        return RefreshResult::Failed;
    }

    void SessionManager::mark_proxy_available() {
        std::lock_guard<std::mutex> lock(mu_);
        proxy_available_ = true;
        proxy_status_message_.clear();
    }

    void SessionManager::mark_proxy_unavailable(const std::string& message) {
        std::lock_guard<std::mutex> lock(mu_);
        proxy_available_ = false;
        proxy_status_message_ = message.empty()
            ? "Misty background service is unavailable. Local files remain available, but cloud and sync features are paused."
            : message;
    }

    bool SessionManager::is_proxy_available() const {
        std::lock_guard<std::mutex> lock(mu_);
        return proxy_available_;
    }

    std::string SessionManager::get_proxy_status_message() const {
        std::lock_guard<std::mutex> lock(mu_);
        return proxy_status_message_;
    }

    std::map<std::string, std::string> SessionManager::get_auth_headers() const {
        std::lock_guard<std::mutex> lock(mu_);
        std::map<std::string, std::string> headers;
        if (!token_.empty()) {
            headers["Authorization"] = "Bearer " + token_;
        }
        return headers;
    }

}
