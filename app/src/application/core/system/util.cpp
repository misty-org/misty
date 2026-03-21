#include "core/system/util.h"
#include <iostream>
#include <cstdlib>
#include <map>
#include <ctime>
#include <vector>
#include <filesystem>
#include <nlohmann/json.hpp>

#ifdef _WIN32
#include <windows.h>
#include <shellapi.h>
#include <shlobj.h>
#include <processthreadsapi.h>
#include <stringapiset.h>
#elif __APPLE__
#include <mach-o/dyld.h>
#include <pwd.h>
#include <unistd.h>
#include <sys/stat.h>
#elif __linux__
#include <pwd.h>
#include <unistd.h>
#include <sys/stat.h>
#endif

#ifndef _WIN32
extern char** environ;
#endif

namespace misty::core {
    bool open_path_default(const std::string& path) {
        if (path.empty()) {
            return false;
        }

#ifdef _WIN32
        HINSTANCE result = ShellExecuteA(nullptr, "open", path.c_str(), nullptr, nullptr, SW_SHOWNORMAL);
        return reinterpret_cast<intptr_t>(result) > 32;
#elif __APPLE__
        return launch_detached_process("/usr/bin/open", {path});
#elif __linux__
        return launch_detached_process("/usr/bin/xdg-open", {path});
#else
        return false;
#endif
    }

    bool open_path_with_application(const std::string& application_path, const std::string& target_path) {
        if (application_path.empty() || target_path.empty()) {
            return false;
        }

#ifdef _WIN32
        std::filesystem::path app_path(application_path);
        return launch_detached_process(application_path, {target_path}, app_path.parent_path().string());
#elif __APPLE__
        return launch_detached_process("/usr/bin/open", {"-a", application_path, target_path});
#elif __linux__
        std::filesystem::path app_path(application_path);
        return launch_detached_process(application_path, {target_path}, app_path.parent_path().string());
#else
        return false;
#endif
    }

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

    std::filesystem::path get_executable_path() {
#ifdef _WIN32
        char buffer[MAX_PATH];
        DWORD length = GetModuleFileNameA(nullptr, buffer, MAX_PATH);
        if (length == 0 || length == MAX_PATH) return {};
        return std::filesystem::path(std::string(buffer, length));
#elif __APPLE__
        uint32_t size = 0;
        _NSGetExecutablePath(nullptr, &size);
        std::string path(size, '\0');
        if (_NSGetExecutablePath(path.data(), &size) != 0) return {};
        return std::filesystem::weakly_canonical(std::filesystem::path(path.c_str()));
#elif __linux__
        std::vector<char> buffer(1024);
        ssize_t length = readlink("/proc/self/exe", buffer.data(), buffer.size() - 1);
        if (length <= 0) return {};
        buffer[static_cast<size_t>(length)] = '\0';
        return std::filesystem::path(buffer.data());
#else
        return {};
#endif
    }

    bool launch_detached_process(const std::string& executable_path,
                                 const std::vector<std::string>& args,
                                 const std::string& working_directory) {
        if (executable_path.empty()) {
            return false;
        }

#ifdef _WIN32
        std::string command_line = "\"" + executable_path + "\"";
        for (const auto& arg : args) {
            command_line += " \"" + arg + "\"";
        }

        STARTUPINFOA startup_info{};
        startup_info.cb = sizeof(startup_info);
        PROCESS_INFORMATION process_info{};

        std::vector<char> mutable_cmd(command_line.begin(), command_line.end());
        mutable_cmd.push_back('\0');

        BOOL ok = CreateProcessA(
            executable_path.c_str(),
            mutable_cmd.data(),
            nullptr,
            nullptr,
            FALSE,
            CREATE_NO_WINDOW | DETACHED_PROCESS,
            nullptr,
            working_directory.empty() ? nullptr : working_directory.c_str(),
            &startup_info,
            &process_info
        );
        if (!ok) {
            return false;
        }

        CloseHandle(process_info.hThread);
        CloseHandle(process_info.hProcess);
        return true;
#else
        pid_t pid = fork();
        if (pid < 0) {
            return false;
        }
        if (pid > 0) {
            return true;
        }

        if (setsid() < 0) {
            _exit(1);
        }

        if (!working_directory.empty()) {
            chdir(working_directory.c_str());
        }

        FILE* null_file = freopen("/dev/null", "r", stdin);
        (void)null_file;
        freopen("/dev/null", "w", stdout);
        freopen("/dev/null", "w", stderr);

        std::vector<char*> argv;
        argv.push_back(const_cast<char*>(executable_path.c_str()));
        for (const auto& arg : args) {
            argv.push_back(const_cast<char*>(arg.c_str()));
        }
        argv.push_back(nullptr);

        execve(executable_path.c_str(), argv.data(), environ);
        _exit(1);
#endif
    }

}
