#pragma once

#include <condition_variable>
#include <functional>
#include <map>
#include <mutex>
#include <string>

namespace misty::core {

    class SessionManager {
    public:
        enum class RefreshResult {
            Success,
            Unavailable,
            Failed
        };

        static SessionManager& get();

        // Store the current access token in memory. Durable session state lives
        // in the local proxy database.
        bool set_tokens(const std::string& access_token, const std::string& refresh_token);

        // Update the in-memory access token (used after a refresh)
        bool update_tokens(const std::string& access_token, const std::string& refresh_token);

        // Clear all tokens from memory and secure storage (logout)
        void clear_token();

        // Get the stored JWT access token (empty string if none)
        std::string get_token() const;

        // Get the stored refresh token (empty string if none)
        std::string get_refresh_token() const;

        bool bootstrap_session();
        bool ensure_session_ready();

        // User ID from the proxy — used to scope cloud provider API calls
        void set_user_id(const std::string& user_id);
        std::string get_user_id() const;

        // Email captured at login. Used by the settings Account section to
        // show the signed-in identity without re-decoding the JWT.
        void set_email(const std::string& email);
        std::string get_email() const;

        // Check if user has a stored token
        bool is_authenticated() const;

        // Session expiration (refresh failed but tokens preserved for reconnect)
        void mark_session_expired();
        bool is_session_expired() const;
        void clear_session_expired();
        RefreshResult attempt_token_refresh();

        void mark_proxy_available();
        void mark_proxy_unavailable(const std::string& message = "");
        bool is_proxy_available() const;
        std::string get_proxy_status_message() const;

        // Returns {"Authorization": "Bearer <token>"} if authenticated, empty map otherwise
        std::map<std::string, std::string> get_auth_headers() const;

    private:
        SessionManager();
        ~SessionManager() = default;
        SessionManager(const SessionManager&) = delete;
        SessionManager& operator=(const SessionManager&) = delete;

        void load_tokens();
        bool save_tokens() const;
        void delete_tokens() const;
        bool apply_session_response(const std::string& body);

        mutable std::mutex mu_;
        std::string token_;
        std::string refresh_token_;
        std::string user_id_;
        std::string email_;
        bool session_expired_ = false;
        bool proxy_available_ = true;
        std::string proxy_status_message_;

        mutable std::mutex bootstrap_mu_;
        std::condition_variable bootstrap_cv_;
        bool bootstrap_in_flight_ = false;
    };

}
