#pragma once

#include <string>
#include <map>
#include <mutex>

namespace misty::core {

    class SessionManager {
    public:
        static SessionManager& get();

        // Store both tokens in memory and persist to secure storage
        void set_tokens(const std::string& access_token, const std::string& refresh_token);

        // Update both tokens (used after a refresh)
        void update_tokens(const std::string& access_token, const std::string& refresh_token);

        // Clear all tokens from memory and secure storage (logout)
        void clear_token();

        // Get the stored JWT access token (empty string if none)
        std::string get_token() const;

        // Get the stored refresh token (empty string if none)
        std::string get_refresh_token() const;

        // Check if user has a stored token
        bool is_authenticated() const;

        // Session expiration (refresh failed but tokens preserved for reconnect)
        void mark_session_expired();
        bool is_session_expired() const;
        void clear_session_expired();

        // Returns {"Authorization": "Bearer <token>"} if authenticated, empty map otherwise
        std::map<std::string, std::string> get_auth_headers() const;

    private:
        SessionManager();
        ~SessionManager() = default;
        SessionManager(const SessionManager&) = delete;
        SessionManager& operator=(const SessionManager&) = delete;

        void load_tokens();
        void save_tokens() const;
        void delete_tokens() const;

        mutable std::mutex mu_;
        std::string token_;
        std::string refresh_token_;
        bool session_expired_ = false;
    };

}
