#include "core/util.h"
#include <iostream>
#include <cstdlib>
#include <map>
#include <ctime>
#include <nlohmann/json.hpp>

#ifdef _WIN32
#include <windows.h>
#include <shellapi.h>
#include <shlobj.h>
#elif __APPLE__
#include <pwd.h>
#include <unistd.h>
#elif __linux__
#include <pwd.h>
#include <unistd.h>
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

    std::string get_user_home_dir() {
#ifdef _WIN32
        char path[MAX_PATH];
        if (SUCCEEDED(SHGetFolderPathA(NULL, CSIDL_PROFILE, NULL, SHGFP_TYPE_CURRENT, path))) {
            return std::string(path);
        }
        // Fallback to USERPROFILE environment variable
        const char* home = std::getenv("USERPROFILE");
        if (home) {
            return std::string(home);
        }
        return "";
#elif __APPLE__ || __linux__
        // Try HOME environment variable first
        const char* home = std::getenv("HOME");
        if (home) {
            return std::string(home);
        }
        // Fallback to getpwuid
        struct passwd* pw = getpwuid(getuid());
        if (pw && pw->pw_dir) {
            return std::string(pw->pw_dir);
        }
        return "";
#else
        return "";
#endif
    }
}