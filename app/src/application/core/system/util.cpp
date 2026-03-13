#include "core/system/util.h"
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

namespace misty::core {
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

}