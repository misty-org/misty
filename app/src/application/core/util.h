#pragma once

#include <string>
#include <map>

namespace minidfs::core {
    bool open_file_in_browser(const std::string& path);
    
    // Build a JSON object from a map of key-value pairs (convenience wrapper around nlohmann/json)
    std::string build_json_object(const std::map<std::string, std::string>& fields);
    
    // Get the user's home directory path
    std::string get_user_home_dir();
    
}