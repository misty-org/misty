#include "core/system/util.h"
#include <cstdio>
#include <iostream>
#include <cstdlib>
#include <map>
#include <ctime>
#include <vector>
#include <filesystem>
#include <nlohmann/json.hpp>

#ifdef _WIN32
#include <windows.h>
#include <psapi.h>
#include <shellapi.h>
#include <shlobj.h>
#include <processthreadsapi.h>
#include <stringapiset.h>
#elif __APPLE__
#include <errno.h>
#include <fcntl.h>
#include <mach/mach.h>
#include <mach-o/dyld.h>
#include <pwd.h>
#include <sys/wait.h>
#include <unistd.h>
#include <sys/stat.h>
#elif __linux__
#include <errno.h>
#include <fcntl.h>
#include <pwd.h>
#include <sys/wait.h>
#include <unistd.h>
#include <sys/stat.h>
#endif

#ifndef _WIN32
extern char** environ;
#endif

namespace fs = std::filesystem;

namespace misty::core {
    namespace {
        int run_process_blocking(const std::string& executable_path,
                                 const std::vector<std::string>& args,
                                 const std::string& working_directory = "") {
#ifdef _WIN32
            (void)executable_path;
            (void)args;
            (void)working_directory;
            return -1;
#else
            pid_t pid = fork();
            if (pid < 0) {
                return -1;
            }
            if (pid == 0) {
                if (!working_directory.empty()) {
                    chdir(working_directory.c_str());
                }

                std::vector<char*> argv;
                argv.push_back(const_cast<char*>(executable_path.c_str()));
                for (const auto& arg : args) {
                    argv.push_back(const_cast<char*>(arg.c_str()));
                }
                argv.push_back(nullptr);

                execve(executable_path.c_str(), argv.data(), environ);
                _exit(127);
            }

            int status = 0;
            if (waitpid(pid, &status, 0) < 0) {
                return -1;
            }
            if (WIFEXITED(status)) {
                return WEXITSTATUS(status);
            }
            return -1;
#endif
        }

#ifdef __APPLE__
        std::string shell_quote(const std::string& value) {
            std::string quoted = "'";
            for (char c : value) {
                if (c == '\'') {
                    quoted += "'\\''";
                } else {
                    quoted += c;
                }
            }
            quoted += "'";
            return quoted;
        }

        std::string applescript_quote(const std::string& value) {
            std::string quoted = "\"";
            for (char c : value) {
                if (c == '\\' || c == '"') {
                    quoted += '\\';
                }
                quoted += c;
            }
            quoted += "\"";
            return quoted;
        }

        bool run_osascript(const std::vector<std::string>& script_lines) {
            std::vector<std::string> args;
            for (const auto& line : script_lines) {
                args.push_back("-e");
                args.push_back(line);
            }
            return run_process_blocking("/usr/bin/osascript", args) == 0;
        }
#endif
    }

    std::string format_bytes(uint64_t bytes) {
        if (bytes < 1024) {
            return std::to_string(bytes) + " B";
        }
        if (bytes < 1024ULL * 1024) {
            return std::to_string(bytes / 1024) + " KB";
        }
        if (bytes < 1024ULL * 1024 * 1024) {
            char buf[32];
            std::snprintf(buf, sizeof(buf), "%.1f MB", static_cast<double>(bytes) / (1024.0 * 1024.0));
            return buf;
        }

        char buf[32];
        std::snprintf(buf, sizeof(buf), "%.2f GB", static_cast<double>(bytes) / (1024.0 * 1024.0 * 1024.0));
        return buf;
    }

    std::string format_bytes(int64_t bytes) {
        if (bytes <= 0) {
            return "0 B";
        }
        return format_bytes(static_cast<uint64_t>(bytes));
    }

    std::string path_utf8_string(const std::filesystem::path& path) {
#if defined(__cpp_char8_t)
        const auto value = path.u8string();
        return std::string(reinterpret_cast<const char*>(value.data()), value.size());
#else
        return path.u8string();
#endif
    }

    std::string path_utf8_generic_string(const std::filesystem::path& path) {
#if defined(__cpp_char8_t)
        const auto value = path.generic_u8string();
        return std::string(reinterpret_cast<const char*>(value.data()), value.size());
#else
        return path.generic_u8string();
#endif
    }

    std::string path_utf8_filename(const std::filesystem::path& path) {
        return path_utf8_string(path.filename());
    }

    ProcessMemoryUsage get_process_memory_usage() {
        ProcessMemoryUsage usage;
#ifdef _WIN32
        PROCESS_MEMORY_COUNTERS_EX counters{};
        if (GetProcessMemoryInfo(GetCurrentProcess(),
                                 reinterpret_cast<PROCESS_MEMORY_COUNTERS*>(&counters),
                                 sizeof(counters))) {
            usage.resident_bytes = static_cast<uint64_t>(counters.WorkingSetSize);
            usage.footprint_bytes = static_cast<uint64_t>(counters.PrivateUsage);
            usage.available = true;
        }
#elif __APPLE__
        mach_task_basic_info basic_info{};
        mach_msg_type_number_t basic_count = MACH_TASK_BASIC_INFO_COUNT;
        if (task_info(mach_task_self(),
                      MACH_TASK_BASIC_INFO,
                      reinterpret_cast<task_info_t>(&basic_info),
                      &basic_count) == KERN_SUCCESS) {
            usage.resident_bytes = static_cast<uint64_t>(basic_info.resident_size);
            usage.available = true;
        }

#ifdef TASK_VM_INFO
        task_vm_info_data_t vm_info{};
        mach_msg_type_number_t vm_count = TASK_VM_INFO_COUNT;
        if (task_info(mach_task_self(),
                      TASK_VM_INFO,
                      reinterpret_cast<task_info_t>(&vm_info),
                      &vm_count) == KERN_SUCCESS) {
            usage.footprint_bytes = static_cast<uint64_t>(vm_info.phys_footprint);
            usage.available = true;
        }
#endif
#elif __linux__
        std::FILE* file = std::fopen("/proc/self/statm", "r");
        if (file != nullptr) {
            long total_pages = 0;
            long resident_pages = 0;
            if (std::fscanf(file, "%ld %ld", &total_pages, &resident_pages) == 2) {
                const long page_size = sysconf(_SC_PAGESIZE);
                usage.resident_bytes = static_cast<uint64_t>(resident_pages) * static_cast<uint64_t>(page_size);
                usage.footprint_bytes = static_cast<uint64_t>(total_pages) * static_cast<uint64_t>(page_size);
                usage.available = true;
            }
            std::fclose(file);
        }
#endif
        if (usage.footprint_bytes == 0) {
            usage.footprint_bytes = usage.resident_bytes;
        }
        return usage;
    }

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

    bool move_path_with_user_approval(const std::filesystem::path& source_path,
                                      const std::filesystem::path& target_path) {
        if (source_path.empty() || target_path.empty()) {
            return false;
        }

#ifdef __APPLE__
        std::error_code ec;
        if (!target_path.parent_path().empty()) {
            std::filesystem::create_directories(target_path.parent_path(), ec);
        }

        const std::string command =
            "/bin/mkdir -p " + shell_quote(target_path.parent_path().string()) +
            " && /bin/mv " + shell_quote(source_path.string()) +
            " " + shell_quote(target_path.string());
        return run_osascript({
            "do shell script " + applescript_quote(command) + " with administrator privileges",
        });
#else
        (void)source_path;
        (void)target_path;
        return false;
#endif
    }

    bool delete_path_with_user_approval(const std::filesystem::path& path) {
        if (path.empty()) {
            return false;
        }

#ifdef __APPLE__
        const std::string command = "/bin/rm -rf " + shell_quote(path.string());
        return run_osascript({
            "do shell script " + applescript_quote(command) + " with administrator privileges",
        });
#else
        (void)path;
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
        return launch_detached_process(executable_path, args, working_directory, "", "");
    }

    bool launch_detached_process(const std::string& executable_path,
                                 const std::vector<std::string>& args,
                                 const std::string& working_directory,
                                 const std::string& stdout_path,
                                 const std::string& stderr_path) {
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
        int exec_status_pipe[2]{-1, -1};
        if (pipe(exec_status_pipe) != 0) {
            return false;
        }
        // Ensure the write end closes automatically on successful exec.
        fcntl(exec_status_pipe[1], F_SETFD, fcntl(exec_status_pipe[1], F_GETFD) | FD_CLOEXEC);

        pid_t pid = fork();
        if (pid < 0) {
            close(exec_status_pipe[0]);
            close(exec_status_pipe[1]);
            return false;
        }
        if (pid > 0) {
            close(exec_status_pipe[1]);
            int child_errno = 0;
            const ssize_t n = read(exec_status_pipe[0], &child_errno, sizeof(child_errno));
            close(exec_status_pipe[0]);
            // Success path: child exec'd; pipe closed with no data.
            if (n == 0) {
                return true;
            }
            return false;
        }

        close(exec_status_pipe[0]);

        if (setsid() < 0) {
            _exit(1);
        }

        if (!working_directory.empty()) {
            chdir(working_directory.c_str());
        }

        FILE* null_file = freopen("/dev/null", "r", stdin);
        (void)null_file;

        const char* out_path = stdout_path.empty() ? "/dev/null" : stdout_path.c_str();
        const char* err_path = stderr_path.empty() ? "/dev/null" : stderr_path.c_str();
        freopen(out_path, "a", stdout);
        freopen(err_path, "a", stderr);

        std::vector<char*> argv;
        argv.push_back(const_cast<char*>(executable_path.c_str()));
        for (const auto& arg : args) {
            argv.push_back(const_cast<char*>(arg.c_str()));
        }
        argv.push_back(nullptr);

        execve(executable_path.c_str(), argv.data(), environ);
        const int err = errno;
        (void)write(exec_status_pipe[1], &err, sizeof(err));
        _exit(1);
#endif
    }


    uint64_t get_directory_size(const std::string& dir_path) {
        uint64_t total = 0;
        std::error_code ec;
        if (!fs::exists(dir_path, ec)) return 0;

        for (const auto& entry : fs::recursive_directory_iterator(
                dir_path, fs::directory_options::skip_permission_denied, ec)) {
            if (entry.is_regular_file(ec)) {
                total += entry.file_size(ec);
            }
        }
        return total;
    }

    std::string default_string(const std::string& value, const char* fallback) {
        return value.empty() ? std::string(fallback) : value;
    }


    std::string strip_trailing_separators(std::string path) {
        while (path.size() > 1 && (path.back() == '/' || path.back() == '\\')) {
            if (path.size() == 3 && path[1] == ':') {
                break;
            }
            path.pop_back();
        }
        return path;
    }

    void sanitize_path(std::string& path) {
        while (path.size() > 1 && path.back() == '/') {
            path.pop_back();
        }
    }

    bool path_under(const std::string& ancestor, const std::string& descendant) {
        if (descendant.size() < ancestor.size()) {
            return false;
        }
        if (descendant.compare(0, ancestor.size(), ancestor) != 0) {
            return false;
        }
        return descendant.size() == ancestor.size() || descendant[ancestor.size()] == '/';
    }

    std::string format_rfc3339_nano(const timespec& ts) {
        char buf[64];
        struct tm tm_utc;
        gmtime_r(&ts.tv_sec, &tm_utc);
        int head = strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%S", &tm_utc);
        if (head <= 0) {
            return "";
        }
        std::snprintf(buf + head, sizeof(buf) - head, ".%09ldZ", static_cast<long>(ts.tv_nsec));
        return std::string(buf);
    }

    std::vector<std::string> split_path(const std::string& path) {
        std::vector<std::string> components;
        std::string current;
        for (char c : path) {
            if (c == '/') {
                if (!current.empty()) {
                    components.push_back(current);
                    current.clear();
                }
            } else {
                current += c;
            }
        }
        if (!current.empty()) {
            components.push_back(current);
        }
        return components;
    }
}
