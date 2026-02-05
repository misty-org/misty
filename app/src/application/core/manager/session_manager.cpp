#include "session_manager.h"
#include <iostream>
#include <fstream>
#include <filesystem>
#include <sys/stat.h>
#include <cstdlib>

namespace fs = std::filesystem;

namespace misty::core {

    static fs::path get_misty_dir() {
        const char* home = getenv("HOME");
        return fs::path(home ? home : "/tmp") / ".misty";
    }

    static void ensure_misty_dir() {
        fs::path dir = get_misty_dir();
        if (!fs::exists(dir)) {
            fs::create_directories(dir);
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

    static void write_file_token(const fs::path& path, const std::string& value) {
        ensure_misty_dir();
        std::ofstream file(path);
        if (file.is_open()) {
            file << value;
            chmod(path.c_str(), 0600);
        }
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
        token_         = read_file_token(get_misty_dir() / "token");
        refresh_token_ = read_file_token(get_misty_dir() / "refresh_token");
        license_token_ = read_file_token(get_misty_dir() / "license_token");
        user_id_       = read_file_token(get_misty_dir() / "user_id");
        if (!token_.empty())
            std::cerr << "[SessionManager] loaded access token (" << token_.size() << " bytes)" << std::endl;
        if (!refresh_token_.empty())
            std::cerr << "[SessionManager] loaded refresh token (" << refresh_token_.size() << " bytes)" << std::endl;
        if (!license_token_.empty())
            std::cerr << "[SessionManager] loaded license token (" << license_token_.size() << " bytes)" << std::endl;
    }

    void SessionManager::save_tokens() const {
        write_file_token(get_misty_dir() / "token",         token_);
        write_file_token(get_misty_dir() / "refresh_token", refresh_token_);
        write_file_token(get_misty_dir() / "license_token", license_token_);
        std::cerr << "[SessionManager] persisted tokens" << std::endl;
    }

    void SessionManager::delete_tokens() const {
        remove_file_token(get_misty_dir() / "token");
        remove_file_token(get_misty_dir() / "refresh_token");
        remove_file_token(get_misty_dir() / "license_token");
        remove_file_token(get_misty_dir() / "user_id");
        std::cerr << "[SessionManager] removed all tokens" << std::endl;
    }

    void SessionManager::set_user_id(const std::string& user_id) {
        std::lock_guard<std::mutex> lock(mu_);
        user_id_ = user_id;
        write_file_token(get_misty_dir() / "user_id", user_id_);
    }

    std::string SessionManager::get_user_id() const {
        std::lock_guard<std::mutex> lock(mu_);
        return user_id_;
    }

    void SessionManager::set_tokens(const std::string& access_token, const std::string& refresh_token) {
        std::lock_guard<std::mutex> lock(mu_);
        token_         = access_token;
        refresh_token_ = refresh_token;
        save_tokens();
    }

    void SessionManager::update_tokens(const std::string& access_token, const std::string& refresh_token) {
        std::lock_guard<std::mutex> lock(mu_);
        token_         = access_token;
        refresh_token_ = refresh_token;
        save_tokens();
    }

    void SessionManager::clear_token() {
        std::lock_guard<std::mutex> lock(mu_);
        token_.clear();
        refresh_token_.clear();
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

    void SessionManager::set_license_token(const std::string& license_token) {
        std::lock_guard<std::mutex> lock(mu_);
        license_token_ = license_token;
        write_file_token(get_misty_dir() / "license_token", license_token_);
    }

    std::string SessionManager::get_license_token() const {
        std::lock_guard<std::mutex> lock(mu_);
        return license_token_;
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
        if (!license_token_.empty()) {
            headers["X-License-Token"] = license_token_;
        }
        return headers;
    }

}
