#ifdef _WIN32
    #include <windows.h>
    #include "platform/windows/windows_app.h"
#elif defined(__APPLE__)
    #include "platform/mac/mac_app.h"
#elif defined(__linux__)
    #include "platform/linux/linux_app.h"
#endif

#include "application.h"
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

int main(int argc, char** argv) {
    (void)argc;
    (void)argv;
    curl_global_init(CURL_GLOBAL_DEFAULT);

    // Anchor cwd to the executable directory so relative runtime files behave
    // the same from Finder/Explorer and arbitrary shells. Assets are resolved
    // through AssetManager and seeded into ~/.misty/assets.
    try {
        std::filesystem::current_path(misty::core::get_executable_path().parent_path());
    } catch (...) {
    }

    auto app = create_application();
    app->run();

    curl_global_cleanup();
    return 0;
}

    
