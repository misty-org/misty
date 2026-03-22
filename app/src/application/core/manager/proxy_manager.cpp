#include "core/manager/proxy_manager.h"

#include <chrono>
#include <filesystem>
#include <thread>
#include <vector>

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

bool is_local_proxy_url(const std::string& url) {
    return url.rfind("http://127.0.0.1", 0) == 0 ||
           url.rfind("http://localhost", 0) == 0 ||
           url.rfind("http://0.0.0.0", 0) == 0;
}

} // namespace

ProxyManager& ProxyManager::get() {
    static ProxyManager instance;
    return instance;
}

bool ProxyManager::should_manage_proxy() const {
    const std::string proxy_url = EnvManager::get().get("PROXY_SERVICE_URL", "");
    return !proxy_url.empty() && is_local_proxy_url(proxy_url);
}

bool ProxyManager::probe_proxy_once() const {
    return HTTPClient::get().probe_proxy();
}

bool ProxyManager::ensure_running() {
    if (probe_proxy_once()) {
        return true;
    }
    if (!should_manage_proxy()) {
        return false;
    }

    std::unique_lock<std::mutex> lock(mu_);
    const auto now = std::chrono::steady_clock::now();
    if (last_launch_attempt_.time_since_epoch().count() != 0 &&
        now - last_launch_attempt_ < std::chrono::seconds(3)) {
        lock.unlock();
        return wait_until_ready(std::chrono::seconds(2));
    }

    last_launch_attempt_ = now;
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
        std::this_thread::sleep_for(std::chrono::milliseconds(250));
    }
    return probe_proxy_once();
}

std::string ProxyManager::resolve_proxy_executable() const {
    const std::string configured = EnvManager::get().get("MISTY_PROXY_PATH", "");
    if (!configured.empty() && fs::exists(configured)) {
        return configured;
    }

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

} // namespace misty::core
