#pragma once

#include <string>
#include <map>

namespace misty::core {
    bool open_file_in_browser(const std::string& path);
    
    // Build a JSON object from a map of key-value pairs (convenience wrapper around nlohmann/json)
    std::string build_json_object(const std::map<std::string, std::string>& fields);
    
    // Get the user's home directory path
    std::string get_user_home_dir();

    // URL-encode a string for use in query parameters
    inline std::string url_encode(const std::string& str) {
        std::string result;
        result.reserve(str.size());
        for (unsigned char c : str) {
            if ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') ||
                (c >= '0' && c <= '9') || c == '-' || c == '_' || c == '.' || c == '~') {
                result += c;
            } else {
                char buf[4];
                snprintf(buf, sizeof(buf), "%%%02X", c);
                result += buf;
            }
        }
        return result;
    }

}