#include "session_manager.h"
#include "core/manager/env_manager.h"
#include "core/manager/proxy_manager.h"
#include "core/net/http_client.h"

#include <nlohmann/json.hpp>
#include <iostream>
#include <fstream>
#include <filesystem>
#include <sys/stat.h>
#include <cstdlib>

namespace fs = std::filesystem;

namespace misty::core {

    static fs::path get_legacy_misty_dir() {
        const char* home = getenv("HOME");
        return fs::path(home ? home : "/tmp") / ".misty";
    }

    static fs::path get_legacy_cache_session_dir() {
        const char* home = getenv("HOME");
        return fs::path(home ? home : "/tmp") / "misty" / ".cache" / "sessions";
    }

    static fs::path get_session_dir() {
        const char* home = getenv("HOME");
        return fs::path(home ? home : "/tmp") / "misty" / "config" / "sessions";
    }

    static void ensure_session_dir() {
        fs::path dir = get_session_dir();
        std::error_code ec;
        if (!fs::exists(dir, ec)) {
            fs::create_directories(dir, ec);
            if (ec) {
                std::cerr << "[SessionManager] failed to create session directory at "
                          << dir << ": " << ec.message() << std::endl;
                return;
            }
            chmod(dir.c_str(), 0700);
        }
    }

    static std::string read_file_token(const fs::path& path) {
        if (!fs::exists(path)) return "";
        std::ifstream file(path);
        std::string value;
        if (file.is_open()) {
            std::getline(file, value);
        }
        return value;
    }

    static bool write_file_token(const fs::path& path, const std::string& value) {
        ensure_session_dir();
        std::ofstream file(path);
        if (!file.is_open()) {
            std::cerr << "[SessionManager] failed to open " << path << " for writing" << std::endl;
            return false;
        }

        file << value;
        file.flush();
        if (!file.good()) {
            std::cerr << "[SessionManager] failed to write token file " << path << std::endl;
            return false;
        }

        chmod(path.c_str(), 0600);
        return true;
    }

    static void remove_file_token(const fs::path& path) {
        if (fs::exists(path)) {
            fs::remove(path);
        }
    }

    SessionManager& SessionManager::get() {
        static SessionManager instance;
        return instance;
    }

    SessionManager::SessionManager() {
        load_tokens();
    }

    void SessionManager::load_tokens() {
        const fs::path session_dir = get_session_dir();
        const fs::path legacy_cache_dir = get_legacy_cache_session_dir();
        const fs::path legacy_dir = get_legacy_misty_dir();

        auto load_with_legacy_fallback = [&](const char* filename) {
            const std::string current = read_file_token(session_dir / filename);
            if (!current.empty()) {
                return current;
            }

            const std::string legacy_cache = read_file_token(legacy_cache_dir / filename);
            if (!legacy_cache.empty()) {
                if (write_file_token(session_dir / filename, legacy_cache)) {
                    remove_file_token(legacy_cache_dir / filename);
                }
                return legacy_cache;
            }

            const std::string legacy = read_file_token(legacy_dir / filename);
            if (!legacy.empty()) {
                if (write_file_token(session_dir / filename, legacy)) {
                    remove_file_token(legacy_dir / filename);
                }
            }
            return legacy;
        };

        token_         = load_with_legacy_fallback("token");
        refresh_token_ = load_with_legacy_fallback("refresh_token");
        user_id_       = load_with_legacy_fallback("user_id");
        email_         = load_with_legacy_fallback("email");
        if (!token_.empty())
            std::cerr << "[SessionManager] loaded access token (" << token_.size() << " bytes)" << std::endl;
        if (!refresh_token_.empty())
            std::cerr << "[SessionManager] loaded refresh token (" << refresh_token_.size() << " bytes)" << std::endl;
    }

    bool SessionManager::save_tokens() const {
        const fs::path session_dir = get_session_dir();
        const bool access_ok = write_file_token(session_dir / "token", token_);
        const bool refresh_ok = write_file_token(session_dir / "refresh_token", refresh_token_);
        if (access_ok && refresh_ok) {
            std::cerr << "[SessionManager] persisted tokens to " << session_dir << std::endl;
            return true;
        }
        std::cerr << "[SessionManager] failed to persist session tokens to " << session_dir << std::endl;
        return false;
    }

    void SessionManager::delete_tokens() const {
        remove_file_token(get_session_dir() / "token");
        remove_file_token(get_session_dir() / "refresh_token");
        remove_file_token(get_session_dir() / "user_id");
        remove_file_token(get_session_dir() / "email");
        remove_file_token(get_legacy_cache_session_dir() / "token");
        remove_file_token(get_legacy_cache_session_dir() / "refresh_token");
        remove_file_token(get_legacy_cache_session_dir() / "user_id");
        remove_file_token(get_legacy_cache_session_dir() / "email");
        remove_file_token(get_legacy_misty_dir() / "token");
        remove_file_token(get_legacy_misty_dir() / "refresh_token");
        remove_file_token(get_legacy_misty_dir() / "user_id");
        remove_file_token(get_legacy_misty_dir() / "email");
        std::cerr << "[SessionManager] removed all tokens" << std::endl;
    }

    void SessionManager::set_user_id(const std::string& user_id) {
        std::lock_guard<std::mutex> lock(mu_);
        user_id_ = user_id;
        if (!write_file_token(get_session_dir() / "user_id", user_id_)) {
            std::cerr << "[SessionManager] failed to persist user_id" << std::endl;
        }
    }

    std::string SessionManager::get_user_id() const {
        std::lock_guard<std::mutex> lock(mu_);
        return user_id_;
    }

    void SessionManager::set_email(const std::string& email) {
        std::lock_guard<std::mutex> lock(mu_);
        email_ = email;
        if (!write_file_token(get_session_dir() / "email", email_)) {
            std::cerr << "[SessionManager] failed to persist email" << std::endl;
        }
    }

    std::string SessionManager::get_email() const {
        std::lock_guard<std::mutex> lock(mu_);
        return email_;
    }

    bool SessionManager::set_tokens(const std::string& access_token, const std::string& refresh_token) {
        std::lock_guard<std::mutex> lock(mu_);
        const fs::path session_dir = get_session_dir();
        const bool access_ok = write_file_token(session_dir / "token", access_token);
        const bool refresh_ok = write_file_token(session_dir / "refresh_token", refresh_token);
        if (!access_ok || !refresh_ok) {
            std::cerr << "[SessionManager] refusing to replace session tokens because persistence failed" << std::endl;
            return false;
        }
        token_         = access_token;
        refresh_token_ = refresh_token;
        session_expired_ = false;
        std::cerr << "[SessionManager] persisted tokens to " << session_dir << std::endl;
        return true;
    }

    bool SessionManager::update_tokens(const std::string& access_token, const std::string& refresh_token) {
        std::lock_guard<std::mutex> lock(mu_);
        token_         = access_token;
        refresh_token_ = refresh_token;
        session_expired_ = false;
        return save_tokens();
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
        const std::string refresh_token = get_refresh_token();
        if (refresh_token.empty()) {
            return RefreshResult::Failed;
        }

        const std::string proxy_url = EnvManager::get().get("PROXY_SERVICE_URL", "");
        if (proxy_url.empty()) {
            return RefreshResult::Failed;
        }

        std::map<std::string, std::string> headers;
        headers["Content-Type"] = "application/json";
        const std::string json_body = build_json_object({{"refresh_token", refresh_token}});

        HttpResponse response = execute_raw_http_request("POST", proxy_url + "/api/refresh", json_body, headers);
        if (response.status_code == 0 && ProxyManager::get().ensure_running()) {
            response = execute_raw_http_request("POST", proxy_url + "/api/refresh", json_body, headers);
        }

        if (response.status_code == 0) {
            ProxyManager::get().record_proxy_request_result(false);
        } else {
            ProxyManager::get().record_proxy_request_result(true);
        }

        if (response.status_code == 200) {
            try {
                const auto json_resp = nlohmann::json::parse(response.body);
                const std::string new_token = json_resp["token"].get<std::string>();
                const std::string new_refresh = json_resp["refresh_token"].get<std::string>();
                if (!update_tokens(new_token, new_refresh)) {
                    std::cerr << "[SessionManager] token refresh succeeded but session persistence failed" << std::endl;
                }
                std::cerr << "[SessionManager] token refresh succeeded" << std::endl;
                return RefreshResult::Success;
            } catch (...) {
                std::cerr << "[SessionManager] failed to parse refresh response" << std::endl;
            }
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
