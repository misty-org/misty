#include "core/util.h"
#include <iostream>
#include <cstdlib>
#include <map>
#include <sstream>
#include <iomanip>
#include <ctime>
#include <chrono>
#include <nlohmann/json.hpp>

#ifdef _WIN32
#include <windows.h>
#include <shellapi.h>
#elif __APPLE__
// No additional includes needed for macOS
#elif __linux__
// No additional includes needed for Linux
#endif

namespace minidfs::core {
    bool open_file_in_browser(const std::string& path) {
        if (path.empty()) {
            std::cerr << "Warning: Cannot open empty path" << std::endl;
            return false;
        }

        std::cout << "Opening file in browser: " << path << std::endl;

#ifdef _WIN32
        HINSTANCE result = ShellExecuteA(NULL, "open", path.c_str(), NULL, NULL, SW_SHOWNORMAL);
        return reinterpret_cast<intptr_t>(result) > 32;
#elif __APPLE__
        std::string cmd = "open \"" + path + "\"";
        std::cout << "Opening file in browser: " << cmd << std::endl;
        int status = system(cmd.c_str());
        return status == 0;
#elif __linux__
        std::string cmd = "xdg-open \"" + path + "\"";
        int status = system(cmd.c_str());
        return status == 0;
#else
        std::cerr << "Warning: open_file_in_browser not implemented for this platform" << std::endl;
        return false;
#endif
    }

    std::string build_json_object(const std::map<std::string, std::string>& fields) {
        nlohmann::json j;
        for (const auto& [key, value] : fields) {
            j[key] = value;
        }
        return j.dump();
    }

    bool is_device_online(const std::string& last_seen_timestamp) {
        if (last_seen_timestamp.empty()) {
            return false;
        }

        try {
            // Parse timestamp - Go time.Time JSON encodes as RFC3339 (ISO 8601)
            // Format: "2024-01-20T12:34:56.123456789Z" or "2024-01-20T12:34:56Z"
            std::tm tm = {};
            std::istringstream ss(last_seen_timestamp);
            
            // Try RFC3339 format with timezone first
            ss >> std::get_time(&tm, "%Y-%m-%dT%H:%M:%S");
            if (ss.fail()) {
                // Try without 'T' separator (SQLite format)
                ss.clear();
                ss.str(last_seen_timestamp);
                ss >> std::get_time(&tm, "%Y-%m-%d %H:%M:%S");
            }
            
            if (!ss.fail()) {
                auto last_seen_time = std::chrono::system_clock::from_time_t(std::mktime(&tm));
                auto now = std::chrono::system_clock::now();
                auto diff = std::chrono::duration_cast<std::chrono::minutes>(now - last_seen_time);
                
                // Device is online if last_seen is within 2 minutes
                return (diff.count() >= 0 && diff.count() <= 2);
            }
        } catch (...) {
            // If parsing fails, assume offline
        }
        
        return false;
    }
}