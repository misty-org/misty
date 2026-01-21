#pragma once

#include <string>
#include <map>

namespace minidfs::core {
    bool open_file_in_browser(const std::string& path);
    
    // Build a JSON object from a map of key-value pairs (convenience wrapper around nlohmann/json)
    std::string build_json_object(const std::map<std::string, std::string>& fields);
    
    // Check if a timestamp string indicates the device is online (within 2 minutes)
    // Returns true if last_seen is within the last 2 minutes, false otherwise
    bool is_device_online(const std::string& last_seen_timestamp);
}