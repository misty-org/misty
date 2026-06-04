#include "core/manager/proxy_manager.h"

#include <chrono>
#include <cctype>
#include <filesystem>
#include <thread>
#include <string>
#include <vector>

#ifdef _WIN32
#include <windows.h>
#include <tlhelp32.h>
#else
#include <spawn.h>
#include <sys/wait.h>
extern char** environ;
#endif

#include "core/manager/env_manager.h"
#include "core/net/http_client.h"
#include "core/system/util.h"

namespace fs = std::filesystem;

namespace misty::core {

namespace {

#ifdef _WIN32
constexpr const char* kProxyBinaryName = "misty-proxy.exe";
#else
constexpr const char* kProxyBinaryName = "misty-proxy";
#endif

constexpr auto kProxyProbeRetryInterval = std::chrono::seconds(2);
constexpr int kProxyUnavailablePromptIntervals = 4;

bool is_local_proxy_url(const std::string& url) {
    return url.rfind("http://127.0.0.1", 0) == 0 ||
           url.rfind("http://localhost", 0) == 0 ||
           url.rfind("http://0.0.0.0", 0) == 0;
}

#ifdef _WIN32
std::string lowercase_copy(std::string value) {
    for (char& c : value) {
        c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
    }
    return value;
}

bool process_matches_proxy(HANDLE process_handle,
                           DWORD pid,
                           DWORD current_pid,
                           const std::string& target_path,
                           const std::string& target_name) {
    if (pid == 0 || pid == current_pid) {
        return false;
    }

    char image_path[MAX_PATH];
    DWORD size = static_cast<DWORD>(std::size(image_path));
    if (!QueryFullProcessImageNameA(process_handle, 0, image_path, &size)) {
        return false;
    }

    const std::string process_path = lowercase_copy(std::string(image_path, size));
    const std::string process_name = lowercase_copy(fs::path(process_path).filename().string());
    return process_path == target_path || process_name == target_name;
}
#else
int run_blocking_process(const std::string& executable, const std::vector<std::string>& args) {
    std::vector<char*> argv;
    argv.reserve(args.size() + 2);
    argv.push_back(const_cast<char*>(executable.c_str()));
    for (const auto& arg : args) {
        argv.push_back(const_cast<char*>(arg.c_str()));
    }
    argv.push_back(nullptr);

    pid_t pid = 0;
    if (posix_spawn(&pid, executable.c_str(), nullptr, nullptr, argv.data(), environ) != 0) {
        return -1;
    }

    int status = 0;
    if (waitpid(pid, &status, 0) < 0) {
        return -1;
    }
    if (!WIFEXITED(status)) {
        return -1;
    }
    return WEXITSTATUS(status);
}
#endif

} // namespace

ProxyManager& ProxyManager::get() {
    static ProxyManager instance;
    return instance;
}

bool ProxyManager::should_manage_proxy() const {
    const std::string proxy_url = EnvManager::get().get("PROXY_SERVICE_URL", "");
    return !proxy_url.empty() && is_local_proxy_url(proxy_url);
}

bool ProxyManager::probe_proxy_once(bool force) const {
    const auto now = std::chrono::steady_clock::now();
    {
        std::lock_guard<std::mutex> lock(mu_);
        if (!force &&
            last_probe_attempt_.time_since_epoch().count() != 0 &&
            now - last_probe_attempt_ < kProxyProbeRetryInterval) {
            return last_known_available_;
        }
        last_probe_attempt_ = now;
    }
    return HTTPClient::get().probe_proxy();
}

void ProxyManager::record_proxy_request_result(bool available, const std::string& message) {
    const auto now = std::chrono::steady_clock::now();
    std::lock_guard<std::mutex> lock(mu_);

    last_known_available_ = available;
    if (available) {
        consecutive_probe_failures_ = 0;
        last_failure_recorded_at_ = std::chrono::steady_clock::time_point{};
        proxy_status_message_.clear();
        return;
    }

    if (last_failure_recorded_at_.time_since_epoch().count() != 0 &&
        now - last_failure_recorded_at_ < kProxyProbeRetryInterval) {
        return;
    }

    last_failure_recorded_at_ = now;
    ++consecutive_probe_failures_;
    if (consecutive_probe_failures_ < kProxyUnavailablePromptIntervals) {
        return;
    }

    proxy_status_message_ =
        message.empty()
            ? "Misty background service is unavailable. Local files remain available, but cloud and sync features are paused."
            : message;
}

bool ProxyManager::is_proxy_available() const {
    std::lock_guard<std::mutex> lock(mu_);
    return last_known_available_;
}

std::string ProxyManager::get_proxy_status_message() const {
    std::lock_guard<std::mutex> lock(mu_);
    return proxy_status_message_;
}

bool ProxyManager::ensure_running(bool force) {
    if (probe_proxy_once(force)) {
        return true;
    }
    if (!should_manage_proxy()) {
        return false;
    }

    std::unique_lock<std::mutex> lock(mu_);
    const auto now = std::chrono::steady_clock::now();
    if (!force &&
        last_launch_attempt_.time_since_epoch().count() != 0 &&
        now - last_launch_attempt_ < kProxyProbeRetryInterval) {
        lock.unlock();
        return wait_until_ready(kProxyProbeRetryInterval);
    }

    last_launch_attempt_ = now;
    const bool launched = launch_proxy_process();
    lock.unlock();

    if (!launched) {
        return false;
    }

    return wait_until_ready(std::chrono::seconds(10));
}

bool ProxyManager::restart_proxy() {
    if (!should_manage_proxy()) {
        return false;
    }

    const std::string proxy_executable = resolve_proxy_executable();
    if (proxy_executable.empty()) {
        return false;
    }

    std::unique_lock<std::mutex> lock(mu_);
    if (!terminate_existing_proxies(proxy_executable)) {
        return false;
    }
    last_launch_attempt_ = std::chrono::steady_clock::now();
    const bool launched = launch_proxy_process();
    lock.unlock();
    if (!launched) {
        return false;
    }
    return wait_until_ready(std::chrono::seconds(10));
}

bool ProxyManager::wait_until_ready(std::chrono::milliseconds timeout) const {
    const auto deadline = std::chrono::steady_clock::now() + timeout;
    while (std::chrono::steady_clock::now() < deadline) {
        if (probe_proxy_once()) {
            return true;
        }
        const auto remaining = deadline - std::chrono::steady_clock::now();
        if (remaining <= std::chrono::milliseconds::zero()) {
            break;
        }
        std::this_thread::sleep_for(
            remaining < kProxyProbeRetryInterval ? remaining : kProxyProbeRetryInterval);
    }
    return probe_proxy_once(true);
}

std::string ProxyManager::resolve_proxy_executable() const {
    const fs::path exe_dir = get_executable_path().parent_path();
    const std::vector<fs::path> candidates = {
        exe_dir / kProxyBinaryName,
        exe_dir / "proxy" / kProxyBinaryName,
        exe_dir.parent_path() / "proxy" / kProxyBinaryName,
        fs::current_path() / "proxy" / kProxyBinaryName,
    };

    for (const auto& candidate : candidates) {
        if (!candidate.empty() && fs::exists(candidate)) {
            return candidate.string();
        }
    }

    for (fs::path cur : {exe_dir, fs::current_path()}) {
        for (int i = 0; i < 6; ++i) {
            const fs::path candidate = cur / "proxy" / "dist" / kProxyBinaryName;
            if (fs::exists(candidate)) {
                return candidate.string();
            }
            if (!cur.has_parent_path()) {
                break;
            }
            cur = cur.parent_path();
        }
    }

    return "";
}

bool ProxyManager::launch_proxy_process() {
    const std::string proxy_executable = resolve_proxy_executable();
    if (proxy_executable.empty()) {
        return false;
    }

    const fs::path proxy_path(proxy_executable);
    return launch_detached_process(proxy_path.string(), {}, proxy_path.parent_path().string());
}

bool ProxyManager::terminate_existing_proxies(const std::string& proxy_executable) const {
#ifdef _WIN32
    const HANDLE snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
    if (snapshot == INVALID_HANDLE_VALUE) {
        return false;
    }

    PROCESSENTRY32 entry{};
    entry.dwSize = sizeof(entry);

    const DWORD current_pid = GetCurrentProcessId();
    const std::string target_path = lowercase_copy(fs::path(proxy_executable).lexically_normal().string());
    const std::string target_name = lowercase_copy(fs::path(proxy_executable).filename().string());
    bool enumerated = Process32First(snapshot, &entry) == TRUE;
    bool success = true;

    while (enumerated) {
        const HANDLE process_handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_TERMINATE | SYNCHRONIZE,
                                                  FALSE, entry.th32ProcessID);
        if (process_handle != nullptr) {
            if (process_matches_proxy(process_handle, entry.th32ProcessID, current_pid, target_path, target_name)) {
                if (!TerminateProcess(process_handle, 0)) {
                    success = false;
                } else {
                    WaitForSingleObject(process_handle, 2000);
                }
            }
            CloseHandle(process_handle);
        }
        enumerated = Process32Next(snapshot, &entry) == TRUE;
    }

    CloseHandle(snapshot);
    std::this_thread::sleep_for(std::chrono::milliseconds(400));
    return success;
#else
    const std::vector<std::vector<std::string>> commands = {
        {"-f", proxy_executable},
        {"-x", kProxyBinaryName},
    };

    bool ran_any = false;
    for (const auto& args : commands) {
        if (run_blocking_process("/usr/bin/pkill", args) >= 0) {
            ran_any = true;
        }
    }
    if (!ran_any) {
        return false;
    }

    std::this_thread::sleep_for(std::chrono::milliseconds(400));
    return true;
#endif
}

} // namespace misty::core
