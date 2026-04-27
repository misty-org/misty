#ifdef _WIN32
    #include <windows.h>
    #include "platform/windows/windows_app.h"
#elif defined(__APPLE__)
    #include "platform/mac/mac_app.h"
#elif defined(__linux__)
    #include "platform/linux/linux_app.h"
#endif

#include "application.h"
#include <cstdlib>
#include <memory>
#include <curl/curl.h>
#include <filesystem>
#include "core/system/util.h"

std::unique_ptr<misty::Application> create_application() {
    #ifdef _WIN32
        return std::make_unique<misty::WindowsApp>();
    #elif defined(__APPLE__)
        return std::make_unique<misty::MacApp>();
    #elif defined(__linux__)
        return std::make_unique<misty::LinuxApp>();
    #else
        static_assert(sizeof(void*) == 0, "Unsupported platform");
    #endif
}

namespace {
    void set_boot_loader_opt_in() {
#ifdef _WIN32
        _putenv_s("MISTY_BOOT_LOADER", "1");
#else
        setenv("MISTY_BOOT_LOADER", "1", 1);
#endif
    }

    void parse_dev_flags(int argc, char** argv) {
        for (int i = 1; i < argc; ++i) {
            const std::string arg = argv[i] ? argv[i] : "";
            if (arg == "--boot-loader" || arg == "--boot") {
                set_boot_loader_opt_in();
            }
        }
    }
} // namespace

int main(int argc, char** argv) {
    curl_global_init(CURL_GLOBAL_DEFAULT);
    parse_dev_flags(argc, argv);

    // Stabilize relative asset/config paths: many client resources are loaded
    // via "assets/..." relative paths. Anchor cwd to the executable directory
    // so launching from Finder/Explorer (or arbitrary shells) behaves the same.
    try {
        std::filesystem::current_path(misty::core::get_executable_path().parent_path());
    } catch (...) {
    }

    auto app = create_application();
    app->run();

    curl_global_cleanup();
    return 0;
}

    
