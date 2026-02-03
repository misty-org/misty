#pragma once

#include <string>
#include <map>
#include <mutex>

namespace misty::core {

    class SessionManager {
    public:
        static SessionManager& get();

        // Store token in memory and persist to secure storage
        void set_token(const std::string& token);

        // Clear token from memory and secure storage (logout)
        void clear_token();

        // Get the stored JWT token (empty string if none)
        std::string get_token() const;

        // Check if user has a stored token
        bool is_authenticated() const;

        // Returns {"Authorization": "Bearer <token>"} if authenticated, empty map otherwise
        std::map<std::string, std::string> get_auth_headers() const;

    private:
        SessionManager();
        ~SessionManager() = default;
        SessionManager(const SessionManager&) = delete;
        SessionManager& operator=(const SessionManager&) = delete;

        void load_token();
        void save_token() const;
        void delete_token() const;

        mutable std::mutex mu_;
        std::string token_;
    };

}
